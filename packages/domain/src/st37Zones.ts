/**
 * Zones where a formation's drilled wells cluster (F-255): wells within a set distance of one
 * another are grouped, small groups are dropped, and a rounded shape is drawn a little way
 * outside each group. Computed from the stored wells alone; nothing is estimated or published
 * by anyone else. Distances are in kilometres on a flat local grid, which is close enough over
 * one cluster.
 */

/** A drilled well: its surface hole and its bottom hole, each [longitude, latitude]. */
export interface ZoneWell {
  surface: readonly [number, number];
  bottom: readonly [number, number];
}

export interface ZoneOptions {
  /** Wells whose surface holes are at most this far apart belong to the same group. */
  linkKm: number;
  /** A group with fewer wells than this gets no zone. */
  minWells: number;
  /** How far outside the group's wells the zone's edge runs. */
  padKm: number;
}

/**
 * Tuned on the Duvernay's wells (2026-11-20): four zones (Fox Creek, Lacombe to Red Deer, Rocky
 * Mountain House and the one south-east of Red Deer) holding about four drilled wells in five.
 */
export const ST37_ZONE_OPTIONS: ZoneOptions = { linkKm: 5, minWells: 50, padKm: 3 };

export interface St37Zone {
  wells: number;
  /** A closed ring, [longitude, latitude], counter-clockwise. */
  ring: [number, number][];
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;
const rad = (deg: number) => (deg * Math.PI) / 180;

function distanceKm(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = (a[0] - b[0]) * KM_PER_DEG_LON * Math.cos(rad((a[1] + b[1]) / 2));
  const dy = (a[1] - b[1]) * KM_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Groups of wells, each well linked to another of its group within `linkKm`. */
function groups(wells: readonly ZoneWell[], linkKm: number): ZoneWell[][] {
  // A grid of squares at least linkKm wide anywhere in Alberta (to 60° north), so a well's
  // neighbours are always in its own square or the eight around it.
  const cellLat = linkKm / KM_PER_DEG_LAT;
  const cellLon = linkKm / (KM_PER_DEG_LON * Math.cos(rad(60.5)));
  const cellOf = (p: readonly [number, number]): [number, number] => [
    Math.floor(p[0] / cellLon),
    Math.floor(p[1] / cellLat),
  ];
  const grid = new Map<string, ZoneWell[]>();
  for (const well of wells) {
    const key = cellOf(well.surface).join(':');
    const list = grid.get(key);
    if (list) list.push(well);
    else grid.set(key, [well]);
  }
  const seen = new Set<ZoneWell>();
  const out: ZoneWell[][] = [];
  for (const start of wells) {
    if (seen.has(start)) continue;
    seen.add(start);
    const group = [start];
    // The group grows while it is walked: each well added is visited in its turn.
    for (const member of group) {
      const [cx, cy] = cellOf(member.surface);
      for (let x = cx - 1; x <= cx + 1; x += 1) {
        for (let y = cy - 1; y <= cy + 1; y += 1) {
          for (const other of grid.get(`${String(x)}:${String(y)}`) ?? []) {
            if (seen.has(other)) continue;
            if (distanceKm(member.surface, other.surface) <= linkKm) {
              seen.add(other);
              group.push(other);
            }
          }
        }
      }
    }
    out.push(group);
  }
  return out;
}

type Point = [number, number];

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** The convex hull of the points, counter-clockwise, without repeating the first. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique: Point[] = [];
  for (const p of sorted) {
    const before = unique.at(-1);
    if (before?.[0] !== p[0] || before[1] !== p[1]) unique.push(p);
  }
  if (unique.length <= 2) return unique;
  const half = (list: readonly Point[]) => {
    const hull: Point[] = [];
    for (const p of list) {
      for (;;) {
        const a = hull.at(-2);
        const b = hull.at(-1);
        if (!a || !b || cross(a, b, p) > 0) break;
        hull.pop();
      }
      hull.push(p);
    }
    hull.pop();
    return hull;
  };
  return [...half(unique), ...half([...unique].reverse())];
}

/** The hull pushed out by `pad` with round corners: a closed ring, counter-clockwise. */
export function paddedHull(hull: readonly Point[], pad: number): Point[] {
  const ring: Point[] = [];
  const step = Math.PI / 12;
  const arc = (centre: Point, from: number, to: number) => {
    let sweep = to - from;
    while (sweep <= 0) sweep += 2 * Math.PI;
    const parts = Math.max(1, Math.ceil(sweep / step));
    for (let i = 0; i <= parts; i += 1) {
      const angle = from + (sweep * i) / parts;
      ring.push([centre[0] + pad * Math.cos(angle), centre[1] + pad * Math.sin(angle)]);
    }
  };
  const [only] = hull;
  if (hull.length === 1 && only) {
    arc(only, 0, 2 * Math.PI);
  } else {
    // At each corner, an arc from the outward side of the edge arriving to that of the edge
    // leaving (outward is to the right of a counter-clockwise edge).
    const outward = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.PI / 2;
    hull.forEach((corner, i) => {
      const before = hull.at(i - 1);
      const after = hull.at((i + 1) % hull.length);
      if (before && after) arc(corner, outward(before, corner), outward(corner, after));
    });
  }
  const [first] = ring;
  if (first) ring.push(first);
  return ring;
}

/** The zones of these drilled wells, largest first. */
export function st37Zones(
  wells: readonly ZoneWell[],
  options: ZoneOptions = ST37_ZONE_OPTIONS,
): St37Zone[] {
  const zones: St37Zone[] = [];
  for (const group of groups(wells, options.linkKm)) {
    if (group.length < options.minWells) continue;
    const places = group.flatMap((w) => [w.surface, w.bottom]);
    // A flat grid in kilometres around the group's own middle.
    const lon0 = places.reduce((sum, p) => sum + p[0], 0) / places.length;
    const lat0 = places.reduce((sum, p) => sum + p[1], 0) / places.length;
    const kmLon = KM_PER_DEG_LON * Math.cos(rad(lat0));
    const flat = places.map((p): Point => [(p[0] - lon0) * kmLon, (p[1] - lat0) * KM_PER_DEG_LAT]);
    const ring = paddedHull(convexHull(flat), options.padKm).map((p): [number, number] => [
      Math.round((lon0 + p[0] / kmLon) * 1e5) / 1e5,
      Math.round((lat0 + p[1] / KM_PER_DEG_LAT) * 1e5) / 1e5,
    ]);
    // Rounding may move the last point off the first: close the ring exactly.
    const [first] = ring;
    if (first) ring[ring.length - 1] = first;
    zones.push({ wells: group.length, ring });
  }
  return zones.sort((a, b) => b.wells - a.wells);
}
