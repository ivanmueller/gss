import { formationColumn, type FormationLayer } from '@grain/domain';

import {
  sceneLonLat,
  sceneZ,
  trueZ,
  type Lens,
  type Scene,
  type SceneLine,
  type Vec3,
} from './well3d';

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
  /** Which way the face looks: outward from the block. */
  normal: readonly [number, number];
  /** Places along the face, from one corner to the other: [east, north] and the layers there. */
  samples: { x: number; y: number; stack: LayerStack | null }[];
}

/** A surface over the block as a mesh: `side` + 1 points each way, the south row first. */
export interface LayerMesh {
  side: number;
  /** In the scene's own heights; null where the grid has no cell. */
  points: (Vec3 | null)[];
}

/**
 * What the Layers view draws: the block of ground as a solid seen from outside (the owner,
 * 2026-11-22, from three pictures of such blocks), its faces cut through the layers, the real
 * ground on top, and, when it is opened, its lower part drawn lower so that the top of the
 * play's zone shows with the legs that run in it.
 */
export interface LayerScene {
  field: LayerField;
  walls: LayerWall[];
  /** Which of the field's zones the block is opened at (its index in `field.zones`); -1: whole. */
  cut: number;
  /** How much lower the part under the opening is drawn, in the scene's metres; 0 when whole. */
  drop: number;
  /** The ground's surface. */
  terrain: LayerMesh;
  /** The top of the lower part where the block is opened (already lowered); null when whole. */
  opened: LayerMesh | null;
  /** The underside of the upper part where the block is opened; null when whole. */
  underside: LayerMesh | null;
  /** The wells as the block shows them: what lies under the opening lowered with it. */
  lines: SceneLine[];
  /**
   * The stretches of the wells that lie in the upper part (above the opening; every leg whole
   * when the block is whole): these show through the upper part's faces.
   */
  upper: SceneLine[];
  /** The scene's height for an elevation at a place. */
  place(x: number, y: number, elevation: number): number;
  /** The elevation a height stands for at a place; null in the opening between the two parts. */
  elevation(x: number, y: number, z: number): number | null;
}

const WALL_SAMPLES = 28;
const MESH_SIDE = 20;

/**
 * The block for a scene: its four faces with the layers read along each, its surfaces and its
 * wells. `open` opens it at the top of `playZone` (when that zone is under the block), the part
 * beneath drawn `drop` scene metres lower. Worked out once; the drawing only projects it.
 */
export function layerScene(
  scene: Scene,
  field: LayerField,
  options: { playZone: number | null; open: boolean; drop: number },
): LayerScene {
  const [x0, y0] = scene.min;
  const [x1, y1] = scene.max;
  const stackAt = (x: number, y: number) => field.stackAt(...sceneLonLat(scene, x, y));
  const along = (
    from: readonly [number, number],
    to: readonly [number, number],
    normal: readonly [number, number],
  ): LayerWall => ({
    normal,
    samples: Array.from({ length: WALL_SAMPLES + 1 }, (_, k) => {
      const t = k / WALL_SAMPLES;
      const [x, y] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      return { x, y, stack: stackAt(x, y) };
    }),
  });
  const walls = [
    along([x0, y0], [x1, y0], [0, -1]),
    along([x1, y0], [x1, y1], [1, 0]),
    along([x1, y1], [x0, y1], [0, 1]),
    along([x0, y1], [x0, y0], [-1, 0]),
  ];
  const play = options.playZone === null ? -1 : field.zones.indexOf(options.playZone);
  const cut = options.open && options.drop > 0 ? play : -1;
  const drop = cut >= 0 ? options.drop : 0;
  // The elevation of the opening at a place: the top of the zone it is opened at.
  const cutAt = (x: number, y: number): number | null =>
    cut < 0 ? null : (stackAt(x, y)?.tops[cut] ?? null);

  const place = (x: number, y: number, elevation: number) => {
    const at = cutAt(x, y);
    return sceneZ(scene, elevation) - (at !== null && elevation <= at + 1e-6 ? drop : 0);
  };
  const elevation = (x: number, y: number, z: number) => {
    const at = cutAt(x, y);
    if (at === null) return trueZ(scene, z);
    const level = sceneZ(scene, at);
    if (z >= level) return trueZ(scene, z);
    return z <= level - drop ? trueZ(scene, z + drop) : null;
  };

  const mesh = (index: number, lower: number): LayerMesh => {
    const points: (Vec3 | null)[] = [];
    for (let j = 0; j <= MESH_SIDE; j += 1) {
      for (let i = 0; i <= MESH_SIDE; i += 1) {
        const [x, y] = [x0 + ((x1 - x0) * i) / MESH_SIDE, y0 + ((y1 - y0) * j) / MESH_SIDE];
        const top = stackAt(x, y)?.tops[index];
        points.push(top === undefined ? null : [x, y, sceneZ(scene, top) - lower]);
      }
    }
    return { side: MESH_SIDE, points };
  };

  // The wells as the block shows them. Where a leg passes the opening it is cut there: the
  // part above keeps its height, the part beneath is drawn lower, and one upright stretch
  // joins the two across the opening, as a pipe would.
  const lines: SceneLine[] = [];
  const upper: SceneLine[] = [];
  for (const line of scene.lines) {
    const shown: Vec3[] = [];
    let run: Vec3[] = [];
    const close = () => {
      if (run.length > 1) upper.push({ ...line, points: run });
      run = [];
    };
    let before: { x: number; y: number; e: number; above: boolean } | null = null;
    for (const [x, y, z] of line.points) {
      const e = trueZ(scene, z);
      const at = cutAt(x, y);
      const above = at === null || e > at + 1e-6;
      if (before && before.above !== above) {
        // Where the leg meets the opening, between the two points: at the opening's level
        // under whichever of them lies beneath it.
        const level = (above ? cutAt(before.x, before.y) : at) ?? e;
        const t =
          before.e === e ? 0 : Math.max(0, Math.min(1, (before.e - level) / (before.e - e)));
        const [cx, cy] = [before.x + (x - before.x) * t, before.y + (y - before.y) * t];
        const high: Vec3 = [cx, cy, sceneZ(scene, level)];
        const low: Vec3 = [cx, cy, sceneZ(scene, level) - drop];
        if (before.above) {
          shown.push(high, low);
          run.push(high);
          close();
        } else {
          shown.push(low, high);
          run.push(high);
        }
      }
      const point: Vec3 = [x, y, sceneZ(scene, e) - (above ? 0 : drop)];
      shown.push(point);
      if (above) run.push(point);
      else close();
      before = { x, y, e, above };
    }
    close();
    lines.push({ ...line, points: shown });
  }

  return {
    field,
    walls,
    cut,
    drop,
    terrain: mesh(0, 0),
    opened: cut >= 0 ? mesh(cut, drop) : null,
    underside: cut >= 0 ? mesh(cut, 0) : null,
    lines,
    upper,
    place,
    elevation,
  };
}

/** Whether a face is one of the far ones: seen from inside the block, behind the wells. */
export function wallIsBehind(wall: LayerWall, eye: Vec3): boolean {
  const middle = wall.samples[Math.floor(wall.samples.length / 2)];
  if (!middle) return false;
  return (eye[0] - middle.x) * wall.normal[0] + (eye[1] - middle.y) * wall.normal[1] < 0;
}

/** The faces the block shows: those turned toward the eye; all four from inside it. */
export function wallsShown(layers: LayerScene, eye: Vec3): LayerWall[] {
  const near = layers.walls.filter((wall) => !wallIsBehind(wall, eye));
  return near.length > 0 ? near : layers.walls;
}

/** A layer under the pointer, on one of the block's faces. */
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
 * The layer under the pointer on the block's faces: the line of sight is followed to each face
 * shown, and the layers are read where it meets the nearest.
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
  for (const wall of wallsShown(layers, view.eye)) {
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
    const height = layers.elevation(px, py, pz);
    if (!stack || height === null) continue;
    for (let k = 0; k < layers.field.zones.length; k += 1) {
      const [top, base] = [stack.tops[k] ?? 0, stack.tops[k + 1] ?? stack.base];
      if (top - base < 0.5) continue;
      if (height <= top && height > base) {
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
