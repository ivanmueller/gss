import type { St37StatusClass } from '@grain/domain';

import {
  lens,
  niceStep,
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

export interface DrawOptions {
  /** What the pointer is on, marked with its depth line. */
  hit: Well3dHit | null;
  /** The leg picked out on the panel (its UWI), drawn brightest; null for none. */
  chosen: string | null;
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
  const marks = niceStep(scene.ground - scene.min[2], 4);
  for (let depth = 0; scene.ground - depth >= scene.min[2] - 1; depth += marks) {
    const seen = view.see([post[0], post[1], scene.ground - depth]);
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
  const marks = niceStep(scene.ground - floor, 4);
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
