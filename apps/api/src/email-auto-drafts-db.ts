import type { EmailAutoDraftListResponse, EmailAutoDraftView } from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';
import type { EmailDraftContext } from './emails-db';

// Email drafts Claude makes by itself, in Postgres (20261115010000_email_auto_drafts.sql). The
// job's calls run without a signed-in user, through the functions that claim, describe and keep a
// draft; a person's list, count and dismissal run as that person.

/** A pending draft claimed by the job, with the token that alone may keep it. */
export interface AutoDraftClaim {
  draftId: string;
  token: string;
}

/** What Claude is given to write a claimed draft (app.email_auto_draft_context). */
export interface AutoDraftContext extends EmailDraftContext {
  source: 'call' | 'email';
  about: string;
  happenedAt: string;
  /** The person it is for: their name and title; null when for anyone. */
  sender: { name: string; title: string | null } | null;
  /** Sent from the shared address. */
  shared: boolean;
  /** What GSS has, for a buyer: never a price, a currency or a seller's name (answer 27). */
  offers: {
    commodity: string;
    grade: string | null;
    firmness: string;
    quantityMinMt: string | null;
    quantityMaxMt: string;
    deliveryStart: string | null;
    deliveryEnd: string | null;
    region: string | null;
    country: string | null;
  }[];
}

/**
 * What Claude is given to write a reminder (F-114 step 5c, part 2): the company's name and types,
 * the sender and the GSS email reminded. Nothing else of the company's records.
 */
export interface ReminderContext {
  source: 'reminder';
  /** Fixed text built from the reminded email's subject, never Claude's words. */
  about: string;
  /** When the reminded email was sent. */
  happenedAt: string;
  name: string;
  types: string[];
  sender: { name: string; title: string | null } | null;
  shared: boolean;
  reminded: {
    subject: string;
    body: string | null;
    to: string[];
    contactName: string | null;
    sentByName: string | null;
  };
}

export type AutoDraftJobContext = AutoDraftContext | ReminderContext;

export interface KeptAutoDraft {
  model: string | null;
  subject: string;
  message: string;
  checkThis: string[];
  placeholders: string[];
  inputTokens: number;
  outputTokens: number;
}

export type DismissAutoDraftResult = 'dismissed' | 'not_found' | 'already' | 'taken';
const DISMISS_RESULTS: readonly DismissAutoDraftResult[] = [
  'dismissed',
  'not_found',
  'already',
  'taken',
];

export interface AutoDraftsDatabase {
  claimEmailAutoDrafts: (most: number) => Promise<AutoDraftClaim[]>;
  releaseEmailAutoDraft: (claim: AutoDraftClaim) => Promise<void>;
  emailAutoDraftContext: (claim: AutoDraftClaim) => Promise<AutoDraftJobContext | null>;
  /** Puts a reminder away under its claim: Claude found the email asked for nothing. */
  skipEmailAutoDraft: (claim: AutoDraftClaim) => Promise<boolean>;
  keepEmailAutoDraft: (claim: AutoDraftClaim, draft: KeptAutoDraft) => Promise<boolean>;
  /** Null for anyone not an active member of the organization. */
  listEmailAutoDrafts: (
    ctx: RequestContext,
    organizationId: string,
    filter: { counterpartyId: string | null; mine: boolean },
  ) => Promise<EmailAutoDraftListResponse | null>;
  countEmailAutoDrafts: (ctx: RequestContext, organizationId: string) => Promise<number>;
  dismissEmailAutoDraft: (
    ctx: RequestContext,
    organizationId: string,
    id: string,
  ) => Promise<DismissAutoDraftResult>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

/** An instant from jsonb ("2026-11-12 10:00:00+00") as ISO, or null. */
function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function autoDraftQueries(asUser: AsUser, sql: postgres.Sql): AutoDraftsDatabase {
  return {
    async claimEmailAutoDrafts(most) {
      const rows = await sql<{ draft_id: string; claim_token: string }[]>`
        select draft_id, claim_token from app.claim_email_auto_drafts(${most})`;
      return rows.map((row) => ({ draftId: row.draft_id, token: row.claim_token }));
    },

    async releaseEmailAutoDraft(claim) {
      await sql`select app.release_email_auto_draft(${claim.draftId}, ${claim.token})`;
    },

    async emailAutoDraftContext(claim) {
      const [row] = await sql<{ context: AutoDraftJobContext | null }[]>`
        select app.email_auto_draft_context(${claim.draftId}, ${claim.token}) as context`;
      const context = row?.context ?? null;
      if (context === null) return null;
      return { ...context, happenedAt: new Date(context.happenedAt).toISOString() };
    },

    async skipEmailAutoDraft(claim) {
      const [row] = await sql<{ skipped: boolean }[]>`
        select app.skip_email_auto_draft(${claim.draftId}, ${claim.token}) as skipped`;
      return row?.skipped === true;
    },

    async keepEmailAutoDraft(claim, draft) {
      const [row] = await sql<{ kept: boolean }[]>`
        select app.keep_email_auto_draft(${claim.draftId}, ${claim.token}, ${draft.model},
                                         ${draft.subject}, ${draft.message},
                                         ${sql.json(draft.checkThis)}::jsonb,
                                         ${sql.json(draft.placeholders)}::jsonb,
                                         ${draft.inputTokens}, ${draft.outputTokens}) as kept`;
      return row?.kept === true;
    },

    listEmailAutoDrafts(ctx, organizationId, filter) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ list: EmailAutoDraftListResponse | null }[]>`
          select app.email_auto_draft_list(${organizationId}, ${filter.counterpartyId}::uuid,
                                           ${filter.mine}) as list`;
        const list = row?.list ?? null;
        if (list === null) return null;
        return {
          truncated: list.truncated,
          drafts: list.drafts.map((draft): EmailAutoDraftView => ({
            ...draft,
            callAt: iso(draft.callAt),
            emailAt: iso(draft.emailAt),
            draftedAt: new Date(draft.draftedAt).toISOString(),
            answeredSince:
              draft.answeredSince === null
                ? null
                : { ...draft.answeredSince, at: new Date(draft.answeredSince.at).toISOString() },
          })),
        };
      });
    },

    countEmailAutoDrafts(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ count: number }[]>`
          select app.email_auto_draft_count(${organizationId}) as count`;
        return row?.count ?? 0;
      });
    },

    dismissEmailAutoDraft(ctx, organizationId, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.dismiss_email_auto_draft(${organizationId}, ${id}) as result`;
        const result = DISMISS_RESULTS.find((value) => value === row?.result);
        if (result === undefined)
          throw new Error('Unexpected answer from app.dismiss_email_auto_draft');
        return result;
      });
    },
  };
}
