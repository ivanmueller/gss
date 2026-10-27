/** A map viewport in WGS84 degrees, in GeoJSON bbox order (west, south, east, north). */
export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// A plain decimal: no exponent, sign only for negatives, at most 15 decimals.
const DEGREES = /^-?\d{1,3}(?:\.\d{1,15})?$/;

/**
 * Parses `west,south,east,north`, the `bbox` query parameter of GET /api/v1/facilities.
 * Returns null unless all four are plain decimals within range, south < north and
 * west < east: a box has an area, and one crossing the antimeridian is sent as two boxes.
 */
export function parseBbox(text: string): Bbox | null {
  const parts = text.split(',');
  if (parts.length !== 4 || !parts.every((part) => DEGREES.test(part))) return null;
  const [west, south, east, north] = parts.map(Number) as [number, number, number, number];
  const longitude = (value: number) => value >= -180 && value <= 180;
  const latitude = (value: number) => value >= -90 && value <= 90;
  if (!longitude(west) || !longitude(east) || !latitude(south) || !latitude(north)) return null;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

const SCALE = 1e6;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A map view's edges as a box parseBbox accepts: rounded outward to six decimals and kept
 * within the world. A view that wraps past ±180° asks for every longitude. Returns null
 * when nothing of the view is left.
 */
export function bboxFromBounds(west: number, south: number, east: number, north: number) {
  const wraps = west < -180 || east > 180;
  const box: Bbox = {
    west: wraps ? -180 : clamp(Math.floor(west * SCALE) / SCALE, -180, 180),
    south: clamp(Math.floor(south * SCALE) / SCALE, -90, 90),
    east: wraps ? 180 : clamp(Math.ceil(east * SCALE) / SCALE, -180, 180),
    north: clamp(Math.ceil(north * SCALE) / SCALE, -90, 90),
  };
  return box.west < box.east && box.south < box.north ? box : null;
}

/** The `bbox` query parameter for a box: six decimals, no exponent. */
export function formatBbox(bbox: Bbox): string {
  return [bbox.west, bbox.south, bbox.east, bbox.north].map((value) => value.toFixed(6)).join(',');
}
