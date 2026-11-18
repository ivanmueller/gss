import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { Membership } from './db';
import {
  PETROLEUM_SCHEMA_VERSION,
  type PetroleumDatabase,
  type PetroleumFactory,
} from './petroleum-db';
import {
  apiError,
  closeLater,
  failureSummary,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

/**
 * The oil and gas database's routes (F-247). It is reached through its own Hyperdrive binding
 * (PETROLEUM) on staging, or PETROLEUM_DATABASE_URL locally and in CI; without either, its routes
 * answer 503 PETROLEUM_NOT_SET_UP and grain's routes are unaffected.
 */

function petroleumUrl(c: ApiContext): { url: string; viaHyperdrive: boolean } | null {
  const binding = c.env.PETROLEUM;
  if (binding) return { url: binding.connectionString, viaHyperdrive: true };
  return c.env.PETROLEUM_DATABASE_URL
    ? { url: c.env.PETROLEUM_DATABASE_URL, viaHyperdrive: false }
    : null;
}

function notSetUp(c: ApiContext) {
  return apiError(c, 503, 'PETROLEUM_NOT_SET_UP', 'The oil and gas database is not set up yet.');
}

/**
 * Opens the oil and gas database, checks it has the schema version this code needs (503
 * PETROLEUM_NOT_READY if not), runs `handle`, and answers 503 (logged) if it is unreachable.
 */
async function withPetroleum(
  c: ApiContext,
  openPetroleum: PetroleumFactory,
  handle: (db: PetroleumDatabase) => Promise<Response>,
): Promise<Response> {
  const target = petroleumUrl(c);
  if (target === null) return notSetUp(c);
  let db: PetroleumDatabase;
  try {
    db = openPetroleum(target.url, { viaHyperdrive: target.viaHyperdrive });
  } catch {
    // The error can carry the whole URL, password included, so it is neither logged nor returned.
    return apiError(
      c,
      500,
      'MISCONFIGURED',
      'The oil and gas database is not configured correctly.',
    );
  }
  try {
    if ((await db.schemaVersion()) < PETROLEUM_SCHEMA_VERSION) {
      return apiError(
        c,
        503,
        'PETROLEUM_NOT_READY',
        'The oil and gas database is being updated. Try again in a few minutes.',
      );
    }
    return await handle(db);
  } catch (error) {
    console.error(
      `Database unavailable in request ${c.get('requestId')}: database=petroleum ${failureSummary(error)}`,
    );
    return apiError(c, 503, 'DATABASE_UNAVAILABLE', 'The oil and gas database is unavailable.');
  } finally {
    closeLater(c, { close: () => db.close() });
  }
}

/**
 * GET /petroleum/ready, public: whether the oil and gas database is reachable and at the schema
 * version this code needs (withPetroleum checks it), for the deploy's smoke test
 * (F-247-1-D1-03). It reads nothing and returns no tenant data.
 *
 * Being public, it must not let anonymous traffic load the database (F-247-1-R7-02): each Worker
 * instance checks the database at most once per `cacheMs` and gives every request in that window
 * the same answer (concurrent requests share the one check in flight). A deploy starts new
 * instances, so the deploy's smoke test still gets a fresh check.
 *
 * The shared check is kept running by the request that started it (waitUntil), even if that
 * client goes away, and gives up after READY_DEADLINE_MS; only an "ok" answer is reused, so a
 * failed or cut-off check is never handed to later requests (F-247-1-R8-02).
 */
export const READY_CACHE_MS = 15_000;
export const READY_DEADLINE_MS = 20_000;

interface ReadyAnswer {
  status: number;
  body: unknown;
}

export function petroleumReadyRoute(
  openPetroleum: PetroleumFactory,
  cacheMs = READY_CACHE_MS,
  deadlineMs = READY_DEADLINE_MS,
) {
  let cached: { until: number; answer: Promise<ReadyAnswer> } | null = null;
  return async (c: ApiContext) => {
    const now = Date.now();
    let current = cached;
    if (current === null || now >= current.until) {
      const check = withPetroleum(c, openPetroleum, () =>
        Promise.resolve(c.json({ status: 'ok', service: 'petroleum' })),
      ).then(async (res): Promise<ReadyAnswer> => ({ status: res.status, body: await res.json() }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<ReadyAnswer>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            status: 503,
            body: {
              error: {
                code: 'DATABASE_UNAVAILABLE',
                message: 'The oil and gas database is unavailable.',
              },
            },
          });
        }, deadlineMs);
      });
      const answer = Promise.race([check, deadline])
        .catch((): ReadyAnswer => ({
          status: 503,
          body: {
            error: {
              code: 'DATABASE_UNAVAILABLE',
              message: 'The oil and gas database is unavailable.',
            },
          },
        }))
        .finally(() => {
          clearTimeout(timer);
        });
      const entry = { until: now + cacheMs, answer };
      cached = entry;
      current = entry;
      // Only an "ok" answer is reused; anything else is dropped once known.
      void answer.then((result) => {
        if (result.status !== 200 && cached === entry) cached = null;
      });
      try {
        c.executionCtx.waitUntil(answer);
      } catch {
        // No execution context (tests): the check still runs.
      }
    }
    const { status, body } = await current.answer;
    c.header('Cache-Control', 'no-store');
    return c.json(body, status as ContentfulStatusCode);
  };
}

/** The person's organization: the one they belong to, or the one named when they have several. */
function membershipOf(c: ApiContext, memberships: Membership[]): Membership | null {
  const named = c.req.query('organization_id');
  if (named !== undefined) return memberships.find((m) => m.organizationId === named) ?? null;
  return memberships.length === 1 ? (memberships[0] ?? null) : null;
}

/** Signed-in oil and gas routes (registered after sign-in is required). */
export function petroleumRoutes(openDatabase: DatabaseFactory, openPetroleum: PetroleumFactory) {
  const routes = new Hono<ApiEnv>();

  // The person's active membership is loaded from grain's database before the oil and gas
  // database is opened; without one, it is never opened.
  routes.get('/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) {
        return apiError(c, 403, 'FORBIDDEN', 'You are not a member of this organization.');
      }
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        const seen = await petroleum.organizationSeen({
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        });
        return seen === membership.organizationId
          ? c.json({ status: 'ok' })
          : apiError(c, 503, 'DATABASE_UNAVAILABLE', 'The oil and gas database is unavailable.');
      });
    });
  });

  return routes;
}
