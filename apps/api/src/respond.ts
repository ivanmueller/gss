import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { AuthBindings, AuthUser } from './auth';
import type { Database, RequestContext } from './db';

export interface ApiEnv {
  Bindings: AuthBindings & {
    /**
     * Cloudflare Hyperdrive in front of Supabase (staging). Hyperdrive verifies Supabase's
     * certificate against Supabase's own CA, which the Workers runtime cannot do itself.
     */
    HYPERDRIVE?: { connectionString: string };
    /** Postgres URL for the `app_api` role, used when there is no Hyperdrive binding. */
    DATABASE_URL?: string;
    /** Geocodio API key (Worker secret) for looking facility addresses up. */
    GEOCODIO_API_KEY?: string;
  };
  Variables: { user: AuthUser; requestId: string };
}

export type DatabaseFactory = (url: string, options?: { viaHyperdrive?: boolean }) => Database;

export type ApiContext = Context<ApiEnv>;

/** The JSON error envelope (docs/API.md). Never cached. */
export function apiError(
  c: ApiContext,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  c.header('Cache-Control', 'no-store');
  return c.json({ error: { code, message }, ...extra }, status);
}

/** The request body as JSON, or the error response to send. */
export async function readJson(
  c: ApiContext,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = c.req.header('content-length');
  const tooLarge = () => ({
    ok: false as const,
    response: apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.'),
  });
  if (declared !== undefined && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    return tooLarge();
  }
  const text = await c.req.text();
  if (text.length > maxBytes) return tooLarge();
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: apiError(c, 422, 'VALIDATION_FAILED', 'The request body is not JSON.'),
    };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function postgresCode(error: unknown): { code: string; constraint: string } | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  const constraint = 'constraint_name' in error ? error.constraint_name : undefined;
  return typeof code === 'string'
    ? { code, constraint: typeof constraint === 'string' ? constraint : '' }
    : null;
}

// Kinds of connection failure, recognised from the error text, which is never logged itself.
const FAILURE_KINDS: [RegExp, string][] = [
  [/certificate|tls|ssl|handshake/i, 'tls'],
  [/password authentication|authentication failed|SASL|SCRAM/i, 'authentication'],
  [/tenant or user not found/i, 'unknown_user'],
  [/timeout|timed out/i, 'timeout'],
  [/refused/i, 'connection_refused'],
  [/getaddrinfo|ENOTFOUND|EAI_AGAIN|dns/i, 'dns'],
  [/closed|reset|ended|destroyed/i, 'connection_closed'],
  // The Workers runtime reports socket failures, including a refused certificate, this way.
  [/internal error/i, 'runtime_socket'],
];

/**
 * A short, secret-free description of a database failure for the logs: the SQLSTATE or
 * driver error code and a kind. Messages and URLs are never logged (they can carry
 * credentials or data).
 */
export function failureSummary(error: unknown): string {
  const code = postgresCode(error)?.code;
  const safeCode = code !== undefined && /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'none';
  const text = error instanceof Error ? `${error.name} ${error.message}` : '';
  const kind = FAILURE_KINDS.find(([pattern]) => pattern.test(text))?.[1] ?? 'other';
  return `code=${safeCode} kind=${kind}`;
}

/** Maps a database failure to a response without exposing database details. */
function databaseFailure(c: ApiContext, error: unknown) {
  const pg = postgresCode(error);
  if (pg?.code === '42501') {
    return apiError(c, 403, 'FORBIDDEN', 'You do not have permission to do that.');
  }
  if (pg?.code === '23505' && pg.constraint.startsWith('import_batches_')) {
    return apiError(c, 409, 'ALREADY_IMPORTED', 'This file has already been imported.');
  }
  if (pg?.code === 'GS001') {
    return apiError(
      c,
      409,
      'LAST_ADMIN',
      'The organization needs at least one active admin. Make someone else an admin first.',
    );
  }
  if (pg?.code === '23505' && pg.constraint === 'counterparties_name_unique') {
    return apiError(
      c,
      409,
      'DUPLICATE_NAME',
      'A counterparty with this legal name is already in the list for this country.',
    );
  }
  if (pg?.code === '23505') {
    return apiError(c, 409, 'CONFLICT', 'The records changed while saving. Try again.');
  }
  if (pg && (pg.code.startsWith('22') || pg.code.startsWith('23'))) {
    return apiError(c, 422, 'VALIDATION_FAILED', 'The database refused a value.');
  }
  console.error(`Database unavailable in request ${c.get('requestId')}: ${failureSummary(error)}`);
  return apiError(c, 503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.');
}

// Driver errors meaning the connection itself was lost before an answer arrived.
const CONNECTION_LOST = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
  'ECONNRESET',
  'EPIPE',
]);

function connectionLost(error: unknown): boolean {
  return CONNECTION_LOST.has(postgresCode(error)?.code ?? '');
}

/** Disconnects after the response is sent where the runtime allows it, so a slow close never delays an answer. */
function closeLater(c: ApiContext, db: Database) {
  const closing = db.close().catch(() => undefined);
  try {
    c.executionCtx.waitUntil(closing);
  } catch {
    // No execution context (tests): the close still runs, unawaited.
  }
}

/**
 * Opens the database for one request, runs `handle` as the verified user and always
 * disconnects. For reads (GET), a lost connection is retried once on a fresh one; writes
 * are never retried, because a lost connection does not say whether the write committed,
 * and replaying it could undo someone else's later change. Missing configuration and
 * database failures fail closed.
 */
export async function withDatabase(
  c: ApiContext,
  openDatabase: DatabaseFactory,
  handle: (db: Database, ctx: RequestContext) => Promise<Response>,
): Promise<Response> {
  const hyperdrive = c.env.HYPERDRIVE;
  const url = hyperdrive?.connectionString ?? c.env.DATABASE_URL;
  if (!url) {
    return apiError(c, 500, 'MISCONFIGURED', 'The database is not configured.');
  }
  const ctx = { userId: c.get('user').id, requestId: c.get('requestId') };
  const readOnly = c.req.method === 'GET' || c.req.method === 'HEAD';
  for (let attempt = 1; ; attempt += 1) {
    let db: Database;
    try {
      db = openDatabase(url, { viaHyperdrive: hyperdrive !== undefined });
    } catch {
      // The error can carry the whole URL, password included, so it is neither logged nor returned.
      return apiError(c, 500, 'MISCONFIGURED', 'The database is not configured correctly.');
    }
    try {
      return await handle(db, ctx);
    } catch (error) {
      if (readOnly && attempt === 1 && connectionLost(error)) {
        console.warn(
          `Database connection lost in request ${ctx.requestId}: ${failureSummary(error)}; retrying`,
        );
        continue;
      }
      return databaseFailure(c, error);
    } finally {
      closeLater(c, db);
    }
  }
}
