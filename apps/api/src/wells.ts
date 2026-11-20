import { parseWellPage, WELL_FIELDS } from '@grain/domain';

import type { DatabaseFactory } from './respond';
import { failureSummary, type ApiEnv } from './respond';
import {
  PETROLEUM_SCHEMA_VERSION,
  type PetroleumDatabase,
  type PetroleumFactory,
} from './petroleum-db';
import type { WellLoad } from './wells-db';

/**
 * Every Alberta well, loaded from the province's public "Well Surface" service (F-243 part 3;
 * docs/FEATURES_OIL_GAS.md; review register docs/reviews/F-243-3.md). Data from the AER, used on
 * the owner's decision (docs/DECISIONS.md, 2026-11-19): members only, never exported.
 *
 * On the free Supabase plan the database size limit is shared by grain's database and the oil
 * and gas one, and going over it refuses requests for both (the owner's decision of 2026-11-19
 * to try the free plan). So before every page the job measures both and stops at
 * WELLS_SIZE_BUDGET_BYTES, never loading blind.
 */

export const WELLS_SERVICE =
  'https://gis.energy.gov.ab.ca/arcgis/rest/services/Geoview/ERCB_Ext_PROD/MapServer/3/query';

/** Grain's and the oil and gas databases together never pass this (the shared limit is 500 MB). */
export const WELLS_SIZE_BUDGET_BYTES = 400 * 1024 * 1024;
const PAGE_SIZE = 2000;
const PAGES_PER_RUN = 60;
const RUN_LIMIT_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
const PAGE_MAX_BYTES = 5_000_000;
/** A new monthly load starts this long after the last clean one finished. */
const REFRESH_AFTER_MS = 28 * 24 * 3600 * 1000;

const mb = (bytes: number) => `${String(Math.round(bytes / (1024 * 1024)))} MB`;

/** One page from the service after `fromObjectId`; null when it did not answer usably. */
export async function fetchWellPage(
  fromObjectId: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const params = new URLSearchParams({
    where: `OBJECTID > ${String(Math.trunc(fromObjectId))}`,
    outFields: WELL_FIELDS.join(','),
    orderByFields: 'OBJECTID',
    resultRecordCount: String(PAGE_SIZE),
    returnGeometry: 'false',
    f: 'json',
  });
  try {
    const res = await fetchImpl(WELLS_SERVICE, {
      method: 'POST',
      body: params,
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > PAGE_MAX_BYTES) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function petroleumTarget(env: ApiEnv['Bindings']): { url: string; viaHyperdrive: boolean } | null {
  if (env.PETROLEUM) return { url: env.PETROLEUM.connectionString, viaHyperdrive: true };
  return env.PETROLEUM_DATABASE_URL
    ? { url: env.PETROLEUM_DATABASE_URL, viaHyperdrive: false }
    : null;
}

export interface WellsRefreshSummary {
  status: 'not_configured' | 'not_ready' | 'idle' | 'stopped_size' | 'size_unknown' | 'ran';
}

/** The load to work on now: the running one, or a new one when the monthly refresh is due. */
async function loadToRun(db: PetroleumDatabase, now: Date): Promise<WellLoad | 'idle' | 'stopped'> {
  const latest = await db.latestWellLoad();
  if (latest?.status === 'running') return latest;
  // A load stopped at the size limit waits for the owner (a plan decision), never restarted.
  if (latest?.status === 'stopped_size') return 'stopped';
  const done = await db.lastDoneWellLoad();
  const due =
    latest === null ||
    latest.status === 'failed' ||
    done === null ||
    now.getTime() - Date.parse(done.finishedAt ?? done.startedAt) > REFRESH_AFTER_MS;
  if (!due) return 'idle';
  return (await db.startWellLoad()) ?? 'idle';
}

/**
 * The scheduled job (the twice-daily trigger). At most PAGES_PER_RUN pages a run; a failed page
 * is fetched again next run from the same cursor. Logs counts and sizes only.
 */
export async function refreshWells(
  env: ApiEnv['Bindings'],
  openDatabase: DatabaseFactory,
  openPetroleum: PetroleumFactory,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<WellsRefreshSummary> {
  const target = petroleumTarget(env);
  const grainUrl = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (target === null || !grainUrl) {
    console.log('Wells not refreshed: a database is not set up');
    return { status: 'not_configured' };
  }
  let petroleum: PetroleumDatabase;
  let grain: ReturnType<DatabaseFactory>;
  try {
    petroleum = openPetroleum(target.url, { viaHyperdrive: target.viaHyperdrive });
    grain = openDatabase(grainUrl, { viaHyperdrive: env.HYPERDRIVE !== undefined });
  } catch {
    // The error can carry the whole URL, password included, so it is not logged.
    console.error('Wells not refreshed: a database is not configured correctly');
    return { status: 'not_configured' };
  }
  const started = Date.now();
  try {
    if ((await petroleum.schemaVersion()) < PETROLEUM_SCHEMA_VERSION) {
      console.log('Wells not refreshed: the oil and gas database is not at this version yet');
      return { status: 'not_ready' };
    }
    const load = await loadToRun(petroleum, now);
    if (load === 'idle') return { status: 'idle' };
    if (load === 'stopped') {
      console.warn('Wells not loaded: the last load stopped at the size limit (a plan decision)');
      return { status: 'stopped_size' };
    }
    let cursor = load.lastObjectId;
    let pages = 0;
    let saved = 0;
    let sizes = '';
    for (; pages < PAGES_PER_RUN && Date.now() - started < RUN_LIMIT_MS; pages++) {
      // The size guard, before every page: both databases, never loading blind.
      const [grainSize, petroleumSize] = await Promise.all([
        grain.databaseSize().catch(() => NaN),
        petroleum.databaseSize().catch(() => NaN),
      ]);
      if (!Number.isFinite(grainSize) || !Number.isFinite(petroleumSize)) {
        console.error('Wells load paused: a database size could not be read');
        return { status: 'size_unknown' };
      }
      const total = grainSize + petroleumSize;
      sizes = `grain ${mb(grainSize)} + oil and gas ${mb(petroleumSize)} = ${mb(total)} of ${mb(WELLS_SIZE_BUDGET_BYTES)}`;
      if (total >= WELLS_SIZE_BUDGET_BYTES) {
        await petroleum.stopWellLoad(load.id, 'stopped_size');
        console.warn(`Wells load ${String(load.id)} stopped at the size limit: ${sizes}`);
        return { status: 'stopped_size' };
      }
      const body = await fetchWellPage(cursor, fetchImpl);
      if (body === null) {
        console.warn(
          `Wells load ${String(load.id)}: the province's service did not answer; next run`,
        );
        break;
      }
      let page;
      try {
        page = parseWellPage(body, PAGE_SIZE);
      } catch {
        console.warn(`Wells load ${String(load.id)}: a page could not be read; next run`);
        break;
      }
      if ((await petroleum.saveWellPage(load.id, cursor, page)) === 'moved') {
        console.log(`Wells load ${String(load.id)}: another run moved on; this one stops`);
        break;
      }
      saved += page.rows.length;
      cursor = page.lastObjectId ?? cursor;
      if (!page.more) {
        pages += 1;
        console.log(`Wells load ${String(load.id)} finished`);
        break;
      }
    }
    console.log(
      `Wells: load ${String(load.id)}, ${String(pages)} pages, ${String(saved)} saved this run; ${sizes}`,
    );
    return { status: 'ran' };
  } catch (error) {
    console.error(`Wells not refreshed: ${failureSummary(error)}`);
    return { status: 'ran' };
  } finally {
    await petroleum.close().catch(() => undefined);
    await grain.close().catch(() => undefined);
  }
}
