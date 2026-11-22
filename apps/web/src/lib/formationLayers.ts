import { formationColumn, type FormationLayer } from '@grain/domain';

import { sceneLonLat, sceneZ, type Lens, type Scene, type Vec3 } from './well3d';

/**
 * The layers of the ground in a well's 3D view (F-261 part 2): the elevations the API sends,
 * turned into surfaces that can be read anywhere in the scene, and into the cut faces of the
 * block of ground the view draws. The elevations are the Alberta Geological Survey's
 * (Geological Framework of Alberta, Version 4); each zone's name and rock type are in
 * @grain/domain (formationZones.ts).
 */

/** The layers as the API sends them (GET /api/v1/petroleum/formation-layers). */
export interface FormationAnswer {
  source: {
    name: string;
    rocks: string;
    model: string | null;
    loadedAt: string | null;
    sourceDate: string | null;
  };
  /** The lattice: cell (x0 + i, y0 + j) is centred on ((x0 + i) × lonStep, (y0 + j) × latStep). */
  grid: { lonStep: number; latStep: number; x0: number; y0: number; columns: number; rows: number };
  /** How many cells of the grid are kept: none means the layers are not loaded here. */
  cells: number;
  /** Each zone present somewhere in the grid: its top and base at every cell, south row first. */
  zones: { zone: number; tops: (number | null)[]; bases: (number | null)[] }[];
}

/** The layers at one place, as surfaces that never cross: one top a zone, and the last base. */
export interface LayerStack {
  /**
   * The top of each zone of the field (in `zones`' order), in metres above sea level. Where a
   * zone is absent its top is that of the next zone beneath, so it has no thickness there.
   */
  tops: Float64Array;
  /** The base of the lowest zone. */
  base: number;
}

export interface LayerField {
  /** The zones' numbers, from the surface down. */
  zones: number[];
  /** The layers at a place, or null where the grid has no cell near it. */
  stackAt(lon: number, lat: number): LayerStack | null;
}

/**
 * The layers as surfaces. In each cell the model's zones are sealed (a base is the top of the
 * zone beneath), so each zone's top is kept as one surface over the whole grid, an absent zone
 * lying on the next one beneath; between cells a surface is read between its four neighbours,
 * which keeps the surfaces in order and lets a zone thin out to nothing where it ends.
 */
export function layerField(answer: FormationAnswer): LayerField | null {
  const { grid } = answer;
  const count = grid.columns * grid.rows;
  if (answer.zones.length === 0 || count === 0) return null;
  const zones = answer.zones.map((z) => z.zone);
  // surfaces[k][cell]: the top of zone k there; surfaces[zones.length][cell]: the last base.
  const surfaces = Array.from({ length: zones.length + 1 }, () =>
    new Float64Array(count).fill(Number.NaN),
  );
  for (let cell = 0; cell < count; cell += 1) {
    let under = Number.NaN;
    for (let k = zones.length - 1; k >= 0; k -= 1) {
      const zone = answer.zones[k];
      const [top, base] = [zone?.tops[cell], zone?.bases[cell]];
      if (typeof top !== 'number' || typeof base !== 'number') continue;
      under = base;
      break;
    }
    if (Number.isNaN(under)) continue;
    (surfaces[zones.length] as Float64Array)[cell] = under;
    for (let k = zones.length - 1; k >= 0; k -= 1) {
      const top = answer.zones[k]?.tops[cell];
      if (typeof top === 'number' && typeof answer.zones[k]?.bases[cell] === 'number') under = top;
      (surfaces[k] as Float64Array)[cell] = under;
    }
  }
  const last = surfaces[zones.length] as Float64Array;
  const kept = (i: number, j: number) =>
    i >= 0 &&
    j >= 0 &&
    i < grid.columns &&
    j < grid.rows &&
    !Number.isNaN(last[j * grid.columns + i]);
  return {
    zones,
    stackAt(lon, lat) {
      const [fx, fy] = [lon / grid.lonStep - grid.x0, lat / grid.latStep - grid.y0];
      const [i, j] = [Math.floor(fx), Math.floor(fy)];
      const [u, v] = [fx - i, fy - j];
      // The four cells about the place, each with its share; a missing one gives its share to
      // the others.
      const corners = [
        [i, j, (1 - u) * (1 - v)],
        [i + 1, j, u * (1 - v)],
        [i, j + 1, (1 - u) * v],
        [i + 1, j + 1, u * v],
      ] as const;
      let total = 0;
      for (const [ci, cj, share] of corners) if (kept(ci, cj)) total += share;
      const near = corners.filter(([ci, cj]) => kept(ci, cj));
      if (near.length === 0) return null;
      const tops = new Float64Array(zones.length);
      let base = 0;
      for (const [ci, cj, share] of near) {
        // On a cell's own centre every share but one is 0: it then counts whole.
        const weight = total > 0 ? share / total : 1 / near.length;
        const cell = cj * grid.columns + ci;
        for (let k = 0; k < zones.length; k += 1) {
          tops[k] = (tops[k] ?? 0) + (surfaces[k]?.[cell] ?? 0) * weight;
        }
        base += (last[cell] ?? 0) * weight;
      }
      return { tops, base };
    },
  };
}

/** The layers at a place that have some thickness there, from the surface down. */
export function layersAt(field: LayerField, lon: number, lat: number): FormationLayer[] {
  const stack = field.stackAt(lon, lat);
  if (!stack) return [];
  const tops: (number | null)[] = new Array<number | null>(90).fill(null);
  const bases: (number | null)[] = new Array<number | null>(90).fill(null);
  field.zones.forEach((zone, k) => {
    const [top, base] = [stack.tops[k] ?? 0, stack.tops[k + 1] ?? stack.base];
    // Under half a metre is a zone that has ended here.
    if (top - base < 0.5) return;
    tops[zone - 1] = top;
    bases[zone - 1] = base;
  });
  return formationColumn(tops, bases);
}

/** One of the four upright faces of the block of ground, with the layers read along it. */
export interface LayerWall {
  /** Which way the face looks from inside the block: outward. */
  normal: readonly [number, number];
  /** Places along the face, from one corner to the other: [east, north] and the layers there. */
  samples: { x: number; y: number; stack: LayerStack | null }[];
}

/** The top of one zone over the block, as a mesh: `side` + 1 points each way; null where it is absent. */
export interface LayerSheet {
  zone: number;
  side: number;
  /** Row-major, the south row first. */
  points: (Vec3 | null)[];
}

/** What the Layers view draws beside the wells: the block's faces and the play's top. */
export interface LayerScene {
  field: LayerField;
  walls: LayerWall[];
  sheet: LayerSheet | null;
}

const WALL_SAMPLES = 28;
const SHEET_SIDE = 18;

/**
 * The block's four faces with the layers read along each, and the top of the play's zone as a
 * sheet through the block. Worked out once for a scene; the drawing only projects it.
 */
export function layerScene(scene: Scene, field: LayerField, playZone: number | null): LayerScene {
  const [x0, y0] = scene.min;
  const [x1, y1] = scene.max;
  const along = (
    from: readonly [number, number],
    to: readonly [number, number],
    normal: readonly [number, number],
  ): LayerWall => ({
    normal,
    samples: Array.from({ length: WALL_SAMPLES + 1 }, (_, k) => {
      const t = k / WALL_SAMPLES;
      const [x, y] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      return { x, y, stack: field.stackAt(...sceneLonLat(scene, x, y)) };
    }),
  });
  const walls = [
    along([x0, y0], [x1, y0], [0, -1]),
    along([x1, y0], [x1, y1], [1, 0]),
    along([x1, y1], [x0, y1], [0, 1]),
    along([x0, y1], [x0, y0], [-1, 0]),
  ];
  const k = playZone === null ? -1 : field.zones.indexOf(playZone);
  let sheet: LayerSheet | null = null;
  if (k >= 0 && playZone !== null) {
    const points: (Vec3 | null)[] = [];
    for (let j = 0; j <= SHEET_SIDE; j += 1) {
      for (let i = 0; i <= SHEET_SIDE; i += 1) {
        const [x, y] = [x0 + ((x1 - x0) * i) / SHEET_SIDE, y0 + ((y1 - y0) * j) / SHEET_SIDE];
        const stack = field.stackAt(...sceneLonLat(scene, x, y));
        const top = stack?.tops[k];
        const under = stack ? (stack.tops[k + 1] ?? stack.base) : undefined;
        points.push(
          top !== undefined && under !== undefined && top - under >= 0.5
            ? [x, y, sceneZ(scene, top)]
            : null,
        );
      }
    }
    sheet = { zone: playZone, side: SHEET_SIDE, points };
  }
  return { field, walls, sheet };
}

/** Whether a face is one of the far ones: seen from inside the block, behind the wells. */
export function wallIsBehind(wall: LayerWall, eye: Vec3): boolean {
  const middle = wall.samples[Math.floor(wall.samples.length / 2)];
  if (!middle) return false;
  return (eye[0] - middle.x) * wall.normal[0] + (eye[1] - middle.y) * wall.normal[1] < 0;
}

/** A layer under the pointer, on one of the block's far faces. */
export interface LayerHit {
  zone: number;
  /** The layer's top and base at that place, in metres above sea level. */
  top: number;
  base: number;
  /** The ground's surface at that place: the top of the first layer there. */
  surface: number;
  /** Where on the canvas. */
  at: [number, number];
}

/**
 * The layer under the pointer on the block's far faces: the line of sight is followed to each
 * face, and the layers are read where it meets the nearest.
 */
export function pickLayer(
  scene: Scene,
  layers: LayerScene,
  view: Lens,
  x: number,
  y: number,
): LayerHit | null {
  const ray = view.ray(x, y);
  let best: (LayerHit & { away: number }) | null = null;
  for (const wall of layers.walls) {
    if (!wallIsBehind(wall, view.eye)) continue;
    const [first, last] = [wall.samples[0], wall.samples[wall.samples.length - 1]];
    if (!first || !last) continue;
    // The face is a plane of one east or one north: where the line of sight crosses it.
    const axis = wall.normal[0] !== 0 ? 0 : 1;
    const level = axis === 0 ? first.x : first.y;
    const speed = ray[axis];
    if (speed === 0) continue;
    const away = (level - view.eye[axis]) / speed;
    if (!(away > 0) || (best && away >= best.away)) continue;
    const [px, py, pz] = [
      view.eye[0] + ray[0] * away,
      view.eye[1] + ray[1] * away,
      view.eye[2] + ray[2] * away,
    ];
    const run = axis === 0 ? last.y - first.y : last.x - first.x;
    const share =
      run === 0 ? -1 : ((axis === 0 ? py : px) - (axis === 0 ? first.y : first.x)) / run;
    if (share < 0 || share > 1 || pz < scene.min[2]) continue;
    const stack = layers.field.stackAt(...sceneLonLat(scene, px, py));
    if (!stack) continue;
    for (let k = 0; k < layers.field.zones.length; k += 1) {
      const [top, base] = [stack.tops[k] ?? 0, stack.tops[k + 1] ?? stack.base];
      if (top - base < 0.5) continue;
      if (pz <= sceneZ(scene, top) && pz > sceneZ(scene, base)) {
        best = {
          zone: layers.field.zones[k] ?? 0,
          top,
          base,
          surface: stack.tops[0] ?? top,
          at: [x, y],
          away,
        };
        break;
      }
    }
  }
  if (!best) return null;
  const { zone, top, base, surface, at } = best;
  return { zone, top, base, surface, at };
}
