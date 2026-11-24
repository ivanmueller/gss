import {
  featuresBounds,
  legalLandLabel,
  legalLandQuery,
  type LegalLand,
  type MapPlace,
  ALBERTA_BOX,
  ATS_SERVICE,
  GRID_LEVELS,
  GRID_SPECS,
  gridSquareOf,
  gridSquareZooms,
  legalLand,
  isTile,
  simplifyDegrees,
  squareInAlberta,
  tileBounds,
  type GridLevel,
  type GridShapeFields,
  type Tile,
} from '@grain/domain';

import { fetchService, LayerServiceError } from './map-layers';
import { apiError, type ApiContext } from './respond';

// The township grid on the oil and gas map (F-240, F-271): one map square of one level, asked of
// the province's township grid service by the Worker, never by the browser. The request is built
// from the fixed values in `GRID_SPECS` and the square alone; nothing the browser sends but the
// level's name and the square's numbers reaches the province, and nothing is stored.

/** Far more than any square was measured at (about 140 KB at most, 2026-11-22). */
const MAX_GRID_BYTES = 2 * 1024 * 1024;

/** The grid changes seldom: the browser's copy of a square is good for a week. */
const GRID_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function parseGridLevel(text: string | undefined): GridLevel | null {
  return GRID_LEVELS.find((level) => level === text) ?? null;
}

/** The square, when it is one this level is ever asked for at, inside Alberta; else null. */
export function parseGridSquare(level: GridLevel, z: string, x: string, y: string): Tile | null {
  const plain = /^\d{1,6}$/;
  if (![z, x, y].every((part) => plain.test(part))) return null;
  const tile = { z: Number(z), x: Number(x), y: Number(y) };
  if (!isTile(tile) || !gridSquareZooms(level).includes(tile.z)) return null;
  return squareInAlberta(tile) ? tile : null;
}

/** The province's address for one square of one level, simplified to the square's zoom. */
export function gridSquareUrl(level: GridLevel, tile: Tile): string {
  const spec = GRID_SPECS[level];
  const b = tileBounds(tile);
  const params = new URLSearchParams({
    f: 'geojson',
    where: spec.landOnly ? "RA = ' '" : '1=1',
    outFields: spec.fields.join(','),
    returnGeometry: 'true',
    geometry: [b.west, b.south, b.east, b.north].map((n) => n.toFixed(6)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    maxAllowableOffset: simplifyDegrees(tile.z).toPrecision(3),
    geometryPrecision: tile.z >= 12 ? '6' : '5',
  });
  return `${ATS_SERVICE}/${String(spec.layer)}/query?${params.toString()}`;
}

/** A point in Alberta from the query's text (plain decimals only); null otherwise. */
export function parseGridPoint(
  lon: string | undefined,
  lat: string | undefined,
): { lon: number; lat: number } | null {
  const plain = /^-?\d{1,3}(\.\d{1,8})?$/;
  if (!lon || !lat || !plain.test(lon) || !plain.test(lat)) return null;
  const point = { lon: Number(lon), lat: Number(lat) };
  return point.lon >= ALBERTA_BOX.west &&
    point.lon <= ALBERTA_BOX.east &&
    point.lat >= ALBERTA_BOX.south &&
    point.lat <= ALBERTA_BOX.north
    ? point
    : null;
}

/** The province's address for a legal land location by its numbers (F-254 part 3). */
export function legalLandUrl(land: LegalLand): string {
  const { level, where } = legalLandQuery(land);
  const spec = GRID_SPECS[level];
  const params = new URLSearchParams({
    f: 'geojson',
    where: spec.landOnly ? `${where} AND RA = ' '` : where,
    outFields: spec.fields.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '5',
  });
  return `${ATS_SERVICE}/${String(spec.layer)}/query?${params.toString()}`;
}

/**
 * A legal land location found on the province's township grid: its name and box; null when the
 * grid has no such square. Throws LayerServiceError when the service cannot be reached.
 */
export async function findLegalLand(land: LegalLand): Promise<MapPlace | null> {
  const { body } = await fetchService(
    legalLandUrl(land),
    /^(application|text)\/(json|plain|geo\+json)$/,
    MAX_GRID_BYTES,
  );
  let answer: unknown;
  try {
    answer = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  const features =
    typeof answer === 'object' && answer !== null
      ? (answer as { features?: unknown }).features
      : undefined;
  const bounds = Array.isArray(features) ? featuresBounds(features) : null;
  return bounds ? { label: legalLandLabel(land), bounds } : null;
}

/** The province's address for the legal subdivision under a point, with its outline. */
export function gridPointUrl(point: { lon: number; lat: number }): string {
  const params = new URLSearchParams({
    f: 'geojson',
    where: "RA = ' '",
    outFields: 'M,RGE,TWP,SEC,QS,LS',
    returnGeometry: 'true',
    geometry: `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    geometryPrecision: '6',
  });
  return `${ATS_SERVICE}/${String(GRID_SPECS.lsd.layer)}/query?${params.toString()}`;
}

/**
 * The square under a click (F-271): the legal subdivision and its section, quarter, township,
 * range and meridian, with its outline; `square: null` on a road allowance or outside the grid.
 */
export async function gridPointAnswer(c: ApiContext, point: { lon: number; lat: number }) {
  c.header('Cache-Control', 'no-store');
  let body: ArrayBuffer;
  try {
    ({ body } = await fetchService(
      gridPointUrl(point),
      /^(application|text)\/(json|plain|geo\+json)$/,
      MAX_GRID_BYTES,
    ));
  } catch (error) {
    if (!(error instanceof LayerServiceError)) throw error;
    console.warn(`Township grid point not fetched: status=${String(error.status)}`);
    return apiError(
      c,
      502,
      'GRID_SERVICE_FAILED',
      "The province's township grid service could not be reached or did not answer as expected.",
    );
  }
  let answer: unknown;
  try {
    answer = JSON.parse(new TextDecoder().decode(body));
  } catch {
    answer = null;
  }
  const features =
    typeof answer === 'object' && answer !== null
      ? (answer as { features?: unknown }).features
      : undefined;
  if (!Array.isArray(features)) {
    console.warn('Township grid point not fetched: status=422');
    return apiError(
      c,
      502,
      'GRID_SERVICE_FAILED',
      "The province's township grid service did not answer as expected.",
    );
  }
  const first = features[0] as
    | { properties?: GridShapeFields; geometry?: { type?: unknown; coordinates?: unknown } }
    | undefined;
  const square = first?.properties ? gridSquareOf(first.properties) : null;
  const geometry = first?.geometry;
  const shape =
    geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
      ? { type: geometry.type, coordinates: geometry.coordinates }
      : null;
  return c.json({ square: square && { ...square, legal: legalLand(square), shape } });
}

/** The tag of a square for this week: the same square within the week is "not modified". */
export function gridTag(level: GridLevel, tile: Tile, now = Date.now()): string {
  const week = Math.floor(now / GRID_WEEK_MS);
  return `"grid-1-${level}-${String(tile.z)}-${String(tile.x)}-${String(tile.y)}-${String(week)}"`;
}

/**
 * Answers one square, once the caller has checked the person is a member. Kept by the person's
 * browser for their sign-in only and reused after asking (no-cache), so every reuse passes the
 * membership check, as for the live layers (F-247-2-R1-01, R4-01).
 */
export async function gridSquareAnswer(c: ApiContext, level: GridLevel, tile: Tile) {
  const tag = gridTag(level, tile);
  c.header('Cache-Control', 'private, no-cache');
  c.header('Vary', 'Authorization', { append: true });
  c.header('ETag', tag);
  const asked = c.req.header('if-none-match') ?? '';
  if (asked.split(',').some((one) => one.trim().replace(/^W\//, '') === tag)) {
    return c.body(null, 304);
  }
  let body: ArrayBuffer;
  try {
    ({ body } = await fetchService(
      gridSquareUrl(level, tile),
      /^(application|text)\/(json|plain|geo\+json)$/,
      MAX_GRID_BYTES,
    ));
  } catch (error) {
    if (!(error instanceof LayerServiceError)) throw error;
    console.warn(`Township grid square not fetched: status=${String(error.status)}`);
    c.header('Cache-Control', 'no-store');
    return apiError(
      c,
      502,
      'GRID_SERVICE_FAILED',
      "The province's township grid service could not be reached or did not answer as expected.",
    );
  }
  // ArcGIS reports its errors with status 200 and an "error" object.
  const start = new TextDecoder().decode(body.slice(0, 64));
  if (!/^\s*\{\s*"(type|crs|features|properties)"/.test(start)) {
    console.warn('Township grid square not fetched: status=422');
    c.header('Cache-Control', 'no-store');
    return apiError(
      c,
      502,
      'GRID_SERVICE_FAILED',
      "The province's township grid service did not answer as expected.",
    );
  }
  c.header('Content-Type', 'application/json');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(body, 200);
}
