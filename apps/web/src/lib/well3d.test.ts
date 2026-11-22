import { describe, expect, it } from 'vitest';

import {
  between,
  clipSegment,
  fitCamera,
  lens,
  lineLength,
  niceStep,
  orbit,
  pan,
  pickLine,
  well3dScene,
  zoom,
  type Camera,
  type Well3dAnswer,
  type Well3dLeg,
} from './well3d';

// A well under the ground, in 3D (F-261): the geometry. Made-up wells only.

const leg = (uwi: string, extra: Partial<Well3dLeg> = {}): Well3dLeg => ({
  uwi,
  licenceNumber: '0509395',
  licensee: 'Example Energy Ltd.',
  statusClass: 'producing',
  surveyed: true,
  own: true,
  // Straight down 2,000 m, then 0.01° of latitude to the north (about 1,106 m), level.
  points: [
    [-113.6, 53.3, 900],
    [-113.6, 53.3, -1100],
    [-113.6, 53.31, -1100],
  ],
  ...extra,
});

const answer = (legs: Well3dLeg[], extra: Partial<Well3dAnswer['well']> = {}): Well3dAnswer => ({
  source: { name: 'Alberta Energy Regulator, ST37 List of Wells in Alberta', loadedAt: null },
  well: {
    uwi: '00/09-07-030-26W4/0',
    licenceNumber: '0509395',
    surface: [-113.6, 53.3],
    kbElevationM: 900,
    groundElevationM: 895,
    ...extra,
  },
  nearbyKm: 3,
  truncated: false,
  legs,
});

const SIZE = { width: 400, height: 300 };

describe('niceStep', () => {
  it('gives round spacings', () => {
    expect(niceStep(3000, 4)).toBe(1000);
    expect(niceStep(9000, 12)).toBe(1000);
    expect(niceStep(400, 12)).toBe(50);
    expect(niceStep(2300, 12)).toBe(200);
    expect(niceStep(0, 4)).toBe(1);
  });
});

describe('well3dScene', () => {
  const NEAR = leg('00/01-08-030-26W4/0', {
    own: false,
    licenceNumber: '0509400',
    points: [
      [-113.59, 53.3, 880],
      [-113.59, 53.3, -1200],
    ],
  });

  it('lays the legs out in metres around the well: east, north and up', () => {
    const scene = well3dScene(answer([leg('00/09-07-030-26W4/0')]), true);
    const points = scene?.lines[0]?.points ?? [];
    expect(points[0]).toEqual([0, 0, 900]);
    expect(points[1]).toEqual([0, 0, -1100]);
    expect(points[2]?.[0]).toBeCloseTo(0, 6);
    expect(points[2]?.[1]).toBeCloseTo(1105.74, 2);
    expect(points[2]?.[2]).toBe(-1100);
    // Depths are counted from the ground the AER gives for the well.
    expect(scene?.ground).toBe(895);
  });

  it('boxes the legs with ground about them, the floor just under the deepest point', () => {
    const scene = well3dScene(answer([leg('00/09-07-030-26W4/0')]), true);
    if (!scene) throw new Error('no scene');
    // 2,000 m at most across: a grid of 200 m.
    expect(scene.step).toBe(200);
    expect(scene.min[0]).toBeLessThan(0);
    expect(scene.max[0]).toBeGreaterThan(0);
    expect(scene.max[1]).toBeGreaterThan(1105);
    expect(scene.min[2]).toBeLessThan(-1100);
    expect(scene.min[2]).toBeGreaterThanOrEqual(-1100 - scene.step / 2);
    // The kelly bushing stands a little over the ground: the box holds it.
    expect(scene.max[2]).toBe(900);
    expect(scene.radius).toBeGreaterThan(1000);
  });

  it('leaves the other wells out when asked, and a leg with under two points always', () => {
    const legs = [
      leg('00/09-07-030-26W4/0'),
      leg('02/09-07-030-26W4/0', { points: [[-113.6, 53.3, 900]] }),
      NEAR,
    ];
    expect(well3dScene(answer(legs), true)?.lines.map((l) => l.uwi)).toEqual([
      '00/09-07-030-26W4/0',
      '00/01-08-030-26W4/0',
    ]);
    expect(well3dScene(answer(legs), false)?.lines.map((l) => l.uwi)).toEqual([
      '00/09-07-030-26W4/0',
    ]);
    expect(well3dScene(answer([]), true)).toBeNull();
  });

  it('takes the ground from where the well starts when the AER gives no elevation', () => {
    const scene = well3dScene(
      answer([leg('00/09-07-030-26W4/0')], { groundElevationM: null, kbElevationM: null }),
      true,
    );
    expect(scene?.ground).toBe(900);
  });
});

describe('the camera', () => {
  const scene = well3dScene(answer([leg('00/09-07-030-26W4/0')]), true);
  if (!scene) throw new Error('no scene');
  const level: Camera = { target: [0, 0, 0], yaw: 0, pitch: 0, distance: 1000 };

  it('looks north with east to the right and up upward', () => {
    const view = lens(level, SIZE);
    const [cx, cy] = view.place(view.see([0, 0, 0]));
    expect([cx, cy]).toEqual([200, 150]);
    expect(view.place(view.see([100, 0, 0]))[0]).toBeGreaterThan(200);
    expect(view.place(view.see([0, 0, 100]))[1]).toBeLessThan(150);
    // North is straight ahead: farther away, still in the middle.
    const north = view.see([0, 500, 0]);
    expect(north[2]).toBeCloseTo(1500, 6);
    expect(view.place(north)).toEqual([200, 150]);
  });

  it('opens holding the whole box in the picture', () => {
    const camera = fitCamera(scene, SIZE);
    const view = lens(camera, SIZE);
    let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const x of [scene.min[0], scene.max[0]]) {
      for (const y of [scene.min[1], scene.max[1]]) {
        for (const z of [scene.min[2], scene.max[2]]) {
          const seen = view.see([x, y, z]);
          expect(seen[2]).toBeGreaterThan(view.near);
          const [px, py] = view.place(seen);
          left = Math.min(left, px);
          right = Math.max(right, px);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
        }
      }
    }
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(SIZE.width);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(SIZE.height);
    // And as near as that allows: the box fills most of one side.
    expect(Math.max((right - left) / SIZE.width, (bottom - top) / SIZE.height)).toBeGreaterThan(
      0.7,
    );
  });

  it('turns with a drag, and never past straight up or down', () => {
    const turned = orbit(level, 100, 0);
    expect(turned.yaw).toBeCloseTo(0.85, 6);
    // The point at the middle stays at the middle.
    const [x, y] = lens(turned, SIZE).place(lens(turned, SIZE).see([0, 0, 0]));
    expect(x).toBeCloseTo(200, 6);
    expect(y).toBeCloseTo(150, 6);
    expect(orbit(level, 0, 10_000).pitch).toBe(1.5);
    expect(orbit(level, 0, -10_000).pitch).toBe(-1.5);
  });

  it('moves with the pointer: what was under it stays under it', () => {
    const moved = pan(level, 40, -25, SIZE);
    const [x, y] = lens(moved, SIZE).place(lens(moved, SIZE).see([0, 0, 0]));
    expect(x).toBeCloseTo(240, 6);
    expect(y).toBeCloseTo(125, 6);
  });

  it('zooms within what the scene allows', () => {
    expect(zoom(level, 0.5, scene).distance).toBe(500);
    expect(zoom(level, 1e-6, scene).distance).toBeCloseTo(scene.radius * 0.04, 6);
    expect(zoom(level, 1e6, scene).distance).toBeCloseTo(scene.radius * 14, 6);
  });

  it('sweeps from one view to another', () => {
    const to: Camera = { target: [10, 20, 30], yaw: 1, pitch: 0.5, distance: 2000 };
    expect(between(level, to, 0)).toEqual(level);
    expect(between(level, to, 1)).toEqual(to);
    expect(between(level, to, 0.5)).toEqual({
      target: [5, 10, 15],
      yaw: 0.5,
      pitch: 0.25,
      distance: 1500,
    });
  });

  it('cuts a line where it passes behind the camera', () => {
    expect(clipSegment([0, 0, 10], [0, 0, 20], 1)).toEqual([
      [0, 0, 10],
      [0, 0, 20],
    ]);
    expect(clipSegment([0, 0, -10], [0, 0, -1], 1)).toBeNull();
    expect(clipSegment([0, 0, -9], [10, 0, 11], 1)).toEqual([
      [5, 0, 1],
      [10, 0, 11],
    ]);
  });
});

describe('pickLine', () => {
  const scene = well3dScene(
    answer([
      leg('00/09-07-030-26W4/0'),
      leg('00/01-08-030-26W4/0', {
        own: false,
        licenceNumber: '0509400',
        points: [
          [-113.59, 53.3, 880],
          [-113.59, 53.3, -1200],
        ],
      }),
    ]),
    true,
  );
  if (!scene) throw new Error('no scene');
  // From the south, level with the middle of the well: the page is the east-and-up plane.
  const camera: Camera = { target: [0, 0, -100], yaw: 0, pitch: 0, distance: 6000 };
  const view = lens(camera, SIZE);

  it('finds the leg under the pointer and how deep the point lies', () => {
    const [x, y] = view.place(view.see([0, 0, -500]));
    const hit = pickLine(scene, view, x + 2, y, 8);
    expect(hit?.line.uwi).toBe('00/09-07-030-26W4/0');
    expect(hit?.point[2]).toBeCloseTo(-500, 0);
    expect(hit?.at[0]).toBeCloseTo(x, 6);
  });

  it('finds another well, and nothing away from every leg', () => {
    const other = scene.lines[1]?.points[0];
    if (!other) throw new Error('no other well');
    const [x, y] = view.place(view.see([other[0], other[1], -600]));
    expect(pickLine(scene, view, x, y, 8)?.line.uwi).toBe('00/01-08-030-26W4/0');
    expect(pickLine(scene, view, 5, 5, 8)).toBeNull();
  });
});

describe('lineLength', () => {
  it('adds up a path along its points', () => {
    expect(
      lineLength([
        [0, 0, 900],
        [0, 0, -1100],
        [0, 1000, -1100],
      ]),
    ).toBe(3000);
    expect(lineLength([[0, 0, 0]])).toBe(0);
  });
});
