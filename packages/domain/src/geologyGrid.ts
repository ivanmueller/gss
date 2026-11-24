/**
 * Depth and thickness maps of a formation (F-287 part 3; docs/FEATURES_OIL_GAS.md). The Alberta
 * Geological Survey's Geological Framework of Alberta, Version 4, gives each zone a grid of the
 * depth to its top from the ground and of its vertical thickness (280 m cells, NAD83 10TM). The
 * build script (scripts/build-geology-grids.js) averages both onto squares of 1,770 m in web
 * mercator, about 1 km on the ground in Alberta, so the map draws them as they are, and packs
 * them in one small file kept with the app (apps/web/public/geology/), as the formation outlines
 * are: open data (Open Government Licence – Alberta), the Survey named where it is shown.
 *
 * The file, before gzip, little-endian: "GSG1"; columns and rows (16 bits each); the west edge,
 * the north edge and the square's size in web mercator metres (64-bit floats); then every
 * square's depth in metres, then every square's thickness in tenths of a metre, as 16-bit
 * integers, the north row first, west to east, -32768 where the zone is absent.
 */

export const GEOLOGY_GRID_MAGIC = 'GSG1';
export const GEOLOGY_GRID_ABSENT = -32768;
const HEADER_BYTES = 32;
/** The earth's radius in web mercator (EPSG:3857), metres. */
const EARTH_RADIUS = 6378137;

/** The formations with depth and thickness maps: Duvernay first (the owner, 2026-11-24). */
export const GEOLOGY_MAPS = [
  {
    key: 'duvernay',
    name: 'Duvernay / Muskwa',
    // The model's zone, which joins the Duvernay and the Muskwa.
    zone: '68_D_Dv_Mu',
    // Contour lines every so many metres.
    depthEvery: 250,
    thicknessEvery: 25,
  },
] as const;

export type GeologyMapKey = (typeof GEOLOGY_MAPS)[number]['key'];
export type GeologyMeasure = 'depth' | 'thickness';

export const geologyGridUrl = (key: string) => `/geology/${key}-grid.bin`;
export const geologyContoursUrl = (key: string, measure: GeologyMeasure) =>
  `/geology/${key}-${measure}.geojson`;

export interface GeologyGrid {
  columns: number;
  rows: number;
  /** The west and north edges, web mercator metres. */
  west: number;
  north: number;
  /** A square's side, web mercator metres. */
  cell: number;
  /** Metres from the ground to the zone's top. */
  depth: Int16Array;
  /** Tenths of a metre. */
  thickness: Int16Array;
}

export function encodeGeologyGrid(grid: GeologyGrid): Uint8Array<ArrayBuffer> {
  const count = grid.columns * grid.rows;
  if (grid.depth.length !== count || grid.thickness.length !== count) {
    throw new Error('A grid holds one depth and one thickness a square.');
  }
  if (grid.columns > 0xffff || grid.rows > 0xffff) throw new Error('The grid is too large.');
  const bytes = new Uint8Array(HEADER_BYTES + count * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i += 1) bytes[i] = GEOLOGY_GRID_MAGIC.charCodeAt(i);
  view.setUint16(4, grid.columns, true);
  view.setUint16(6, grid.rows, true);
  view.setFloat64(8, grid.west, true);
  view.setFloat64(16, grid.north, true);
  view.setFloat64(24, grid.cell, true);
  for (let i = 0; i < count; i += 1) {
    view.setInt16(HEADER_BYTES + i * 2, grid.depth[i] ?? GEOLOGY_GRID_ABSENT, true);
    view.setInt16(HEADER_BYTES + (count + i) * 2, grid.thickness[i] ?? GEOLOGY_GRID_ABSENT, true);
  }
  return bytes;
}

export function decodeGeologyGrid(bytes: Uint8Array): GeologyGrid {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (bytes.byteLength < HEADER_BYTES || magic !== GEOLOGY_GRID_MAGIC) {
    throw new Error('Not a geology grid.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const columns = view.getUint16(4, true);
  const rows = view.getUint16(6, true);
  const count = columns * rows;
  if (bytes.byteLength !== HEADER_BYTES + count * 4) throw new Error('The grid is cut short.');
  const depth = new Int16Array(count);
  const thickness = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    depth[i] = view.getInt16(HEADER_BYTES + i * 2, true);
    thickness[i] = view.getInt16(HEADER_BYTES + (count + i) * 2, true);
  }
  return {
    columns,
    rows,
    west: view.getFloat64(8, true),
    north: view.getFloat64(16, true),
    cell: view.getFloat64(24, true),
    depth,
    thickness,
  };
}

export function toMercator(lon: number, lat: number): [number, number] {
  const x = (lon * Math.PI * EARTH_RADIUS) / 180;
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

export function fromMercator(x: number, y: number): [number, number] {
  const lon = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

/** The grid's corners as longitude and latitude: north-west, north-east, south-east, south-west. */
export function geologyGridCorners(grid: GeologyGrid): [number, number][] {
  const east = grid.west + grid.columns * grid.cell;
  const south = grid.north - grid.rows * grid.cell;
  return [
    fromMercator(grid.west, grid.north),
    fromMercator(east, grid.north),
    fromMercator(east, south),
    fromMercator(grid.west, south),
  ];
}

export interface GeologyAt {
  /** Metres from the ground to the zone's top. */
  depthM: number | null;
  /** Metres, to one decimal. */
  thicknessM: number | null;
}

/** The depth and thickness in the square under a place; null outside the grid or the zone. */
export function geologyAt(grid: GeologyGrid, lon: number, lat: number): GeologyAt | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) >= 85) return null;
  const [x, y] = toMercator(lon, lat);
  const column = Math.floor((x - grid.west) / grid.cell);
  const row = Math.floor((grid.north - y) / grid.cell);
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return null;
  const i = row * grid.columns + column;
  const depth = grid.depth[i] ?? GEOLOGY_GRID_ABSENT;
  const thickness = grid.thickness[i] ?? GEOLOGY_GRID_ABSENT;
  if (depth === GEOLOGY_GRID_ABSENT && thickness === GEOLOGY_GRID_ABSENT) return null;
  return {
    depthM: depth === GEOLOGY_GRID_ABSENT ? null : depth,
    thicknessM: thickness === GEOLOGY_GRID_ABSENT ? null : thickness / 10,
  };
}

/** A measure's values in metres, absent squares as NaN. */
export function geologyValues(grid: GeologyGrid, measure: GeologyMeasure): Float32Array {
  const raw = measure === 'depth' ? grid.depth : grid.thickness;
  const scale = measure === 'depth' ? 1 : 10;
  const values = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i] ?? GEOLOGY_GRID_ABSENT;
    values[i] = value === GEOLOGY_GRID_ABSENT ? Number.NaN : value / scale;
  }
  return values;
}

/**
 * The range a legend shows: the lowest and highest value, widened to whole steps of `every`
 * metres; null for a grid with no value.
 */
export function geologyRange(values: Float32Array, every: number): [number, number] | null {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (Number.isNaN(value)) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (low === Infinity) return null;
  const from = Math.floor(low / every) * every;
  const to = Math.max(Math.ceil(high / every) * every, from + every);
  return [from, to];
}
