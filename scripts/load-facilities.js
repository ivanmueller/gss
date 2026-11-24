#!/usr/bin/env node
// Loads the AER's facilities into the oil and gas database (F-278), from its ST102 facility list
// as a shapefile, for one area. Run by .github/workflows/load-facilities.yml, "Load facilities".
//
//   node --experimental-strip-types scripts/load-facilities.js sql <facilities.shp> \
//     <facilities.dbf> <west> <south> <east> <north> <grain-bytes> <file-date|-> > load.sql
//
// reads every facility of the file, keeps those whose point is in the area, and writes the SQL
// that replaces the whole copy in one transaction, so the map never shows half a load.
// <grain-bytes> is the size of grain's database: the load is refused, and nothing changes, if
// both databases together would pass 450 MB (the free plan's limit is shared,
// docs/DECISIONS.md, 2026-11-19). <file-date> is the file's Last-Modified day (YYYY-MM-DD), or -.
//
// The AER's data is never written to the repository: the files live only on the runner.

import { readFileSync, writeSync } from 'node:fs';

import { dbaseRecords, facilityRow, shapefilePoints } from '../packages/domain/src/facilities.ts';

const BUDGET_BYTES = 450 * 1024 * 1024;
const ALBERTA = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };
const SOURCE_URL = 'https://static.aer.ca/prd/data/codes/ST102-SHP.zip';

function usage() {
  return 'usage: load-facilities.js sql <facilities.shp> <facilities.dbf> <west> <south> <east> <north> <grain-bytes> <file-date|->';
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

/** The area, in Alberta, west of east and south of north; null otherwise. */
function areaOf(west, south, east, north) {
  const edge = /^-?\d{1,3}(\.\d{1,6})?$/;
  if (![west, south, east, north].every((v) => typeof v === 'string' && edge.test(v))) return null;
  const area = {
    west: Number(west),
    south: Number(south),
    east: Number(east),
    north: Number(north),
  };
  const inside =
    area.west >= ALBERTA.west &&
    area.east <= ALBERTA.east &&
    area.south >= ALBERTA.south &&
    area.north <= ALBERTA.north;
  return inside && area.west < area.east && area.south < area.north ? area : null;
}

/** A value for COPY's CSV format: empty for null, quoted otherwise, always on one line. */
function csv(value) {
  if (value === null || value === undefined) return '';
  return `"${String(value)
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('"', '""')}"`;
}

const COLUMNS =
  'facility_id, name, operator_code, operator, sub_code, sub_type, licence_number, licence_type, licensee_code, licensee, status, location_source, longitude, latitude';

function main(argv) {
  const [mode, shp, dbf, west, south, east, north, grainBytes, fileDate] = argv;
  const area = areaOf(west, south, east, north);
  const bytes = /^\d{1,15}$/.test(grainBytes ?? '') ? Number(grainBytes) : Number.NaN;
  const day = fileDate === '-' ? null : fileDate;
  if (
    mode !== 'sql' ||
    !shp ||
    !dbf ||
    !area ||
    !Number.isSafeInteger(bytes) ||
    (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(day ?? ''))
  ) {
    fail(usage(), 2);
  }

  let points;
  let records;
  try {
    points = shapefilePoints(new Uint8Array(readFileSync(shp)));
    records = dbaseRecords(new Uint8Array(readFileSync(dbf)));
  } catch (error) {
    fail(
      `The facility file could not be read: ${error instanceof Error ? error.message : String(error)}; nothing was loaded.`,
      2,
    );
  }
  if (points.length !== records.length) {
    fail("The facility file's points and its table do not match; nothing was loaded.", 2);
  }

  const lines = [];
  const seen = new Set();
  let skipped = 0;
  let outside = 0;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const row = record ? facilityRow(record, points[i] ?? null) : null;
    if (!row) {
      if (record) skipped += 1;
      continue;
    }
    if (
      row.longitude < area.west ||
      row.longitude > area.east ||
      row.latitude < area.south ||
      row.latitude > area.north
    ) {
      outside += 1;
      continue;
    }
    // The ID is the table's key: a second record of one facility is left out.
    if (seen.has(row.facilityId)) {
      skipped += 1;
      continue;
    }
    seen.add(row.facilityId);
    lines.push(
      [
        row.facilityId,
        row.name,
        row.operatorCode,
        row.operator,
        row.subCode,
        row.subType,
        row.licenceNumber,
        row.licenceType,
        row.licenseeCode,
        row.licensee,
        row.status,
        row.located,
        row.longitude,
        row.latitude,
      ]
        .map(csv)
        .join(','),
    );
  }
  if (lines.length === 0) fail('No facilities in the area: nothing was loaded.', 2);
  console.error(
    `${String(lines.length)} facilities in the area, ${String(outside)} outside it, ${String(skipped)} left out as unreadable or repeated.`,
  );

  const out = [];
  const flush = () => {
    writeSync(1, `${out.join('\n')}\n`);
    out.length = 0;
  };
  out.push(
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '15min', true);",
    // Emptied at once (and put back if the load fails): a delete would leave the old rows as
    // dead weight that the size guard counts.
    'truncate petro.facilities;',
    `copy petro.facilities (${COLUMNS}) from stdin with (format csv);`,
  );
  flush();
  for (let i = 0; i < lines.length; i += 2000) {
    out.push(...lines.slice(i, i + 2000));
    flush();
  }
  out.push('\\.');
  const box = `${String(area.west)}, ${String(area.south)}, ${String(area.east)}, ${String(area.north)}`;
  out.push(
    `insert into petro.facility_loads (source_url, file_date, west, south, east, north, facilities) values ('${SOURCE_URL}', ${day === null ? 'null' : `'${day}'`}, ${box}, ${String(lines.length)});`,
    // Measured inside the transaction, with the new rows written: over the guard, nothing stays.
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(bytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 450 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select (select count(*) from petro.facilities) as facilities, pg_size_pretty(pg_total_relation_size('petro.facilities')) as size, pg_size_pretty(pg_database_size(current_database())) as oil_and_gas_database;",
  );
  flush();
}

main(process.argv.slice(2));
