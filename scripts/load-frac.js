#!/usr/bin/env node
// Loads the AER's frac data into the oil and gas database (F-288). Run by
// .github/workflows/load-frac.yml, "Load frac data".
//
//   node --experimental-strip-types scripts/load-frac.js fetch <dir>
//     fetches the AER's Hydraulic Fracturing Summary Chemical and Water Use Data (one
//     pipe-delimited file of every frac reported since 2013), reads it into one line per well
//     event (packages/domain/src/frac.ts) and writes <dir>/frac.json. The file itself stays in
//     <dir> on the runner.
//
//   node --experimental-strip-types scripts/load-frac.js sql <frac.json> <grain-bytes> > load.sql
//     writes the SQL that replaces the whole copy in one transaction, refused if grain's and the
//     oil and gas databases together would pass 450 MB.
//
// Only the AER's own address is asked for, and redirects are not followed.

import { mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { fracWells } from '../packages/domain/src/frac.ts';

export const SOURCE_URL =
  'https://static.aer.ca/prd/documents/by-topic/hydraulic-fracturing/SummaryChemical-WaterUse.csv';
const BUDGET_BYTES = 450 * 1024 * 1024;
// Fewer wells than this means the file is not the one expected: nothing is loaded.
const FEWEST_WELLS = 20_000;

const UWI = /^[0-9A-Z]{2}\/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]\/[0-9A-Z]$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function download() {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(SOURCE_URL, {
        redirect: 'manual',
        headers: { 'user-agent': 'grain-trading-platform frac loader' },
        signal: globalThis.AbortSignal.timeout(600_000),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const modified = response.headers.get('last-modified');
      const date = modified ? new Date(modified) : null;
      return {
        text: await response.text(),
        sourceDate: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null,
      };
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(5000 * attempt);
    }
  }
}

async function fetchAll(dir) {
  mkdirSync(dir, { recursive: true });
  let got;
  try {
    got = await download();
  } catch (error) {
    fail(`The AER's frac file could not be fetched (${String(error)}): nothing was loaded.`, 2);
  }
  writeFileSync(join(dir, 'SummaryChemical-WaterUse.csv'), got.text);
  let read;
  try {
    read = fracWells(got.text.split(/\r?\n/));
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)} Nothing was loaded.`, 3);
  }
  if (read.wells.length < FEWEST_WELLS) {
    fail(`Only ${String(read.wells.length)} wells in the frac file: nothing was loaded.`, 3);
  }
  const suspect = read.wells.filter((w) => w.suspect).length;
  console.error(
    `${String(read.wells.length)} wells fractured; ${String(read.skipped)} lines unreadable, ${String(read.otherUnits)} proppant lines not in tonnes, ${String(suspect)} wells marked as likely reporting errors. File of ${got.sourceDate ?? 'an unknown date'}.`,
  );
  writeFileSync(
    join(dir, 'frac.json'),
    JSON.stringify({ wells: read.wells, skipped: read.skipped, sourceDate: got.sourceDate }),
  );
}

/** A value for COPY's CSV format: quoted, always on one line; null as an empty field. */
const csv = (value) =>
  value === null
    ? ''
    : `"${String(value)
        .replace(/[\r\n]+/g, ' ')
        .replaceAll('"', '""')}"`;

/** Refuses a well the reader would never write, before any SQL is made of it. */
export function checkedRow(w) {
  const ok =
    UWI.test(w.uwi) &&
    /^[0-9A-Z]{0,9}$/.test(w.licenceNumber) &&
    DAY.test(w.firstFracDate) &&
    DAY.test(w.lastFracDate) &&
    w.lastFracDate >= w.firstFracDate &&
    Number.isSafeInteger(w.fracs) &&
    w.fracs >= 1 &&
    w.fracs <= 32767 &&
    (w.stages === null || (Number.isSafeInteger(w.stages) && w.stages >= 0)) &&
    [w.waterM3, w.proppantT, w.upgradeHintT, w.refracProppantT].every((a) => AMOUNT.test(a)) &&
    (w.maxTvdM === null || /^\d{1,6}(\.\d{1,2})?$/.test(w.maxTvdM)) &&
    typeof w.suspect === 'boolean';
  if (!ok) return null;
  return [
    w.uwi,
    w.licenceNumber,
    w.firstFracDate,
    w.lastFracDate,
    w.fracs,
    w.stages,
    w.waterM3,
    w.proppantT,
    w.upgradeHintT,
    w.refracProppantT,
    w.maxTvdM,
    w.suspect,
  ]
    .map(csv)
    .join(',');
}

export function sqlFor({ wells, skipped, sourceDate }, grainBytes) {
  const lines = [];
  for (const w of wells) {
    const row = checkedRow(w);
    // Never echoed: the line could hold the source's data.
    if (row === null) fail('A well is not in the form the reader writes; nothing was loaded.');
    lines.push(row);
  }
  if (lines.length === 0) fail('No wells: nothing was loaded.', 2);
  const date = sourceDate && DAY.test(sourceDate) ? `'${sourceDate}'` : 'null';
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    'truncate petro.frac_wells;',
    'copy petro.frac_wells (uwi, licence_number, first_frac_date, last_frac_date, fracs, stages, water_m3, proppant_t, upgrade_hint_t, refrac_proppant_t, max_tvd_m, suspect) from stdin with (format csv);',
    ...lines,
    '\\.',
    `insert into petro.frac_loads (source_url, source_date, wells, skipped) values ('${SOURCE_URL}', ${date}, ${String(lines.length)}, ${String(Number.isSafeInteger(skipped) ? skipped : 0)});`,
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(grainBytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 450 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select count(*) as wells, count(*) filter (where suspect) as suspect, min(first_frac_date) as first, max(last_frac_date) as last, pg_size_pretty(pg_total_relation_size('petro.frac_wells')) as size from petro.frac_wells;",
    '',
  ].join('\n');
}

function sql(file, grainArg) {
  const bytes = /^\d{1,15}$/.test(grainArg ?? '') ? Number(grainArg) : Number.NaN;
  if (!file || !Number.isFinite(bytes)) fail('usage: load-frac.js sql <frac.json> <grain-bytes>');
  writeSync(1, sqlFor(JSON.parse(readFileSync(file, 'utf8')), bytes));
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/').split('/').pop() ?? '\0')) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'fetch' && rest[0]) await fetchAll(rest[0]);
  else if (command === 'sql') sql(rest[0], rest[1]);
  else fail('usage: load-frac.js fetch <dir> | sql <frac.json> <grain-bytes>');
}
