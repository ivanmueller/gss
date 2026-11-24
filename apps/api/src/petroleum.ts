import { GEOLOGY_MAPS, PIPELINE_LEVELS, PLAY_SAMPLE_UNITS, type St37Zone } from '@grain/domain';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  LICENCE_DAYS,
  licencesAnswer,
  periodStart,
  RIG_DAYS,
  RIG_TARGETS_SCHEMA_VERSION,
  rigsAnswer,
} from './aer-lists';
import type { Membership } from './db';
import {
  LAND_SCHEMA_VERSION,
  landAnswer,
  landLimits,
  landRightsZones,
  parseLandKinds,
  parseLandRights,
} from './land';
import { FORMATION_SCHEMA_VERSION, formationAnswer, formationRange } from './formation';
import { keptJson } from './kept-json';
import {
  LAND_SALES_MAX,
  LAND_SALES_SCHEMA_VERSION,
  landSalesAnswer,
  landSaleSummaryAnswer,
  parseSince,
} from './land-sales';
import type { LandSaleFilter } from './land-sales-db';
import { PLAY_OUTLINES } from './play-outlines';
import {
  parseFormation,
  parseUwi,
  PRODUCTION_SCHEMA_VERSION,
  productionAnswer,
} from './production';
import type { ProductionLoad } from './production-db';
import {
  parseSt37Box,
  ST37_3D_MAX_NEARBY,
  ST37_3D_NEARBY_KM,
  ST37_3D_SCHEMA_VERSION,
  ST37_MAX_WELLS,
  ST37_SCHEMA_VERSION,
  st37Answer,
  st37LoadZones,
  st37Well3dAnswer,
} from './st37';
import { FACILITIES_SCHEMA_VERSION, facilitiesAnswer } from './petro-facilities';
import { FRAC_SCHEMA_VERSION, fracAnswer, parseLicence } from './petro-frac';
import { GEOLOGY_SCHEMA_VERSION, geologyAnswer, playSamplesAnswer } from './petro-geology';
import { PRICES_SCHEMA_VERSION, pricesAnswer } from './petro-prices';
import {
  parsePipelineId,
  parsePipelineSquare,
  PIPELINE_SQUARE_MAX,
  PIPELINES_SCHEMA_VERSION,
  pipelineSegmentAnswer,
  pipelineSquareAnswer,
  pipelineSquareBox,
} from './petro-pipelines';
import {
  gridPointAnswer,
  gridSquareAnswer,
  parseGridLevel,
  parseGridPoint,
  parseGridSquare,
} from './township-grid';
import { WELLS_SCHEMA_VERSION } from './wells';
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
        // The rigs need the licences' locations (F-282) and targets (F-283).
        if ((await petroleum.schemaVersion()) < RIG_TARGETS_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const { rows, dates, listDates } = await petroleum.aerRigs(who, since);
        return c.json(rigsAnswer(rows, dates, days, listDates));
      });
    });
  };
  routes.get('/aer/licences', aer('licences'));
  routes.get('/aer/rigs', aer('rigs'));

  // /petroleum/grid/:level/:z/:x/:y: one map square of the township grid (F-240, F-271), from the
  // province's service; membership first, as above. Nothing is stored, so the oil and gas
  // database is never opened.
  // /petroleum/grid/at?lon=&lat=: the legal subdivision under a click on no land, well or
  // facility (F-271), asked of the province; membership first, nothing stored.
  routes.get('/grid/at', (c) => {
    const point = parseGridPoint(c.req.query('lon'), c.req.query('lat'));
    if (!point) {
      c.header('Cache-Control', 'no-store');
      return apiError(c, 400, 'VALIDATION_FAILED', 'lon and lat must be a point in Alberta.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) {
        c.header('Cache-Control', 'no-store');
        return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      }
      return gridPointAnswer(c, point);
    });
  });

  routes.get('/grid/:level/:z/:x/:y', (c) => {
    const level = parseGridLevel(c.req.param('level'));
    const tile =
      level && parseGridSquare(level, c.req.param('z'), c.req.param('x'), c.req.param('y'));
    if (!level || !tile) {
      c.header('Cache-Control', 'no-store');
      return apiError(c, 404, 'NOT_FOUND', 'No such square of the township grid.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) {
        c.header('Cache-Control', 'no-store');
        return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      }
      return gridSquareAnswer(c, level, tile);
    });
  });

  // /petroleum/wells/status: the wells load and how many wells are current (F-243 part 3), for
  // the map to say "loading" or "stopped at the size limit". Membership first, as above.
  routes.get('/wells/status', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        // The wells need their own migration; without it only this route waits (F-243-3-R1-02).
        if ((await petroleum.schemaVersion()) < WELLS_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const { load, current } = await petroleum.wellsStatus({
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        });
        return c.json({
          current,
          load: load && {
            status: load.status,
            startedAt: load.startedAt,
            finishedAt: load.finishedAt,
            rowsSaved: load.rowsSaved,
          },
        });
      });
    });
  });

  // /petroleum/st37/wells: the AER's ST37 wells whose surface hole is in the map's view
  // (F-243 part 4). Membership first, as above. JSON for the map only, never another format
  // (the AER's terms, docs/DECISIONS.md 2026-11-19).
  routes.get('/st37/wells', (c) => {
    c.header('Cache-Control', 'no-store');
    const box = parseSt37Box(c.req.query());
    if (typeof box === 'string') return apiError(c, 400, 'VALIDATION_FAILED', box);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < ST37_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const who: PetroleumContext = {
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        };
        const { loads, wells } = await petroleum.st37Wells(who, box, ST37_MAX_WELLS);
        const zones = new Map<string, St37Zone[]>();
        for (const load of loads) {
          if (!load.formation) continue;
          zones.set(
            load.formation,
            await st37LoadZones(load, (formation) => petroleum.st37Drilled(who, formation)),
          );
        }
        return keptJson(c, st37Answer(loads, zones, wells));
      });
    });
  });

  // /petroleum/st37/well-3d: one well under the ground (F-261): its legs and those of the
  // wells nearby, each path with the elevation of every point. Membership first, as above. JSON
  // for the view only, never another format (the AER's terms, docs/DECISIONS.md 2026-11-19).
  routes.get('/st37/well-3d', (c) => {
    c.header('Cache-Control', 'no-store');
    const asked = parseUwi(c.req.query('uwi'));
    if (typeof asked === 'string') return apiError(c, 400, 'VALIDATION_FAILED', asked);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < ST37_3D_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const { loadedAt, legs } = await petroleum.st37Well3d(
          {
            userId: ctx.userId,
            organizationId: membership.organizationId,
            role: membership.role,
            requestId: ctx.requestId,
          },
          asked.uwi,
          ST37_3D_NEARBY_KM,
          ST37_3D_MAX_NEARBY,
        );
        const answer = st37Well3dAnswer(asked.uwi, loadedAt, legs);
        if (answer === null) return apiError(c, 404, 'NOT_FOUND', 'No such well is loaded.');
        return keptJson(c, answer);
      });
    });
  });

  // /petroleum/formation-layers: the layers of the ground under a box (F-261 part 2): the
  // elevation of the top and of the base of each zone of the Survey's model, cell by cell, for
  // a well's 3D view. Membership first, as above.
  routes.get('/formation-layers', (c) => {
    c.header('Cache-Control', 'no-store');
    const box = parseSt37Box(c.req.query());
    if (typeof box === 'string') return apiError(c, 400, 'VALIDATION_FAILED', box);
    const range = formationRange(box);
    if (typeof range === 'string') return apiError(c, 400, 'VALIDATION_FAILED', range);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < FORMATION_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const { load, cells } = await petroleum.formationCells(
          {
            userId: ctx.userId,
            organizationId: membership.organizationId,
            role: membership.role,
            requestId: ctx.requestId,
          },
          range,
        );
        return keptJson(c, formationAnswer(range, load, cells));
      });
    });
  });

  // /petroleum/land: land held today whose shape touches the map's view (F-241): Crown
  // agreements, active offset notices and land whose petroleum and natural gas is not the
  // Crown's, for the kinds named in `layers`. Membership first, as above.
  routes.get('/land', (c) => {
    c.header('Cache-Control', 'no-store');
    const box = parseSt37Box(c.req.query());
    if (typeof box === 'string') return apiError(c, 400, 'VALIDATION_FAILED', box);
    const kinds = parseLandKinds(c.req.query('layers'));
    if (typeof kinds === 'string') return apiError(c, 400, 'VALIDATION_FAILED', kinds);
    const rights = parseLandRights(c.req.query('rights'));
    if (typeof rights === 'string') return apiError(c, 400, 'VALIDATION_FAILED', rights);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < LAND_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const who: PetroleumContext = {
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        };
        const zones = await landRightsZones(rights.play, {
          stamp: () => petroleum.landZoneStamp(who),
          zones: () => petroleum.landZones(who),
        });
        const rows = await petroleum.land(who, box, landLimits(kinds), zones);
        return keptJson(c, landAnswer(rows));
      });
    });
  });

  // /petroleum/facilities: every facility of the latest "Load facilities" (F-278), the AER's ST102
  // list, in one answer the browser keeps until a load changes it. Membership first. JSON for
  // the map only, never another format (the AER's terms, docs/DECISIONS.md 2026-11-19).
  routes.get('/facilities', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < FACILITIES_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const { load, rows } = await petroleum.facilities({
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        });
        return keptJson(c, facilitiesAnswer(load, rows));
      });
    });
  });

  // /petroleum/prices: every royalty price of the latest "Load prices" (F-285), the province's
  // gas, liquids, sulphur and oil par prices by month, in one answer the browser keeps until a
  // load changes it. Membership first. Public data of the Government of Alberta on its
  // non-commercial terms (docs/DECISIONS.md, 2026-11-23).
  routes.get('/prices', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < PRICES_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const { load, rows } = await petroleum.prices({
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        });
        return keptJson(c, pricesAnswer(load, rows));
      });
    });
  });

  // /petroleum/frac/licence?licence=: the AER's frac data (F-288) of one licence's well events,
  // for a well's panel and its royalty's C*. Membership first. The AER's data on the owner's
  // decision (docs/DECISIONS.md, 2026-11-19): members only, the AER named.
  routes.get('/frac/licence', (c) => {
    c.header('Cache-Control', 'no-store');
    const asked = parseLicence(c.req.query('licence'));
    if (typeof asked === 'string') return apiError(c, 400, 'VALIDATION_FAILED', asked);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < FRAC_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const { load, rows } = await petroleum.fracOfLicence(
          {
            userId: ctx.userId,
            organizationId: membership.organizationId,
            role: membership.role,
            requestId: ctx.requestId,
          },
          asked.licence,
        );
        return keptJson(c, fracAnswer(load, rows));
      });
    });
  });

  // /petroleum/geology/well?uwi=: a well's Geology section (F-287 part 2): the Alberta
  // Geological Survey's tops picked in it or nearest it, its play's zone under it, and the play's
  // nearest Rock-Eval samples. Membership first, as above. Open data (Open Government Licence –
  // Alberta), the Survey named; the well itself is the AER's (members only).
  routes.get('/geology/well', (c) => {
    c.header('Cache-Control', 'no-store');
    const asked = parseUwi(c.req.query('uwi'));
    if (typeof asked === 'string') return apiError(c, 400, 'VALIDATION_FAILED', asked);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < GEOLOGY_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const data = await petroleum.geologyOfWell(
          {
            userId: ctx.userId,
            organizationId: membership.organizationId,
            role: membership.role,
            requestId: ctx.requestId,
          },
          asked.uwi,
        );
        if (data.well === null) return apiError(c, 404, 'NOT_FOUND', 'No such well is loaded.');
        return keptJson(c, geologyAnswer(data));
      });
    });
  });

  // /petroleum/geology/samples?play=: every Rock-Eval sample of a play's units with the maturity
  // it reads, for the Geology section's Maturity map (F-287 part 4). Membership first, as above.
  // Open data (Open Government Licence – Alberta), the Survey named.
  routes.get('/geology/samples', (c) => {
    c.header('Cache-Control', 'no-store');
    const key = c.req.query('play');
    const play = GEOLOGY_MAPS.find((m) => m.key === key);
    const units = key === undefined ? undefined : PLAY_SAMPLE_UNITS[key];
    if (!play || !units) return apiError(c, 400, 'VALIDATION_FAILED', 'No such play.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < GEOLOGY_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const data = await petroleum.playSamples(
          {
            userId: ctx.userId,
            organizationId: membership.organizationId,
            role: membership.role,
            requestId: ctx.requestId,
          },
          units,
        );
        return keptJson(c, playSamplesAnswer({ key: play.key, name: play.name }, data));
      });
    });
  });

  // /petroleum/pipelines/segment/:id and /pipelines/:z/:x/:y: the AER's pipelines of the latest
  // "Load pipelines" (F-249): one segment's every column for its panel, and the segments that
  // touch one map square (at z 6 and 8 the large and long lines only, at z 9 and 10 every line;
  // PIPELINE_LEVELS in packages/domain/src/pipelines.ts). Membership first, as
  // above. JSON for the map only, never another format (the AER's terms, docs/DECISIONS.md
  // 2026-11-19).
  const pipelines = (
    c: Context<ApiEnv>,
    read: (petroleum: PetroleumDatabase, ctx: PetroleumContext) => Promise<Response>,
  ) =>
    withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < PIPELINES_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        return read(petroleum, {
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        });
      });
    });

  routes.get('/pipelines/segment/:id', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = parsePipelineId(c.req.param('id'));
    if (id === null) return apiError(c, 404, 'NOT_FOUND', 'No such pipeline segment.');
    return pipelines(c, async (petroleum, ctx) => {
      const row = await petroleum.pipelineSegment(ctx, id);
      if (row === null) return apiError(c, 404, 'NOT_FOUND', 'No such pipeline segment.');
      return keptJson(c, pipelineSegmentAnswer(row));
    });
  });

  routes.get('/pipelines/:z/:x/:y', (c) => {
    c.header('Cache-Control', 'no-store');
    const square = parsePipelineSquare(c.req.param('z'), c.req.param('x'), c.req.param('y'));
    if (square === null) return apiError(c, 404, 'NOT_FOUND', 'No such square of pipelines.');
    return pipelines(c, async (petroleum, ctx) => {
      const { load, rows } = await petroleum.pipelineSquare(
        ctx,
        pipelineSquareBox(square.tile),
        {
          minDiameterMm: PIPELINE_LEVELS[square.level].minDiameterMm,
          minLengthKm: PIPELINE_LEVELS[square.level].minLengthKm,
        },
        PIPELINE_SQUARE_MAX + 1,
      );
      return keptJson(c, pipelineSquareAnswer(square.level, load, rows));
    });
  });

  // /petroleum/land-sales and /land-sales/summary: the parcels of the province's public
  // offerings of petroleum and natural gas rights, with their results (F-242): those whose
  // shape touches the map's view, and the totals of every parcel loaded. `rights` keeps the
  // parcels whose rights include a play, and of those the ones inside the play's outline
  // (F-264); `since` the sales from a date on. Membership first.
  const landSales = (
    c: Context<ApiEnv>,
    read: (
      petroleum: PetroleumDatabase,
      ctx: PetroleumContext,
      filter: LandSaleFilter & { until: string | null },
    ) => Promise<unknown>,
  ) => {
    c.header('Cache-Control', 'no-store');
    const rights = parseLandRights(c.req.query('rights'));
    if (typeof rights === 'string') return apiError(c, 400, 'VALIDATION_FAILED', rights);
    const since = parseSince(c.req.query('since'));
    if (typeof since === 'string') return apiError(c, 400, 'VALIDATION_FAILED', since);
    // Sales before a date: the page reads every year of a play a few years at a time (F-263).
    const until = parseSince(c.req.query('until'));
    if (typeof until === 'string') {
      return apiError(c, 400, 'VALIDATION_FAILED', 'until must be a date such as 2024-11-22.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < LAND_SALES_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const who: PetroleumContext = {
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        };
        const zones = await landRightsZones(rights.play, {
          stamp: () => petroleum.landZoneStamp(who),
          zones: () => petroleum.landZones(who),
        });
        return keptJson(
          c,
          await read(petroleum, who, {
            zones,
            since: since.since,
            until: until.since,
            // The play's sales are those inside its outline, as the map draws it (F-264).
            outline: rights.play !== null ? (PLAY_OUTLINES[rights.play] ?? null) : null,
          }),
        );
      });
    });
  };

  routes.get('/land-sales', (c) => {
    const box = parseSt37Box(c.req.query());
    if (typeof box === 'string') return apiError(c, 400, 'VALIDATION_FAILED', box);
    return landSales(c, async (petroleum, ctx, filter) => {
      const { load, parcels } = await petroleum.landSales(ctx, box, filter, LAND_SALES_MAX);
      return landSalesAnswer(load, parcels);
    });
  });

  routes.get('/land-sales/summary', (c) =>
    landSales(c, async (petroleum, ctx, filter) =>
      landSaleSummaryAnswer(await petroleum.landSaleSummary(ctx, filter)),
    ),
  );

  // /petroleum/production/well and /formation: monthly production from Petrinex's public data
  // (F-252 step 3). Membership first, as above. JSON for the charts only, never another format
  // (Petrinex's terms and the owner's decision, docs/DECISIONS.md 2026-11-20).
  const production = (
    c: Context<ApiEnv>,
    read: (
      petroleum: PetroleumDatabase,
      ctx: PetroleumContext,
    ) => Promise<{ load: ProductionLoad | null; months: unknown[] }>,
  ) =>
    withDatabase(c, openDatabase, async (db, ctx) => {
      const membership = membershipOf(c, await db.memberships(ctx.userId));
      if (membership === null) return apiError(c, 403, 'FORBIDDEN', NOT_A_MEMBER);
      return withPetroleum(c, openPetroleum, async (petroleum) => {
        if ((await petroleum.schemaVersion()) < PRODUCTION_SCHEMA_VERSION) {
          return apiError(
            c,
            503,
            'PETROLEUM_NOT_READY',
            'The oil and gas database is being updated. Try again in a few minutes.',
          );
        }
        const { load, months } = await read(petroleum, {
          userId: ctx.userId,
          organizationId: membership.organizationId,
          role: membership.role,
          requestId: ctx.requestId,
        });
        return keptJson(c, productionAnswer(load, months));
      });
    });

  routes.get('/production/well', (c) => {
    c.header('Cache-Control', 'no-store');
    const asked = parseUwi(c.req.query('uwi'));
    if (typeof asked === 'string') return apiError(c, 400, 'VALIDATION_FAILED', asked);
    return production(c, (petroleum, ctx) => petroleum.wellProduction(ctx, asked.uwi));
  });

  routes.get('/production/formation', (c) => {
    c.header('Cache-Control', 'no-store');
    const asked = parseFormation(c.req.query('formation'));
    if (typeof asked === 'string') return apiError(c, 400, 'VALIDATION_FAILED', asked);
    return production(c, (petroleum, ctx) => petroleum.formationProduction(ctx, asked.formation));
  });

  return routes;
}
