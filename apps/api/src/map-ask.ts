import {
  keepTypedNames,
  MAP_ASK_INSTRUCTIONS,
  MAP_ASK_JSON_SCHEMA,
  mapAskAnswerSchema,
  mapAskRequestSchema,
} from '@grain/domain';
import { Hono } from 'hono';

import {
  claudeFailure,
  MAP_ASK_MODEL,
  ReadingDeadlineError,
  type ClaudeFactory,
} from './anthropic';
import type { Membership } from './db';
import { apiError, readJson, withDatabase, type ApiEnv, type DatabaseFactory } from './respond';

/**
 * POST /petroleum/ask (F-254 part 2): a request typed in the oil and gas map's Ask bar, read by
 * Claude into the map's settings. Members only, checked in grain's database before Claude is
 * asked. One request to Anthropic, no tools, the fixed instructions and the typed words only: no
 * well, land or production record is sent. Claude answers in a fixed shape (structured outputs),
 * checked again here (mapAskAnswerSchema); anything else is refused and the page falls back to
 * its own word matching. Nothing is kept: no history, and the logs carry only the outcome, the
 * model and the token counts, never the request's words.
 */

/** Room for a short answer and Claude's thinking at low effort. */
const ASK_MAX_TOKENS = 4_000;
/** The bar waits for an answer; past this the page reads the request itself. */
export const ASK_DEADLINE_MS = 20_000;
const MAX_BODY_BYTES = 4 * 1024;

/** How many requests a person may send a minute. */
export const ASK_PER_MINUTE = 12;
const MINUTE = 60_000;

/**
 * Each person's recent requests, in this Worker instance only: a brake on a stuck key or a loop,
 * not an exact count (Cloudflare runs several instances). Each request costs a small fraction of
 * a cent (docs/DECISIONS.md, 2026-11-24).
 */
export class AskLimiter {
  private readonly times = new Map<string, number[]>();

  /** Counts the request; false when the person has sent ASK_PER_MINUTE in the last minute. */
  take(userId: string, now = Date.now()): boolean {
    const recent = (this.times.get(userId) ?? []).filter((t) => now - t < MINUTE);
    if (recent.length >= ASK_PER_MINUTE) {
      this.times.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.times.set(userId, recent);
    // Forget people with nothing recent, so the map stays small.
    if (this.times.size > 500) {
      for (const [id, list] of this.times) {
        if (list.every((t) => now - t >= MINUTE)) this.times.delete(id);
      }
    }
    return true;
  }
}

function membershipOf(named: string | undefined, memberships: Membership[]): Membership | null {
  if (named !== undefined) return memberships.find((m) => m.organizationId === named) ?? null;
  return memberships.length === 1 ? (memberships[0] ?? null) : null;
}

export function mapAskRoutes(
  openDatabase: DatabaseFactory,
  claude: ClaudeFactory,
  limiter = new AskLimiter(),
) {
  const routes = new Hono<ApiEnv>();

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = mapAskRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'Type a request of at most 500 characters.');
    }
    const client = claude(c.env);
    if (client === null) {
      return apiError(c, 503, 'CLAUDE_NOT_CONFIGURED', 'Claude is not set up yet.');
    }
    const member = await withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(
        c.req.query('organization_id'),
        await db.memberships(ctx.userId),
      );
      return membership === null
        ? apiError(c, 403, 'FORBIDDEN', 'You are not a member of this organization.')
        : new Response(null, { status: 204 });
    });
    // The database is closed before Claude is asked.
    if (member.status !== 204) return member;
    if (!limiter.take(c.get('user').id)) {
      return apiError(c, 429, 'TOO_MANY_REQUESTS', 'Too many requests. Wait a minute.');
    }

    let answer;
    try {
      answer = await client.readCall({
        system: MAP_ASK_INSTRUCTIONS,
        user: parsed.data.text,
        schema: MAP_ASK_JSON_SCHEMA,
        model: MAP_ASK_MODEL,
        effort: 'low',
        maxTokens: ASK_MAX_TOKENS,
        deadlineMs: ASK_DEADLINE_MS,
      });
    } catch (error) {
      console.error(`Map ask: failed ${claudeFailure(error)}`);
      return error instanceof ReadingDeadlineError
        ? apiError(c, 504, 'CLAUDE_TIMEOUT', 'Claude took too long to answer.')
        : apiError(c, 502, 'CLAUDE_FAILED', 'Claude could not be reached.');
    }
    const model = /^[a-z0-9][a-z0-9.-]{0,79}$/.test(answer.model) ? answer.model : 'unknown';
    if (answer.status !== 'read') {
      console.error(`Map ask: failed ${answer.status} model=${model}`);
      return apiError(c, 502, 'CLAUDE_FAILED', 'Claude could not read the request.');
    }
    const checked = mapAskAnswerSchema.safeParse(answer.json);
    if (!checked.success) {
      console.error(`Map ask: failed shape model=${model}`);
      return apiError(c, 502, 'CLAUDE_FAILED', 'Claude answered outside the map’s settings.');
    }
    console.log(
      `Map ask: read model=${model} in=${String(answer.inputTokens)} out=${String(answer.outputTokens)}`,
    );
    // A name Claude gives that is not in the request is dropped, never applied.
    return c.json({
      ...checked.data,
      settings: keepTypedNames(checked.data.settings, parsed.data.text),
    });
  });

  return routes;
}
