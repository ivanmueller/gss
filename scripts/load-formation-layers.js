#!/usr/bin/env node
// Writes the SQL that loads the layers of the ground around the wells into the oil and gas
// database (F-261 part 2); run by .github/workflows/load-formation-layers.yml, "Load formation
// layers".
//
// The Alberta Geological Survey's Geological Framework of Alberta, Version 4, gives each of its
// 90 zones a grid of the elevation of its top and of its base (500 m cells, NAD83 10TM). The
// workflow cuts every grid onto our lattice (a cell every 0.016° of longitude and 0.009° of
// latitude, packages/domain/src/formationZones.ts) taking the model's own value at each cell's
// centre, and this script keeps the cells within 10 km of a well.
//
//   node --experimental-strip-types scripts/load-formation-layers.js lattice <wells.csv>
//
// prints "west south east north columns rows" for gdalwarp: the edges and the size of the
// lattice that holds every well with its margin. <wells.csv> has a line a well: surface
// longitude, surface latitude, bottom longitude, bottom latitude.
//
//   node --experimental-strip-types scripts/load-formation-layers.js load <dir> <wells.csv> \
//     <source-url> <source-date|-> <grain-bytes> > load.sql
//
// <dir> holds top_NN.bil and base_NN.bil for NN = 01 to 90: each grid on that lattice as raw
// 32-bit numbers, the north row first, -9999 where the zone is absent. <grain-bytes> is the size
// of grain's database: the load is refused, and nothing changes, if both databases together
// would pass 450 MB (the free plan's limit is shared, docs/DECISIONS.md, 2026-11-19).
//
// The SQL replaces the whole copy in one transaction. The Survey's data is open (Open
// Government Licence – Alberta); its files still live only on the runner.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  FORMATION_LAT_STEP,
  FORMATION_LON_STEP,
  FORMATION_MODEL_NAME,
  FORMATION_ZONE_COUNT,
  formationCell,
} from '../packages/domain/src/formationZones.ts';

const BUDGET_BYTES = 450 * 1024 * 1024;
/** The ground kept around each well's surface and bottom hole, in kilometres. */
export const KEEP_KM = 10;
const NO_DATA = -9999;

export function usage() {
  return [
    'usage: load-formation-layers.js lattice <wells.csv>',
    '       load-formation-layers.js load <dir> <wells.csv> <source-url> <source-date|-> <grain-bytes>',
  ].join('\n');
}

/** The wells' surface and bottom holes, as [longitude, latitude], from the workflow's CSV. */
export function wellPoints(csv) {
  const points = [];
  for (const line of csv.split(/\r?\n/)) {
    const numbers = line.split(',').map((field) => Number(field));
    if (numbers.length < 4 || numbers.some((n) => !Number.isFinite(n))) continue;
    points.push([numbers[0], numbers[1]], [numbers[2], numbers[3]]);
  }
  return points;
}

/** How many cells reach `km` kilometres from a place at this latitude: across and up. */
function reach(lat, km) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  return {
    nx: Math.ceil(km / (FORMATION_LON_STEP * kx)),
    ny: Math.ceil(km / (FORMATION_LAT_STEP * 110.574)),
    kx,
  };
}

/** The lattice that holds every point with its margin: the first and last column and row. */
export function latticeOf(points, km = KEEP_KM) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [lon, lat] of points) {
    const { x, y } = formationCell(lon, lat);
    const { nx, ny } = reach(lat, km);
    x0 = Math.min(x0, x - nx);
    x1 = Math.max(x1, x + nx);
    y0 = Math.min(y0, y - ny);
    y1 = Math.max(y1, y + ny);
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, x1, y0, y1, columns: x1 - x0 + 1, rows: y1 - y0 + 1 };
}

/** The edges of the lattice for gdalwarp: half a cell beyond the outer cells' centres. */
export function latticeEdges(lattice) {
  const round = (n) => Math.round(n * 1e6) / 1e6;
  return {
    west: round((lattice.x0 - 0.5) * FORMATION_LON_STEP),
    east: round((lattice.x1 + 0.5) * FORMATION_LON_STEP),
    south: round((lattice.y0 - 0.5) * FORMATION_LAT_STEP),
    north: round((lattice.y1 + 0.5) * FORMATION_LAT_STEP),
  };
}

/** Which cells of the lattice lie within `km` of a point: 1 for kept, row 0 the north row. */
export function keptCells(points, lattice, km = KEEP_KM) {
  const kept = new Uint8Array(lattice.columns * lattice.rows);
  for (const [lon, lat] of points) {
    const { x, y } = formationCell(lon, lat);
    const { nx, ny, kx } = reach(lat, km);
    for (let i = -nx; i <= nx; i += 1) {
      for (let j = -ny; j <= ny; j += 1) {
        const dx = i * FORMATION_LON_STEP * kx;
        const dy = j * FORMATION_LAT_STEP * 110.574;
        if (dx * dx + dy * dy > km * km) continue;
        const column = x + i - lattice.x0;
        const row = lattice.y1 - (y + j);
        if (column < 0 || column >= lattice.columns || row < 0 || row >= lattice.rows) continue;
        kept[row * lattice.columns + column] = 1;
      }
    }
  }
  return kept;
}

/** A grid file as numbers; refuses a file of the wrong size. */
function readGrid(file, cells) {
  const bytes = readFileSync(file);
  if (bytes.length !== cells * 4) {
    throw new Error(`${file} holds ${String(bytes.length)} bytes, not ${String(cells * 4)}.`);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, cells);
}

/** "{840,NULL,-2252}": a Postgres array of whole metres, null where the zone is absent. */
export function arrayText(values) {
  return `{${values.map((v) => (v === null ? 'NULL' : String(v))).join(',')}}`;
}

/**
 * The kept cells as rows: each zone's top and base in whole metres, a zone absent where either
 * is missing or the two leave no thickness. `tops[z]` and `bases[z]` are the grids of zone
 * z + 1. Also counts the cells whose layers do not stack exactly (a base that is not the top
 * of the layer beneath): the model's zones are sealed, so this should stay 0.
 */
export function cellRows(lattice, kept, tops, bases) {
  const rows = [];
  let unsealed = 0;
  for (let row = 0; row < lattice.rows; row += 1) {
    for (let column = 0; column < lattice.columns; column += 1) {
      const at = row * lattice.columns + column;
      if (kept[at] !== 1) continue;
      const top = new Array(FORMATION_ZONE_COUNT).fill(null);
      const base = new Array(FORMATION_ZONE_COUNT).fill(null);
      let before = null;
      let sealed = true;
      for (let z = 0; z < FORMATION_ZONE_COUNT; z += 1) {
        const [t, b] = [tops[z][at], bases[z][at]];
        if (!(t > NO_DATA + 1) || !(b > NO_DATA + 1)) continue;
        const [tr, br] = [Math.round(t), Math.round(b)];
        if (!(tr > br)) continue;
        if (before !== null && before !== tr) sealed = false;
        before = br;
        top[z] = tr;
        base[z] = br;
      }
      if (before === null) continue;
      if (!sealed) unsealed += 1;
      rows.push({ x: lattice.x0 + column, y: lattice.y1 - row, tops: top, bases: base });
    }
  }
  return { rows, unsealed };
}

/** SQL text literal. */
function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function sqlFor(rows, sourceUrl, sourceDate, grainBytes) {
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '10min', true);",
    // Emptied at once, so a second run leaves no dead rows for the size guard to count.
    'truncate petro.formation_cells;',
    'copy petro.formation_cells (cell_x, cell_y, tops, bases) from stdin with (format csv);',
    ...rows.map(
      (r) => `${String(r.x)},${String(r.y)},"${arrayText(r.tops)}","${arrayText(r.bases)}"`,
    ),
    '\\.',
    'insert into petro.formation_loads (source_url, source_date, model, lon_step, lat_step, cells)',
    `values (${literal(sourceUrl)}, ${sourceDate ? `${literal(sourceDate)}::date` : 'null'}, ${literal(FORMATION_MODEL_NAME)}, ${String(FORMATION_LON_STEP)}, ${String(FORMATION_LAT_STEP)}, ${String(rows.length)});`,
    // Measured inside the transaction, with the new rows written: over the guard, nothing stays.
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(grainBytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 450 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select count(*) as cells, pg_size_pretty(pg_total_relation_size('petro.formation_cells')) as size, pg_size_pretty(pg_database_size(current_database())) as oil_and_gas_database from petro.formation_cells;",
    '',
  ].join('\n');
}

function readWells(file) {
  const points = wellPoints(readFileSync(file, 'utf8'));
  const lattice = latticeOf(points);
  if (!lattice) {
    console.error('No wells in the list: run Load ST37 wells first.');
    process.exit(1);
  }
  return { points, lattice };
}

function main(argv) {
  if (argv[0] === 'lattice' && argv[1]) {
    const { lattice } = readWells(argv[1]);
    const edges = latticeEdges(lattice);
    process.stdout.write(
      `${String(edges.west)} ${String(edges.south)} ${String(edges.east)} ${String(edges.north)} ${String(lattice.columns)} ${String(lattice.rows)}\n`,
    );
    return;
  }
  const [command, dir, wellsFile, sourceUrl, sourceDate, grainBytes] = argv;
  const bytes = Number(grainBytes);
  const date = sourceDate && sourceDate !== '-' ? sourceDate : null;
  if (
    command !== 'load' ||
    !dir ||
    !wellsFile ||
    !sourceUrl ||
    !/^https:\/\/[a-z0-9.-]+\//.test(sourceUrl) ||
    (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0
  ) {
    console.error(usage());
    process.exit(2);
  }
  const { points, lattice } = readWells(wellsFile);
  const cells = lattice.columns * lattice.rows;
  const grids = (kind) =>
    Array.from({ length: FORMATION_ZONE_COUNT }, (_, z) => {
      const file = join(dir, `${kind}_${String(z + 1).padStart(2, '0')}.bil`);
      if (!existsSync(file)) throw new Error(`The grid ${file} is missing.`);
      return readGrid(file, cells);
    });
  const { rows, unsealed } = cellRows(
    lattice,
    keptCells(points, lattice),
    grids('top'),
    grids('base'),
  );
  console.error(
    `Formation layers: ${String(rows.length)} cells within ${String(KEEP_KM)} km of ${String(points.length / 2)} wells, on a lattice of ${String(lattice.columns)} by ${String(lattice.rows)}; ${String(unsealed)} cells whose layers do not stack exactly.`,
  );
  if (rows.length === 0) {
    console.error('No cell holds a layer: nothing to load.');
    process.exit(1);
  }
  process.stdout.write(sqlFor(rows, sourceUrl, date, bytes));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
