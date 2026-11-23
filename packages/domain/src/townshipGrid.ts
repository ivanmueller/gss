// The Alberta Township System grid on the oil and gas map (F-240, F-271; the owner, 2026-11-22:
// "We need the map grid for the boxes around the province of Alberta"). Drawn from the
// province's township grid service, fetched by the Worker by map square, nothing stored:
// https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer
// ("Copyright Government of Alberta", Open Government Licence – Alberta). Shared by the Worker,
// which builds each request from these fixed values and a map square only, and the browser,
// which asks for the squares of the view and labels the shapes.

import type { Bbox } from './geo';
import type { Tile } from './mapLayers';

export const ATS_SERVICE =
  'https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer';

export type GridLevel = 'township' | 'section' | 'quarter' | 'lsd';
export const GRID_LEVELS: readonly GridLevel[] = ['township', 'section', 'quarter', 'lsd'];

interface LevelSpec {
  /** The service's layer: the finest outline of each level. */
  layer: number;
  /** The fields asked for, which name each shape. */
  fields: readonly string[];
  /** The map squares' zoom, by the map's zoom: [from map zoom, square zoom], highest first. */
  squares: readonly (readonly [number, number])[];
  /** The map zoom the level is drawn from. */
  from: number;
  /**
   * Only the land itself, not the road allowance strips beside it, which the service keeps as
   * shapes of their own (RA = RI, RS or RW; blank for the land).
   */
  landOnly: boolean;
}

/**
 * Measured on the service around Fox Creek (2026-11-22): a township square at zoom 8 holds 122
 * shapes (25 KB), a section square at zoom 11 168 (36 KB), a quarter square at zoom 12 about
 * 130, a legal subdivision square at zoom 13 90 (21 KB); each answered in under half a second.
 * The service gives at most 1,000 shapes an answer, so no square is asked for farther out.
 */
export const GRID_SPECS: Record<GridLevel, LevelSpec> = {
  township: {
    layer: 14,
    fields: ['M', 'RGE', 'TWP'],
    squares: [
      [9, 9],
      [7, 7],
    ],
    from: 7,
    landOnly: false,
  },
  section: {
    layer: 18,
    fields: ['M', 'RGE', 'TWP', 'SEC'],
    squares: [[11, 11]],
    from: 11,
    landOnly: true,
  },
  quarter: {
    layer: 19,
    fields: ['M', 'RGE', 'TWP', 'SEC', 'QS'],
    squares: [[13, 12]],
    from: 13,
    landOnly: true,
  },
  lsd: {
    layer: 20,
    fields: ['M', 'RGE', 'TWP', 'SEC', 'LS'],
    squares: [[14, 13]],
    from: 14,
    landOnly: true,
  },
};

/** Every square zoom a level is ever asked for at: the Worker refuses any other. */
export function gridSquareZooms(level: GridLevel): number[] {
  return GRID_SPECS[level].squares.map(([, z]) => z);
}

/** The zoom of a level's squares at a map zoom; null when the level is not drawn there. */
export function gridSquareZoom(level: GridLevel, zoom: number): number | null {
  const spec = GRID_SPECS[level];
  if (zoom < spec.from) return null;
  return spec.squares.find(([at]) => zoom >= at)?.[1] ?? null;
}

/** Alberta, a little wide: a square wholly outside it is never asked for. */
export const ALBERTA_BOX: Bbox = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };

function tileX(lon: number, n: number) {
  return Math.floor(((lon + 180) / 360) * n);
}
function tileY(lat: number, n: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
}

/** The squares of a zoom that cover the view, cut to Alberta; none outside it. */
export function gridSquares(view: Bbox, z: number, max = 64): Tile[] {
  const west = Math.max(view.west, ALBERTA_BOX.west);
  const east = Math.min(view.east, ALBERTA_BOX.east);
  const south = Math.max(view.south, ALBERTA_BOX.south);
  const north = Math.min(view.north, ALBERTA_BOX.north);
  if (west >= east || south >= north) return [];
  const n = 2 ** z;
  const x0 = tileX(west, n);
  const x1 = Math.min(n - 1, tileX(east, n));
  const y0 = tileY(north, n);
  const y1 = Math.min(n - 1, tileY(south, n));
  const tiles: Tile[] = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      if (tiles.length >= max) return tiles;
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

/** Whether a square touches Alberta: the Worker asks the province for no other. */
export function squareInAlberta(tile: Tile): boolean {
  const n = 2 ** tile.z;
  const lon = (x: number) => (x / n) * 360 - 180;
  const lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return !(
    lon(tile.x + 1) <= ALBERTA_BOX.west ||
    lon(tile.x) >= ALBERTA_BOX.east ||
    lat(tile.y) <= ALBERTA_BOX.south ||
    lat(tile.y + 1) >= ALBERTA_BOX.north
  );
}

/** A shape's fields as the service sends them; anything else is left out. */
export interface GridShapeFields {
  M?: unknown;
  RGE?: unknown;
  TWP?: unknown;
  SEC?: unknown;
  QS?: unknown;
  LS?: unknown;
}

const whole = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null;

/**
 * A shape's own name, as land is written in Alberta: "T64 R18 W5" for a township, the number of
 * a section or a legal subdivision, the letters of a quarter (NE, NW, SE, SW); null when its
 * fields are not what the service sends.
 */
export function gridLabel(level: GridLevel, f: GridShapeFields): string | null {
  if (level === 'township') {
    const m = whole(f.M, 6);
    const r = whole(f.RGE, 34);
    const t = whole(f.TWP, 126);
    return m && r && t ? `T${String(t)} R${String(r)} W${String(m)}` : null;
  }
  if (level === 'section') {
    const s = whole(f.SEC, 36);
    return s ? String(s) : null;
  }
  if (level === 'quarter') {
    return typeof f.QS === 'string' && /^(NE|NW|SE|SW)$/.test(f.QS) ? f.QS : null;
  }
  const l = whole(f.LS, 16);
  return l ? String(l) : null;
}

/**
 * The key of a shape, the same whichever square it came in (a shape crossing squares comes in
 * each), so it is drawn once: its level and its place on the grid.
 */
export function gridKey(level: GridLevel, f: GridShapeFields): string | null {
  const parts = [f.M, f.RGE, f.TWP, f.SEC, f.QS, f.LS].map((v) =>
    typeof v === 'number' || typeof v === 'string' ? String(v) : '',
  );
  return gridLabel(level, f) === null ? null : `${level}:${parts.join('-')}`;
}

/**
 * The Dominion Land Survey's meridians through Alberta, the 4th being its border with
 * Saskatchewan: every land description counts its ranges west from one of them.
 */
export const GRID_MERIDIANS = [
  { meridian: 4, longitude: -110 },
  { meridian: 5, longitude: -114 },
  { meridian: 6, longitude: -118 },
] as const;
