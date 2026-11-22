import type { St37StatusClass } from '@grain/domain';

/**
 * A well under the ground, in 3D (F-261; the owner, 2026-11-22): the geometry behind the view
 * on a well's panel. The AER's ST37 drilled paths carry an elevation at every point (metres
 * above sea level); here they become a scene in metres around the well's surface location
 * (east, north, up), seen through a camera that turns about a point, moves and zooms. No
 * drawing here: `well3dDraw.ts` paints what these functions work out.
 */

/** A leg as the API sends it (GET /api/v1/petroleum/st37/well-3d). */
export interface Well3dLeg {
  uwi: string;
  licenceNumber: string;
  licensee: string | null;
  statusClass: St37StatusClass;
  /** Whether the path was surveyed (true) or worked out by the AER (false); null if not said. */
  surveyed: boolean | null;
  /** Whether it is a leg of the well asked for. */
  own: boolean;
  /** [longitude, latitude, metres above sea level], from the surface down. */
  points: [number, number, number][];
}

export interface Well3dAnswer {
  source: { name: string; loadedAt: string | null };
  well: {
    uwi: string;
    licenceNumber: string;
    surface: [number, number];
    kbElevationM: number | null;
    groundElevationM: number | null;
  } | null;
  /** How far around the well the other wells were looked for, in kilometres. */
  nearbyKm: number;
  /** True when more wells lie nearby than the answer holds. */
  truncated: boolean;
  legs: Well3dLeg[];
}

export type Vec3 = readonly [number, number, number];

/** A leg in the scene: its points in metres, east, north and up from the origin. */
export interface SceneLine {
  uwi: string;
  licenceNumber: string;
  licensee: string | null;
  statusClass: St37StatusClass;
  surveyed: boolean | null;
  own: boolean;
  points: Vec3[];
}

export interface Scene {
  lines: SceneLine[];
  /** The well's surface location, [longitude, latitude]: where east and north are counted from. */
  origin: readonly [number, number];
  /** Metres to a degree of longitude at the origin. */
  kx: number;
  /** The ground at the well, in metres above sea level: the level depths are counted from. */
  ground: number;
  /**
   * How many times depths are drawn deeper than they are (1: true to scale). Every height in
   * the scene is already stretched about the ground: `sceneZ` and `trueZ` go between the two.
   */
  stretch: number;
  /** The box the scene is drawn in: snapped outward to the grid. */
  min: Vec3;
  max: Vec3;
  /** The spacing of the grid on the ground and of the depth marks, in metres. */
  step: number;
  centre: Vec3;
  /** Half the box's diagonal: what the camera must hold. */
  radius: number;
}

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320;

/** A round spacing (1, 2, 2.5 or 5 times a power of ten) giving about `parts` parts of `span`. */
export function niceStep(span: number, parts: number): number {
  if (!(span > 0) || !(parts > 0)) return 1;
  const raw = span / parts;
  const power = 10 ** Math.floor(Math.log10(raw));
  const over = raw / power;
  const nice = over <= 1 ? 1 : over <= 2 ? 2 : over <= 2.5 ? 2.5 : over <= 5 ? 5 : 10;
  return nice * power;
}

/** An elevation as the scene draws it: stretched about the ground. */
export function sceneZ(scene: Pick<Scene, 'ground' | 'stretch'>, elevation: number): number {
  return scene.ground + (elevation - scene.ground) * scene.stretch;
}

/** The elevation a height of the scene stands for. */
export function trueZ(scene: Pick<Scene, 'ground' | 'stretch'>, z: number): number {
  return scene.ground + (z - scene.ground) / scene.stretch;
}

/** The place under a point of the scene, [longitude, latitude]. */
export function sceneLonLat(scene: Scene, x: number, y: number): [number, number] {
  return [scene.origin[0] + x / scene.kx, scene.origin[1] + y / M_PER_DEG_LAT];
}

/**
 * The scene of an answer: every leg with at least two points, in metres around the well's
 * surface location. Without `nearby`, only the well's own legs. `stretch` draws depths that
 * many times deeper; `floor` (an elevation) lowers the box to hold what lies under the wells.
 * Null when nothing can be drawn.
 */
export function well3dScene(
  answer: Well3dAnswer,
  nearby: boolean,
  options: { stretch?: number; floor?: number } = {},
): Scene | null {
  const kept = answer.legs.filter((leg) => leg.points.length >= 2 && (nearby || leg.own));
  const first = kept.find((leg) => leg.own) ?? kept[0];
  if (!first) return null;
  const origin = answer.well?.surface ?? [first.points[0]?.[0] ?? 0, first.points[0]?.[1] ?? 0];
  const kx = M_PER_DEG_LON * Math.cos((origin[1] * Math.PI) / 180);
  const flat = kept.map((leg) =>
    leg.points.map(
      ([lon, lat, z]) => [(lon - origin[0]) * kx, (lat - origin[1]) * M_PER_DEG_LAT, z] as const,
    ),
  );
  // The ground: as the AER gives it for the well; else where the well's own paths start (the
  // kelly bushing, a few metres above the ground).
  const ownTop = Math.max(
    ...flat.filter((_, i) => kept[i]?.own).map((points) => points[0]?.[2] ?? -Infinity),
  );
  const highest = Math.max(...flat.flatMap((points) => points.map((p) => p[2])));
  const ground =
    answer.well?.groundElevationM ??
    answer.well?.kbElevationM ??
    (Number.isFinite(ownTop) ? ownTop : highest);
  const stretch = options.stretch && options.stretch > 0 ? options.stretch : 1;
  const deep = (z: number) => ground + (z - ground) * stretch;
  const lines: SceneLine[] = kept.map((leg, i) => ({
    uwi: leg.uwi,
    licenceNumber: leg.licenceNumber,
    licensee: leg.licensee,
    statusClass: leg.statusClass,
    surveyed: leg.surveyed,
    own: leg.own,
    points: (flat[i] ?? []).map(([x, y, z]) => [x, y, deep(z)] as const),
  }));
  let [x0, y0, z0] = [Infinity, Infinity, Infinity];
  let [x1, y1, z1] = [-Infinity, -Infinity, -Infinity];
  for (const line of lines) {
    for (const [x, y, z] of line.points) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  }
  if (options.floor !== undefined) z0 = Math.min(z0, deep(options.floor));
  const top = Math.max(ground, z1);
  const step = niceStep(Math.max(x1 - x0, y1 - y0, top - z0, 400), 12);
  // Some ground about the wells, and never a sliver: a vertical well still gets a square.
  const pad = step * 0.25;
  const snapDown = (n: number) => Math.floor((n - pad) / step) * step;
  const snapUp = (n: number) => Math.ceil((n + pad) / step) * step;
  // The floor a little under the deepest point, on a quarter of the grid.
  const under = step / 4;
  const floor = ground - Math.ceil((ground - z0 + under * 0.2) / under) * under;
  const min: Vec3 = [snapDown(x0), snapDown(y0), floor];
  const max: Vec3 = [snapUp(x1), snapUp(y1), top];
  const centre: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return { lines, origin, kx, ground, stretch, min, max, step, centre, radius };
}

/**
 * The camera: it looks at `target` from `distance` away. `yaw` 0 looks north (east to the
 * right) and grows as the camera swings round to the west; `pitch` is how far above the level
 * it sits (negative: below, looking up).
 */
export interface Camera {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The view's angle from top to bottom, in radians: a long lens, so depths stay readable. */
export const FIELD_OF_VIEW = (32 * Math.PI) / 180;
const MAX_PITCH = 1.5;

const focal = (size: Size) => Math.min(size.width, size.height) / 2 / Math.tan(FIELD_OF_VIEW / 2);

function basis(camera: Camera) {
  const [sy, cy] = [Math.sin(camera.yaw), Math.cos(camera.yaw)];
  const [sp, cp] = [Math.sin(camera.pitch), Math.cos(camera.pitch)];
  const forward: Vec3 = [-sy * cp, cy * cp, -sp];
  const right: Vec3 = [cy, sy, 0];
  const up: Vec3 = [-sy * sp, cy * sp, cp];
  const eye: Vec3 = [
    camera.target[0] - forward[0] * camera.distance,
    camera.target[1] - forward[1] * camera.distance,
    camera.target[2] - forward[2] * camera.distance,
  ];
  return { forward, right, up, eye };
}

/** A point as the camera sees it: across, up and away, in metres. */
export type Seen = readonly [number, number, number];

export interface Lens {
  /** Where the camera stands. */
  eye: Vec3;
  /** The line of sight through a point of the canvas: from the eye, in this direction. */
  ray(x: number, y: number): Vec3;
  /** A scene point in the camera's own axes. */
  see(point: Vec3): Seen;
  /** A seen point on the canvas: x, y in pixels. Only for points in front of `near`. */
  place(seen: Seen): [number, number];
  /** The nearest distance drawn; anything closer is cut away. */
  near: number;
}

export function lens(camera: Camera, size: Size): Lens {
  const { forward, right, up, eye } = basis(camera);
  const f = focal(size);
  const [cx, cy] = [size.width / 2, size.height / 2];
  return {
    eye,
    ray(x, y) {
      const [across, upward] = [(x - cx) / f, -(y - cy) / f];
      return [
        forward[0] + right[0] * across + up[0] * upward,
        forward[1] + right[1] * across + up[1] * upward,
        forward[2] + right[2] * across + up[2] * upward,
      ];
    },
    near: Math.max(1, camera.distance * 0.02),
    see([x, y, z]) {
      const [dx, dy, dz] = [x - eye[0], y - eye[1], z - eye[2]];
      return [
        dx * right[0] + dy * right[1] + dz * right[2],
        dx * up[0] + dy * up[1] + dz * up[2],
        dx * forward[0] + dy * forward[1] + dz * forward[2],
      ];
    },
    place([x, y, depth]) {
      return [cx + (f * x) / depth, cy - (f * y) / depth];
    },
  };
}

/**
 * The part of a seen segment in front of the camera, or null when all of it is behind: a line
 * that runs past the camera is cut where it would otherwise fold back across the picture.
 */
export function clipSegment(a: Seen, b: Seen, near: number): [Seen, Seen] | null {
  if (a[2] < near && b[2] < near) return null;
  if (a[2] >= near && b[2] >= near) return [a, b];
  const t = (near - a[2]) / (b[2] - a[2]);
  const cut: Seen = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near];
  return a[2] < near ? [cut, b] : [a, cut];
}

/**
 * The camera a scene opens with: from the south-east and above, as near as holds the whole box
 * in the picture with a little air around it.
 */
export function fitCamera(
  scene: Scene,
  size: Size,
  room = { side: 44, top: 30 },
  angles = { yaw: -0.65, pitch: 0.42 },
): Camera {
  let camera: Camera = {
    target: scene.centre,
    yaw: angles.yaw,
    pitch: angles.pitch,
    distance: scene.radius / Math.sin(FIELD_OF_VIEW / 2),
  };
  if (!(size.width > 0) || !(size.height > 0)) return camera;
  const corners: Vec3[] = [];
  for (const x of [scene.min[0], scene.max[0]]) {
    for (const y of [scene.min[1], scene.max[1]]) {
      for (const z of [scene.min[2], scene.max[2]]) corners.push([x, y, z]);
    }
  }
  // Room for the depth marks on the left and the lines of text top and bottom.
  const [halfWide, halfHigh] = [size.width / 2 - room.side, size.height / 2 - room.top];
  // The picture does not shrink in step with the distance: a few rounds settle it.
  for (let round = 0; round < 8; round += 1) {
    const view = lens(camera, size);
    let over = 0;
    for (const corner of corners) {
      const seen = view.see(corner);
      if (seen[2] < view.near) {
        over = Math.max(over, 2);
        continue;
      }
      const [x, y] = view.place(seen);
      over = Math.max(
        over,
        Math.abs(x - size.width / 2) / Math.max(1, halfWide),
        Math.abs(y - size.height / 2) / Math.max(1, halfHigh),
      );
    }
    if (over === 0 || Math.abs(over - 1) < 0.01) break;
    camera = { ...camera, distance: camera.distance * over };
  }
  return camera;
}

/** The camera turned by a drag of dx, dy pixels: the scene follows the pointer. */
export function orbit(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    yaw: camera.yaw + dx * 0.0085,
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.pitch + dy * 0.0085)),
  };
}

/** The camera moved sideways and up by a drag of dx, dy pixels: the scene follows the pointer. */
export function pan(camera: Camera, dx: number, dy: number, size: Size): Camera {
  const { right, up } = basis(camera);
  const k = camera.distance / focal(size);
  return {
    ...camera,
    target: [
      camera.target[0] - right[0] * dx * k + up[0] * dy * k,
      camera.target[1] - right[1] * dx * k + up[1] * dy * k,
      camera.target[2] - right[2] * dx * k + up[2] * dy * k,
    ],
  };
}

/** The camera moved nearer (factor under 1) or farther, within what the scene allows. */
export function zoom(camera: Camera, factor: number, scene: Scene): Camera {
  const distance = Math.max(
    scene.radius * 0.04,
    Math.min(scene.radius * 14, camera.distance * factor),
  );
  return { ...camera, distance };
}

/** A camera part of the way from one to another (0 to 1), for the opening sweep. */
export function between(from: Camera, to: Camera, t: number): Camera {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    target: [
      mix(from.target[0], to.target[0]),
      mix(from.target[1], to.target[1]),
      mix(from.target[2], to.target[2]),
    ],
    yaw: mix(from.yaw, to.yaw),
    pitch: mix(from.pitch, to.pitch),
    distance: mix(from.distance, to.distance),
  };
}

/** What lies under the pointer: a leg, and the point on it nearest the pointer. */
export interface Well3dHit {
  line: SceneLine;
  point: Vec3;
  /** Where the point is on the canvas. */
  at: [number, number];
}

/**
 * The leg nearest the pointer, within `reach` pixels, and the point on it. The well's own legs
 * count as a little nearer than the others: they are what the person came for.
 */
export function pickLine(
  scene: Scene,
  view: Lens,
  x: number,
  y: number,
  reach: number,
): Well3dHit | null {
  let best: Well3dHit | null = null;
  let bestScore = Infinity;
  for (const line of scene.lines) {
    for (let i = 1; i < line.points.length; i += 1) {
      const [from, to] = [line.points[i - 1], line.points[i]];
      if (!from || !to) continue;
      const [a, b] = [view.see(from), view.see(to)];
      if (a[2] < view.near && b[2] < view.near) continue;
      // The part of the segment in front of the camera, as shares of its length.
      const cut = b[2] === a[2] ? 0 : (view.near - a[2]) / (b[2] - a[2]);
      const [t0, t1] = a[2] < view.near ? [cut, 1] : b[2] < view.near ? [0, cut] : [0, 1];
      const along = (t: number): Seen => [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ];
      const [ax, ay] = view.place(along(t0));
      const [bx, by] = view.place(along(t1));
      const [vx, vy] = [bx - ax, by - ay];
      const length2 = vx * vx + vy * vy;
      const t =
        length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / length2));
      const [px, py] = [ax + vx * t, ay + vy * t];
      const distance = Math.hypot(x - px, y - py);
      const score = distance - (line.own ? 2 : 0);
      if (distance > reach || score >= bestScore) continue;
      const s = t0 + (t1 - t0) * t;
      bestScore = score;
      best = {
        line,
        point: [
          from[0] + (to[0] - from[0]) * s,
          from[1] + (to[1] - from[1]) * s,
          from[2] + (to[2] - from[2]) * s,
        ],
        at: [px, py],
      };
    }
  }
  return best;
}

/** The length of a line in metres, along its points. */
export function lineLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1], points[i]];
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return total;
}
