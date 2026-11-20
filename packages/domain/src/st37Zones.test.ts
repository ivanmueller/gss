import { describe, expect, it } from 'vitest';

import { convexHull, paddedHull, st37Zones, type ZoneWell } from './st37Zones';

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

describe('convexHull', () => {
  it('keeps the corners, counter-clockwise, and drops what is inside or repeated', () => {
    expect(
      convexHull([
        [0, 0],
        [2, 0],
        [1, 1],
        [2, 2],
        [0, 2],
        [0, 0],
        [1, 0],
      ]),
    ).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
  });
});

describe('paddedHull', () => {
  it('draws a closed ring that stays the pad away from a square', () => {
    const ring = paddedHull(
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      1,
    );
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [x, y] of ring) {
      const dx = Math.max(0 - x, 0, x - 2);
      const dy = Math.max(0 - y, 0, y - 2);
      expect(Math.hypot(dx, dy)).toBeCloseTo(1, 9);
    }
    // Counter-clockwise: a positive area, a little under the 4 + 8 + π of the exact shape.
    let area = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [a, b] = [ring[i], ring[i + 1]] as [[number, number], [number, number]];
      area += a[0] * b[1] - b[0] * a[1];
    }
    expect(area / 2).toBeGreaterThan(15);
    expect(area / 2).toBeLessThan(12 + Math.PI);
  });

  it('draws a circle around one point and a capsule around two', () => {
    expect(paddedHull([[5, 5]], 2).every((p) => Math.hypot(p[0] - 5, p[1] - 5) < 2.0001)).toBe(
      true,
    );
    const capsule = paddedHull(
      [
        [0, 0],
        [4, 0],
      ],
      1,
    );
    expect(Math.max(...capsule.map((p) => p[0]))).toBeCloseTo(5, 9);
    expect(Math.min(...capsule.map((p) => p[0]))).toBeCloseTo(-1, 9);
    expect(Math.max(...capsule.map((p) => Math.abs(p[1])))).toBeCloseTo(1, 9);
  });
});

describe('st37Zones', () => {
  const options = { linkKm: 5, minWells: 25, padKm: 3 };

  it('gives each cluster of enough wells one zone that holds all its wells, largest first', () => {
    const north = block(-117, 54.4, 6);
    const south = block(-113.8, 52.2, 5);
    const zones = st37Zones([...south, ...north], options);
    expect(zones.map((z) => z.wells)).toEqual([36, 25]);
    const [zone] = zones;
    if (!zone) throw new Error('no zone');
    expect(zone.ring[0]).toEqual(zone.ring[zone.ring.length - 1]);
    const lons = zone.ring.map((p) => p[0]);
    const lats = zone.ring.map((p) => p[1]);
    for (const well of north) {
      for (const [lon, lat] of [well.surface, well.bottom]) {
        expect(lon).toBeGreaterThan(Math.min(...lons));
        expect(lon).toBeLessThan(Math.max(...lons));
        expect(lat).toBeGreaterThan(Math.min(...lats));
        expect(lat).toBeLessThan(Math.max(...lats));
      }
    }
    // About 3 km (0.027° of latitude) outside the northernmost bottom hole.
    const top = Math.max(...north.map((w) => w.bottom[1]));
    expect(Math.max(...lats) - top).toBeCloseTo(3 / 110.574, 3);
  });

  it('gives no zone to stray wells or to a cluster below the minimum', () => {
    const few = block(-115, 53, 4);
    const stray: ZoneWell = { surface: [-112, 51], bottom: [-112, 51] };
    expect(st37Zones([...few, stray], options)).toEqual([]);
  });

  it('joins wells that reach one another through wells in between, and not across a gap', () => {
    const chain = Array.from({ length: 30 }, (_, i): ZoneWell => {
      // About 4 km apart along a line of latitude at 54° north.
      const surface: [number, number] = [-116 + i * 0.061, 54];
      return { surface, bottom: surface };
    });
    expect(st37Zones(chain, options).map((z) => z.wells)).toEqual([30]);
    const apart = chain.map((w, i): ZoneWell =>
      i < 15 ? w : { surface: [w.surface[0] + 0.2, 54], bottom: w.bottom },
    );
    expect(st37Zones(apart, { ...options, minWells: 10 }).map((z) => z.wells)).toEqual([15, 15]);
  });
});
