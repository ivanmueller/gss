import type { LayerFeatureCollection } from './mapLayers';

// A live map layer's zoomed-out view (the owner's request of 2026-11-07, F-134). Zoomed out, a
// map square holds only part of a big layer (North American Rail Network Lines has 302,774 rail
// pieces; a square takes at most 4,000), so the map showed scattered pieces. Instead, an
// admin's browser reads the whole layer once (in web Mercator metres, simplified by the service
// to about a kilometre), and this joins each value's pieces end to end into lines, simplifies
// them again and keeps three decimals of a degree (about 100 m): the whole network in a few MB.

/** Below this map zoom the zoomed-out view is drawn; from it, live squares. */
export const OVERVIEW_BELOW_ZOOM = 7;
/** How many pieces the Worker asks the service for at once. */
export const OVERVIEW_PAGE_SIZE = 8000;
/** The most pieces read for a view; a bigger layer is drawn by squares only. */
export const MAX_OVERVIEW_SOURCE = 1_000_000;
/** How much the service simplifies the pieces, and this simplifies the lines, in metres. */
export const OVERVIEW_TOLERANCE_METRES = 1000;

/** A line in web Mercator metres. */
export type MercatorLine = [number, number][];

const EARTH = 6378137;

function toLonLat([x, y]: [number, number]): [number, number] {
  const lon = (x / EARTH) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH)) - Math.PI / 2) * (180 / Math.PI);
  return [Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000];
}

/** Where a line starts or ends, to the metre. */
function endKey([x, y]: [number, number]): string {
  return `${String(Math.round(x))},${String(Math.round(y))}`;
}

/**
 * Joins lines that meet end to end into longer lines, greedily: each line is extended at both
 * ends by any line not used yet that starts or ends where it does.
 */
export function joinLines(lines: readonly MercatorLine[]): MercatorLine[] {
  const ends = new Map<string, number[]>();
  lines.forEach((line, i) => {
    const first = line[0];
    const last = line[line.length - 1];
    if (!first || !last) return;
    for (const key of new Set([endKey(first), endKey(last)])) {
      const at = ends.get(key);
      if (at) at.push(i);
      else ends.set(key, [i]);
    }
  });
  const used = new Uint8Array(lines.length);
  const next = (point: [number, number]): number => {
    for (const j of ends.get(endKey(point)) ?? []) if (!used[j]) return j;
    return -1;
  };
  const joined: MercatorLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = lines[i];
    if (used[i] || !start || start.length < 2) continue;
    used[i] = 1;
    const chain: MercatorLine = start.slice();
    // Forward from its end, then backward from its start; a chain always has 2 points or more.
    let end = chain[chain.length - 1] ?? [0, 0];
    for (let j = next(end); j >= 0; j = next(end)) {
      used[j] = 1;
      const line = lines[j] ?? [];
      const piece = line[0] && endKey(line[0]) === endKey(end) ? line : line.slice().reverse();
      chain.push(...piece.slice(1));
      end = chain[chain.length - 1] ?? end;
    }
    let first = chain[0] ?? [0, 0];
    for (let j = next(first); j >= 0; j = next(first)) {
      used[j] = 1;
      const line = lines[j] ?? [];
      const last = line[line.length - 1];
      const piece = last && endKey(last) === endKey(first) ? line : line.slice().reverse();
      chain.unshift(...piece.slice(0, -1));
      first = chain[0] ?? first;
    }
    joined.push(chain);
  }
  return joined;
}

/** A line with points closer than `tolerance` to the simplified line dropped (Douglas–Peucker). */
export function simplifyLine(points: MercatorLine, tolerance: number): MercatorLine {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  for (let range = stack.pop(); range; range = stack.pop()) {
    const [a, b] = range;
    const [x1, y1] = points[a] ?? [0, 0];
    const [x2, y2] = points[b] ?? [0, 0];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = dx * dx + dy * dy;
    let farthest = -1;
    let distance = 0;
    for (let i = a + 1; i < b; i += 1) {
      const [x, y] = points[i] ?? [x1, y1];
      const u =
        length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length));
      const d = Math.hypot(x - (x1 + u * dx), y - (y1 + u * dy));
      if (d > distance) {
        distance = d;
        farthest = i;
      }
    }
    if (distance > tolerance && farthest > 0) {
      keep[farthest] = 1;
      stack.push([a, farthest], [farthest, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * The zoomed-out view of a layer: one feature per value of `field` (all in one when null), its
 * pieces joined, simplified and in longitude and latitude, with the value under `field`.
 */
export function buildOverview(
  groups: ReadonlyMap<string | null, readonly MercatorLine[]>,
  field: string | null,
  tolerance = OVERVIEW_TOLERANCE_METRES,
): LayerFeatureCollection {
  const features: LayerFeatureCollection['features'] = [];
  for (const [value, lines] of groups) {
    const coordinates: [number, number][][] = [];
    for (const line of joinLines(lines)) {
      const points: [number, number][] = [];
      for (const point of simplifyLine(line, tolerance)) {
        const lonLat = toLonLat(point);
        const last = points[points.length - 1];
        if (last?.[0] !== lonLat[0] || last[1] !== lonLat[1]) points.push(lonLat);
      }
      if (points.length >= 2) coordinates.push(points);
    }
    if (coordinates.length === 0) continue;
    features.push({
      type: 'Feature',
      id: features.length + 1,
      geometry: { type: 'MultiLineString', coordinates },
      properties: field === null ? {} : { [field]: value },
    });
  }
  return { type: 'FeatureCollection', features };
}
