import { describe, expect, it } from 'vitest';

import {
  GEOLOGY_GRID_ABSENT,
  decodeGeologyGrid,
  encodeGeologyGrid,
  fromMercator,
  geologyAt,
  geologyGridCorners,
  geologyRange,
  geologyValues,
  toMercator,
  type GeologyGrid,
} from './geologyGrid';

const A = GEOLOGY_GRID_ABSENT;

/** Two columns, two rows of 1,770 m, the north-west corner at 116° W, 54° N. */
function sample(): GeologyGrid {
  const [west, north] = toMercator(-116, 54);
  return {
    columns: 2,
    rows: 2,
    west,
    north,
    cell: 1770,
    depth: Int16Array.from([3093, 3100, A, 3200]),
    thickness: Int16Array.from([573, 600, A, A]),
  };
}

describe('the geology grid file', () => {
  it('reads back what it wrote', () => {
    const grid = sample();
    const back = decodeGeologyGrid(encodeGeologyGrid(grid));
    expect(back).toEqual(grid);
  });

  it('refuses a file that is not a grid or is cut short', () => {
    const bytes = encodeGeologyGrid(sample());
    expect(() => decodeGeologyGrid(bytes.subarray(0, bytes.length - 2))).toThrow(/cut short/);
    const wrong = bytes.slice();
    wrong[0] = 0x58;
    expect(() => decodeGeologyGrid(wrong)).toThrow(/Not a geology grid/);
  });

  it('refuses a grid whose values do not fill it', () => {
    expect(() => encodeGeologyGrid({ ...sample(), thickness: Int16Array.from([1, 2, 3]) })).toThrow(
      /one depth and one thickness/,
    );
  });
});

describe('geologyAt', () => {
  it('reads the square under a place', () => {
    const grid = sample();
    const [lon, lat] = fromMercator(grid.west + 100, grid.north - 100);
    expect(geologyAt(grid, lon, lat)).toEqual({ depthM: 3093, thicknessM: 57.3 });
    const [lon2, lat2] = fromMercator(grid.west + 1770 + 5, grid.north - 1770 - 5);
    expect(geologyAt(grid, lon2, lat2)).toEqual({ depthM: 3200, thicknessM: null });
  });

  it('answers nothing outside the grid or where the zone is absent', () => {
    const grid = sample();
    const [lon, lat] = fromMercator(grid.west + 5, grid.north - 1770 - 5);
    expect(geologyAt(grid, lon, lat)).toBeNull();
    expect(geologyAt(grid, -117, 54)).toBeNull();
    expect(geologyAt(grid, -116, 55)).toBeNull();
    expect(geologyAt(grid, Number.NaN, 54)).toBeNull();
  });
});

describe('mercator', () => {
  it('turns a place there and back', () => {
    expect(toMercator(180, 0)[0]).toBeCloseTo(20037508.34, 1);
    const [x, y] = toMercator(-114.0719, 51.0447);
    const [lon, lat] = fromMercator(x, y);
    expect(lon).toBeCloseTo(-114.0719, 6);
    expect(lat).toBeCloseTo(51.0447, 6);
  });

  it('gives the corners north-west first', () => {
    const corners = geologyGridCorners(sample());
    expect(corners[0]?.[0]).toBeCloseTo(-116, 6);
    expect(corners[0]?.[1]).toBeCloseTo(54, 6);
    expect(corners[2]?.[0]).toBeGreaterThan(-116);
    expect(corners[2]?.[1]).toBeLessThan(54);
  });
});

describe('values and range', () => {
  it('gives metres, absent as NaN, and a range in whole steps', () => {
    const grid = sample();
    const thickness = geologyValues(grid, 'thickness');
    expect(thickness[0]).toBeCloseTo(57.3, 5);
    expect(Number.isNaN(thickness[2])).toBe(true);
    expect(geologyRange(geologyValues(grid, 'depth'), 250)).toEqual([3000, 3250]);
    expect(geologyRange(thickness, 25)).toEqual([50, 75]);
    expect(geologyRange(Float32Array.from([Number.NaN]), 25)).toBeNull();
    expect(geologyRange(Float32Array.from([100]), 25)).toEqual([100, 125]);
  });
});
