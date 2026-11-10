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

/**
 * Pieces sharing the same properties (a railroad, and the railroads that share its track), joined
 * together into one feature of the view.
 */
export interface OverviewGroup {
  properties: Record<string, string | null>;
  lines: MercatorLine[];
}

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
    // Forward from its end, then backward from its start; a chain always has 2 points or more.
    // Points are only ever appended, and the pieces found backward are put in front once at the
    // end, so a long chain is joined in time proportional to its length (Codex's review of
    // 8e0fd95: adding each piece to the front of a growing chain took 21 s for 320,000 pieces).
    const chain: MercatorLine = start.slice();
    let end = chain[chain.length - 1] ?? [0, 0];
    for (let j = next(end); j >= 0; j = next(end)) {
      used[j] = 1;
      const line = lines[j] ?? [];
      const piece = line[0] && endKey(line[0]) === endKey(end) ? line : line.slice().reverse();
      for (let k = 1; k < piece.length; k += 1) chain.push(piece[k] ?? end);
      end = chain[chain.length - 1] ?? end;
    }
    const before: MercatorLine[] = [];
    let first = chain[0] ?? [0, 0];
    for (let j = next(first); j >= 0; j = next(first)) {
      used[j] = 1;
      const line = lines[j] ?? [];
      const last = line[line.length - 1];
      const piece = last && endKey(last) === endKey(first) ? line : line.slice().reverse();
      before.push(piece.slice(0, -1));
      first = piece[0] ?? first;
    }
    const whole: MercatorLine = [];
    for (let k = before.length - 1; k >= 0; k -= 1) {
      for (const point of before[k] ?? []) whole.push(point);
    }
    for (const point of chain) whole.push(point);
    joined.push(whole);
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
 * The zoomed-out view of a layer: one feature per group (its pieces joined, simplified and in
 * longitude and latitude) carrying the group's properties.
 */
export function buildOverview(
  groups: ReadonlyMap<string, OverviewGroup>,
  tolerance = OVERVIEW_TOLERANCE_METRES,
): LayerFeatureCollection {
  const features: LayerFeatureCollection['features'] = [];
  for (const { properties, lines } of groups.values()) {
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
      properties: { ...properties },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * The most a part of a view may weigh as JSON, as sent. Cloudflare's paid plan (2026-11-09) lets
 * the Worker check a larger part than the free plan's 96 KB; it stays well inside the 256 KB a part
 * may be kept at (F-146).
 */
export const OVERVIEW_PART_BYTES = 192 * 1024;
/** The most parts a view may have (the Worker and the database allow parts 0 to 63). */
export const MAX_OVERVIEW_PARTS = 64;
/**
 * The most a whole view may weigh as sent, 6 MiB: what 64 parts of 96 KB allowed before F-146,
 * so larger parts neither refuse a view taken before nor let a much larger one through.
 */
export const MAX_OVERVIEW_BYTES = 64 * 96 * 1024;

/** Whether a view's parts are too many or, together, too heavy to be sent and kept. */
export function overviewTooLarge(parts: readonly (readonly unknown[])[]): boolean {
  if (parts.length > MAX_OVERVIEW_PARTS) return true;
  let total = 0;
  for (const part of parts) {
    total += utf8Length(JSON.stringify({ features: part }));
    if (total > MAX_OVERVIEW_BYTES) return true;
  }
  return false;
}

type OverviewFeature = LayerFeatureCollection['features'][number];

/** The length of text in UTF-8, as it is sent (Codex's review of d35ac90: not in characters). */
export function utf8Length(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      length += 4;
      i += 1;
    } else length += 3;
  }
  return length;
}

const jsonBytes = (value: unknown) => utf8Length(JSON.stringify(value));

/** What a part's request adds around its features: {"features":[…]}. */
const PART_WRAPPER = jsonBytes({ features: [] });

/**
 * A line cut into pieces that each fit `room` bytes as JSON, consecutive pieces sharing their end
 * point so the line stays whole on the map.
 */
function cutLine(line: [number, number][], room: number): [number, number][][] {
  const pieces: [number, number][][] = [];
  let piece: [number, number][] = [];
  let size = 2;
  for (const point of line) {
    const pointBytes = jsonBytes(point) + 1;
    if (piece.length >= 2 && size + pointBytes > room) {
      pieces.push(piece);
      const last = piece[piece.length - 1] ?? point;
      piece = [last];
      size = 2 + jsonBytes(last) + 1;
    }
    piece.push(point);
    size += pointBytes;
  }
  if (piece.length >= 2) pieces.push(piece);
  return pieces;
}

/**
 * A view split into parts whose requests ({"features":[…]}) each weigh at most `maxBytes` in
 * UTF-8, in order: features are kept whole when they fit; a big feature's lines are shared out
 * over several parts under the same value; a line too long for a part is cut into pieces that
 * share their end points.
 */
export function splitOverview(
  collection: LayerFeatureCollection,
  maxBytes = OVERVIEW_PART_BYTES,
): OverviewFeature[][] {
  const parts: OverviewFeature[][] = [];
  let part: OverviewFeature[] = [];
  let size = PART_WRAPPER;
  const flush = () => {
    if (part.length > 0) parts.push(part);
    part = [];
    size = PART_WRAPPER;
  };
  /** Adds a feature of `bytes` (comma included), starting a new part when it would not fit. */
  const add = (feature: OverviewFeature, bytes: number) => {
    if (part.length > 0 && size + bytes > maxBytes) flush();
    part.push(feature);
    size += bytes;
  };
  for (const feature of collection.features) {
    const whole = jsonBytes(feature) + 1;
    if (PART_WRAPPER + whole <= maxBytes) {
      add(feature, whole);
      continue;
    }
    // Too big for one part: its lines, shared out under the same value.
    const shellOf = (coordinates: unknown[]): OverviewFeature => ({
      ...feature,
      geometry: { type: 'MultiLineString', coordinates },
    });
    const shell = jsonBytes(shellOf([])) + 1;
    const room = maxBytes - PART_WRAPPER - shell;
    const coordinates = feature.geometry.coordinates;
    const lines = (
      feature.geometry.type === 'MultiLineString'
        ? (coordinates as [number, number][][])
        : feature.geometry.type === 'LineString'
          ? [coordinates as [number, number][]]
          : []
    ).flatMap((line) => (jsonBytes(line) + 1 <= room ? [line] : cutLine(line, room)));
    let taken: [number, number][][] = [];
    let takenSize = shell;
    const take = () => {
      if (taken.length > 0) add(shellOf(taken), takenSize);
      taken = [];
      takenSize = shell;
    };
    for (const line of lines) {
      const lineBytes = jsonBytes(line) + 1;
      if (taken.length > 0 && takenSize + lineBytes > maxBytes - PART_WRAPPER) take();
      taken.push(line);
      takenSize += lineBytes;
    }
    take();
  }
  flush();
  return parts;
}
