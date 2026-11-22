import { describe, expect, it } from 'vitest';

import {
  layerField,
  layersAt,
  layerScene,
  pickLayer,
  wallIsBehind,
  wallsShown,
  type FormationAnswer,
} from './formationLayers';
import { lens, sceneLonLat, sceneZ, well3dScene, type Camera, type Well3dAnswer } from './well3d';

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

describe('the block of ground', () => {
  const field = layerField(layers());
  const answer = well();
  const plain = well3dScene(answer, true);
  if (!field || !plain) throw new Error('no scene');
  // The floor low enough to hold the lower part when the block is opened (500 scene metres).
  const scene = well3dScene(answer, true, { stretch: 2, floor: -2700 });
  if (!scene) throw new Error('no scene');
  // From the south, level: the south face is the near one, the north face the far one.
  const camera: Camera = { target: scene.centre, yaw: 0, pitch: 0, distance: scene.radius * 6 };
  const view = lens(camera, { width: 800, height: 600 });

  it('holds the layers down to the floor asked for, depths stretched about the ground', () => {
    expect(scene.stretch).toBe(2);
    // -2700 m is 3,600 m under the ground: drawn 7,200 m under it.
    expect(scene.min[2]).toBeLessThanOrEqual(900 - 7200);
    expect(sceneZ(scene, -2400)).toBe(900 - 6600);
    expect(sceneZ(plain, -2400)).toBe(-2400);
  });

  it('whole: four faces with the layers along each, the ground on top, the legs as they are', () => {
    const block = layerScene(scene, field, { playZone: 68, open: false, drop: 500 });
    expect(block.cut).toBe(-1);
    expect(block.drop).toBe(0);
    expect(block.opened).toBeNull();
    expect(block.underside).toBeNull();
    expect(block.walls.map((wall) => wall.normal)).toEqual([
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
    const [south, , north] = block.walls;
    if (!south || !north) throw new Error('no walls');
    expect(south.samples[0]).toMatchObject({ x: scene.min[0], y: scene.min[1] });
    expect(south.samples.at(-1)).toMatchObject({ x: scene.max[0], y: scene.min[1] });
    expect(south.samples.every((sample) => sample.stack !== null)).toBe(true);
    // The faces turned toward the eye are shown: the south one, not the north one.
    expect(wallIsBehind(north, view.eye)).toBe(true);
    expect(wallsShown(block, view.eye)).toContain(south);
    expect(wallsShown(block, view.eye)).not.toContain(north);
    // The ground: the top of the first layer, where the scene draws it.
    const corner = block.terrain.points[0];
    expect(block.terrain.points).toHaveLength((block.terrain.side + 1) ** 2);
    expect(corner?.[0]).toBe(scene.min[0]);
    expect(corner?.[2]).toBeGreaterThan(sceneZ(scene, 850));
    // Every leg whole, at the scene's own heights, and all of it shows through the faces.
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]?.points).toHaveLength(3);
    block.lines[0]?.points.forEach((point, i) => {
      expect(point[2]).toBeCloseTo(scene.lines[0]?.points[i]?.[2] ?? 0, 6);
    });
    expect(block.upper).toHaveLength(1);
    expect(block.place(0, 0, -2400)).toBe(sceneZ(scene, -2400));
    expect(block.elevation(0, 0, sceneZ(scene, -2400))).toBeCloseTo(-2400, 6);
    // A play that is not under the block cannot be opened at.
    expect(layerScene(scene, field, { playZone: 12, open: true, drop: 500 }).cut).toBe(-1);
    expect(layerScene(scene, field, { playZone: null, open: true, drop: 500 }).cut).toBe(-1);
  });

  it('opened at the play: what lies under its top is drawn lower, the legs cut there', () => {
    const block = layerScene(scene, field, { playZone: 68, open: true, drop: 500 });
    // The Duvernay is the third of the field's zones.
    expect(block.cut).toBe(2);
    expect(block.drop).toBe(500);
    // Under the well the Duvernay's top is at -2210: above it as it is, under it 500 lower.
    const top = sceneZ(scene, -2210);
    expect(block.place(0, 0, -2000)).toBe(sceneZ(scene, -2000));
    expect(block.place(0, 0, -2210)).toBeCloseTo(top - 500, 6);
    expect(block.place(0, 0, -2300)).toBe(sceneZ(scene, -2300) - 500);
    expect(block.elevation(0, 0, top + 10)).toBeCloseTo(-2205, 6);
    expect(block.elevation(0, 0, top - 500 - 10)).toBeCloseTo(-2215, 6);
    // Between the two parts there is no ground.
    expect(block.elevation(0, 0, top - 250)).toBeNull();
    // The lower part's top and the upper part's underside: the same surface, 500 apart.
    const [low, high] = [block.opened?.points[0], block.underside?.points[0]];
    expect((high?.[2] ?? 0) - (low?.[2] ?? 0)).toBeCloseTo(500, 6);
    // The leg (down to -2230, then level): cut where it meets the Duvernay's top, with an
    // upright stretch across the opening.
    const points = block.lines[0]?.points ?? [];
    expect(points).toHaveLength(5);
    expect(points[0]?.[2]).toBeCloseTo(sceneZ(scene, 905), 6);
    expect(points[1]?.[2]).toBeCloseTo(top, 6);
    expect(points[2]?.[2]).toBeCloseTo(top - 500, 6);
    expect([points[1]?.[0], points[1]?.[1], points[2]?.[0], points[2]?.[1]]).toEqual([0, 0, 0, 0]);
    expect(points[3]?.[2]).toBeCloseTo(sceneZ(scene, -2230) - 500, 6);
    expect(points[4]?.[2]).toBeCloseTo(sceneZ(scene, -2230) - 500, 6);
    // Only the stretch above the opening shows through the upper part's faces.
    expect(block.upper).toHaveLength(1);
    expect(block.upper[0]?.points).toEqual([points[0], points[1]]);
  });

  it('names the layer under the pointer on a face, and none in the opening', () => {
    const [x, y] = [(scene.min[0] + scene.max[0]) / 2, scene.min[1]];
    for (const open of [false, true]) {
      const block = layerScene(scene, field, { playZone: 68, open, drop: 500 });
      const stack = field.stackAt(...sceneLonLat(scene, x, y));
      if (!stack) throw new Error('no stack');
      const [surface, top8, top68, top90] = [...stack.tops];
      const at = (elevation: number) => view.place(view.see([x, y, block.place(x, y, elevation)]));
      // In the thick of zone 8, and in the Duvernay (lower on the canvas when opened).
      expect(pickLayer(scene, block, view, ...at(((top8 ?? 0) + (top68 ?? 0)) / 2))).toMatchObject({
        zone: 8,
      });
      const hit = pickLayer(scene, block, view, ...at(((top68 ?? 0) + (top90 ?? 0)) / 2));
      expect(hit?.zone).toBe(68);
      expect(hit?.top).toBeCloseTo(top68 ?? 0, 0);
      expect(hit?.base).toBeCloseTo(top90 ?? 0, 0);
      expect(hit?.surface).toBeCloseTo(surface ?? 0, 0);
      // In the opening itself, and beside the block: no layer.
      if (open) {
        const [px, py] = view.place(view.see([x, y, sceneZ(scene, top68 ?? 0) - 250]));
        expect(pickLayer(scene, block, view, px, py)).toBeNull();
      }
      expect(pickLayer(scene, block, view, 2, 300)).toBeNull();
    }
  });
});
