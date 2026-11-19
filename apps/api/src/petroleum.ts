import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { LICENCE_DAYS, licencesAnswer, periodStart, RIG_DAYS, rigsAnswer } from './aer-lists';
import type { Membership } from './db';
import { layerRoutes, type LayerBackend, type LayerDatabase } from './map-layers';
import type { MapLayerWrite } from './map-layers-db';
import {
  LayerRefusedError,
  PETROLEUM_SCHEMA_VERSION,
  TooManyLayersError,
  type PetroleumContext,
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
 * The longest an oil and gas request may spend on its database, end to end (connecting included):
 * past it, the connection is dropped and the request answers "unavailable" (F-247-1-R10-01).
 */
export const PETROLEUM_DEADLINE_MS = 15_000;

class DeadlineError extends Error {
  constructor() {
    super('timed out');
    this.name = 'DeadlineError';
  }
}

/**
 * Opens the oil and gas database, checks it has the schema version this code needs (503
 * PETROLEUM_NOT_READY if not), runs `handle`, and answers 503 (logged) if it is unreachable or
 * takes longer than `deadlineMs`, in which case the connection is dropped.
 */
async function withPetroleum(
  c: ApiContext,
  openPetroleum: PetroleumFactory,
  handle: (db: PetroleumDatabase) => Promise<Response>,
  deadlineMs = PETROLEUM_DEADLINE_MS,
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      if ((await db.schemaVersion()) < PETROLEUM_SCHEMA_VERSION) {
        return apiError(
          c,
          503,
          'PETROLEUM_NOT_READY',
          'The oil and gas database is being updated. Try again in a few minutes.',
        );
      }
      return handle(db);
    })();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void db.abort().catch(() => undefined);
        reject(new DeadlineError());
      }, deadlineMs);
    });
    // The abandoned work fails once its connection is dropped; nothing waits for it.
    work.catch(() => undefined);
    return await Promise.race([work, deadline]);
  } catch (error) {
    console.error(
      `Database unavailable in request ${c.get('requestId')}: database=petroleum ${failureSummary(error)}`,
    );
    return apiError(c, 503, 'DATABASE_UNAVAILABLE', 'The oil and gas database is unavailable.');
  } finally {
    clearTimeout(timer);
    closeLater(c, { close: () => db.close() });
  }
}

/** A call to the oil and gas database that failed or passed its deadline. */
class PetroleumFailure extends Error {
  constructor(readonly reason: unknown) {
    super('oil and gas database call failed');
    this.name = 'PetroleumFailure';
  }
}

/** Runs one piece of work on the oil and gas database, within the deadline. */
type PetroleumCall = <T>(run: (db: PetroleumDatabase) => Promise<T>) => Promise<T>;

/**
 * As withPetroleum, for a request that also waits on something else between its database calls
 * (a map service, F-247 part 2): the deadline applies to each database call, not to the whole
 * request, so a slow map service is never taken for a database failure and no transaction is
 * held while it answers. A call past its deadline drops the connection; the request then answers
 * "unavailable". Any other error `handle` throws is the caller's to answer.
 */
async function withPetroleumCalls(
  c: ApiContext,
  openPetroleum: PetroleumFactory,
  handle: (call: PetroleumCall) => Promise<Response>,
  deadlineMs = PETROLEUM_DEADLINE_MS,
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
  const call: PetroleumCall = async (run) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = run(db);
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void db.abort().catch(() => undefined);
          reject(new DeadlineError());
        }, deadlineMs);
      });
      // The abandoned work fails once its connection is dropped; nothing waits for it.
      work.catch(() => undefined);
      return await Promise.race([work, deadline]);
    } catch (error) {
      // The database's own refusals of a layer are answers, not outages.
      if (error instanceof TooManyLayersError || error instanceof LayerRefusedError) throw error;
      throw new PetroleumFailure(error);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    if ((await call((d) => d.schemaVersion())) < PETROLEUM_SCHEMA_VERSION) {
      return apiError(
        c,
        503,
        'PETROLEUM_NOT_READY',
        'The oil and gas database is being updated. Try again in a few minutes.',
      );
    }
    return await handle(call);
  } catch (error) {
    if (error instanceof TooManyLayersError) {
      return apiError(
        c,
        422,
        'TOO_MANY_LAYERS',
        'The map has the most layers it can keep. Remove one before adding another.',
      );
    }
    if (error instanceof LayerRefusedError) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        'The map layer was not saved: check its name, source, terms and colours.',
      );
    }
    if (!(error instanceof PetroleumFailure)) throw error;
    console.error(
      `Database unavailable in request ${c.get('requestId')}: database=petroleum ${failureSummary(error.reason)}`,
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
 * One check at a time per instance (F-247-1-R9-01): a check in flight is shared by every request
 * until it finishes, however long it takes, and is kept running by the request that started it
 * (waitUntil) even if that client goes away (F-247-1-R8-02). Its answer, "ok" or not, is then
 * reused for `cacheMs`, so an outage cannot turn traffic into repeated database attempts. A check
 * always ends within `deadlineMs`: past it, its connection is dropped and the answer is
 * "unavailable" (F-247-1-R10-01), so a hung connection never keeps the slot.
 */
export const READY_CACHE_MS = 15_000;
export const READY_DEADLINE_MS = PETROLEUM_DEADLINE_MS;

interface ReadyAnswer {
  status: number;
  body: unknown;
}

const UNAVAILABLE: ReadyAnswer = {
  status: 503,
  body: {
    error: { code: 'DATABASE_UNAVAILABLE', message: 'The oil and gas database is unavailable.' },
  },
};

export function petroleumReadyRoute(
  openPetroleum: PetroleumFactory,
  cacheMs = READY_CACHE_MS,
  deadlineMs = READY_DEADLINE_MS,
) {
  let last: { until: number; answer: ReadyAnswer } | null = null;
  let inFlight: Promise<ReadyAnswer> | null = null;
  return async (c: ApiContext) => {
    let answer: ReadyAnswer;
    if (last !== null && Date.now() < last.until) {
      answer = last.answer;
    } else {
      if (inFlight === null) {
        const check = withPetroleum(
          c,
          openPetroleum,
          () => Promise.resolve(c.json({ status: 'ok', service: 'petroleum' })),
          deadlineMs,
        )
          .then(async (res): Promise<ReadyAnswer> => ({
            status: res.status,
            body: await res.json(),
          }))
          .catch((): ReadyAnswer => UNAVAILABLE)
          .then((result) => {
            last = { until: Date.now() + cacheMs, answer: result };
            inFlight = null;
            return result;
          });
        inFlight = check;
        try {
          c.executionCtx.waitUntil(check);
        } catch {
          // No execution context (tests): the check still runs.
        }
      }
      answer = await inFlight;
    }
    c.header('Cache-Control', 'no-store');
    return c.json(answer.body, answer.status as ContentfulStatusCode);
  };
}

/** The person's organization: the one they belong to, or the one named when they have several. */
function membershipOf(c: ApiContext, memberships: Membership[]): Membership | null {
  const named = c.req.query('organization_id');
  if (named !== undefined) return memberships.find((m) => m.organizationId === named) ?? null;
  return memberships.length === 1 ? (memberships[0] ?? null) : null;
}

const NOT_A_MEMBER = 'You are not a member of this organization.';

/**
 * The oil and gas map layers (F-247 part 2) behind the shared layer routes: live ArcGIS layers
 * only, kept in the oil and gas database. The person's active membership and role are read from
 * grain's database first, in this same request; without one the oil and gas database is never
 * opened. The database checks the organization and role again on every read and write.
 */
export function petroleumLayerBackend(
  openDatabase: DatabaseFactory,
  openPetroleum: PetroleumFactory,
  deadlineMs = PETROLEUM_DEADLINE_MS,
): LayerBackend {
  return {
    features: {
      files: false,
      wms: false,
      arcgisMaps: false,
      overviews: false,
      defaultChangeable: true,
    },
    run: (c, handle) =>
      withDatabase(c, openDatabase, async (grain, ctx) => {
        const membership = membershipOf(c, await grain.memberships(ctx.userId));
        if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
        const organizationId = membership.organizationId;
        const who: PetroleumContext = {
          userId: ctx.userId,
          organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        };
        /**
         * A write waits on the map service first (adding a layer reads its description): the
         * person's admin role is read again from grain's database just before it, so a role
         * removed meanwhile writes nothing (F-247-2-R5-01).
         */
        const asAdmin = async (write: () => Promise<MapLayerWrite>): Promise<MapLayerWrite> => {
          const now = await grain.memberships(ctx.userId);
          const still = now.some(
            (m) => m.organizationId === organizationId && m.role === 'org_admin',
          );
          return still ? write() : { status: 'forbidden' };
        };
        return withPetroleumCalls(
          c,
          openPetroleum,
          (call) => {
            const layers: LayerDatabase = {
              isOrgAdmin: (_ctx, organization) =>
                Promise.resolve(organization === organizationId && membership.role === 'org_admin'),
              listMapLayers: (_ctx, organization) =>
                organization === organizationId
                  ? call((db) => db.listLayers(who))
                  : Promise.resolve(null),
              getMapLayerSource: (_ctx, id) => call((db) => db.layerSource(who, id)),
              createMapLayer: (_ctx, organization, layer) =>
                organization === organizationId
                  ? asAdmin(() => call((db) => db.createLayer(who, layer)))
                  : Promise.resolve({ status: 'forbidden' }),
              updateMapLayer: (_ctx, id, version, changes) =>
                asAdmin(() => call((db) => db.updateLayer(who, id, version, changes))),
              removeMapLayer: (_ctx, id, version) =>
                asAdmin(() => call((db) => db.removeLayer(who, id, version))),
              // Files and zoomed-out views are not offered here; their routes are not registered.
              getMapLayerFile: () => Promise.resolve(null),
              getMapLayerOverview: () => Promise.resolve(null),
              saveMapLayerOverviewPart: () => Promise.resolve({ status: 'not_found' }),
              publishMapLayerOverview: () => Promise.resolve({ status: 'not_found' }),
            };
            return handle(layers, ctx, () => Promise.resolve(organizationId));
          },
          deadlineMs,
        );
      }),
  };
}

/** Signed-in oil and gas routes (registered after sign-in is required). */
export function petroleumRoutes(
  openDatabase: DatabaseFactory,
  openPetroleum: PetroleumFactory,
  layersDeadlineMs = PETROLEUM_DEADLINE_MS,
) {
  const routes = new Hono<ApiEnv>();

  // /petroleum/layers: the oil and gas map's layers (F-247 part 2).
  routes.route(
    '/layers',
    layerRoutes(petroleumLayerBackend(openDatabase, openPetroleum, layersDeadlineMs)),
  );

  // The person's active membership is loaded from grain's database before the oil and gas
  // database is opened; without one, it is never opened.
  routes.get('/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) {
        return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
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

  // /petroleum/aer/licences and /rigs: the AER's daily lists (F-243 part 1), in the same order as
  // /health: the membership first, from grain's database; without one the oil and gas database is
  // never opened (F-243-1-D1-06). Every role reads. JSON for the map only, never another format
  // (the AER's terms, docs/DECISIONS.md 2026-11-19).
  const aer = (kind: 'licences' | 'rigs') => (c: ApiContext) => {
    c.header('Cache-Control', 'no-store');
    const offered: readonly number[] = kind === 'licences' ? LICENCE_DAYS : RIG_DAYS;
    const raw = c.req.query('days');
    const days = raw === undefined ? (kind === 'licences' ? 30 : 7) : Number(raw);
    if (!offered.includes(days) || (raw !== undefined && String(days) !== raw)) {
      return apiError(c, 400, 'VALIDATION_FAILED', `days must be one of ${offered.join(', ')}.`);
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        const who: PetroleumContext = {
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        };
        const since = periodStart(new Date(), days);
        if (kind === 'licences') {
          const { rows, dates } = await petroleum.aerLicences(who, since);
          return c.json(licencesAnswer(rows, dates, days));
        }
        const { rows, dates } = await petroleum.aerRigs(who, since);
        return c.json(rigsAnswer(rows, dates, days));
      });
    });
  };
  routes.get('/aer/licences', aer('licences'));
  routes.get('/aer/rigs', aer('rigs'));

  return routes;
}
