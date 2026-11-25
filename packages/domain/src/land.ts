/**
 * Land held today (F-241, docs/FEATURES_OIL_GAS.md): Crown petroleum and natural gas and oil
 * sands agreements, active offset notices, and land whose petroleum and natural gas is not the
 * Crown's, read from the Government of Alberta's public map services and turned into rows ready
 * to load. Agreements and non-Crown minerals are Alberta Energy and Minerals' data under the
 * Open Government Licence - Alberta (each service's metadata, read 2026-11-21).
 *
 * Kept free of imports and of TypeScript-only syntax, so the manual loader
 * (scripts/load-land.js) can run it with Node's type stripping.
 */

export const LAND_LAYER_KEYS = [
  'png_agreements',
  'oil_sands_agreements',
  'offset_notices',
  'freehold',
] as const;
export type LandLayerKey = (typeof LAND_LAYER_KEYS)[number];

export interface LandLayer {
  key: LandLayerKey;
  /** The layer's address on the province's map service, without `/query`. */
  url: string;
  /** The field the pages are ordered by. */
  idField: string;
}

const AGREEMENTS = 'https://geospatial.alberta.ca/titan/rest/services/energy/mineral_agreement';
export const LAND_LAYERS: Record<LandLayerKey, LandLayer> = {
  png_agreements: {
    key: 'png_agreements',
    url: `${AGREEMENTS}/MapServer/8`,
    idField: 'OBJECTID',
  },
  oil_sands_agreements: {
    key: 'oil_sands_agreements',
    url: `${AGREEMENTS}/MapServer/7`,
    idField: 'OBJECTID',
  },
  offset_notices: {
    key: 'offset_notices',
    url: 'https://gis.energy.gov.ab.ca/arcgis/rest/services/Geoview/Mineral_Agreements_Ext_PROD/MapServer/27',
    idField: 'ObjectId',
  },
  freehold: {
    key: 'freehold',
    url: 'https://geospatial.alberta.ca/titan/rest/services/energy/non_crown_mineral_ownership/MapServer/6',
    idField: 'OBJECTID',
  },
};

/** Named on screen, as the Open Government Licence - Alberta asks. */
export const LAND_SOURCE_NAME = 'Alberta Energy and Minerals, Government of Alberta';

/** West, south, east, north, in degrees. */
export type LandBounds = [number, number, number, number];
/** A GeoJSON MultiPolygon's coordinates. */
export type LandShape = [number, number][][][];

/**
 * A shape as the database keeps it (F-310), whole numbers, as the pipelines are (F-249): JSON
 * took about three times the room. `path` is every point, longitude then latitude, in
 * hundred-thousandths of a degree (the five decimals shapes are rounded to), each ring without
 * the point that closes it. `rings` is, for each polygon, its count of rings and then each
 * ring's count of points; empty for one polygon of one ring, the most common shape.
 */
export interface PackedLandShape {
  path: number[];
  rings: number[];
}

const LAND_UNITS = 1e5;

/** A shape packed for the database; null when it holds no ring of three points or more. */
export function packLandShape(shape: LandShape): PackedLandShape | null {
  const path: number[] = [];
  const layout: number[] = [];
  for (const polygon of shape) {
    layout.push(polygon.length);
    for (const ring of polygon) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      const closed =
        ring.length > 1 && first !== undefined && last?.[0] === first[0] && last[1] === first[1];
      const points = closed ? ring.slice(0, -1) : ring;
      if (points.length < 3) return null;
      layout.push(points.length);
      for (const [lon, lat] of points) {
        path.push(Math.round(lon * LAND_UNITS), Math.round(lat * LAND_UNITS));
      }
    }
  }
  if (path.length === 0) return null;
  const single = shape.length === 1 && layout[0] === 1;
  return { path, rings: single ? [] : layout };
}

/**
 * A packed shape as a GeoJSON MultiPolygon's coordinates, each ring closed again; null when the
 * counts do not match the points.
 */
export function unpackLandShape(
  path: readonly number[],
  rings: readonly number[],
): LandShape | null {
  if (path.length % 2 !== 0) return null;
  const layout = rings.length === 0 ? [1, path.length / 2] : rings;
  const shape: LandShape = [];
  let at = 0;
  let i = 0;
  while (i < layout.length) {
    const count = layout[i++] ?? 0;
    if (!Number.isInteger(count) || count < 1) return null;
    const polygon: [number, number][][] = [];
    for (let r = 0; r < count; r += 1) {
      const points = layout[i++];
      if (points === undefined || !Number.isInteger(points) || points < 3) return null;
      if (at + points * 2 > path.length) return null;
      const ring: [number, number][] = [];
      for (let p = 0; p < points; p += 1) {
        ring.push([(path[at] ?? 0) / LAND_UNITS, (path[at + 1] ?? 0) / LAND_UNITS]);
        at += 2;
      }
      const first = ring[0];
      if (first) ring.push([first[0], first[1]]);
      polygon.push(ring);
    }
    shape.push(polygon);
  }
  return at === path.length && shape.length > 0 ? shape : null;
}

/** A row's shape, in whichever form it is kept: packed (F-310), or as JSON by an older load. */
export function storedLandShape(row: {
  shape: LandShape | null;
  path: readonly number[] | null;
  rings: readonly number[] | null;
}): LandShape {
  if (row.path !== null) return unpackLandShape(row.path, row.rings ?? []) ?? [];
  return row.shape ?? [];
}

export interface LandAgreement {
  rights: 'png' | 'oil_sands';
  agreementType: string;
  agreementNumber: string;
  tract: string | null;
  mineralType: string | null;
  agreementGroup: string | null;
  status: string | null;
  vintage: string | null;
  holder: string | null;
  parties: string | null;
  zone: string | null;
  originalAreaHa: number | null;
  areaHa: number | null;
  termDate: string | null;
  continuationDate: string | null;
  expiryText: string | null;
  bounds: LandBounds;
  shape: LandShape;
}

export interface LandOffset {
  offsetType: string | null;
  offsetNumber: string;
  tract: string | null;
  holder: string | null;
  expiryDate: string | null;
  zone: string | null;
  bounds: LandBounds;
  shape: LandShape;
}

export interface LandFreehold {
  landKey: number | null;
  substances: string | null;
  nationalPark: string | null;
  reserveNumber: string | null;
  reserveName: string | null;
  bounds: LandBounds;
  shape: LandShape;
}

interface Feature {
  properties?: Record<string, unknown> | null;
  geometry?: { type?: unknown; coordinates?: unknown } | null;
}

/** Alberta, a little wider: a shape reaching outside it is not one of ours. */
const WEST = -120.1;
const EAST = -109.9;
const SOUTH = 48.9;
const NORTH = 60.1;

/** Text trimmed, with runs of spaces as one; null when empty, not text, or longer than `max`. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim();
  return t === '' || t.length > max ? null : t;
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e8
    ? Math.round(value * 1e4) / 1e4
    : null;
}

/** `1964/02/17` or `2006-05-08` as `1964-02-17`; null for anything else. */
export function landDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${String(y)}-${String(mo)}-${String(d)}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d)) return null;
  return `${String(y)}-${String(mo)}-${String(d)}`;
}

/**
 * A Polygon's or MultiPolygon's coordinates as a MultiPolygon's, to five decimals (about a
 * metre), with the box around them; null when it is neither, holds no ring of four points, or
 * reaches outside Alberta.
 */
export function landShape(geometry: Feature['geometry']): {
  shape: LandShape;
  bounds: LandBounds;
} | null {
  if (!geometry) return null;
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : null;
  if (!Array.isArray(polygons)) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const shape: LandShape = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) return null;
    const rings: [number, number][][] = [];
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      const points: [number, number][] = [];
      for (const point of ring) {
        if (!Array.isArray(point)) return null;
        const [x, y] = point as unknown[];
        if (typeof x !== 'number' || typeof y !== 'number') return null;
        if (!(x >= WEST && x <= EAST && y >= SOUTH && y <= NORTH)) return null;
        const lon = Math.round(x * 1e5) / 1e5;
        const lat = Math.round(y * 1e5) / 1e5;
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        points.push([lon, lat]);
      }
      rings.push(points);
    }
    if (rings.length > 0) shape.push(rings);
  }
  if (shape.length === 0) return null;
  return { shape, bounds: [west, south, east, north] };
}

/** One tract of a Crown agreement, or null when it cannot be read. */
export function landAgreement(feature: Feature, rights: 'png' | 'oil_sands'): LandAgreement | null {
  const p = feature.properties ?? {};
  const placed = landShape(feature.geometry);
  const agreementType = text(p.AgreementType, 3);
  const agreementNumber = text(p.AgreementNumber, 10);
  if (!placed || !agreementType || !agreementNumber) return null;
  if (!/^[0-9A-Z]{1,3}$/.test(agreementType) || !/^[0-9A-Z]{1,10}$/.test(agreementNumber)) {
    return null;
  }
  return {
    rights,
    agreementType,
    agreementNumber,
    tract: text(p.TractIdentifier, 2),
    mineralType: text(p.MineralType, 10),
    agreementGroup: text(p.AgreementGroup, 10),
    status: text(p.Status, 255),
    vintage: text(p.LicenceVintage, 50),
    holder: text(p.DesRepName, 150),
    parties: text(p.PartyName, 1730),
    zone: text(p.Zone, 1000),
    originalAreaHa: amount(p.OriginalArea),
    areaHa: amount(p.AgreementArea),
    termDate: landDate(p.TermDate),
    continuationDate: landDate(p.ContinuationDate),
    expiryText: text(p.CurrentExpiryText, 4000),
    ...placed,
  };
}

/** One tract of an active offset notice, or null when it cannot be read. */
export function landOffset(feature: Feature): LandOffset | null {
  const p = feature.properties ?? {};
  const placed = landShape(feature.geometry);
  const offsetNumber = text(p.OffsetNo, 20);
  if (!placed || !offsetNumber || !/^[0-9A-Z]{1,20}$/.test(offsetNumber)) return null;
  return {
    offsetType: text(p.OffsetType, 10),
    offsetNumber,
    tract: text(p.Tract, 2),
    holder: text(p.DesRep, 150),
    expiryDate: landDate(p.ExpiryDate),
    zone: text(p.ZoneDesc, 1000),
    ...placed,
  };
}

/** One piece of land whose petroleum and natural gas is not the Crown's, or null. */
export function landFreehold(feature: Feature): LandFreehold | null {
  const p = feature.properties ?? {};
  const placed = landShape(feature.geometry);
  if (!placed) return null;
  return {
    landKey: typeof p.LandKey === 'number' && Number.isSafeInteger(p.LandKey) ? p.LandKey : null,
    substances: text(p.SubstanceDescription, 245),
    nationalPark: text(p.NationalPark, 60),
    reserveNumber: text(p.IndianReserveNumber, 20),
    reserveName: text(p.IndianReserveName, 75),
    ...placed,
  };
}

/** The rows of one page of a layer's answer, and how many of its shapes could not be read. */
export function landRows(
  layer: LandLayerKey,
  features: readonly Feature[],
): { rows: (LandAgreement | LandOffset | LandFreehold)[]; skipped: number } {
  const rows: (LandAgreement | LandOffset | LandFreehold)[] = [];
  for (const feature of features) {
    const row =
      layer === 'png_agreements'
        ? landAgreement(feature, 'png')
        : layer === 'oil_sands_agreements'
          ? landAgreement(feature, 'oil_sands')
          : layer === 'offset_notices'
            ? landOffset(feature)
            : landFreehold(feature);
    if (row) rows.push(row);
  }
  return { rows, skipped: features.length - rows.length };
}
