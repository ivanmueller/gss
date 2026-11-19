import {
  AER_LIST_MAX_CHARS,
  AER_READER_VERSION,
  albertaDay,
  albertaToUtc,
  parseSt1,
  parseSt49,
  type AtsLsd,
} from '@grain/domain';

import {
  AER_MAX_FEATURES,
  type AerLicenceServed,
  type AerPoint,
  type AerReading,
  type AerReport,
  type AerRigServed,
  type AerSourceDates,
} from './aer-lists-db';
import {
  PETROLEUM_SCHEMA_VERSION,
  type PetroleumDatabase,
  type PetroleumFactory,
} from './petroleum-db';
import { failureSummary, type ApiEnv } from './respond';

/**
 * The Alberta Energy Regulator's daily licence (ST1) and rig activity (ST49) lists (F-243 part 1;
 * docs/FEATURES_OIL_GAS.md; review register docs/reviews/F-243-1.md). The AER overwrites each
 * weekday's file a week later, so the Worker's twice-daily job keeps every file as published,
 * then reads it, then places each licence's surface location on the province's township grid.
 *
 * The AER's data is not under an open licence; it is used on the owner's decision
 * (docs/DECISIONS.md, 2026-11-19): shown with its source and date, marked preliminary, to members
 * only, never exported.
 */

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** The 14 fixed addresses (final ones: www.aer.ca/data/… answers with a page that points here). */
export const AER_SOURCES: readonly { report: AerReport; url: string }[] = [
  ...DAYS.map((day) => ({
    report: 'st1' as const,
    url: `https://static.aer.ca/prd/data/well-lic/WELLS${day}.TXT`,
  })),
  ...DAYS.map((day) => ({
    report: 'st49' as const,
    url: `https://static.aer.ca/prd/data/wells/SPUD${day.charAt(0)}${day.slice(1).toLowerCase()}.txt`,
  })),
];

export const ATS_LSD_QUERY =
  'https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer/20/query';

/**
 * The placing code's version: raised when the way a point is placed in its subdivision changes,
 * so every subdivision is placed again (F-243-1-R3-02). 1: a point inside the largest piece.
 */
export const AER_PLACEMENT_VERSION = 1;

const FETCH_TIMEOUT_MS = 20_000;
/** Files read (or read again after a reader change) in one run. */
const READS_PER_RUN = 50;
/** Subdivisions asked of the township grid in one run, and in one request. */
const LOCATE_PER_RUN = 300;
const LOCATE_BATCH = 40;

type FetchOutcome =
  | { kind: 'ok'; body: string; fetchedAt: Date }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed'; reason: string };

/** Reads a body as a stream, giving up past `max` bytes so a huge answer is never held. */
async function boundedBytes(res: Response, max: number): Promise<Uint8Array | null> {
  const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
}

/** Fetches one AER list: status 200, no redirect, at most AER_LIST_MAX_CHARS bytes, not HTML. */
export async function fetchAerList(url: string, fetchImpl: typeof fetch): Promise<FetchOutcome> {
  let res: Response;
  const fetchedAt = new Date();
  try {
    res = await fetchImpl(url, {
      redirect: 'error',
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'failed', reason: 'no answer' };
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: 'failed', reason: `status ${String(res.status)}` };
  }
  if ((res.headers.get('Content-Type') ?? '').toLowerCase().includes('text/html')) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: 'refused', reason: 'an HTML page' };
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await boundedBytes(res, AER_LIST_MAX_CHARS);
  } catch {
    return { kind: 'failed', reason: 'cut short' };
  }
  if (bytes === null) return { kind: 'refused', reason: 'too large' };
  // windows-1252 never fails on a stray byte; the files are plain ASCII today.
  const body = new TextDecoder('windows-1252').decode(bytes);
  if (body.trim() === '') return { kind: 'refused', reason: 'empty' };
  if (body.trimStart().startsWith('<')) return { kind: 'refused', reason: 'an HTML page' };
  return { kind: 'ok', body, fetchedAt };
}

/** SHA-256 of the body's UTF-8 encoding, as the database checks it. */
export async function bodySha256(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A stored file read by the current reader, as the database stores it. */
export function readAerFile(report: AerReport, body: string): AerReading {
  if (report === 'st1') {
    const read = parseSt1(body);
    if (!read.structure || read.listDate === null) return { status: 'unreadable' };
    return {
      status: read.skipped > 0 ? 'partial' : 'read',
      listDate: read.listDate,
      skipped: read.skipped,
      licences: read.rows,
      rigs: [],
    };
  }
  const read = parseSt49(body);
  if (!read.structure || read.listDate === null) return { status: 'unreadable' };
  let skipped = read.skipped;
  const rigs = [];
  for (const row of read.rows) {
    // The platform's Alberta rule converts the minute; the seconds are added (F-243-1-D1-04).
    const minute = albertaToUtc(row.activityWallTime.slice(0, 16));
    if (minute === null) {
      skipped += 1;
      continue;
    }
    const seconds = Number(row.activityWallTime.slice(17, 19));
    const activityAt = new Date(Date.parse(minute) + seconds * 1000).toISOString();
    rigs.push({ ...row, activityAt });
  }
  return {
    status: skipped > 0 ? 'partial' : 'read',
    listDate: read.listDate,
    skipped,
    licences: [],
    rigs,
  };
}

/** The township grid's where clause for these subdivisions: numbers only, from checked values. */
export function lsdWhere(subdivisions: AtsLsd[]): string {
  return subdivisions
    .map((s) => {
      const parts = [s.meridian, s.range, s.township, s.section, s.lsd];
      if (!parts.every((n) => Number.isInteger(n) && n >= 1 && n <= 126)) {
        throw new RangeError('not a subdivision');
      }
      return `(M=${String(s.meridian)} AND RGE=${String(s.range)} AND TWP=${String(s.township)} AND SEC=${String(s.section)} AND LS=${String(s.lsd)})`;
    })
    .join(' OR ');
}

type Ring = [number, number][];

/** A polygon: its outer ring and its holes. */
interface Polygon {
  outer: Ring;
  holes: Ring[];
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i] ?? [0, 0];
    const [x2, y2] = ring[i + 1] ?? [0, 0];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function polygonArea(polygon: Polygon): number {
  return ringArea(polygon.outer) - polygon.holes.reduce((sum, hole) => sum + ringArea(hole), 0);
}

/** Whether a point is inside a ring (ray casting; a point on an edge counts either way). */
function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] ?? [0, 0];
    const [xj, yj] = ring[j] ?? [0, 0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a point is inside a polygon: in its outer ring and in none of its holes. */
function inPolygon(point: [number, number], polygon: Polygon): boolean {
  return inRing(point, polygon.outer) && !polygon.holes.some((hole) => inRing(point, hole));
}

/**
 * A point inside the polygon (F-243-1-R2-03): the average of its outer corners when that lies
 * inside (a grid square, nearly always); otherwise the middle of the widest stretch inside along a
 * few horizontal lines across it. Null when none is found.
 */
export function pointOnSurface(polygon: Polygon): [number, number] | null {
  const corners = polygon.outer.slice(0, -1);
  if (corners.length < 3) return null;
  const average: [number, number] = [
    corners.reduce((sum, [x]) => sum + x, 0) / corners.length,
    corners.reduce((sum, [, y]) => sum + y, 0) / corners.length,
  ];
  if (inPolygon(average, polygon)) return average;
  const ys = corners.map(([, y]) => y);
  const south = Math.min(...ys);
  const north = Math.max(...ys);
  let best: { width: number; point: [number, number] } | null = null;
  for (const share of [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875]) {
    const y = south + (north - south) * share;
    const xs: number[] = [];
    for (const ring of [polygon.outer, ...polygon.holes]) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i] ?? [0, 0];
        const [x2, y2] = ring[i + 1] ?? [0, 0];
        if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const west = xs[i] ?? 0;
      const east = xs[i + 1] ?? 0;
      const point: [number, number] = [(west + east) / 2, y];
      if (east - west > (best?.width ?? 0) && inPolygon(point, polygon)) {
        best = { width: east - west, point };
      }
    }
  }
  return best?.point ?? null;
}

function isRing(value: unknown): value is Ring {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    value.every(
      (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
  );
}

function polygonOf(rings: unknown): Polygon | null {
  if (!Array.isArray(rings) || !isRing(rings[0])) return null;
  return { outer: rings[0], holes: rings.slice(1).filter(isRing) };
}

/** The polygons of a GeoJSON polygon or multipolygon geometry, with their holes. */
function polygonsOf(geometry: unknown): Polygon[] {
  if (typeof geometry !== 'object' || geometry === null) return [];
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(coordinates)) return [];
  if (type === 'Polygon') {
    const polygon = polygonOf(coordinates);
    return polygon ? [polygon] : [];
  }
  if (type === 'MultiPolygon') {
    return coordinates.flatMap((rings: unknown) => {
      const polygon = polygonOf(rings);
      return polygon ? [polygon] : [];
    });
  }
  return [];
}

const ALBERTA = { west: -120.1, east: -109.9, south: 48.9, north: 60.1 };

/**
 * The township grid's answer for `asked`, as points: a point inside each subdivision's largest
 * piece, checked inside it once rounded (F-243-1-R2-03); a subdivision not in the answer, without
 * such a point, or outside Alberta, is not found.
 */
export function pointsFromGrid(asked: AtsLsd[], body: unknown): AerPoint[] {
  const features =
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { features?: unknown }).features)
      ? (body as { features: unknown[] }).features
      : null;
  if (features === null) throw new Error('township grid answer malformed');
  const best = new Map<string, { area: number; polygon: Polygon }>();
  const key = (m: number, r: number, t: number, s: number, l: number) =>
    `${String(m)}-${String(r)}-${String(t)}-${String(s)}-${String(l)}`;
  for (const feature of features) {
    if (typeof feature !== 'object' || feature === null) continue;
    const props = (feature as { properties?: Record<string, unknown> }).properties ?? {};
    const k = key(
      Number(props.M),
      Number(props.RGE),
      Number(props.TWP),
      Number(props.SEC),
      Number(props.LS),
    );
    for (const polygon of polygonsOf((feature as { geometry?: unknown }).geometry)) {
      const area = polygonArea(polygon);
      if (area > (best.get(k)?.area ?? 0)) best.set(k, { area, polygon });
    }
  }
  return asked.map((s) => {
    const piece = best.get(key(s.meridian, s.range, s.township, s.section, s.lsd))?.polygon;
    const inner = piece ? pointOnSurface(piece) : null;
    // Stored to six places (about 10 cm): the rounded point must still lie inside the piece.
    const point: [number, number] | null = inner
      ? [Math.round(inner[0] * 1e6) / 1e6, Math.round(inner[1] * 1e6) / 1e6]
      : null;
    const usable =
      piece !== undefined &&
      point !== null &&
      inPolygon(point, piece) &&
      point[0] >= ALBERTA.west &&
      point[0] <= ALBERTA.east &&
      point[1] >= ALBERTA.south &&
      point[1] <= ALBERTA.north;
    return { ...s, point: usable ? { longitude: point[0], latitude: point[1] } : null };
  });
}

/** Asks the township grid for one batch; null when the service did not answer usably. */
async function locateBatch(batch: AtsLsd[], fetchImpl: typeof fetch): Promise<AerPoint[] | null> {
  const params = new URLSearchParams({
    where: lsdWhere(batch),
    outFields: 'M,RGE,TWP,SEC,LS',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  try {
    const res = await fetchImpl(ATS_LSD_QUERY, {
      method: 'POST',
      body: params,
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const bytes = await boundedBytes(res, 5_000_000);
    if (bytes === null) return null;
    return pointsFromGrid(batch, JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/**
 * Whether the database refused a reading's rows themselves: SQLSTATE class 22 (data exception) or
 * 23 (integrity constraint violation). The same rows would be refused again.
 */
export function refusedRows(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^2[23][0-9A-Z]{3}$/.test(code);
}

export interface AerRefreshSummary {
  status: 'done' | 'not_configured' | 'not_ready' | 'database_failed';
}

function petroleumTarget(env: ApiEnv['Bindings']): { url: string; viaHyperdrive: boolean } | null {
  if (env.PETROLEUM) return { url: env.PETROLEUM.connectionString, viaHyperdrive: true };
  return env.PETROLEUM_DATABASE_URL
    ? { url: env.PETROLEUM_DATABASE_URL, viaHyperdrive: false }
    : null;
}

/**
 * The scheduled job (the twice-daily trigger, beside the Bank of Canada rate). Each step catches
 * its own failures: a file that cannot be fetched or read never stops the others. Logs counts
 * only, never a file's contents.
 */
export async function refreshAerLists(
  env: ApiEnv['Bindings'],
  openPetroleum: PetroleumFactory,
  fetchImpl: typeof fetch = fetch,
): Promise<AerRefreshSummary> {
  const target = petroleumTarget(env);
  if (target === null) {
    console.log('AER lists not refreshed: the oil and gas database is not set up');
    return { status: 'not_configured' };
  }
  let db: PetroleumDatabase;
  try {
    db = openPetroleum(target.url, { viaHyperdrive: target.viaHyperdrive });
  } catch {
    // The error can carry the whole URL, password included, so it is not logged.
    console.error('AER lists not refreshed: the oil and gas database is not configured correctly');
    return { status: 'not_configured' };
  }
  try {
    if ((await db.schemaVersion()) < PETROLEUM_SCHEMA_VERSION) {
      console.log('AER lists not refreshed: the oil and gas database is not at this version yet');
      return { status: 'not_ready' };
    }
    const captured: string[] = [];
    for (const report of ['st1', 'st49'] as const) {
      const counts = { fetched: 0, newEditions: 0, unchanged: 0, refused: 0, failed: 0 };
      for (const source of AER_SOURCES.filter((s) => s.report === report)) {
        const outcome = await fetchAerList(source.url, fetchImpl);
        if (outcome.kind !== 'ok') {
          counts[outcome.kind] += 1;
          console.warn(
            `AER ${report.toUpperCase()} ${source.url.slice(-11)}: ${outcome.kind}, ${outcome.reason}`,
          );
          continue;
        }
        counts.fetched += 1;
        try {
          // Captured before any reading, so a reading that fails never loses the file
          // (F-243-1-D2-04).
          const capture = await db.aerCapture(
            report,
            source.url,
            outcome.body,
            await bodySha256(outcome.body),
            outcome.fetchedAt,
          );
          if (capture.newEdition) counts.newEditions += 1;
          else counts.unchanged += 1;
          if (capture.newFile) captured.push(capture.fileId);
        } catch (error) {
          counts.failed += 1;
          console.error(`AER ${report.toUpperCase()} not kept: ${failureSummary(error)}`);
        }
      }
      console.log(
        `AER ${report.toUpperCase()}: ${String(counts.fetched)} fetched, ${String(counts.newEditions)} new edition(s), ` +
          `${String(counts.unchanged)} unchanged, ${String(counts.refused)} refused, ${String(counts.failed)} failed`,
      );
    }

    // Reading: the files just captured first, then any stored file the current reader has not
    // read yet (after a reader change), at most READS_PER_RUN.
    for (const file of await db.aerFilesToRead(AER_READER_VERSION, captured, READS_PER_RUN)) {
      const reading = readAerFile(file.report, file.body);
      try {
        const stored = await db.aerStoreReading(file.id, AER_READER_VERSION, reading);
        if (stored === 'stored') {
          console.log(
            reading.status === 'unreadable'
              ? `AER ${file.report.toUpperCase()} read: unreadable`
              : `AER ${file.report.toUpperCase()} read: ${reading.listDate}, ${reading.status}, ` +
                  `${String(reading.licences.length + reading.rigs.length)} rows, ${String(reading.skipped)} skipped`,
          );
        }
      } catch (error) {
        console.error(
          `AER ${file.report.toUpperCase()} reading not stored: ${failureSummary(error)}`,
        );
        // Only the database refusing the rows themselves (a data or constraint error) is recorded
        // unreadable at this version; anything else (a timeout, a lost connection) leaves the file
        // to be read again next run (F-243-1-R1-02). The file itself always stays.
        if (refusedRows(error)) {
          await db
            .aerStoreReading(file.id, AER_READER_VERSION, { status: 'unreadable' })
            .catch(() => undefined);
        }
      }
    }

    // Locating the served licences' surface locations on the township grid.
    const counts = { asked: 0, found: 0, notFound: 0, failed: 0 };
    const pending = await db.aerSubdivisionsToLocate(LOCATE_PER_RUN, AER_PLACEMENT_VERSION);
    for (let i = 0; i < pending.length; i += LOCATE_BATCH) {
      const batch = pending.slice(i, i + LOCATE_BATCH);
      counts.asked += batch.length;
      const points = await locateBatch(batch, fetchImpl);
      if (points === null) {
        // Nothing written: asked again next run.
        counts.failed += batch.length;
        continue;
      }
      await db.aerStorePoints(points, AER_PLACEMENT_VERSION);
      for (const p of points) {
        if (p.point) counts.found += 1;
        else counts.notFound += 1;
      }
    }
    console.log(
      `AER locations: ${String(counts.asked)} asked, ${String(counts.found)} found, ` +
        `${String(counts.notFound)} not found, ${String(counts.failed)} failed`,
    );
    return { status: 'done' };
  } catch (error) {
    console.error(`AER lists not refreshed: ${failureSummary(error)}`);
    return { status: 'database_failed' };
  } finally {
    await db.close().catch(() => undefined);
  }
}

/** The periods the routes offer, in days. */
export const LICENCE_DAYS = [7, 30, 90] as const;
export const RIG_DAYS = [7, 30] as const;

/** The first list date in a period of `days` ending today in Alberta. */
export function periodStart(now: Date, days: number): string {
  return albertaDay(new Date(now.getTime() - days * 86_400_000));
}

const LICENCE_SOURCE = 'Alberta Energy Regulator, ST1 Well Licences Issued – Daily List';
const RIG_SOURCE = 'Alberta Energy Regulator, ST49 Daily Drilling Activity List';

interface PointFeature<P> {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: P;
}

function source(name: string, dates: AerSourceDates) {
  return { name, preliminary: true as const, ...dates };
}

/** GET /petroleum/aer/licences: located licences as points, the rest counted. */
export function licencesAnswer(rows: AerLicenceServed[], dates: AerSourceDates, days: number) {
  const truncated = rows.length > AER_MAX_FEATURES;
  const kept = rows.slice(0, AER_MAX_FEATURES);
  const features: PointFeature<
    Omit<AerLicenceServed, 'longitude' | 'latitude'> & { precision: 'lsd' }
  >[] = [];
  let unlocated = 0;
  for (const { longitude, latitude, ...properties } of kept) {
    if (longitude === null || latitude === null) {
      unlocated += 1;
      continue;
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: { ...properties, precision: 'lsd' },
    });
  }
  return {
    source: source(LICENCE_SOURCE, dates),
    days,
    located: { type: 'FeatureCollection' as const, features },
    unlocated,
    truncated,
  };
}

/** GET /petroleum/aer/rigs: rigs placed at their licence's surface location; the rest listed. */
export function rigsAnswer(rows: AerRigServed[], dates: AerSourceDates, days: number) {
  const truncated = rows.length > AER_MAX_FEATURES;
  const kept = rows.slice(0, AER_MAX_FEATURES);
  const features: PointFeature<
    Omit<AerRigServed, 'longitude' | 'latitude'> & { precision: 'lsd' }
  >[] = [];
  const unlocated: Omit<AerRigServed, 'longitude' | 'latitude'>[] = [];
  for (const { longitude, latitude, ...properties } of kept) {
    if (longitude === null || latitude === null) {
      unlocated.push(properties);
      continue;
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: { ...properties, precision: 'lsd' },
    });
  }
  return {
    source: source(RIG_SOURCE, dates),
    days,
    located: { type: 'FeatureCollection' as const, features },
    unlocated,
    truncated,
  };
}
