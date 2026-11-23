import { describe, expect, it } from 'vitest';

import { gridEdgeLabels, type GridTownship } from './gridEdges';

// The range and township numbers along the map's edges (F-271): made-up townships of about the
// grid's size, on a plain projection of 1,000 pixels a degree.

const TOWNSHIPS: GridTownship[] = [];
for (let r = 14; r <= 17; r += 1) {
  for (let t = 9; t <= 11; t += 1) {
    // Ranges count west from the 4th meridian (110° W); townships north from 49°.
    const east = -110 - (r - 1) * 0.14;
    const south = 49 + (t - 1) * 0.087;
    TOWNSHIPS.push([4, r, t, east - 0.14, south, east, south + 0.087]);
  }
}
const VIEW = { west: -112.4, south: 49.75, east: -111.82, north: 49.95 };
const project = (lon: number, lat: number) => ({
  x: (lon - VIEW.west) * 1000,
  y: (VIEW.north - lat) * 1000,
});
const SIZE = { width: 580, height: 200 };

describe('gridEdgeLabels', () => {
  it('puts each range across the top and each township down the right side', () => {
    const labels = gridEdgeLabels(TOWNSHIPS, VIEW, project, SIZE);
    const tops = labels.filter((l) => l.side === 'top').map((l) => l.text);
    const sides = labels.filter((l) => l.side === 'right').map((l) => l.text);
    expect(tops).toEqual(['R17 W4', 'R16 W4', 'R15 W4', 'R14 W4']);
    expect(sides).toEqual(['T11', 'T10']);
  });

  it('places a range at the middle of the part of its column in view', () => {
    const labels = gridEdgeLabels(TOWNSHIPS, VIEW, project, SIZE);
    const r16 = labels.find((l) => l.text === 'R16 W4');
    // Range 16 runs from -112.24 to -112.10: its middle, -112.17, is 230 pixels in.
    expect(r16?.at).toBeCloseTo(230, 0);
  });

  it('leaves out a label too close to the one before, or at the very edge', () => {
    const narrow = gridEdgeLabels(
      TOWNSHIPS,
      VIEW,
      (lon, lat) => {
        const p = project(lon, lat);
        return { x: p.x / 4, y: p.y };
      },
      { width: 145, height: 200 },
    );
    const tops = narrow.filter((l) => l.side === 'top');
    for (let i = 1; i < tops.length; i += 1) {
      expect((tops[i]?.at ?? 0) - (tops[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(58);
    }
    expect(tops.every((l) => l.at >= 24 && l.at <= 145 - 24)).toBe(true);
  });

  it('shows nothing for a view with no township', () => {
    expect(
      gridEdgeLabels(TOWNSHIPS, { west: -100, south: 40, east: -99, north: 41 }, project, SIZE),
    ).toEqual([]);
  });
});
