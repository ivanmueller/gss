import { describe, expect, it } from 'vitest';

import { contourRings, insideRing, softenRings, st37Zones, type ZoneWell } from './st37Zones';

/** Synthetic wells: a grid of n by n surface holes about 1 km apart, from a corner. */
function block(lon: number, lat: number, n: number): ZoneWell[] {
  const wells: ZoneWell[] = [];
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      const surface: [number, number] = [lon + x * 0.015, lat + y * 0.009];
      wells.push({ surface, bottom: [surface[0] + 0.01, surface[1] + 0.01] });
    }
  }
  return wells;
}

describe('insideRing', () => {
  const square: [number, number][] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ];

  it('tells a point inside a closed ring from one outside', () => {
    expect(insideRing([1, 1], square)).toBe(true);
    expect(insideRing([3, 1], square)).toBe(false);
    expect(insideRing([1, -0.5], square)).toBe(false);
  });
});

describe('contourRings', () => {
  it('draws one closed line around a bump, placed between corners by their values', () => {
    // 5 by 5 corners, a single corner of 4 in the middle: the level 1 line crosses three
    // quarters of the way from the middle to each neighbour.
    const values = new Float64Array(25);
    values[12] = 4;
    const rings = contourRings(values, 5, 5, 1);
    expect(rings).toHaveLength(1);
    const [ring] = rings;
    if (!ring) throw new Error('no ring');
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(5);
    for (const [x, y] of ring) {
      expect(Math.abs(x - 2) + Math.abs(y - 2)).toBeCloseTo(0.75, 9);
    }
  });

  it('draws two lines around two bumps and none on flat ground', () => {
    const values = new Float64Array(7 * 5);
    values[1 * 7 + 1] = 3;
    values[3 * 7 + 5] = 3;
    expect(contourRings(values, 7, 5, 1)).toHaveLength(2);
    expect(contourRings(new Float64Array(25), 5, 5, 1)).toEqual([]);
  });

  it('keeps two bumps that touch at a corner apart when the ground between is low', () => {
    const values = new Float64Array(16);
    values[1 * 4 + 1] = 3;
    values[2 * 4 + 2] = 3;
    const rings = contourRings(values, 4, 4, 2);
    expect(rings).toHaveLength(2);
    expect(rings.every((ring) => ring[0] === ring[ring.length - 1])).toBe(true);
  });
});

describe('softenRings', () => {
  // A square of 40 km with a bay cut into its east side, `width` km wide and 20 km deep.
  const withBay = (width: number): [number, number][] => [
    [0, 0],
    [40, 0],
    [40, 20 - width / 2],
    [20, 20 - width / 2],
    [20, 20 + width / 2],
    [40, 20 + width / 2],
    [40, 40],
    [0, 40],
    [0, 0],
  ];
  const inBay: [number, number] = [30, 20];

  it('fills a narrow bay, rounds the corners and keeps the outer reach', () => {
    expect(insideRing(inBay, withBay(8))).toBe(false);
    const [soft, ...rest] = softenRings([withBay(8)], 1, 9, 2);
    if (!soft) throw new Error('no ring');
    expect(rest).toEqual([]);
    expect(soft[0]).toEqual(soft[soft.length - 1]);
    expect(insideRing(inBay, soft)).toBe(true);
    // The middle of each side stays where it was, to within a square; the corners are rounded.
    const xs = soft.map((p) => p[0]);
    const ys = soft.map((p) => p[1]);
    expect(Math.abs(Math.min(...xs) - 0)).toBeLessThan(2);
    expect(Math.abs(Math.max(...xs) - 40)).toBeLessThan(2);
    expect(Math.abs(Math.min(...ys) - 0)).toBeLessThan(2);
    expect(Math.abs(Math.max(...ys) - 40)).toBeLessThan(2);
    expect(insideRing([-1.2, -1.2], soft)).toBe(false);
    expect(insideRing([3, 3], soft)).toBe(true);
  });

  it('keeps a strip only a few kilometres wide', () => {
    const strip: [number, number][] = [
      [0, 0],
      [50, 0],
      [50, 2.5],
      [0, 2.5],
      [0, 0],
    ];
    const [soft, ...rest] = softenRings([strip], 1, 9, 2);
    expect(rest).toEqual([]);
    expect(soft && insideRing([25, 1.2], soft)).toBe(true);
  });

  it('leaves a wide bay open', () => {
    const [soft] = softenRings([withBay(30)], 1, 9, 2);
    if (!soft) throw new Error('no ring');
    expect(insideRing(inBay, soft)).toBe(false);
  });

  it('joins two areas a short way apart into one, and gives nothing for no rings', () => {
    const square = (x: number): [number, number][] => [
      [x, 0],
      [x + 20, 0],
      [x + 20, 20],
      [x, 20],
      [x, 0],
    ];
    expect(softenRings([square(0), square(26)], 1, 9, 2)).toHaveLength(1);
    expect(softenRings([square(0), square(60)], 1, 9, 2)).toHaveLength(2);
    expect(softenRings([], 1, 9, 2)).toEqual([]);
  });
});

describe('st37Zones', () => {
  const options = {
    spreadKm: 4,
    level: 1.5,
    minWells: 25,
    share: 1,
    closeKm: 0,
    roundKm: 0,
    cellKm: 1,
  };

  it('draws one smooth zone around each cluster of enough wells, largest first', () => {
    const north = block(-117, 54.4, 6);
    const south = block(-113.8, 52.2, 5);
    const zones = st37Zones([...south, ...north], options);
    expect(zones.map((z) => z.wells)).toEqual([36, 25]);
    const [zone] = zones;
    if (!zone) throw new Error('no zone');
    expect(zone.ring[0]).toEqual(zone.ring[zone.ring.length - 1]);
    // Every well of the cluster lies inside, both ends, and none of the other cluster.
    for (const well of north) {
      expect(insideRing(well.surface, zone.ring)).toBe(true);
      expect(insideRing(well.bottom, zone.ring)).toBe(true);
    }
    expect(south.some((well) => insideRing(well.surface, zone.ring))).toBe(false);
    // Smooth: many short steps, no step longer than about 1.5 km, and the edge a few
    // kilometres outside the wells, not far away.
    expect(zone.ring.length).toBeGreaterThan(40);
    const lats = zone.ring.map((p) => p[1]);
    for (let i = 1; i < zone.ring.length; i += 1) {
      const [a, b] = [zone.ring[i - 1], zone.ring[i]];
      if (!a || !b) throw new Error('no point');
      expect(Math.hypot((a[0] - b[0]) * 65, (a[1] - b[1]) * 110.6)).toBeLessThan(1.6);
    }
    const top = Math.max(...north.map((w) => w.bottom[1]));
    const marginKm = (Math.max(...lats) - top) * 110.574;
    expect(marginKm).toBeGreaterThan(2);
    expect(marginKm).toBeLessThan(12);
  });

  it('gives no zone to stray wells or to a cluster below the minimum', () => {
    const few = block(-115, 53, 4);
    const stray: ZoneWell = { surface: [-112, 51], bottom: [-112, 51] };
    expect(st37Zones([...few, stray], options)).toEqual([]);
    expect(st37Zones([], options)).toEqual([]);
  });

  it("draws the smallest area holding a share of a cluster's wells, leaving its fringe out", () => {
    // A tight block of 64 wells with 16 more strung out to the east, 2 km apart: one cluster.
    const core = block(-117, 54.4, 8);
    const fringe = Array.from({ length: 16 }, (_, i): ZoneWell => {
      const surface: [number, number] = [-116.88 + i * 0.031, 54.43];
      return { surface, bottom: [surface[0], surface[1] + 0.01] };
    });
    const wells = [...core, ...fringe];
    const [whole, ...others] = st37Zones(wells, options);
    expect(others).toEqual([]);
    expect(whole?.wells).toBe(80);
    const [zone, ...rest] = st37Zones(wells, { ...options, share: 0.8 });
    if (!zone || !whole) throw new Error('no zone');
    expect(rest).toEqual([]);
    // The share asked for (the well the edge runs through may fall either side), and not the
    // far end of the fringe.
    expect(zone.wells).toBeGreaterThanOrEqual(62);
    expect(zone.wells).toBeLessThan(80);
    const last = fringe.at(-1);
    expect(last && insideRing(last.surface, zone.ring)).toBe(false);
    expect(last && insideRing(last.surface, whole.ring)).toBe(true);
    // Nearly all of the tight block is in (a corner well may sit on the edge).
    expect(core.filter((well) => insideRing(well.surface, zone.ring)).length).toBeGreaterThan(58);
    const east = (ring: [number, number][]) => Math.max(...ring.map((p) => p[0]));
    expect(east(zone.ring)).toBeLessThan(east(whole.ring));
  });

  it('leaves a stray well near a cluster outside its zone', () => {
    const cluster = block(-117, 54.4, 6);
    // About 20 km east of the cluster's edge.
    const stray: ZoneWell = { surface: [-116.6, 54.42], bottom: [-116.6, 54.43] };
    const [zone] = st37Zones([...cluster, stray], options);
    if (!zone) throw new Error('no zone');
    expect(zone.wells).toBe(36);
    expect(insideRing(stray.surface, zone.ring)).toBe(false);
  });
});
