import { FORMATION_ROCKS, formationZone, type St37StatusClass } from '@grain/domain';

import {
  wallsShown,
  type LayerHit,
  type LayerMesh,
  type LayerScene,
  type LayerWall,
} from './formationLayers';

import {
  lens,
  niceStep,
  sceneZ,
  type Camera,
  type Lens,
  type Scene,
  type SceneLine,
  type Seen,
  type Size,
  type Vec3,
  type Well3dHit,
} from './well3d';

/**
 * How a well under the ground is painted (F-261): a dark block of ground seen from outside, the
 * surface as a faint sheet with a grid, the depths marked down one corner, each leg along its
 * real path with its shadow on the floor, the clicked well bright and the others faint. Plain
 * canvas drawing, no 3D library: a few thousand line segments a frame.
 */

/** The wells' colours on the dark scene, by status (the map's own, for a dark ground). */
export const WELL3D_COLOURS: Record<St37StatusClass, string> = {
  producing: '#f8fafc',
  awaiting: '#cbd5e1',
  drilling: '#60a5fa',
  inactive: '#fbbf24',
  suspended: '#a8a29e',
  abandoned: '#78716c',
  licensed: '#93c5fd',
};

const SKY = '#38bdf8';
const INK = '226, 232, 240';
const FONT = "10px 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
/** The layers' names on the block's faces. */
const FONT_FACE = "12px 'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif";

export interface DrawOptions {
  /** What the pointer is on, marked with its depth line. */
  hit: Well3dHit | null;
  /** The leg picked out on the panel (its UWI), drawn brightest; null for none. */
  chosen: string | null;
  /** The ground's layers, for the Layers view: the block is drawn solid, cut through them. */
  layers?: LayerScene | null;
  /** The layer the pointer is on, on a face of the block. */
  layerHit?: LayerHit | null;
  /** The zone the play is (the Duvernay's), edged and always named; null for none. */
  playZone?: number | null;
}

/** Strokes the line through the points, cut where it passes behind the camera. */
function trace(ctx: CanvasRenderingContext2D, view: Lens, points: readonly Vec3[], closed = false) {
  ctx.beginPath();
  let before: Seen | null = null;
  let down = false;
  const count = closed ? points.length + 1 : points.length;
  for (let i = 0; i < count; i += 1) {
    const point = points[i % points.length];
    if (!point) continue;
    const seen = view.see(point);
    if (before) {
      const [a, b] = [before, seen];
      if (a[2] >= view.near || b[2] >= view.near) {
        const cut = b[2] === a[2] ? 0 : (view.near - a[2]) / (b[2] - a[2]);
        const at = (t: number): Seen => [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ];
        const from = a[2] < view.near ? at(cut) : a;
        const to = b[2] < view.near ? at(cut) : b;
        if (!down || a[2] < view.near) ctx.moveTo(...view.place(from));
        ctx.lineTo(...view.place(to));
        down = b[2] >= view.near;
      } else {
        down = false;
      }
    }
    before = seen;
  }
}

function stroke(ctx: CanvasRenderingContext2D, colour: string, width: number, dash?: number[]) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.setLineDash(dash ?? []);
  ctx.stroke();
}

/** The four corners of the box at one level, round from the south-west. */
function corners(scene: Scene, z: number): Vec3[] {
  const [x0, y0] = scene.min;
  const [x1, y1] = scene.max;
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ];
}

/** The grid lines of one level: every `step` metres across and along. */
function gridLines(scene: Scene, z: number): Vec3[][] {
  const lines: Vec3[][] = [];
  const [x0, y0] = scene.min;
  const [x1, y1] = scene.max;
  for (let x = x0 + scene.step; x < x1 - 1; x += scene.step) {
    lines.push([
      [x, y0, z],
      [x, y1, z],
    ]);
  }
  for (let y = y0 + scene.step; y < y1 - 1; y += scene.step) {
    lines.push([
      [x0, y, z],
      [x1, y, z],
    ]);
  }
  return lines;
}

const metres = (n: number) => `${Math.round(n).toLocaleString('en-CA')} m`;

function fillSheet(ctx: CanvasRenderingContext2D, view: Lens, sheet: Vec3[], colour: string) {
  const seen = sheet.map((corner) => view.see(corner));
  // A sheet that passes behind the camera is left unfilled: its outline is still drawn.
  if (seen.some((corner) => corner[2] < view.near)) return;
  ctx.beginPath();
  seen.forEach((corner, i) => {
    const [x, y] = view.place(corner);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

function drawGround(ctx: CanvasRenderingContext2D, view: Lens, scene: Scene) {
  const sheet = corners(scene, scene.ground);
  fillSheet(ctx, view, sheet, 'rgba(148, 163, 184, 0.09)');
  for (const line of gridLines(scene, scene.ground)) {
    trace(ctx, view, line);
    stroke(ctx, `rgba(${INK}, 0.11)`, 1);
  }
  trace(ctx, view, sheet, true);
  stroke(ctx, `rgba(${INK}, 0.5)`, 1.2);
  // The clicked well's trace on the surface, as the map draws it, and a dot where each well
  // starts.
  for (const line of scene.lines) {
    if (!line.own) continue;
    trace(
      ctx,
      view,
      line.points.map(([x, y]) => [x, y, scene.ground] as const),
    );
    stroke(ctx, 'rgba(125, 211, 252, 0.55)', 1, [3, 3]);
  }
  ctx.setLineDash([]);
  const heads = new Map<string, SceneLine>();
  for (const line of scene.lines) {
    if (!heads.has(line.licenceNumber) || line.own) heads.set(line.licenceNumber, line);
  }
  for (const line of heads.values()) {
    const [first] = line.points;
    if (!first) continue;
    const seen = view.see([first[0], first[1], scene.ground]);
    if (seen[2] < view.near) continue;
    const [x, y] = view.place(seen);
    ctx.beginPath();
    ctx.arc(x, y, line.own ? 4 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = line.own ? SKY : `rgba(${INK}, 0.55)`;
    ctx.fill();
    if (line.own) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      stroke(ctx, 'rgba(56, 189, 248, 0.45)', 1.2);
    }
  }
  // North, at the middle of the north edge.
  const mid: Vec3 = [(scene.min[0] + scene.max[0]) / 2, scene.max[1], scene.ground];
  const out: Vec3 = [mid[0], mid[1] + scene.step * 0.35, scene.ground];
  const [a, b] = [view.see(mid), view.see(out)];
  if (a[2] >= view.near && b[2] >= view.near) {
    const [ax, ay] = view.place(a);
    const [bx, by] = view.place(b);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    stroke(ctx, `rgba(${INK}, 0.7)`, 1.2);
    const length = Math.hypot(bx - ax, by - ay) || 1;
    ctx.font = FONT;
    ctx.fillStyle = `rgba(${INK}, 0.85)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', bx + ((bx - ax) / length) * 9, by + ((by - ay) / length) * 9);
  }
}

/** A faint sheet from a leg straight up to the surface: where it runs, and how deep. */
function curtain(ctx: CanvasRenderingContext2D, view: Lens, line: SceneLine, ground: number) {
  ctx.fillStyle = 'rgba(56, 189, 248, 0.055)';
  for (let i = 1; i < line.points.length; i += 1) {
    const [a, b] = [line.points[i - 1], line.points[i]];
    if (!a || !b) continue;
    const quad = [a, b, [b[0], b[1], ground] as const, [a[0], a[1], ground] as const].map((p) =>
      view.see(p),
    );
    if (quad.some((corner) => corner[2] < view.near)) continue;
    ctx.beginPath();
    quad.forEach((corner, k) => {
      const [x, y] = view.place(corner);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  view: Lens,
  line: SceneLine,
  ground: number,
  fade: number,
  bright: boolean,
) {
  const colour = WELL3D_COLOURS[line.statusClass];
  // A path the AER worked out, not surveyed, is dashed.
  const dash = line.surveyed === false ? [6, 4] : undefined;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (line.own) curtain(ctx, view, line, ground);
  trace(ctx, view, line.points);
  if (line.own) {
    ctx.globalAlpha = fade * (bright ? 0.3 : 0.16);
    stroke(ctx, SKY, bright ? 11 : 8);
    ctx.globalAlpha = fade * (bright ? 0.55 : 0.32);
    stroke(ctx, SKY, bright ? 5.5 : 4.5);
    ctx.globalAlpha = Math.min(1, fade + 0.15);
    stroke(ctx, colour, bright ? 2.6 : 2, dash);
  } else {
    ctx.globalAlpha = fade * (bright ? 0.95 : 0.5);
    stroke(ctx, colour, bright ? 2 : 1.1, dash);
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  // The bottom hole.
  const last = line.points[line.points.length - 1];
  const seen = last && view.see(last);
  if (seen && seen[2] >= view.near && (line.own || bright)) {
    const [x, y] = view.place(seen);
    ctx.beginPath();
    ctx.arc(x, y, line.own ? 3 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }
}

/** A zone's colour and hatching, as the Table of Formations colours its unit. */
function rockOf(zone: number) {
  return FORMATION_ROCKS[formationZone(zone)?.rock ?? 'unknown'];
}

/** A colour made darker or lighter: each of its parts times `by`. */
function shade(hex: string, by: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const part = (shift: number) =>
    String(Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * by))));
  return `rgb(${part(16)}, ${part(8)}, ${part(0)})`;
}

const GRASS = '#7f9d5b';
const CASING = '#0b1220';
/** Where the light comes from: the north-west, above. */
const LIGHT: Vec3 = [-0.37, 0.47, 0.8];

/**
 * A surface of the block (the ground, or the top of the lower part where it is opened) as a
 * solid sheet: its squares the farthest first, each lit by how it faces the light.
 */
function drawMesh(
  ctx: CanvasRenderingContext2D,
  view: Lens,
  mesh: LayerMesh,
  colour: string,
  grid: string | null,
) {
  const width = mesh.side + 1;
  const at = (i: number, j: number) => mesh.points[j * width + i] ?? null;
  const quads: { away: number; corners: [number, number][]; lit: number }[] = [];
  for (let j = 0; j < mesh.side; j += 1) {
    for (let i = 0; i < mesh.side; i += 1) {
      const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (!a || !b || !c || !d) continue;
      const seen = [a, b, c, d].map((point) => view.see(point));
      if (seen.some((corner) => corner[2] < view.near)) continue;
      // The square's own slope, from its two diagonals.
      const [ux, uy, uz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const [vx, vy, vz] = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
      const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const length = Math.hypot(nx, ny, nz) || 1;
      const facing = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / length;
      quads.push({
        away: seen.reduce((sum, corner) => sum + corner[2], 0) / 4,
        corners: seen.map((corner) => view.place(corner)),
        lit: 0.62 + 0.5 * facing,
      });
    }
  }
  quads.sort((p, q) => q.away - p.away);
  ctx.setLineDash([]);
  ctx.lineWidth = 0.8;
  for (const quad of quads) {
    ctx.beginPath();
    quad.corners.forEach(([x, y], n) => {
      if (n === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    const fill = shade(colour, quad.lit);
    ctx.fillStyle = fill;
    ctx.fill();
    // Its own colour along its edges, so no seam shows between squares.
    ctx.strokeStyle = fill;
    ctx.stroke();
  }
  if (!grid) return;
  const line = (points: (Vec3 | null)[]) => {
    let run: Vec3[] = [];
    for (const point of [...points, null]) {
      if (point) {
        run.push(point);
        continue;
      }
      if (run.length > 1) {
        trace(ctx, view, run);
        stroke(ctx, grid, 0.7);
      }
      run = [];
    }
  };
  for (let n = 0; n <= mesh.side; n += 4) {
    line(Array.from({ length: width }, (_, i) => at(i, n)));
    line(Array.from({ length: width }, (_, j) => at(n, j)));
  }
}

/** A face of the block on the canvas: each layer's top and base along it, where they can be drawn. */
interface Face {
  wall: LayerWall;
  /** How bright the face is: the two faces shown differ, so the corner between them reads. */
  lit: number;
  /** The stretches of the face that can be drawn: first and last sample of each. */
  runs: [number, number][];
  /** The surface under zone index k (k = the zones' count: the last base), lowered or not. */
  line(k: number, lowered: boolean): ([number, number] | null)[];
}

function faceOf(view: Lens, scene: Scene, layers: LayerScene, wall: LayerWall): Face {
  const zones = layers.field.zones;
  const floor = scene.min[2];
  const kept = new Map<string, ([number, number] | null)[]>();
  const line = (k: number, lowered: boolean) => {
    const key = `${String(k)}:${String(lowered)}`;
    let points = kept.get(key);
    if (!points) {
      points = wall.samples.map((sample) => {
        if (!sample.stack) return null;
        const elevation = k < zones.length ? (sample.stack.tops[k] ?? 0) : sample.stack.base;
        const z = Math.max(floor, sceneZ(scene, elevation) - (lowered ? layers.drop : 0));
        const seen = view.see([sample.x, sample.y, z]);
        return seen[2] >= view.near ? view.place(seen) : null;
      });
      kept.set(key, points);
    }
    return points;
  };
  const [top, bottom] = [line(0, false), line(zones.length, layers.cut >= 0)];
  const runs: [number, number][] = [];
  let from = -1;
  wall.samples.forEach((_, s) => {
    const seen = top[s] != null && bottom[s] != null;
    if (seen && from < 0) from = s;
    if ((!seen || s === wall.samples.length - 1) && from >= 0) {
      const to = seen ? s : s - 1;
      if (to > from) runs.push([from, to]);
      from = -1;
    }
  });
  return { wall, lit: wall.normal[0] !== 0 ? 0.8 : 1, runs, line };
}

/** Adds one surface's stretch to the path being drawn. */
function edge(
  ctx: CanvasRenderingContext2D,
  points: readonly ([number, number] | null)[],
  from: number,
  to: number,
) {
  const step = from <= to ? 1 : -1;
  for (let s = from; s !== to + step; s += step) {
    const point = points[s];
    if (point) ctx.lineTo(point[0], point[1]);
  }
}

/**
 * The layers of zone indexes `first` to `last` (not included) on a face: each a band between
 * its top and its base, in its rock type's colour, hatched for the two interbedded classes, the
 * play's zone edged dark.
 */
function drawBands(
  ctx: CanvasRenderingContext2D,
  layers: LayerScene,
  face: Face,
  first: number,
  last: number,
  play: number,
) {
  const zones = layers.field.zones;
  const lowered = (k: number) => layers.cut >= 0 && k >= layers.cut;
  ctx.setLineDash([]);
  for (const [a, b] of face.runs) {
    for (let k = first; k < last; k += 1) {
      const [top, under] = [face.line(k, lowered(k)), face.line(k + 1, lowered(k))];
      // A zone with no thickness anywhere along the stretch is not there.
      let thick = 0;
      for (let s = a; s <= b; s += 1) {
        const [p, q] = [top[s], under[s]];
        if (p && q) thick = Math.max(thick, Math.abs(q[1] - p[1]));
      }
      if (thick < 0.35) continue;
      const rock = rockOf(zones[k] ?? 0);
      ctx.beginPath();
      edge(ctx, top, a, b);
      edge(ctx, under, b, a);
      ctx.closePath();
      ctx.fillStyle = shade(rock.colour, face.lit);
      ctx.fill();
      if (rock.hatch) {
        // The two interbedded classes: slanted lines, as on the table.
        ctx.beginPath();
        for (let s = a; s < b; s += 1) {
          const [p, q] = [top[s], under[s + 1]];
          if (!p || !q) continue;
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        }
        stroke(ctx, rock.hatch, 0.9);
      }
      ctx.beginPath();
      edge(ctx, top, a, b);
      stroke(ctx, 'rgba(15, 23, 42, 0.5)', k === play || k === play + 1 ? 1.6 : 0.7);
    }
    // The face's outline.
    ctx.beginPath();
    edge(ctx, face.line(first, lowered(first)), a, b);
    edge(ctx, face.line(last, lowered(last - 1)), b, a);
    ctx.closePath();
    stroke(ctx, 'rgba(15, 23, 42, 0.8)', 1);
  }
}

/**
 * A leg as a pipe: its status colour inside a dark casing, so it reads on any rock. `inside`
 * is a leg seen through a face of the block: the other wells' are then thin and faint, so the
 * layers stay readable behind a crowd of them.
 */
function drawPipe(
  ctx: CanvasRenderingContext2D,
  view: Lens,
  line: SceneLine,
  bright: boolean,
  inside: boolean,
) {
  const dash = line.surveyed === false ? [6, 4] : undefined;
  const quiet = inside && !line.own && !bright;
  const wide = line.own ? (bright ? 3.4 : 2.8) : bright ? 2.2 : quiet ? 1 : 1.3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalAlpha = quiet ? 0.42 : line.own ? 1 : 0.9;
  trace(ctx, view, line.points);
  stroke(ctx, CASING, wide + (quiet ? 1.2 : 2.2));
  stroke(ctx, line.own ? SKY : WELL3D_COLOURS[line.statusClass], wide, dash);
  ctx.setLineDash([]);
  const last = line.points[line.points.length - 1];
  const seen = last && view.see(last);
  if (!inside && seen && seen[2] >= view.near && (line.own || bright)) {
    const [x, y] = view.place(seen);
    ctx.beginPath();
    ctx.arc(x, y, line.own ? 3.4 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = line.own ? '#ffffff' : WELL3D_COLOURS[line.statusClass];
    ctx.fill();
    stroke(ctx, CASING, 1.2);
  }
  ctx.globalAlpha = 1;
}

/** Where each well starts, on the ground: a derrick for the clicked well, a dot for the others. */
function drawHeads(ctx: CanvasRenderingContext2D, view: Lens, lines: readonly SceneLine[]) {
  const heads = new Map<string, SceneLine>();
  for (const line of lines) {
    if (!heads.has(line.licenceNumber) || line.own) heads.set(line.licenceNumber, line);
  }
  ctx.setLineDash([]);
  for (const line of heads.values()) {
    const [first] = line.points;
    const seen = first && view.see(first);
    if (!seen || seen[2] < view.near) continue;
    const [x, y] = view.place(seen);
    if (!line.own) {
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
      stroke(ctx, CASING, 1);
      continue;
    }
    // A small derrick: two legs to a point, two braces across.
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x, y - 17);
    ctx.lineTo(x + 6, y);
    ctx.moveTo(x - 4, y - 6);
    ctx.lineTo(x + 4, y - 6);
    ctx.moveTo(x - 2.2, y - 11);
    ctx.lineTo(x + 2.2, y - 11);
    stroke(ctx, '#f8fafc', 3.4);
    stroke(ctx, CASING, 1.6);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = SKY;
    ctx.fill();
    stroke(ctx, CASING, 1.2);
  }
}

/** The layers' names on the face that shows widest: every layer tall enough, and the play's. */
function drawFaceLabels(
  ctx: CanvasRenderingContext2D,
  layers: LayerScene,
  faces: readonly Face[],
  play: number,
) {
  const zones = layers.field.zones;
  let widest: { face: Face; s: number; wide: number } | null = null;
  for (const face of faces) {
    for (const [a, b] of face.runs) {
      const [p, q] = [face.line(0, false)[a], face.line(0, false)[b]];
      const wide = p && q ? Math.abs(q[0] - p[0]) : 0;
      if (!widest || wide > widest.wide) widest = { face, s: Math.round((a + b) / 2), wide };
    }
  }
  if (!widest) return;
  const { face, s, wide } = widest;
  const lowered = (k: number) => layers.cut >= 0 && k >= layers.cut;
  const found = zones.flatMap((zone, k) => {
    const [p, q] = [face.line(k, lowered(k))[s], face.line(k + 1, lowered(k))[s]];
    if (!p || !q) return [];
    const tall = q[1] - p[1];
    if (k !== play && tall < 13) return [];
    if (k === play && tall < 1) return [];
    return [{ zone, play: k === play, x: p[0], y: (p[1] + q[1]) / 2 }];
  });
  const written: number[] = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  for (const label of [...found.filter((l) => l.play), ...found.filter((l) => !l.play)]) {
    if (written.some((y) => Math.abs(y - label.y) < 12)) continue;
    const short = formationZone(label.zone)?.short ?? '';
    ctx.font = label.play ? `600 ${FONT_FACE}` : FONT_FACE;
    // A name wider than the face would hang off it: the first of a joined layer's names then.
    const text =
      ctx.measureText(short).width > wide - 16 ? (short.split(' / ')[0] ?? short) : short;
    if (ctx.measureText(text).width > wide - 8) continue;
    written.push(label.y);
    ctx.strokeStyle = 'rgba(11, 18, 32, 0.9)';
    ctx.lineWidth = 2.6;
    ctx.strokeText(text, label.x, label.y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, label.x, label.y);
  }
}

/** The depth marks down the block's edge that stands leftmost: depths below the surface there. */
function drawBlockDepths(
  ctx: CanvasRenderingContext2D,
  view: Lens,
  scene: Scene,
  layers: LayerScene,
  faces: readonly Face[],
) {
  let post: LayerWall['samples'][number] | null = null;
  let leftmost = Infinity;
  for (const face of faces) {
    for (const [a, b] of face.runs) {
      for (const s of [a, b]) {
        const point = face.line(0, false)[s];
        const sample = face.wall.samples[s];
        if (point && sample && point[0] < leftmost) {
          leftmost = point[0];
          post = sample;
        }
      }
    }
  }
  if (!post?.stack) return;
  const { x, y, stack } = post;
  const surface = stack.tops[0] ?? scene.ground;
  // The lowest elevation the block shows at that edge.
  const lowest = layers.elevation(x, y, scene.min[2]) ?? surface;
  const marks = niceStep(surface - lowest, 4);
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let depth = 0; surface - depth >= lowest - 1; depth += marks) {
    const seen = view.see([x, y, layers.place(x, y, surface - depth)]);
    if (seen[2] < view.near) continue;
    const [px, py] = view.place(seen);
    ctx.beginPath();
    ctx.moveTo(px - 5, py);
    ctx.lineTo(px, py);
    stroke(ctx, `rgba(${INK}, 0.7)`, 1);
    ctx.fillStyle = `rgba(${INK}, ${depth === 0 ? '0.95' : '0.75'})`;
    ctx.fillText(depth === 0 ? 'Surface' : metres(depth), px - 8, py);
  }
}

/**
 * The Layers view (the owner, 2026-11-22, from three pictures of such blocks): the ground as a
 * solid block seen from outside. Its faces are cut through the layers, each a band at its real
 * depth in its rock type's colour with its name on it; the real ground lies on top; the wells
 * show through the faces as pipes. Opened at the play's zone, the part beneath is drawn lower:
 * the top of the play shows, with the legs that run in it.
 */
function drawBlock(
  ctx: CanvasRenderingContext2D,
  view: Lens,
  scene: Scene,
  layers: LayerScene,
  options: DrawOptions,
) {
  const zones = layers.field.zones;
  const play = options.playZone == null ? -1 : zones.indexOf(options.playZone);
  const { cut } = layers;
  const upper = cut >= 0 ? cut : zones.length;
  const faces = wallsShown(layers, view.eye)
    .map((wall) => {
      const middle = wall.samples[Math.floor(wall.samples.length / 2)];
      return { wall, away: middle ? view.see([middle.x, middle.y, scene.ground])[2] : 0 };
    })
    .sort((a, b) => b.away - a.away)
    .map(({ wall }) => faceOf(view, scene, layers, wall));
  const bright = (line: SceneLine) =>
    line.uwi === options.hit?.line.uwi || line.uwi === options.chosen;
  const pipes = (lines: readonly SceneLine[], inside: boolean) => {
    for (const own of [false, true]) {
      for (const line of lines) {
        if (line.own === own) drawPipe(ctx, view, line, bright(line), inside);
      }
    }
  };

  if (cut >= 0) {
    // The lower part: its top (the top of the play's zone), its faces, and every leg over them.
    const middle = layers.underside?.points[Math.floor(layers.underside.points.length / 2)];
    const fromBelow = middle != null && view.eye[2] < middle[2];
    const rock = rockOf(zones[cut] ?? 0);
    if (!fromBelow && layers.opened) {
      drawMesh(ctx, view, layers.opened, rock.colour, 'rgba(15, 23, 42, 0.14)');
    }
    for (const face of faces) drawBands(ctx, layers, face, cut, zones.length, play);
    pipes(layers.lines, false);
    if (fromBelow && layers.underside) {
      drawMesh(ctx, view, layers.underside, shade(rockOf(zones[cut - 1] ?? 0).colour, 0.7), null);
    }
  }
  // The upper part (or the whole block): its faces, then the ground on top.
  for (const face of faces) drawBands(ctx, layers, face, 0, upper, play);
  drawMesh(ctx, view, layers.terrain, GRASS, 'rgba(15, 23, 42, 0.1)');

  // The legs inside the block show through its faces, never over the ground.
  ctx.save();
  ctx.beginPath();
  const lowered = (k: number) => cut >= 0 && k >= cut;
  for (const face of faces) {
    for (const [a, b] of face.runs) {
      const [top, under] = [face.line(0, false), face.line(upper, lowered(upper - 1))];
      const start = top[a];
      if (!start) continue;
      ctx.moveTo(start[0], start[1]);
      edge(ctx, top, a, b);
      edge(ctx, under, b, a);
      ctx.closePath();
    }
  }
  ctx.clip();
  pipes(layers.upper, true);
  ctx.restore();

  drawHeads(ctx, view, layers.lines);
  drawFaceLabels(ctx, layers, faces, play);
  drawBlockDepths(ctx, view, scene, layers, faces);
}

/** The depth marks down the corner that stands leftmost in the picture. */
function drawDepths(ctx: CanvasRenderingContext2D, view: Lens, scene: Scene) {
  const middle = (scene.min[2] + scene.ground) / 2;
  let post: Vec3 | null = null;
  let leftmost = Infinity;
  for (const corner of corners(scene, middle)) {
    const seen = view.see(corner);
    if (seen[2] < view.near) continue;
    const [x] = view.place(seen);
    if (x < leftmost) {
      leftmost = x;
      post = corner;
    }
  }
  if (!post) return;
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  // Depths as they are, placed where the scene draws them (deeper when it is stretched).
  const marks = niceStep((scene.ground - scene.min[2]) / scene.stretch, 4);
  for (let depth = 0; scene.ground - depth * scene.stretch >= scene.min[2] - 1; depth += marks) {
    const seen = view.see([post[0], post[1], scene.ground - depth * scene.stretch]);
    if (seen[2] < view.near) continue;
    const [x, y] = view.place(seen);
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x, y);
    stroke(ctx, `rgba(${INK}, 0.6)`, 1);
    ctx.fillStyle = `rgba(${INK}, ${depth === 0 ? '0.9' : '0.62'})`;
    ctx.fillText(depth === 0 ? 'Surface' : metres(depth), x - 7, y);
  }
}

function drawHit(ctx: CanvasRenderingContext2D, view: Lens, scene: Scene, hit: Well3dHit) {
  const [x, y, z] = hit.point;
  // Straight up to the surface: how deep the point lies.
  trace(ctx, view, [
    [x, y, z],
    [x, y, scene.ground],
  ]);
  stroke(ctx, 'rgba(56, 189, 248, 0.7)', 1, [2, 3]);
  ctx.setLineDash([]);
  const top = view.see([x, y, scene.ground]);
  if (top[2] >= view.near) {
    const [tx, ty] = view.place(top);
    ctx.beginPath();
    ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = SKY;
    ctx.fill();
  }
  const [px, py] = hit.at;
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  stroke(ctx, SKY, 1.5);
}

/** Paints the scene as the camera sees it. The context is already scaled to CSS pixels. */
export function drawWell3d(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  size: Size,
  options: DrawOptions,
) {
  const view = lens(camera, size);
  const { width, height } = size;

  // The dark of the ground, a little lighter toward the middle.
  const back = ctx.createLinearGradient(0, 0, 0, height);
  back.addColorStop(0, '#0a0f16');
  back.addColorStop(1, '#141d2a');
  ctx.globalAlpha = 1;
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(
    width / 2,
    height * 0.55,
    0,
    width / 2,
    height * 0.55,
    Math.max(width, height) * 0.7,
  );
  glow.addColorStop(0, 'rgba(56, 189, 248, 0.10)');
  glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  if (options.layers) {
    drawBlock(ctx, view, scene, options.layers, options);
    const mark = options.layerHit?.at ?? options.hit?.at;
    if (mark) {
      ctx.beginPath();
      ctx.arc(mark[0], mark[1], 4.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      stroke(ctx, '#0b1220', 1.6);
    }
    return;
  }

  // Seen from above, the surface is a sheet over the wells; from below, it is behind them.
  const eyeAbove = camera.target[2] + Math.sin(camera.pitch) * camera.distance > scene.ground;
  if (!eyeAbove) drawGround(ctx, view, scene);

  // The floor, at the deepest level: a grid, and each leg's shadow on it.
  const floor = scene.min[2];
  fillSheet(ctx, view, corners(scene, floor), 'rgba(2, 6, 12, 0.35)');
  for (const line of gridLines(scene, floor)) {
    trace(ctx, view, line);
    stroke(ctx, 'rgba(125, 211, 252, 0.09)', 1);
  }
  trace(ctx, view, corners(scene, floor), true);
  stroke(ctx, 'rgba(125, 211, 252, 0.3)', 1);
  for (const line of scene.lines) {
    trace(
      ctx,
      view,
      line.points.map(([x, y]) => [x, y, floor] as const),
    );
    stroke(ctx, line.own ? 'rgba(56, 189, 248, 0.28)' : 'rgba(0, 0, 0, 0.5)', line.own ? 2 : 1.4);
  }

  // The box: its upright edges and a frame at every depth mark.
  for (const [x, y] of corners(scene, 0)) {
    trace(ctx, view, [
      [x, y, floor],
      [x, y, scene.ground],
    ]);
    stroke(ctx, `rgba(${INK}, 0.2)`, 1);
  }
  const marks = niceStep((scene.ground - floor) / scene.stretch, 4) * scene.stretch;
  for (let z = scene.ground - marks; z > floor + 1; z -= marks) {
    trace(ctx, view, corners(scene, z), true);
    stroke(ctx, `rgba(${INK}, 0.07)`, 1);
  }

  // The legs, the farthest first, each fainter the farther it lies.
  const [nearest, farthest] = [camera.distance - scene.radius, camera.distance + scene.radius];
  const ordered = scene.lines
    .map((line) => {
      let depth = 0;
      for (const point of line.points) depth += view.see(point)[2];
      return { line, depth: depth / line.points.length };
    })
    .sort((a, b) => b.depth - a.depth);
  const hitUwi = options.hit?.line.uwi ?? null;
  for (const pass of [false, true]) {
    for (const { line, depth } of ordered) {
      // The clicked well's legs go over the others, so a crowd never hides them.
      if (line.own !== pass) continue;
      const share = Math.max(0, Math.min(1, (depth - nearest) / (farthest - nearest || 1)));
      const bright = line.uwi === hitUwi || line.uwi === options.chosen;
      drawLine(ctx, view, line, scene.ground, 1 - share * 0.55, bright);
    }
  }

  if (eyeAbove) drawGround(ctx, view, scene);
  drawDepths(ctx, view, scene);
  if (options.hit) drawHit(ctx, view, scene, options.hit);
}
