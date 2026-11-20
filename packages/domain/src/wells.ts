/**
 * Alberta's wells from the province's public "Well Surface" service (F-243 part 3;
 * docs/FEATURES_OIL_GAS.md). The data comes from the AER and is used on the owner's decision
 * (docs/DECISIONS.md, 2026-11-19). This reads one page of the service's JSON answer; it never
 * guesses: a field that fails its check is reported, so the well keeps its last good value.
 */

/** The fields asked of the service. */
export const WELL_FIELDS = [
  'OBJECTID',
  'UWI',
  'WELL_NAME',
  'OPERATOR',
  'OPERATOR_NAME',
  'WELLTYPE',
  'CURRENT_STATUS',
  'WELL_STATUS',
  'FINAL_DRILL_DATE',
  'SURFACE_LONGITUDE',
  'SURFACE_LATITUDE',
] as const;

/** A well's fields that can fail their check, each kept at its last good value when it does. */
export type WellField =
  | 'wellName'
  | 'operatorCode'
  | 'operatorName'
  | 'wellType'
  | 'statusCode'
  | 'status'
  | 'finalDrillDate'
  | 'location';

export interface WellRow {
  uwi: string;
  objectId: number;
  wellName: string;
  operatorCode: string;
  operatorName: string;
  wellType: string;
  statusCode: string;
  status: string;
  /** `YYYY-MM-DD`, or null when the source has none. */
  finalDrillDate: string | null;
  /** Degrees, west negative; null when the source has none. */
  longitude: number | null;
  latitude: number | null;
  /** The fields that failed their check: the stored well keeps its last good value for each. */
  invalid: WellField[];
}

export interface WellPage {
  /** One row per UWI, the highest OBJECTID kept (F-243-3-D1-04). */
  rows: WellRow[];
  /** Rows without a valid UWI: they cannot be matched to a well (F-243-3-D1-01). */
  unidentified: number;
  /** The highest OBJECTID on the page, or null for an empty page. */
  lastObjectId: number | null;
  /** Whether the service has more after this page. */
  more: boolean;
}

const UWI = /^[0-9A-Z]{13,16}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ALBERTA = { west: -120.1, east: -109.9, south: 48.9, north: 60.1 };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** A text field: trimmed, within `max` characters; null text is empty; anything else invalid. */
function text(value: unknown, max: number): string | undefined {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : undefined;
}

function date(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const match = DATE.exec(value.trim());
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
    ? value.trim()
    : undefined;
}

/**
 * The location: the service gives longitude in degrees west as a positive number; it is stored
 * negative. Both absent: no location. Anything outside Alberta's box: invalid.
 */
function location(
  lon: unknown,
  lat: unknown,
): { longitude: number; latitude: number } | null | undefined {
  if ((lon === null || lon === undefined) && (lat === null || lat === undefined)) return null;
  if (typeof lon !== 'number' || typeof lat !== 'number') return undefined;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  const longitude = Math.round((lon > 0 ? -lon : lon) * 1e6) / 1e6;
  const latitude = Math.round(lat * 1e6) / 1e6;
  const inside =
    longitude >= ALBERTA.west &&
    longitude <= ALBERTA.east &&
    latitude >= ALBERTA.south &&
    latitude <= ALBERTA.north;
  return inside ? { longitude, latitude } : undefined;
}

/** One page of the service's answer; throws when the answer is not a feature list. */
export function parseWellPage(body: unknown, asked: number): WellPage {
  const features = record(body)?.features;
  if (!Array.isArray(features)) throw new Error('well page malformed');
  const byUwi = new Map<string, WellRow>();
  let unidentified = 0;
  let lastObjectId: number | null = null;
  for (const feature of features) {
    const a = record(record(feature)?.attributes);
    const objectId = a?.OBJECTID;
    if (!a || typeof objectId !== 'number' || !Number.isSafeInteger(objectId) || objectId <= 0) {
      // Without an OBJECTID the cursor cannot move past it: the page cannot be trusted.
      throw new Error('well page has a row without an OBJECTID');
    }
    lastObjectId = Math.max(lastObjectId ?? 0, objectId);
    const uwi = typeof a.UWI === 'string' ? a.UWI.trim() : '';
    if (!UWI.test(uwi)) {
      unidentified += 1;
      continue;
    }
    const invalid: WellField[] = [];
    const take = (field: WellField, value: string | undefined): string => {
      if (value === undefined) invalid.push(field);
      return value ?? '';
    };
    const drill = date(a.FINAL_DRILL_DATE);
    if (drill === undefined) invalid.push('finalDrillDate');
    const place = location(a.SURFACE_LONGITUDE, a.SURFACE_LATITUDE);
    if (place === undefined) invalid.push('location');
    const row: WellRow = {
      uwi,
      objectId,
      wellName: take('wellName', text(a.WELL_NAME, 200)),
      operatorCode: take('operatorCode', text(a.OPERATOR, 20)),
      operatorName: take('operatorName', text(a.OPERATOR_NAME, 200)),
      wellType: take('wellType', text(a.WELLTYPE, 200)),
      statusCode: take('statusCode', text(a.CURRENT_STATUS, 20)),
      status: take('status', text(a.WELL_STATUS, 200)),
      finalDrillDate: drill ?? null,
      longitude: place?.longitude ?? null,
      latitude: place?.latitude ?? null,
      invalid,
    };
    const before = byUwi.get(uwi);
    if (!before || before.objectId < objectId) byUwi.set(uwi, row);
  }
  const more = record(body)?.exceededTransferLimit === true || features.length >= asked;
  return { rows: [...byUwi.values()], unidentified, lastObjectId, more };
}
