#!/usr/bin/env node
// Writes the SQL that loads each well's monthly production into the oil and gas database, from
// Petrinex's public Conventional Volumetric Data files (F-252 step 3); run by
// .github/workflows/load-petrinex.yml, "Load Petrinex production".
//
// 1. For each monthly file, the rows of the wells asked for (one UWI a line in <uwis.txt>):
//
//   node --experimental-strip-types scripts/load-petrinex.js month <Vol_YYYY-MM-AB.CSV> \
//     <YYYY-MM> <uwis.txt> >> rows.csv
//
// 2. Then the SQL, which replaces the whole copy in one transaction, so a chart never shows half
//    a load:
//
//   node --experimental-strip-types scripts/load-petrinex.js sql <rows.csv> <formation|-> \
//     <first YYYY-MM> <last YYYY-MM> <files> <grain-bytes> > load.sql
//
// <grain-bytes> is the size of grain's database: the load is refused, and nothing changes, if
// both databases together would pass 450 MB (the free plan's limit is shared, docs/DECISIONS.md,
// 2026-11-19). Petrinex's data is used on the owner's decision (docs/DECISIONS.md, 2026-11-20):
// it is never written to the repository; the files live only on the runner.

import { Buffer } from 'node:buffer';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

import { petrinexDecimal, petrinexMonth } from '../packages/domain/src/petrinex.ts';

const BUDGET_BYTES = 450 * 1024 * 1024;
export const SOURCE_URL = 'https://www.petrinex.gov.ab.ca/publicdata/API/Files/AB/Vol/';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UWI = /^[0-9A-Z]{2}\/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]\/[0-9A-Z]$/;
/** One row of rows.csv: UWI, month, four volumes (each may be empty), hours (may be empty). */
const ROW = /^[0-9A-Z/-]{19},\d{4}-\d{2}-01(,(\d+\.\d{3})?){4},\d{0,3}$/;

export function usage() {
  return [
    'usage: load-petrinex.js month <vol.csv> <YYYY-MM> <uwis.txt>',
    '       load-petrinex.js sql <rows.csv> <formation|-> <first YYYY-MM> <last YYYY-MM> <files> <grain-bytes>',
  ].join('\n');
}

/** The lines of a large file, read a piece at a time (a monthly file is about 120 MB). */
export function* linesOf(file) {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1 << 20);
    const decoder = new StringDecoder('latin1');
    let rest = '';
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      const parts = (rest + decoder.write(buffer.subarray(0, read))).split('\n');
      rest = parts.pop() ?? '';
      yield* parts;
    }
    if (rest !== '') yield rest;
  } finally {
    closeSync(fd);
  }
}

/** The month's rows for COPY, sorted by UWI: no quoting is needed for what they hold. */
export function rowsFor(wells, month) {
  const text = (n) => (n === null ? '' : petrinexDecimal(n));
  return [...wells.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([uwi, w]) =>
      [
        uwi,
        `${month}-01`,
        text(w.oil),
        text(w.gas),
        text(w.water),
        text(w.condensate),
        w.hours === null ? '' : String(w.hours),
      ].join(','),
    );
}

export function sqlFor(rows, formation, first, last, files, grainBytes) {
  const wells = new Set(rows.map((r) => r.slice(0, 19))).size;
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '10min', true);",
    'delete from petro.well_production;',
    'copy petro.well_production (uwi, month, oil_m3, gas_e3m3, water_m3, condensate_m3, hours) from stdin with (format csv);',
    ...rows,
    '\\.',
    'insert into petro.production_loads (source_url, formation, first_month, last_month, files, wells, well_months)',
    `values ('${SOURCE_URL}', ${formation ? `'${formation}'` : 'null'}, '${first}-01', '${last}-01', ${String(files)}, ${String(wells)}, ${String(rows.length)});`,
    // Measured inside the transaction, with the new rows written: over the guard, nothing stays.
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(grainBytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 450 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select count(*) as well_months, count(distinct uwi) as wells, min(month) as first_month, max(month) as last_month, pg_size_pretty(pg_total_relation_size('petro.well_production')) as size from petro.well_production;",
    '',
  ].join('\n');
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function mainMonth([file, month, uwisFile]) {
  if (!file || !uwisFile || !MONTH.test(month ?? '')) fail(usage());
  const uwis = new Set(
    readFileSync(uwisFile, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => UWI.test(l)),
  );
  if (uwis.size === 0) fail('No wells to look for: load the wells first.');
  const { wells, skipped } = petrinexMonth(linesOf(file), month, uwis);
  console.error(
    `${month}: ${String(wells.size)} of ${String(uwis.size)} wells produced${skipped ? `, ${String(skipped)} lines skipped as unreadable` : ''}.`,
  );
  const rows = rowsFor(wells, month);
  if (rows.length > 0) process.stdout.write(`${rows.join('\n')}\n`);
}

function mainSql([rowsFile, formationArg, first, last, filesArg, grainArg]) {
  const formation = formationArg === '-' ? null : formationArg;
  const files = Number(filesArg);
  const bytes = Number(grainArg);
  if (
    !rowsFile ||
    !MONTH.test(first ?? '') ||
    !MONTH.test(last ?? '') ||
    first > last ||
    (formation !== null && !/^[a-z][a-z_]{1,39}$/.test(formation ?? '')) ||
    !Number.isSafeInteger(files) ||
    files < 1 ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0
  ) {
    fail(usage());
  }
  const rows = readFileSync(rowsFile, 'utf8')
    .split('\n')
    .filter((l) => l !== '');
  const bad = rows.find((r) => !ROW.test(r));
  // Never echoed: the line could hold the source's data.
  if (bad !== undefined)
    fail('A row is not in the form the month step writes; nothing was loaded.');
  if (rows.length === 0) fail('No production found for these wells: nothing was loaded.');
  process.stdout.write(sqlFor(rows, formation, first, last, files, bytes));
}

function main(argv) {
  if (argv[0] === 'month') mainMonth(argv.slice(1));
  else if (argv[0] === 'sql') mainSql(argv.slice(1));
  else fail(usage());
}

// Run as a script, not when a test imports it.
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop() ?? '\0')
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
