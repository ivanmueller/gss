import { readFileSync } from 'node:fs';

import { LAND_RIGHTS } from '@grain/domain';
import { describe, expect, it } from 'vitest';

import { PLAY_OUTLINES } from './play-outlines';

// F-264: the outline the database keeps the sale parcels by is the one the map draws.
describe('PLAY_OUTLINES', () => {
  it("holds each play's outline, ring for ring, as the map's own file has it", () => {
    for (const [play, rings] of Object.entries(PLAY_OUTLINES)) {
      // Only plays whose rights can be asked for.
      expect(Object.keys(LAND_RIGHTS)).toContain(play);
      const path = new URL(`../../web/public/outlines/${play}.geojson`, import.meta.url);
      const drawn = JSON.parse(readFileSync(path, 'utf8')) as {
        features: { geometry: { type: string; coordinates: number[][][][] } }[];
      };
      const expected = drawn.features.flatMap((feature) => {
        expect(feature.geometry.type).toBe('MultiPolygon');
        return feature.geometry.coordinates.flatMap((polygon) =>
          polygon.map((ring, n) => ({
            hole: n > 0,
            ring: `(${ring.map(([x, y]) => `(${String(x)},${String(y)})`).join(',')})`,
          })),
        );
      });
      expect(rings).toEqual(expected);
      // Each ring reads as a Postgres polygon: pairs of numbers and nothing else.
      for (const { ring } of rings) {
        expect(ring).toMatch(/^\((\(-?\d+(\.\d+)?,-?\d+(\.\d+)?\),?){4,}\)$/);
      }
    }
    expect(PLAY_OUTLINES.duvernay?.filter((r) => !r.hole)).toHaveLength(3);
  });
});
