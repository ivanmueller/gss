import { describe, expect, it } from 'vitest';

import {
  layerField,
  layersAt,
  layerScene,
  pickLayer,
  wallIsBehind,
  type FormationAnswer,
} from './formationLayers';
import { lens, sceneZ, well3dScene, type Camera, type Well3dAnswer } from './well3d';

// The ground's layers in a well's 3D view (F-261 part 2): the geometry. Made-up layers only.

/**
 * A grid of 3 by 3 cells around (-113.6, 53.3) (cell -7100, 5922): the surface (zone 1), a thick
 * zone 8, the Duvernay (zone 68) that ends before the east column, and the Precambrian (90).
 * Everything dips 10 m a cell to the east.
 */
const layers = (): FormationAnswer => {
  const [columns, rows] = [3, 3];
  const zones = [1, 8, 68, 90].map((zone) => ({
    zone,
    tops: new Array<number | null>(columns * rows).fill(null),
    bases: new Array<number | null>(columns * rows).fill(null),
  }));
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const dip = -10 * i;
      const cell = j * columns + i;
      const duvernay = i < 2;
      const stack: [number, number, number][] = [
        [0, 900 + dip, 880 + dip],
        [1, 880 + dip, duvernay ? -2200 + dip : -2700 + dip],
        ...(duvernay ? ([[2, -2200 + dip, -2260 + dip]] as [number, number, number][]) : []),
        [3, duvernay ? -2260 + dip : -2700 + dip, -6000],
      ];
      // Where the Duvernay is, the Precambrian's top is still -2700: zone 8 does not reach it.
      for (const [k, top, base] of stack) {
        const zone = zones[k];
        if (!zone) continue;
        zone.tops[cell] = top;
        zone.bases[cell] = base;
      }
    }
  }
  return {
    source: { name: 'Survey', rocks: 'Table', model: 'v4', loadedAt: null, sourceDate: null },
    grid: { lonStep: 0.016, latStep: 0.009, x0: -7101, y0: 5921, columns, rows },
    cells: 9,
    zones,
  };
};

const well = (): Well3dAnswer => ({
  source: { name: 'AER', loadedAt: null },
  well: {
    uwi: '00/09-07-030-26W4/0',
    licenceNumber: '0509395',
    surface: [-113.6, 53.298],
    kbElevationM: 905,
    groundElevationM: 900,
  },
  nearbyKm: 3,
  truncated: false,
  legs: [
    {
      uwi: '00/09-07-030-26W4/0',
      licenceNumber: '0509395',
      licensee: null,
      statusClass: 'producing',
      surveyed: true,
      own: true,
      points: [
        [-113.6, 53.298, 905],
        [-113.6, 53.298, -2230],
        [-113.605, 53.298, -2230],
      ],
    },
  ],
});

describe('layerField', () => {
  const field = layerField(layers());
  if (!field) throw new Error('no field');

  it('reads the layers at a cell as they are', () => {
    // Cell (-7100, 5922), the middle one: one cell east of the grid's west column.
    expect(layersAt(field, -7100 * 0.016, 5922 * 0.009)).toEqual([
      { zone: 1, top: 890, base: 870 },
      { zone: 8, top: 870, base: -2210 },
      { zone: 68, top: -2210, base: -2270 },
      { zone: 90, top: -2270, base: -6000 },
    ]);
    expect(field.zones).toEqual([1, 8, 68, 90]);
  });

  it('reads between cells, and thins a zone out to nothing where it ends', () => {
    // Halfway between the middle column (Duvernay 60 m) and the east one (none).
    const between = layersAt(field, -7099.5 * 0.016, 5922 * 0.009);
    const duvernay = between.find((layer) => layer.zone === 68);
    expect(duvernay?.top).toBeCloseTo(-2465, 6);
    expect((duvernay?.top ?? 0) - (duvernay?.base ?? 0)).toBeCloseTo(30, 6);
    // The layers still stack with nothing between them.
    for (let k = 1; k < between.length; k += 1) {
      expect(between[k]?.top).toBeCloseTo(between[k - 1]?.base ?? 0, 6);
    }
    // In the east column the Duvernay is gone: three layers.
    expect(layersAt(field, -7099 * 0.016, 5922 * 0.009).map((layer) => layer.zone)).toEqual([
      1, 8, 90,
    ]);
  });

  it('has nothing where the grid keeps no cell, and takes the nearest at its edge', () => {
    expect(field.stackAt(-120, 60)).toBeNull();
    const edge = layersAt(field, -7101.4 * 0.016, 5921 * 0.009);
    expect(edge[0]).toEqual({ zone: 1, top: 900, base: 880 });
    expect(layerField({ ...layers(), zones: [] })).toBeNull();
  });
});

describe('the block cut open', () => {
  const field = layerField(layers());
  const answer = well();
  const plain = well3dScene(answer, true);
  if (!field || !plain) throw new Error('no scene');
  const scene = well3dScene(answer, true, { stretch: 2, floor: -2400 });
  if (!scene) throw new Error('no scene');

  it('holds the layers down to the floor asked for, depths stretched about the ground', () => {
    expect(scene.stretch).toBe(2);
    // -2400 m is 3,300 m under the ground: drawn 6,600 m under it.
    expect(scene.min[2]).toBeLessThanOrEqual(900 - 6600);
    expect(sceneZ(scene, -2400)).toBe(900 - 6600);
    expect(sceneZ(plain, -2400)).toBe(-2400);
  });

  it('reads the layers along each face and lays the play top as a sheet', () => {
    const cut = layerScene(scene, field, 68);
    expect(cut.walls).toHaveLength(4);
    expect(cut.walls.map((wall) => wall.normal)).toEqual([
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
    const south = cut.walls[0];
    expect(south?.samples[0]).toMatchObject({ x: scene.min[0], y: scene.min[1] });
    expect(south?.samples.at(-1)).toMatchObject({ x: scene.max[0], y: scene.min[1] });
    expect(south?.samples.every((sample) => sample.stack !== null)).toBe(true);
    // The sheet: the Duvernay's top, drawn at the scene's stretched height.
    expect(cut.sheet?.zone).toBe(68);
    const [first] = cut.sheet?.points ?? [];
    expect(first?.[2]).toBeLessThan(900 - 2 * 3000);
    expect(layerScene(scene, field, null).sheet).toBeNull();
    expect(layerScene(scene, field, 12).sheet).toBeNull();
  });

  it('shows the faces behind the wells and names the layer under the pointer', () => {
    const cut = layerScene(scene, field, 68);
    // From the south, level: the north face is the far one, the south face the near one.
    const camera: Camera = { target: scene.centre, yaw: 0, pitch: 0, distance: scene.radius * 6 };
    const size = { width: 800, height: 600 };
    const view = lens(camera, size);
    const [south, , north] = cut.walls;
    if (!south || !north) throw new Error('no walls');
    expect(wallIsBehind(north, view.eye)).toBe(true);
    expect(wallIsBehind(south, view.eye)).toBe(false);

    // A point of the north face in the thick of zone 8, and one in the Duvernay.
    const middle = north.samples[Math.floor(north.samples.length / 2)];
    if (!middle?.stack) throw new Error('no stack');
    const [top8, top68, top90] = [middle.stack.tops[1], middle.stack.tops[2], middle.stack.tops[3]];
    const at = (elevation: number) =>
      view.place(view.see([middle.x, middle.y, sceneZ(scene, elevation)]));
    const [x8, y8] = at(((top8 ?? 0) + (top68 ?? 0)) / 2);
    expect(pickLayer(scene, cut, view, x8, y8)).toMatchObject({ zone: 8 });
    const [x68, y68] = at(((top68 ?? 0) + (top90 ?? 0)) / 2);
    const hit = pickLayer(scene, cut, view, x68, y68);
    expect(hit?.zone).toBe(68);
    expect(hit?.top).toBeCloseTo(top68 ?? 0, 0);
    expect((hit?.top ?? 0) - (hit?.base ?? 0)).toBeGreaterThan(0);
    expect(hit?.surface).toBeCloseTo(middle.stack.tops[0] ?? 0, 0);
    // Above the ground and beside the block: no layer.
    expect(pickLayer(scene, cut, view, 400, 2)).toBeNull();
    expect(pickLayer(scene, cut, view, 2, 300)).toBeNull();
  });
});
