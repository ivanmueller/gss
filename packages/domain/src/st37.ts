/**
 * Alberta's wells from the AER's ST37 list (F-243 part 4, docs/FEATURES_OIL_GAS.md): the four
 * layers of its geodatabase (surface holes, bottom holes, production strings and drilled paths),
 * cut to an area and turned into one row per well (per UWI, so each leg of a multi-leg well is
 * its own row), ready to load. Data from the AER, used on the owner's decision
 * (docs/DECISIONS.md, 2026-11-19): members only, never exported.
 *
 * Kept free of imports and of TypeScript-only syntax, so the manual loader
 * (scripts/load-st37.js) can run it with Node's type stripping.
 */

/** What the map colours wells by, in the legend's order. */
export const ST37_STATUS_CLASSES = [
  'producing',
  'awaiting',
  'drilling',
  'inactive',
  'suspended',
  'abandoned',
  'licensed',
] as const;
export type St37StatusClass = (typeof ST37_STATUS_CLASSES)[number];

export const ST37_STATUS_LABELS: Record<St37StatusClass, string> = {
  producing: 'Producing or injecting',
  awaiting: 'Drilled, awaiting production',
  drilling: 'Drilling or completing',
  inactive: 'Closed, not suspended',
  suspended: 'Suspended',
  abandoned: 'Abandoned',
  licensed: 'Licensed, not drilled',
};

/**
 * The AER's status modes (the two digits after the fluid in its status code), as the province's
 * well service words them (read 2026-11-19 from its "Well Surface" layer): 01 Suspended,
 * 02 Abandon, 03 Abandon Zone, 04 Abandoned Reentered, 06 Potential, 07 Drilled and Cased,
 * 08 Junked and Abandoned, 09 Closed, 10 Flow, 11 Pumping, 12 Gas Lift, 13 Testing,
 * 14 Abandoned Whipstock, 15 Drilling and Completing, 16 Test Completed, 17 Preset.
 */
const MODE_CLASS: Record<string, St37StatusClass> = {
  '01': 'suspended',
  '02': 'abandoned',
  '03': 'abandoned',
  '04': 'abandoned',
  '06': 'awaiting',
  '07': 'awaiting',
  '08': 'abandoned',
  '09': 'inactive',
  '10': 'producing',
  '11': 'producing',
  '12': 'producing',
  '13': 'awaiting',
  '14': 'abandoned',
  '15': 'drilling',
  '16': 'awaiting',
  '17': 'awaiting',
};

/** Licence statuses that mean the well is gone: abandoned, or its site reclaimed. */
const ENDED_LICENCES = new Set(['abandoned', 'reccertified', 'recexempt', 'cancelled']);

export interface St37StatusInput {
  licenceStatus: string | null;
  spudDate: string | null;
  finalDrillDate: string | null;
  /** The two-digit status mode, or null when the well has no production string. */
  mode: string | null;
  /** The status type in words (Injection, Disposal, Storage…), or null. */
  type: string | null;
}

/** Which of the map's statuses a well is shown in. */
export function st37StatusClass(input: St37StatusInput): St37StatusClass {
  const licence = (input.licenceStatus ?? '').toLowerCase();
  if (ENDED_LICENCES.has(licence)) return 'abandoned';
  if (input.mode !== null) {
    const byMode = MODE_CLASS[input.mode];
    if (byMode) return byMode;
    // Mode 00 on an injection, disposal or storage well: a service well in use.
    if (input.mode === '00' && input.type !== null) return 'producing';
  }
  if (licence === 'suspension') return 'suspended';
  if (input.spudDate === null) return 'licensed';
  if (input.finalDrillDate === null) return 'drilling';
  return 'awaiting';
}

/** When a well has several production strings, the one the map shows: the most active. */
const CLASS_RANK: Record<St37StatusClass, number> = {
  producing: 0,
  drilling: 1,
  awaiting: 2,
  inactive: 3,
  suspended: 4,
  abandoned: 5,
  licensed: 6,
};

export interface St37Area {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A GeoJSON feature as ogr2ogr writes it: properties, and a geometry or null. */
export interface St37Feature {
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown } | null;
}

export interface St37Layers {
  surface: readonly St37Feature[];
  bottom: readonly St37Feature[];
  strings: readonly St37Feature[];
  paths: readonly St37Feature[];
}

export interface St37Well {
  uwi: string;
  licenceNumber: string;
  wellName: string | null;
  licensee: string | null;
  licenceStatus: string | null;
  statusClass: St37StatusClass;
  statusFluid: string | null;
  statusMode: string | null;
  statusType: string | null;
  poolCode: number | null;
  spudDate: string | null;
  finalDrillDate: string | null;
  totalDepthM: number | null;
  trueVerticalDepthM: number | null;
  surface: [number, number];
  bottom: [number, number];
  /** The drilled path from the surface down, or null when it runs less than 20 m sideways. */
  path: [number, number][] | null;
  /** What the licence planned (Petrinex's Well Licence file), when the load read it. */
  licenceDate: string | null;
  plannedOperation: string | null;
  plannedFormation: string | null;
  plannedDepthM: number | null;
  /**
   * For a well with no drilled path yet: the planned bottom hole, the legal subdivision in its
   * UWI placed from the township grid (set by the loader, `st37PlanBottoms`); null otherwise.
   */
  plannedBottom: [number, number] | null;
}

export const ST37_UWI = /^[0-9A-Z]{2}\/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]\/[0-9A-Z]$/;
/** A path shorter than this sideways is drawn as a dot (a vertical well). */
export const ST37_MIN_REACH_M = 20;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed === '' || trimmed.toLowerCase() === 'not applicable') return null;
  return trimmed.slice(0, max);
}

/** CRUDE OIL → Crude oil; words the AER writes in capitals, in sentence case. */
function words(value: unknown, max: number): string | null {
  const t = text(value, max);
  if (t === null) return null;
  if (t !== t.toUpperCase()) return t;
  const lower = t.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e6
    ? Math.round(value * 100) / 100
    : null;
}

/**
 * A date in any of the forms the layers use (20230903, 09/03/2023, 2023-09-03T00:00:00Z), as
 * YYYY-MM-DD, or null.
 */
export function st37Date(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  let y: string;
  let m: string;
  let d: string;
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (match) [, y, m, d] = match as unknown as [string, string, string, string];
  else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v)))
    [, m, d, y] = match as unknown as [string, string, string, string];
  else if ((match = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)))
    [, y, m, d] = match as unknown as [string, string, string, string];
  else return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() < 1880 ||
    date.getUTCMonth() !== Number(m) - 1
  ) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

function inAlberta(lon: number, lat: number): boolean {
  return lon >= -120.1 && lon <= -109.9 && lat >= 48.9 && lat <= 60.1;
}

function point(lon: unknown, lat: unknown): [number, number] | null {
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inAlberta(lon, lat)) return null;
  return [round6(lon), round6(lat)];
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function pointOf(feature: St37Feature): [number, number] | null {
  const g = feature.geometry;
  if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates as unknown[];
  return point(lon, lat);
}

/** The path's vertices, from the surface down, without repeats; null when unusable. */
function lineOf(feature: St37Feature): [number, number][] | null {
  const g = feature.geometry;
  if (!g || !Array.isArray(g.coordinates)) return null;
  const parts =
    g.type === 'LineString'
      ? [g.coordinates as unknown[]]
      : g.type === 'MultiLineString'
        ? (g.coordinates as unknown[][])
        : null;
  if (!parts) return null;
  const out: [number, number][] = [];
  for (const part of parts) {
    if (!Array.isArray(part)) return null;
    for (const vertex of part) {
      if (!Array.isArray(vertex)) return null;
      const p = point(vertex[0], vertex[1]);
      if (!p) return null;
      const last = out[out.length - 1];
      if (last?.[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
  }
  return out.length >= 2 ? st37Simplify(out, ST37_SIMPLIFY_M) : null;
}

/** A drilled path keeps its shape to within this many metres (the map never shows less). */
export const ST37_SIMPLIFY_M = 2;

/**
 * The line without the vertices that lie within `tolerance` metres of the line through their
 * neighbours (Douglas–Peucker, flat-earth, fine at a well's scale); the ends always stay.
 */
export function st37Simplify(line: [number, number][], tolerance: number): [number, number][] {
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
    let most = tolerance;
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

/** The farthest any vertex lies from the first, in metres (flat-earth, fine at this scale). */
export function st37Reach(path: readonly (readonly [number, number])[]): number {
  const first = path[0];
  if (!first) return 0;
  const kx = 111_320 * Math.cos((first[1] * Math.PI) / 180);
  let most = 0;
  for (const [lon, lat] of path) {
    const dx = (lon - first[0]) * kx;
    const dy = (lat - first[1]) * 110_574;
    most = Math.max(most, Math.hypot(dx, dy));
  }
  return most;
}

function inArea(p: readonly [number, number], area: St37Area): boolean {
  return p[0] >= area.west && p[0] <= area.east && p[1] >= area.south && p[1] <= area.north;
}

function licenceOf(value: unknown): string | null {
  const t = typeof value === 'string' ? value.trim() : null;
  return t && /^[0-9A-Z]{1,9}$/.test(t) ? t : null;
}

/**
 * One row per well whose surface or bottom hole lies in the area. A well is the bottom-hole
 * record of a UWI; its surface location comes from its licence's surface hole, its status from
 * its production string (the most active when it has several), its path from the drilled path
 * of the same UWI. Records that cannot be read are counted in `skipped`, never guessed.
 */
export function buildSt37Wells(
  layers: St37Layers,
  area: St37Area,
  licences: ReadonlyMap<string, St37Licence> = new Map(),
): { wells: St37Well[]; skipped: number } {
  const surfaceByLicence = new Map<string, [number, number]>();
  for (const f of layers.surface) {
    const p = f.properties ?? {};
    const licence = licenceOf(p.Well_Licence_Number);
    const at = point(p.SH_Actual_Longitude, p.SH_Actual_Latitude) ?? pointOf(f);
    if (licence && at && !surfaceByLicence.has(licence)) surfaceByLicence.set(licence, at);
  }

  const pathByUwi = new Map<string, [number, number][]>();
  for (const f of layers.paths) {
    const uwi = text(f.properties?.UWI_Label, 30);
    const line = lineOf(f);
    if (uwi && line && !pathByUwi.has(uwi)) pathByUwi.set(uwi, line);
  }

  interface Strung {
    mode: string | null;
    type: string | null;
    fluid: string | null;
    pool: number | null;
  }
  const stringsByUwi = new Map<string, Strung[]>();
  for (const f of layers.strings) {
    const p = f.properties ?? {};
    const uwi = text(p.Prod_String_UWI, 30);
    if (!uwi) continue;
    const rawMode = typeof p.Status_Mode === 'string' ? p.Status_Mode.trim() : '';
    const mode = /^\d{1,2}$/.test(rawMode) ? rawMode.padStart(2, '0') : null;
    const pool =
      typeof p.Pool_Code === 'number' && Number.isInteger(p.Pool_Code) ? p.Pool_Code : null;
    const list = stringsByUwi.get(uwi) ?? [];
    list.push({
      mode,
      type: words(p.Status_Type, 60),
      fluid: words(p.Status_Fluid, 60),
      pool,
    });
    stringsByUwi.set(uwi, list);
  }

  const wells: St37Well[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const f of layers.bottom) {
    const p = f.properties ?? {};
    const uwi = text(p.Well_UWI, 30);
    const licence = licenceOf(p.Well_Licence_Number);
    const bottom = point(p.BH_Longitude, p.BH_Latitude) ?? pointOf(f);
    if (!uwi || !ST37_UWI.test(uwi) || !licence || !bottom || seen.has(uwi)) {
      skipped += 1;
      continue;
    }
    const line = pathByUwi.get(uwi) ?? null;
    const surface = surfaceByLicence.get(licence) ?? line?.[0] ?? bottom;
    if (!inArea(surface, area) && !inArea(bottom, area)) continue;
    seen.add(uwi);

    const licenceStatus = text(p.Licence_Status, 20);
    const spudDate = st37Date(p.Spud_Date);
    const finalDrillDate = st37Date(p.Final_Drill_Date);
    const classify = (s: Strung | null) =>
      st37StatusClass({
        licenceStatus,
        spudDate,
        finalDrillDate,
        mode: s?.mode ?? null,
        type: s?.type ?? null,
      });
    let chosen: Strung | null = null;
    let statusClass = classify(null);
    for (const s of stringsByUwi.get(uwi) ?? []) {
      const c = classify(s);
      if (chosen === null || CLASS_RANK[c] < CLASS_RANK[statusClass]) {
        chosen = s;
        statusClass = c;
      }
    }

    wells.push({
      uwi,
      licenceNumber: licence,
      wellName: text(p.Well_Name, 60),
      licensee: text(p.Licensee, 100),
      licenceStatus,
      statusClass,
      statusFluid: chosen?.fluid ?? null,
      statusMode: chosen?.mode ?? null,
      statusType: chosen?.type ?? null,
      poolCode: chosen?.pool ?? null,
      spudDate,
      finalDrillDate,
      totalDepthM: positive(p.Final_Total_Depth),
      trueVerticalDepthM: positive(p.Max_True_Vertical_Depth),
      surface,
      bottom,
      path: line && st37Reach(line) >= ST37_MIN_REACH_M ? line : null,
      licenceDate: licences.get(licence)?.licenceDate ?? null,
      plannedOperation: licences.get(licence)?.operation ?? null,
      plannedFormation: licences.get(licence)?.formation ?? null,
      plannedDepthM: licences.get(licence)?.depthM ?? null,
      plannedBottom: null,
    });
  }
  return { wells, skipped };
}

/**
 * One formation loaded whole (F-252, docs/FEATURES_OIL_GAS.md): which wells belong to it. A
 * well belongs when one of its production strings is in one of the formation's pools (the AER's
 * pool code is a four-digit formation code followed by the pool's number: ST103, read
 * 2026-11-20), or when its licence aims at the formation (Petrinex's public Well Licence file,
 * its "ProjectedFormation"), which is the only way to tell for a well not yet drilled.
 */
export interface St37Formation {
  key: string;
  name: string;
  /** The pool codes of the formation, first and last, as ST37 writes them (numbers). */
  poolFrom: number;
  poolTo: number;
  /** The formation as Petrinex's Well Licence file names it. */
  petrinexFormation: string;
}

export const ST37_FORMATIONS: Record<string, St37Formation> = {
  // The AER's formation codes 7280 to 7288 (ST103's formation list, read 2026-11-20).
  duvernay: {
    key: 'duvernay',
    name: 'Duvernay',
    poolFrom: 728000,
    poolTo: 728899,
    petrinexFormation: 'DUVERNAY FM',
  },
};

/** What a licence planned, from Petrinex's Well Licence file. */
export interface St37Licence {
  licenceDate: string | null;
  operation: string | null;
  formation: string | null;
  depthM: number | null;
}

/** One line of a CSV file as its fields (quotes doubled inside quoted fields). */
export function st37CsvFields(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (line.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** DUVERNAY FM → Duvernay Fm: a formation's name as Petrinex writes it, in title case. */
function titleCase(value: unknown): string | null {
  const t = text(value, 60);
  if (t === null) return null;
  return t
    .toLowerCase()
    .replace(
      /(^|[\s(/-])([a-z])/g,
      (_, before: string, letter: string) => before + letter.toUpperCase(),
    );
}

/**
 * The licences aimed at a formation, from Petrinex's Well Licence file (CSV, one line a
 * licence): every well licence whose projected formation is the formation's and which was not
 * cancelled, by licence number. Throws when the file is not the one expected.
 */
export function st37FormationLicences(
  csv: string,
  formation: St37Formation,
): Map<string, St37Licence> {
  const lines = csv.split(/\r?\n/);
  const head = lines[0] ?? '';
  const header = st37CsvFields(head.charCodeAt(0) === 0xfeff ? head.slice(1) : head);
  const column = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Petrinex's Well Licence file has no ${name} column`);
    return i;
  };
  const cType = column('LicenceType');
  const cNumber = column('LicenceNumber');
  const cIssued = column('LicenceIssueDate');
  const cStatus = column('LicenceStatus');
  const cOperation = column('DrillingOperationType');
  const cProjected = column('ProjectedFormation');
  const cDepth = column('ProjectedTotalDepth');
  const out = new Map<string, St37Licence>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    // A cheap test first: the file has half a million lines.
    if (!line?.includes(formation.petrinexFormation)) continue;
    const f = st37CsvFields(line);
    if (f[cType] !== 'WELL' || (f[cProjected] ?? '').trim() !== formation.petrinexFormation) {
      continue;
    }
    if ((f[cStatus] ?? '').trim().toLowerCase() === 'cancelled') continue;
    const licence = licenceOf(f[cNumber]);
    if (!licence) continue;
    out.set(licence, {
      licenceDate: st37Date(f[cIssued]),
      operation: words(f[cOperation], 20),
      formation: titleCase(f[cProjected]),
      depthM: (f[cDepth] ?? '').trim() === '' ? null : positive(Number(f[cDepth])),
    });
  }
  return out;
}

/** A legal subdivision of the Alberta Township System. */
export interface St37Lsd {
  meridian: number;
  range: number;
  township: number;
  section: number;
  lsd: number;
}

/** The legal subdivision written in a UWI (00/01-29-049-26W4/0: LSD 1 of 29-049-26W4), or null. */
export function st37UwiLsd(uwi: string): St37Lsd | null {
  const m = /^[0-9A-Z]{2}\/(\d{2})-(\d{2})-(\d{3})-(\d{2})W([4-6])\/[0-9A-Z]$/.exec(uwi);
  if (!m) return null;
  const [lsd, section, township, range, meridian] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (lsd < 1 || lsd > 16 || section < 1 || section > 36) return null;
  if (township < 1 || township > 126 || range < 1 || range > 34) return null;
  return { meridian, range, township, section, lsd };
}

export function st37LsdKey(s: St37Lsd): string {
  return [s.meridian, s.range, s.township, s.section, s.lsd].map(String).join('-');
}

/** A planned line shorter than this is not drawn: the well ends about where it starts. */
export const ST37_MIN_PLAN_M = 300;

/**
 * Whether a well gets a planned line: licensed or being drilled, no drilled path yet, its
 * bottom hole still given at its surface location, and not licensed as a vertical well.
 */
export function st37NeedsPlan(well: St37Well): boolean {
  return (
    (well.statusClass === 'licensed' || well.statusClass === 'drilling') &&
    well.path === null &&
    well.plannedOperation !== 'Vertical' &&
    st37Reach([well.surface, well.bottom]) < ST37_MIN_REACH_M &&
    st37UwiLsd(well.uwi) !== null
  );
}

/**
 * The centre of each legal subdivision in the township grid's answer (GeoJSON from the
 * province's service, fields M, RGE, TWP, SEC, LS): the middle of its largest ring's box, by
 * `st37LsdKey`. Good to a few tens of metres, enough for a line that only shows a plan.
 */
export function st37LsdCentres(body: unknown): Map<string, [number, number]> {
  const features =
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { features?: unknown }).features)
      ? (body as { features: unknown[] }).features
      : null;
  if (features === null) throw new Error('township grid answer malformed');
  const out = new Map<string, [number, number]>();
  const size = new Map<string, number>();
  for (const feature of features) {
    const f = feature as {
      properties?: Record<string, unknown> | null;
      geometry?: { type?: string; coordinates?: unknown } | null;
    } | null;
    const p = f?.properties ?? {};
    const key = [p.M, p.RGE, p.TWP, p.SEC, p.LS].map((n) => String(Number(n))).join('-');
    const g = f?.geometry;
    const polygons =
      g?.type === 'Polygon'
        ? [g.coordinates as unknown[]]
        : g?.type === 'MultiPolygon'
          ? (g.coordinates as unknown[][])
          : [];
    for (const polygon of polygons) {
      const ring = Array.isArray(polygon) ? polygon[0] : null;
      if (!Array.isArray(ring) || ring.length < 4) continue;
      let west = Infinity;
      let east = -Infinity;
      let south = Infinity;
      let north = -Infinity;
      for (const vertex of ring as unknown[]) {
        if (!Array.isArray(vertex)) continue;
        const [lon, lat] = vertex as unknown[];
        if (typeof lon !== 'number' || typeof lat !== 'number') continue;
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
      const centre = point((west + east) / 2, (south + north) / 2);
      const area = (east - west) * (north - south);
      if (centre && area > (size.get(key) ?? 0)) {
        out.set(key, centre);
        size.set(key, area);
      }
    }
  }
  return out;
}

/**
 * Sets the planned bottom hole of each well that needs one (`st37NeedsPlan`) from the centres
 * of the subdivisions in their UWIs; a well whose subdivision was not found, or lies less than
 * 300 m from its surface hole, gets none. Returns how many were set.
 */
export function st37PlanBottoms(
  wells: St37Well[],
  centres: ReadonlyMap<string, [number, number]>,
): number {
  let planned = 0;
  for (const well of wells) {
    if (!st37NeedsPlan(well)) continue;
    const lsd = st37UwiLsd(well.uwi);
    const centre = lsd ? centres.get(st37LsdKey(lsd)) : undefined;
    if (!centre || st37Reach([well.surface, centre]) < ST37_MIN_PLAN_M) continue;
    well.plannedBottom = centre;
    planned += 1;
  }
  return planned;
}
