/**
 * Zones where a formation's drilled wells cluster (F-255): a smooth outline around the ground
 * where wells are dense. Each well is spread over its surroundings as a soft bump (three along
 * its path, from the surface hole to the bottom hole); where the bumps of many wells add up past
 * a level, the ground is in a zone, and the zone's edge is the line where the sum equals that
 * level. Stray wells and small groups make no zone. Computed from the stored wells alone;
 * nothing is estimated or published by anyone else. Distances are in kilometres on a flat grid
 * around the wells' middle, close enough over one formation.
 */

/** A drilled well: its surface hole and its bottom hole, each [longitude, latitude]. */
export interface ZoneWell {
  surface: readonly [number, number];
  bottom: readonly [number, number];
}

export interface ZoneOptions {
  /** How far a well's bump spreads (the kernel's standard deviation). */
  spreadKm: number;
  /** The sum of bumps at a zone's edge, in wells: higher draws tighter zones. */
  level: number;
  /** A zone holding fewer wells than this is dropped. */
  minWells: number;
  /** The size of the grid's squares; the outline is drawn between their corners. */
  cellKm: number;
}

/** Tuned on the Duvernay's wells (2026-11-20, the owner: smooth, following the producing wells). */
export const ST37_ZONE_OPTIONS: ZoneOptions = { spreadKm: 4, level: 1.5, minWells: 50, cellKm: 1 };

export interface St37Zone {
  wells: number;
  /** A closed ring, [longitude, latitude]. */
  ring: [number, number][];
}

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;
/** A grid no larger than this many squares: beyond it the squares are made larger. */
const MAX_CELLS = 600_000;

type Point = [number, number];

/** Whether the point is inside the closed ring (even-odd rule). */
export function insideRing(p: readonly [number, number], ring: readonly Point[]): boolean {
  let inside = false;
  let a = ring.at(-1);
  for (const b of ring) {
    if (a && a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (x > p[0]) inside = !inside;
    }
    a = b;
  }
  return inside;
}

/**
 * The closed lines where a grid of values crosses `level` (marching squares, each crossing
 * placed between two corners in proportion to their values). `values` holds `nx` by `ny`
 * corners, row by row; the grid's edge must be below the level, so every line closes. Points
 * are in grid units.
 */
export function contourRings(
  values: Float64Array,
  nx: number,
  ny: number,
  level: number,
): Point[][] {
  const at = (i: number, j: number) => values[j * nx + i] ?? 0;
  // Each crossing lies on one edge of the grid: 2 * corner for the edge to the right of a
  // corner, 2 * corner + 1 for the edge above it.
  const right = (i: number, j: number) => 2 * (j * nx + i);
  const above = (i: number, j: number) => 2 * (j * nx + i) + 1;
  const place = new Map<number, Point>();
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const list = links.get(from);
      if (list) list.push(to);
      else links.set(from, [to]);
    }
  };
  const cross = (v0: number, v1: number) => (level - v0) / (v1 - v0);
  for (let j = 0; j < ny - 1; j += 1) {
    for (let i = 0; i < nx - 1; i += 1) {
      const v0 = at(i, j);
      const v1 = at(i + 1, j);
      const v2 = at(i + 1, j + 1);
      const v3 = at(i, j + 1);
      const [in0, in1, in2, in3] = [v0 >= level, v1 >= level, v2 >= level, v3 >= level];
      const kind = (in0 ? 1 : 0) + (in1 ? 2 : 0) + (in2 ? 4 : 0) + (in3 ? 8 : 0);
      if (kind === 0 || kind === 15) continue;
      // The square's four edges: bottom, right, top, left.
      const b = right(i, j);
      const r = above(i + 1, j);
      const t = right(i, j + 1);
      const l = above(i, j);
      if (in0 !== in1) place.set(b, [i + cross(v0, v1), j]);
      if (in1 !== in2) place.set(r, [i + 1, j + cross(v1, v2)]);
      if (in3 !== in2) place.set(t, [i + cross(v3, v2), j + 1]);
      if (in0 !== in3) place.set(l, [i, j + cross(v0, v3)]);
      if (kind === 5 || kind === 10) {
        // Two opposite corners in: joined through the middle when the middle is in.
        const middleIn = (v0 + v1 + v2 + v3) / 4 >= level;
        if ((kind === 5) === middleIn) {
          link(b, r);
          link(t, l);
        } else {
          link(b, l);
          link(t, r);
        }
      } else if (kind === 1 || kind === 14) link(b, l);
      else if (kind === 2 || kind === 13) link(b, r);
      else if (kind === 4 || kind === 11) link(r, t);
      else if (kind === 8 || kind === 7) link(t, l);
      else if (kind === 3 || kind === 12) link(l, r);
      else link(b, t);
    }
  }
  const rings: Point[][] = [];
  const used = new Set<number>();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const ring: Point[] = [];
    let here = start;
    for (;;) {
      used.add(here);
      const p = place.get(here);
      if (p) ring.push(p);
      const next = (links.get(here) ?? []).find((n) => !used.has(n));
      if (next === undefined) break;
      here = next;
    }
    const [first] = ring;
    if (first && ring.length >= 3) {
      ring.push(first);
      rings.push(ring);
    }
  }
  return rings;
}

/** The zones of these drilled wells, largest first. */
export function st37Zones(
  wells: readonly ZoneWell[],
  options: ZoneOptions = ST37_ZONE_OPTIONS,
): St37Zone[] {
  if (wells.length === 0) return [];
  const all = wells.flatMap((w) => [w.surface, w.bottom]);
  const lon0 = all.reduce((sum, p) => sum + p[0], 0) / all.length;
  const lat0 = all.reduce((sum, p) => sum + p[1], 0) / all.length;
  const kmLon = KM_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180);
  const flat = (p: readonly [number, number]): Point => [
    (p[0] - lon0) * kmLon,
    (p[1] - lat0) * KM_PER_DEG_LAT,
  ];
  // Each well as three places along its path, a third of a well each.
  const places = wells.map((w) => {
    const s = flat(w.surface);
    const b = flat(w.bottom);
    const middle: Point = [(s[0] + b[0]) / 2, (s[1] + b[1]) / 2];
    return { middle, points: [s, middle, b] };
  });
  const reach = 3 * options.spreadKm;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { points } of places) {
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  // Room around the wells, so the grid's edge is clear of every bump and each line closes.
  const margin = reach + 2 * options.cellKm;
  minX -= margin;
  minY -= margin;
  const width = maxX + margin - minX;
  const height = maxY + margin - minY;
  const cell = Math.max(options.cellKm, Math.sqrt((width * height) / MAX_CELLS));
  const nx = Math.ceil(width / cell) + 1;
  const ny = Math.ceil(height / cell) + 1;
  const values = new Float64Array(nx * ny);
  const span = Math.ceil(reach / cell);
  const fade = 2 * options.spreadKm * options.spreadKm;
  for (const { points } of places) {
    for (const [x, y] of points) {
      const ci = Math.round((x - minX) / cell);
      const cj = Math.round((y - minY) / cell);
      for (let j = Math.max(0, cj - span); j <= Math.min(ny - 1, cj + span); j += 1) {
        for (let i = Math.max(0, ci - span); i <= Math.min(nx - 1, ci + span); i += 1) {
          const d2 = (minX + i * cell - x) ** 2 + (minY + j * cell - y) ** 2;
          if (d2 <= reach * reach) {
            const k = j * nx + i;
            values[k] = (values[k] ?? 0) + Math.exp(-d2 / fade) / 3;
          }
        }
      }
    }
  }
  const rings = contourRings(values, nx, ny, options.level).map((ring) =>
    ring.map((p): Point => [minX + p[0] * cell, minY + p[1] * cell]),
  );
  const zones: St37Zone[] = [];
  for (const ring of rings) {
    // A line inside another is a gap in that zone: zones are drawn whole, without gaps.
    const [first] = ring;
    if (!first || rings.some((other) => other !== ring && insideRing(first, other))) continue;
    const held = places.filter((p) => insideRing(p.middle, ring)).length;
    if (held < options.minWells) continue;
    const out = ring.map((p): [number, number] => [
      Math.round((lon0 + p[0] / kmLon) * 1e5) / 1e5,
      Math.round((lat0 + p[1] / KM_PER_DEG_LAT) * 1e5) / 1e5,
    ]);
    const [start] = out;
    if (start) out[out.length - 1] = start;
    zones.push({ wells: held, ring: out });
  }
  return zones.sort((a, b) => b.wells - a.wells);
}
