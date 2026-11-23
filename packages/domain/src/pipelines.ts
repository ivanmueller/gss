// Pipelines (F-249): the Alberta Energy Regulator's pipeline file as a shapefile
// (https://static.aer.ca/prd/data/pipeline/Pipelines_SHP.zip, Pipelines_GCS_NAD83.shp and .dbf;
// its layout https://static.aer.ca/prd/data/pipeline/EnhancedPipeline_Layout.pdf, June 2025), read
// by the manual "Load pipelines" workflow and drawn on the oil and gas map square by square: the
// large lines from farther out, every line close in.

// Types only from the other files: the loader runs this file in Node as it is, which cannot
// resolve an import of another file's values without its extension.
import type { Bbox } from './geo';
import type { Tile } from './mapLayers';

/** The segment statuses as the AER writes them, in the order the map lists them. */
export const PIPELINE_STATUSES = [
  'Operating',
  'Permitted',
  'Discontinued',
  'Abandoned',
  'Removed',
] as const;

/**
 * What the map colours a line by: its first substance, grouped as the AER's layout groups them
 * (the "highest priority substance" when a line carries several).
 */
export const PIPELINE_SUBSTANCES = [
  { key: 'gas', name: 'Natural gas' },
  { key: 'sour_gas', name: 'Sour natural gas' },
  { key: 'effluent', name: 'Oil-well effluent' },
  { key: 'crude', name: 'Crude oil' },
  { key: 'products', name: 'HVP and LVP products' },
  { key: 'water', name: 'Water' },
  { key: 'other', name: 'Other' },
] as const;
export type PipelineSubstance = (typeof PIPELINE_SUBSTANCES)[number]['key'];

const SUBSTANCE_GROUPS: Record<string, PipelineSubstance> = {
  'natural gas': 'gas',
  'fuel gas': 'gas',
  'sour natural gas': 'sour_gas',
  'oil-well effluent': 'effluent',
  'crude oil': 'crude',
  'hvp products': 'products',
  'lvp products': 'products',
  ethylene: 'products',
  ethane: 'products',
  'liquid ethane': 'products',
  propane: 'products',
  butane: 'products',
  pentanes: 'products',
  condensate: 'products',
  'diesel fuel': 'products',
  kerosene: 'products',
  'hydrocarbon diluents': 'products',
  solvents: 'products',
  'hv other': 'products',
  'salt water': 'water',
  'fresh water': 'water',
};

/**
 * A substance's group, by the names in the file (read 2026-11-22): natural and fuel gas; sour
 * natural gas; oil-well effluent; crude oil; high and low vapour pressure products (ethane,
 * propane, butane, condensate, diluents ...); salt and fresh water; anything else other (air,
 * nitrogen, steam, carbon dioxide, hydrogen, glycol, polymer ...).
 */
export function pipelineSubstanceOf(substance: string | null): PipelineSubstance {
  return SUBSTANCE_GROUPS[(substance ?? '').trim().toLowerCase()] ?? 'other';
}

/** The fields of the file the loader reads; the others are left in the file. */
export const PIPELINE_FIELDS = [
  'LICENCE_NO',
  'IS_NEB',
  'LINE_NO',
  'PLLICSEGID',
  'COMP_NAME',
  'BA_CODE',
  'SEG_LENGTH',
  'SEG_STATUS',
  'FROM_FAC',
  'FROM_LOC',
  'TO_FAC',
  'TO_LOC',
  'H2S_CONT',
  'OUT_DIAMET',
  'WALL_THICK',
  'PIPE_TYPE',
  'PIPE_GRADE',
  'PIP_MATERL',
  'PIPE_MAOP',
  'FLD_CTR_NM',
  'SUBSTANCE1',
  'SUBSTANCE2',
  'SUBSTANCE3',
  'LICAPPDATE',
  'LAST_OCCYR',
  'GEOM_SRCE',
] as const;

/** A line in parts, each part its points as longitude and latitude. */
export type PipelineParts = [number, number][][];

/** One segment as the loader keeps it. */
export interface PipelineRow {
  segmentId: string | null;
  licenceNumber: string;
  lineNumber: string | null;
  /** In the National Energy Board's 80000 series, as the AER marks it. */
  federal: boolean;
  licenseeCode: string | null;
  licensee: string | null;
  status: string | null;
  substances: string[];
  fromFacility: string | null;
  fromLocation: string | null;
  toFacility: string | null;
  toLocation: string | null;
  lengthKm: number | null;
  diameterMm: number | null;
  wallMm: number | null;
  material: string | null;
  pipeType: string | null;
  pipeGrade: string | null;
  /** As the AER lists them: its layout names no unit for either. */
  maxPressure: number | null;
  h2s: number | null;
  fieldCentre: string | null;
  /** YYYY-MM-DD. */
  licenceApproved: string | null;
  lastOccurrenceYear: number | null;
  geometrySource: string | null;
  parts: PipelineParts;
  bounds: Bbox;
}

/** Alberta, a little wide, as the database checks it. */
const ALBERTA = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };

/** A segment's line keeps its shape to within this many metres. */
export const PIPELINE_SIMPLIFY_M = 3;

function text(value: string | undefined, max: number): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : v.slice(0, max);
}

/** A non-negative number as the file writes it, below `max`; null otherwise. */
function amount(value: string | undefined, max: number): number | null {
  const v = (value ?? '').trim();
  if (!/^\d{1,9}(\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) && n < max ? n : null;
}

/** A dBASE date (YYYYMMDD) as YYYY-MM-DD, or null. */
function day(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y ?? ''}-${mo ?? ''}-${d ?? ''}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== `${y ?? ''}-${mo ?? ''}-${d ?? ''}`
    ? null
    : `${y ?? ''}-${mo ?? ''}-${d ?? ''}`;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * The line without the points that lie within `metres` of the line through their neighbours
 * (Douglas–Peucker on a flat earth at the line's first point, as st37Simplify does for the
 * drilled paths); the ends always stay.
 */
export function thinLine(line: [number, number][], metres: number): [number, number][] {
  const first = line[0];
  if (line.length <= 2 || !first) return line;
  const kx = 111_320 * Math.cos((first[1] * Math.PI) / 180);
  const xs = line.map(([lon]) => (lon - first[0]) * kx);
  const ys = line.map(([, lat]) => (lat - first[1]) * 110_574);
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  for (let span = stack.pop(); span; span = stack.pop()) {
    const [from, to] = span;
    const ax = xs[from] ?? 0;
    const ay = ys[from] ?? 0;
    const bx = xs[to] ?? 0;
    const by = ys[to] ?? 0;
    const length = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let most = metres;
    for (let i = from + 1; i < to; i += 1) {
      const px = xs[i] ?? 0;
      const py = ys[i] ?? 0;
      const distance =
        length === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > most) {
        most = distance;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([from, worst], [worst, to]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}

/**
 * The parts thinned to `metres` and rounded to five decimals (about a metre), with points that
 * fall together after rounding kept once; a part left with fewer than two points is dropped.
 */
export function thinParts(parts: PipelineParts, metres: number): PipelineParts {
  const out: PipelineParts = [];
  for (const part of parts) {
    const thin = metres > 0 ? thinLine(part, metres) : part;
    const kept: [number, number][] = [];
    for (const [lon, lat] of thin) {
      const point: [number, number] = [round5(lon), round5(lat)];
      const last = kept.at(-1);
      if (last?.[0] !== point[0] || last[1] !== point[1]) kept.push(point);
    }
    if (kept.length >= 2) out.push(kept);
  }
  return out;
}

/** The box around a line's parts; null for none. */
export function partsBounds(parts: PipelineParts): Bbox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const part of parts) {
    for (const [lon, lat] of part) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

/**
 * One segment from a record of the file and its line; null when the record is not one the
 * database would take (no licence number, no line in Alberta). Text past a column's length is
 * cut; a code or number not in the AER's form is left empty.
 */
export function pipelineRow(
  record: Readonly<Record<string, string>>,
  parts: PipelineParts | null,
): PipelineRow | null {
  const licenceNumber = (record.LICENCE_NO ?? '').trim();
  if (!/^[0-9A-Z]{1,9}$/.test(licenceNumber) || parts === null) return null;
  const thin = thinParts(parts, PIPELINE_SIMPLIFY_M);
  const bounds = partsBounds(thin);
  if (
    bounds === null ||
    bounds.west < ALBERTA.west ||
    bounds.east > ALBERTA.east ||
    bounds.south < ALBERTA.south ||
    bounds.north > ALBERTA.north
  ) {
    return null;
  }
  const line = (record.LINE_NO ?? '').trim();
  const segment = (record.PLLICSEGID ?? '').trim();
  const code = (record.BA_CODE ?? '').trim();
  const year = (record.LAST_OCCYR ?? '').trim();
  const substances = [record.SUBSTANCE1, record.SUBSTANCE2, record.SUBSTANCE3]
    .map((s) => text(s, 30))
    .filter((s): s is string => s !== null);
  return {
    segmentId: /^\d{1,12}$/.test(segment) ? segment : null,
    licenceNumber,
    lineNumber: /^[0-9A-Z]{1,10}$/.test(line) ? line : null,
    federal: (record.IS_NEB ?? '').trim().toUpperCase() === 'Y',
    licenseeCode: /^[0-9A-Z]{4}$/.test(code) ? code : null,
    licensee: text(record.COMP_NAME, 60),
    status: text(record.SEG_STATUS, 20),
    substances,
    fromFacility: text(record.FROM_FAC, 30),
    fromLocation: text(record.FROM_LOC, 25),
    toFacility: text(record.TO_FAC, 30),
    toLocation: text(record.TO_LOC, 25),
    lengthKm: amount(record.SEG_LENGTH, 10_000),
    diameterMm: amount(record.OUT_DIAMET, 10_000),
    wallMm: amount(record.WALL_THICK, 1_000),
    material: text(record.PIP_MATERL, 40),
    pipeType: text(record.PIPE_TYPE, 30),
    pipeGrade: text(record.PIPE_GRADE, 40),
    maxPressure: amount(record.PIPE_MAOP, 1_000_000),
    h2s: amount(record.H2S_CONT, 1_000_000),
    fieldCentre: text(record.FLD_CTR_NM, 40),
    licenceApproved: day(record.LICAPPDATE),
    lastOccurrenceYear: /^\d{4}$/.test(year) ? Number(year) : null,
    geometrySource: text(record.GEOM_SRCE, 50),
    parts: thin,
    bounds,
  };
}

/** Hundred-thousandths of a degree: how the database keeps a line's points. */
export const PIPELINE_UNITS = 1e5;

/**
 * A line as the database keeps it: every point's longitude and latitude in turn as whole
 * hundred-thousandths of a degree, and the points where a new part starts.
 */
export function encodeParts(parts: PipelineParts): { path: number[]; breaks: number[] } {
  const path: number[] = [];
  const breaks: number[] = [];
  for (const part of parts) {
    if (path.length > 0) breaks.push(path.length / 2);
    for (const [lon, lat] of part) {
      path.push(Math.round(lon * PIPELINE_UNITS), Math.round(lat * PIPELINE_UNITS));
    }
  }
  return { path, breaks };
}

/** A line's parts from the database's form (encodeParts); a part of one point is dropped. */
export function decodeParts(path: readonly number[], breaks: readonly number[]): PipelineParts {
  const points = Math.floor(path.length / 2);
  const starts = [0, ...breaks.filter((b) => b > 0 && b < points).sort((a, b) => a - b), points];
  const parts: PipelineParts = [];
  for (let k = 0; k + 1 < starts.length; k += 1) {
    const part: [number, number][] = [];
    for (let i = starts[k] ?? 0; i < (starts[k + 1] ?? 0); i += 1) {
      part.push([(path[2 * i] ?? 0) / PIPELINE_UNITS, (path[2 * i + 1] ?? 0) / PIPELINE_UNITS]);
    }
    if (part.length >= 2) parts.push(part);
  }
  return parts;
}

/** A shapefile of lines (type 3) read a record at a time. */
export interface ShapefileLines {
  count: number;
  /** Record `n`'s box (west, south, east, north); null for an empty shape. */
  bounds(n: number): Bbox | null;
  /** Record `n`'s parts; null for an empty shape. */
  parts(n: number): PipelineParts | null;
}

export function shapefileLines(bytes: Uint8Array): ShapefileLines {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 100 || view.getInt32(0, false) !== 9994) {
    throw new Error('not a shapefile');
  }
  if (view.getInt32(32, true) !== 3) throw new Error('not a shapefile of lines');
  const starts: number[] = [];
  let at = 100;
  while (at + 8 <= bytes.byteLength) {
    const length = view.getInt32(at + 4, false) * 2;
    const start = at + 8;
    if (start + length > bytes.byteLength || length < 4) throw new Error('a record is cut short');
    starts.push(start);
    at = start + length;
  }
  const isLine = (n: number) => {
    const start = starts[n];
    return start !== undefined && view.getInt32(start, true) === 3;
  };
  return {
    count: starts.length,
    bounds(n) {
      if (!isLine(n)) return null;
      const s = starts[n] ?? 0;
      return {
        west: view.getFloat64(s + 4, true),
        south: view.getFloat64(s + 12, true),
        east: view.getFloat64(s + 20, true),
        north: view.getFloat64(s + 28, true),
      };
    },
    parts(n) {
      if (!isLine(n)) return null;
      const s = starts[n] ?? 0;
      const count = view.getInt32(s + 36, true);
      const points = view.getInt32(s + 40, true);
      const first = s + 44 + 4 * count;
      if (count < 1 || points < 2 || first + 16 * points > bytes.byteLength) return null;
      const parts: PipelineParts = [];
      for (let p = 0; p < count; p += 1) {
        const from = view.getInt32(s + 44 + 4 * p, true);
        const to = p + 1 < count ? view.getInt32(s + 48 + 4 * p, true) : points;
        if (from < 0 || to > points || from >= to) return null;
        const part: [number, number][] = [];
        for (let i = from; i < to; i += 1) {
          part.push([
            view.getFloat64(first + 16 * i, true),
            view.getFloat64(first + 16 * i + 8, true),
          ]);
        }
        parts.push(part);
      }
      return parts;
    },
  };
}

/**
 * The two ways the map asks for pipelines, square by square: the large lines, outside diameter
 * 219.1 mm (8-inch pipe) and up, from about the 10 km distance bar, in large squares and thinned
 * further; every line from about the 2 km bar, in smaller squares.
 */
export const PIPELINE_LEVELS = {
  main: { squareZoom: 8, from: 7.8, minDiameterMm: 219.1, simplifyM: 40 },
  all: { squareZoom: 10, from: 10, minDiameterMm: 0, simplifyM: 0 },
} as const;
export type PipelineLevel = keyof typeof PIPELINE_LEVELS;

/** The level a map at this zoom asks for; null farther out. */
export function pipelineLevelAt(zoom: number): PipelineLevel | null {
  if (zoom >= PIPELINE_LEVELS.all.from) return 'all';
  if (zoom >= PIPELINE_LEVELS.main.from) return 'main';
  return null;
}

/** The level a square's zoom belongs to; null for a zoom neither asks at. */
export function pipelineLevelOfSquare(tile: Tile): PipelineLevel | null {
  if (tile.z === PIPELINE_LEVELS.all.squareZoom) return 'all';
  if (tile.z === PIPELINE_LEVELS.main.squareZoom) return 'main';
  return null;
}
