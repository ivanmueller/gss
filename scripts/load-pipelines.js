#!/usr/bin/env node
// Loads the AER's pipelines into the oil and gas database (F-249), from its pipeline file as a
// shapefile, for one area. Run by .github/workflows/load-pipelines.yml, "Load pipelines".
//
//   node --experimental-strip-types scripts/load-pipelines.js sql <pipelines.shp> \
//     <pipelines.dbf> <west> <south> <east> <north> <grain-bytes> <file-date|-> > load.sql
//
// reads every segment of the file whose line touches the area, thins its line to about 3 m, and
// writes the SQL that replaces the whole copy in one transaction, so the map never shows half a
// load. <grain-bytes> is the size of grain's database: the load is refused, and nothing changes,
// if both databases together would pass 400 MB (the free plan's limit is shared,
// docs/DECISIONS.md, 2026-11-19). <file-date> is the file's Last-Modified day (YYYY-MM-DD), or -.
//
// The AER's data is never written to the repository: the files live only on the runner.

import { readFileSync, writeSync } from 'node:fs';

import { dbaseTable } from '../packages/domain/src/facilities.ts';
import {
  encodeParts,
  PIPELINE_FIELDS,
  pipelineRow,
  shapefileLines,
} from '../packages/domain/src/pipelines.ts';

const BUDGET_BYTES = 400 * 1024 * 1024;
const ALBERTA = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };
const SOURCE_URL = 'https://static.aer.ca/prd/data/pipeline/Pipelines_SHP.zip';

function usage() {
  return 'usage: load-pipelines.js sql <pipelines.shp> <pipelines.dbf> <west> <south> <east> <north> <grain-bytes> <file-date|->';
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

/** A Postgres text array literal: each element quoted, its quotes and backslashes escaped. */
function textArray(values) {
  return `{${values.map((v) => `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
}

/** A Postgres box literal from a box of degrees. */
function boxLiteral(b) {
  return `(${String(b.east)},${String(b.north)}),(${String(b.west)},${String(b.south)})`;
}

const COLUMNS =
  'segment_id, licence_number, line_number, federal, licensee_code, licensee, status, substances, from_facility, from_location, to_facility, to_location, length_km, diameter_mm, wall_mm, material, pipe_type, pipe_grade, max_pressure, h2s, field_centre, licence_approved, last_occurrence_year, geometry_source, bounds, path, breaks';

/** One CSV line of COPY for a segment. */
function copyLine(row) {
  const { path, breaks } = encodeParts(row.parts);
  return [
    row.segmentId,
    row.licenceNumber,
    row.lineNumber,
    row.federal ? 't' : 'f',
    row.licenseeCode,
    row.licensee,
    row.status,
    textArray(row.substances),
    row.fromFacility,
    row.fromLocation,
    row.toFacility,
    row.toLocation,
    row.lengthKm,
    row.diameterMm,
    row.wallMm,
    row.material,
    row.pipeType,
    row.pipeGrade,
    row.maxPressure,
    row.h2s,
    row.fieldCentre,
    row.licenceApproved,
    row.lastOccurrenceYear,
    row.geometrySource,
    boxLiteral(row.bounds),
    `{${path.join(',')}}`,
    `{${breaks.join(',')}}`,
  ]
    .map(csv)
    .join(',');
}

const touches = (b, area) =>
  b.east >= area.west && b.west <= area.east && b.north >= area.south && b.south <= area.north;

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

  let lines;
  let table;
  try {
    lines = shapefileLines(new Uint8Array(readFileSync(shp)));
    table = dbaseTable(new Uint8Array(readFileSync(dbf)));
  } catch (error) {
    fail(
      `The pipeline file could not be read: ${error instanceof Error ? error.message : String(error)}; nothing was loaded.`,
      2,
    );
  }
  if (lines.count !== table.count) {
    fail("The pipeline file's lines and its table do not match; nothing was loaded.", 2);
  }

  const rows = [];
  let skipped = 0;
  let outside = 0;
  for (let i = 0; i < lines.count; i += 1) {
    const bounds = lines.bounds(i);
    if (bounds && !touches(bounds, area)) {
      outside += 1;
      continue;
    }
    const record = table.record(i, PIPELINE_FIELDS);
    const row = record && bounds ? pipelineRow(record, lines.parts(i)) : null;
    if (!row) {
      if (record) skipped += 1;
      continue;
    }
    rows.push(copyLine(row));
  }
  if (rows.length === 0) fail('No pipelines in the area: nothing was loaded.', 2);
  console.error(
    `${String(rows.length)} segments in the area, ${String(outside)} outside it, ${String(skipped)} left out as unreadable.`,
  );

  const out = [];
  const flush = () => {
    writeSync(1, `${out.join('\n')}\n`);
    out.length = 0;
  };
  out.push(
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '20min', true);",
    // Emptied at once (and put back if the load fails): a delete would leave the old rows as
    // dead weight that the size guard counts.
    'truncate petro.pipelines restart identity;',
    `copy petro.pipelines (${COLUMNS}) from stdin with (format csv);`,
  );
  flush();
  for (let i = 0; i < rows.length; i += 2000) {
    out.push(...rows.slice(i, i + 2000));
    flush();
  }
  out.push('\\.');
  const box = `${String(area.west)}, ${String(area.south)}, ${String(area.east)}, ${String(area.north)}`;
  out.push(
    `insert into petro.pipeline_loads (source_url, file_date, west, south, east, north, segments) values ('${SOURCE_URL}', ${day === null ? 'null' : `'${day}'`}, ${box}, ${String(rows.length)});`,
    // Measured inside the transaction, with the new rows written: over the guard, nothing stays.
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(bytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 400 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select (select count(*) from petro.pipelines) as segments, pg_size_pretty(pg_total_relation_size('petro.pipelines')) as size, pg_size_pretty(pg_database_size(current_database())) as oil_and_gas_database;",
  );
  flush();
}

main(process.argv.slice(2));
