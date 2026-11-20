#!/usr/bin/env node
// Writes the SQL that loads one area of the AER's ST37 wells into the oil and gas database
// (F-243 part 4; run by .github/workflows/load-st37.yml, "Load ST37 wells").
//
//   node --experimental-strip-types scripts/load-st37.js <dir> <west> <south> <east> <north> \
//     <source-url> <source-date|-> <grain-bytes> > load.sql
//
// <dir> holds surface.geojson, bottom.geojson, strings.geojson and paths.geojson, the four
// layers of ST_37_Wells.gdb cut to the area by ogr2ogr (EPSG:4326). <grain-bytes> is the size of
// grain's database: the load is refused, and nothing changes, if both databases together would
// pass 400 MB (the free plan's limit is shared, docs/DECISIONS.md, 2026-11-19).
//
// The SQL replaces the whole ST37 copy in one transaction, so the map never shows half a load.
// The AER's data is never written to the repository: the files live only on the runner.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildSt37Wells } from '../packages/domain/src/st37.ts';

const BUDGET_BYTES = 400 * 1024 * 1024;

export function usage() {
  return 'usage: load-st37.js <dir> <west> <south> <east> <north> <source-url> <source-date|-> <grain-bytes>';
}

/** A value for COPY's CSV format: empty for null, quoted otherwise. */
export function csv(value) {
  if (value === null || value === undefined) return '';
  return `"${String(value).replaceAll('"', '""')}"`;
}

/** SQL text literal. */
function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function sqlFor(wells, area, sourceUrl, sourceDate, grainBytes) {
  const columns = [
    'uwi',
    'licence_number',
    'well_name',
    'licensee',
    'licence_status',
    'status_class',
    'status_fluid',
    'status_mode',
    'status_type',
    'pool_code',
    'spud_date',
    'final_drill_date',
    'total_depth_m',
    'true_vertical_depth_m',
    'surface_longitude',
    'surface_latitude',
    'bottom_longitude',
    'bottom_latitude',
    'path',
  ];
  const rows = wells.map((w) =>
    [
      w.uwi,
      w.licenceNumber,
      w.wellName,
      w.licensee,
      w.licenceStatus,
      w.statusClass,
      w.statusFluid,
      w.statusMode,
      w.statusType,
      w.poolCode,
      w.spudDate,
      w.finalDrillDate,
      w.totalDepthM,
      w.trueVerticalDepthM,
      w.surface[0],
      w.surface[1],
      w.bottom[0],
      w.bottom[1],
      w.path === null ? null : JSON.stringify(w.path),
    ]
      .map(csv)
      .join(','),
  );
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '10min', true);",
    'delete from petro.st37_wells;',
    `copy petro.st37_wells (${columns.join(', ')}) from stdin with (format csv);`,
    ...rows,
    '\\.',
    'insert into petro.st37_loads (source_url, source_date, west, south, east, north, wells)',
    `values (${literal(sourceUrl)}, ${sourceDate ? `${literal(sourceDate)}::date` : 'null'}, ${String(area.west)}, ${String(area.south)}, ${String(area.east)}, ${String(area.north)}, ${String(wells.length)});`,
    // Measured inside the transaction, with the new rows written: over the guard, nothing stays.
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(grainBytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 400 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select count(*) as wells, count(path) as with_paths, pg_size_pretty(pg_total_relation_size('petro.st37_wells')) as size from petro.st37_wells;",
    '',
  ].join('\n');
}

function main(argv) {
  const [dir, west, south, east, north, sourceUrl, sourceDate, grainBytes] = argv;
  const area = {
    west: Number(west),
    south: Number(south),
    east: Number(east),
    north: Number(north),
  };
  const bytes = Number(grainBytes);
  if (
    !dir ||
    !sourceUrl ||
    !/^https:\/\/[a-z.]*aer\.ca\//.test(sourceUrl) ||
    Object.values(area).some((n) => !Number.isFinite(n)) ||
    !(area.west < area.east && area.south < area.north) ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0
  ) {
    console.error(usage());
    process.exit(2);
  }
  const date = sourceDate && sourceDate !== '-' ? sourceDate : null;
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('source date must be YYYY-MM-DD or -');
    process.exit(2);
  }
  const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8')).features ?? [];
  const { wells, skipped } = buildSt37Wells(
    {
      surface: read('surface.geojson'),
      bottom: read('bottom.geojson'),
      strings: read('strings.geojson'),
      paths: read('paths.geojson'),
    },
    area,
  );
  const withPaths = wells.filter((w) => w.path !== null).length;
  console.error(
    `ST37: ${String(wells.length)} wells in the area (${String(withPaths)} with drilled paths), ${String(skipped)} records skipped as unreadable.`,
  );
  if (wells.length === 0) {
    console.error('No wells in the area: nothing to load.');
    process.exit(1);
  }
  process.stdout.write(sqlFor(wells, area, sourceUrl, date, bytes));
}

main(process.argv.slice(2));
