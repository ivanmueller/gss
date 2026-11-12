import { checkEmailDraft, EMAIL_DRAFT_JSON_SCHEMA, emailDraftAnswerSchema } from '@grain/domain';
import { Hono } from 'hono';

import {
  claudeClient,
  claudeFailure,
  notTakenByAnthropic,
  type ClaudeFactory,
  type ReadingAnswer,
} from './anthropic';
import { RECORDINGS_JOB_BUDGET_MS } from './calls';
import type { AutoDraftContext } from './email-auto-drafts-db';
import {
  DRAFT_DEADLINE_MS,
  DRAFT_INSTRUCTIONS,
  DRAFT_MESSAGE_MAX,
  draftMessage,
} from './email-drafts';
import {
  apiError,
  failureSummary,
  isUuid,
  withDatabase,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

// Email drafts Claude makes by itself (F-114 step 5c; the owner's answers 25 to 34 in
// docs/FEATURES.md, Codex's design review in docs/reviews/F-114-5c.md). When Claude's reading of a
// call or a received email said an email is wanted, the database added a pending draft; this job
// claims a few a run (within the organization's 200 Claude requests a day), asks Claude for the
// email with the same records as Draft with Claude, checks every number against what Claude was
// given, and keeps it. A person opens it in the email form and sends it, or dismisses it: nothing
// is sent by itself (AGENTS.md rule 8). Nothing of the records or the draft is logged.

/** Drafts written per run of the job, at most. */
const DRAFT_MOST = 2;
/** A short email: as for the button. */
const AUTO_DRAFT_MAX_TOKENS = 4000;

/** The button's instructions, and what an email nobody asked for by hand must also respect. */
export const AUTO_DRAFT_INSTRUCTIONS = `${DRAFT_INSTRUCTIONS}

This draft was not asked for by a person: it follows a call where an email was promised or asked for, or answers a received email that needs an answer. "Why this email" says which.
- When it mentions what GSS has to offer, give only the grain, grade, quantity, delivery period and area listed. Never a price: write [price] where one is needed. Never name a seller or any company other than the recipient's.
- When the records do not say what the email should contain, keep it short and write a placeholder for the person to fill in.`;

/** The fixed reason of each kind of draft: never generated text (F-114-5c-D1-02). */
const REASONS = {
  call: 'it follows the call below, where GSS said it would send an email or the counterparty asked for one.',
  email: 'the received email marked ANSWER needs an answer.',
} as const;

/**
 * The message for Claude, and the text its numbers are checked against: the same message with the
 * about line (Claude's own words from its reading) left out, so a number Claude made up there
 * cannot make itself known (F-114-5c-D1-02).
 */
export function autoDraftMessage(
  context: AutoDraftContext,
  now: Date,
): { message: string; checkSource: string } {
  const isBuyer = context.types.includes('buyer');
  const to =
    context.source === 'email'
      ? [context.answer === null ? 'the sender' : (context.answer.fromName ?? context.answer.from)]
      : [context.call?.contactName ?? 'the contact on the call'];
  const message = draftMessage(
    context,
    {
      senderName: context.sender?.name ?? 'a person at GSS',
      senderTitle: context.sender?.title ?? null,
      shared: context.shared,
      to,
      about: context.about,
      reason: REASONS[context.source],
      ...(isBuyer ? { offers: context.offers } : {}),
    },
    now,
  );
  const aboutLine = `What it is about: ${context.about}.`;
  const checkSource = message.replace(aboutLine, 'What it is about: (left out).');
  return { message, checkSource };
}

interface JobOptions {
  /** The clock, for tests. */
  now?: () => number;
}

/**
 * Writes the waiting drafts, at most DRAFT_MOST a run, within the job's time budget: a claim per
 * draft, kept under that claim only. A failed request stops the run and gives its attempt back
 * when Anthropic did not take it; an answer out of shape leaves the draft pending (its attempt
 * counted, at most 5). Without the API key it does nothing.
 */
export async function draftWaitingEmails(
  env: ApiEnv['Bindings'],
  openDatabase: DatabaseFactory,
  claude: ClaudeFactory = claudeClient,
  { now = Date.now }: JobOptions = {},
) {
  const client = claude(env);
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (client === null || !url) return;
  const started = now();
  const db = openDatabase(url, { viaHyperdrive: env.HYPERDRIVE !== undefined });
  try {
    for (let count = 0; count < DRAFT_MOST; count += 1) {
      if (now() - started >= RECORDINGS_JOB_BUDGET_MS) break;
      const [claim] = await db.claimEmailAutoDrafts(1);
      if (claim === undefined) break;
      try {
        const context = await db.emailAutoDraftContext(claim);
        if (context === null) continue;
        const { message, checkSource } = autoDraftMessage(context, new Date(now()));
        if (message.length > DRAFT_MESSAGE_MAX) {
          // Cannot happen within the context's limits; never sent to Claude if it does.
          console.error('Email auto draft: not written too_large');
          continue;
        }
        let answer: ReadingAnswer;
        try {
          answer = await client.readCall({
            system: AUTO_DRAFT_INSTRUCTIONS,
            user: message,
            schema: EMAIL_DRAFT_JSON_SCHEMA,
            maxTokens: AUTO_DRAFT_MAX_TOKENS,
            deadlineMs: DRAFT_DEADLINE_MS,
          });
        } catch (error) {
          console.error(
            `Email auto draft: not written, paused until the next run: ${claudeFailure(error)}`,
          );
          if (notTakenByAnthropic(error)) await db.releaseEmailAutoDraft(claim);
          break;
        }
        const model = /^[a-z0-9][a-z0-9.-]{0,79}$/.test(answer.model) ? answer.model : null;
        if (answer.status !== 'read') {
          console.error(
            `Email auto draft: not written ${answer.status} model=${model ?? 'unknown'}`,
          );
          continue;
        }
        const parsed = emailDraftAnswerSchema.safeParse(answer.json);
        if (!parsed.success) {
          console.error(`Email auto draft: not written shape model=${model ?? 'unknown'}`);
          continue;
        }
        const check = checkEmailDraft(parsed.data, checkSource);
        const kept = await db.keepEmailAutoDraft(claim, {
          model,
          subject: parsed.data.subject,
          message: parsed.data.message,
          checkThis: check.checkThis,
          placeholders: check.placeholders,
          inputTokens: answer.inputTokens,
          outputTokens: answer.outputTokens,
        });
        console.log(
          `Email auto draft: ${kept ? 'kept' : 'not kept'} model=${model ?? 'unknown'} in=${String(answer.inputTokens)} out=${String(answer.outputTokens)}`,
        );
      } catch (error) {
        console.error(`Email auto draft: not written ${claudeFailure(error)}`);
      }
    }
  } catch (error) {
    console.error(`Email auto draft job stopped: ${failureSummary(error)}`);
  } finally {
    await db.close().catch(() => undefined);
  }
}

const NOT_MEMBER = 'You are not an active member of this organization.';

/** /api/v1/email-auto-drafts: the waiting drafts, their count, and Dismiss. */
export function emailAutoDraftRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? '';
    const counterpartyId = c.req.query('counterparty_id') ?? null;
    const assigned = c.req.query('assigned') ?? 'everyone';
    if (!isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    if (counterpartyId !== null && !isUuid(counterpartyId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'counterparty_id must be a UUID.');
    }
    if (assigned !== 'me' && assigned !== 'everyone') {
      return apiError(c, 422, 'VALIDATION_FAILED', 'assigned must be me or everyone.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const list = await db.listEmailAutoDrafts(ctx, organizationId, {
        counterpartyId,
        mine: assigned === 'me',
      });
      if (list === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      return c.json(list);
    });
  });

  routes.get('/count', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? '';
    if (!isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) =>
      c.json({ waiting: await db.countEmailAutoDrafts(ctx, organizationId) }),
    );
  });

  routes.post('/:id/dismiss', async (c) => {
    const id = c.req.param('id');
    const organizationId = c.req.query('organization_id') ?? '';
    if (!isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such draft.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.dismissEmailAutoDraft(ctx, organizationId, id);
      switch (result) {
        case 'dismissed':
          return c.json({ dismissed: true });
        case 'already':
          return apiError(c, 409, 'ALREADY_DISMISSED', 'Someone dismissed this draft already.');
        case 'taken':
          return apiError(
            c,
            409,
            'AUTO_DRAFT_USED',
            'An email from this draft is being sent or was sent.',
          );
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', 'No such draft.');
      }
    });
  });

  return routes;
}
