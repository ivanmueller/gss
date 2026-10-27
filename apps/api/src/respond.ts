import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { AuthBindings, AuthUser } from './auth';
import type { Database, RequestContext } from './db';

export interface ApiEnv {
  Bindings: AuthBindings & {
    /** Postgres URL for the `app_api` role (Worker secret). */
    DATABASE_URL?: string;
  };
  Variables: { user: AuthUser; requestId: string };
}

export type DatabaseFactory = (url: string) => Database;

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

/** Maps a database failure to a response without exposing database details. */
function databaseFailure(c: ApiContext, error: unknown) {
  const pg = postgresCode(error);
  if (pg?.code === '42501') {
    return apiError(c, 403, 'FORBIDDEN', 'You do not have permission to do that.');
  }
  if (pg?.code === '23505' && pg.constraint.startsWith('import_batches_')) {
    return apiError(c, 409, 'ALREADY_IMPORTED', 'This file has already been imported.');
  }
  if (pg?.code === '23505') {
    return apiError(c, 409, 'CONFLICT', 'The records changed while saving. Try again.');
  }
  if (pg && (pg.code.startsWith('22') || pg.code.startsWith('23'))) {
    return apiError(c, 422, 'VALIDATION_FAILED', 'The database refused a value.');
  }
  return apiError(c, 503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.');
}

/**
 * Opens the database for one request, runs `handle` as the verified user and always
 * disconnects. Missing configuration and database failures fail closed.
 */
export async function withDatabase(
  c: ApiContext,
  openDatabase: DatabaseFactory,
  handle: (db: Database, ctx: RequestContext) => Promise<Response>,
): Promise<Response> {
  if (!c.env.DATABASE_URL) {
    return apiError(c, 500, 'MISCONFIGURED', 'The database is not configured.');
  }
  const db = openDatabase(c.env.DATABASE_URL);
  try {
    return await handle(db, { userId: c.get('user').id, requestId: c.get('requestId') });
  } catch (error) {
    return databaseFailure(c, error);
  } finally {
    await db.close();
  }
}
