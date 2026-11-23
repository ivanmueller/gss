#!/usr/bin/env node
// Loads Alberta's royalty prices into the oil and gas database (F-285). Run by
// .github/workflows/load-prices.yml, "Load prices".
//
//   node --experimental-strip-types scripts/load-prices.js fetch <dir>
//     fetches the province's gas price archive, its yearly lists of monthly reference price
//     calculations (1994 to this year) and its oil par price letters (2012 on), reads each PDF with
//     `pdftotext -raw` (poppler-utils), and writes <dir>/prices.json. A file that cannot be fetched
//     or read is listed as unread, and its month is simply missing; a file read as nonsense (a
//     price in the wrong unit, a letter for another month) stops the load.
//
//   node --experimental-strip-types scripts/load-prices.js sql <prices.json> <grain-bytes> > load.sql
//     writes the SQL that replaces the whole copy in one transaction, refused if grain's and the
//     oil and gas databases together would pass 400 MB.
//
// Only the province's own addresses are asked for, and redirects are not followed.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { TextDecoder } from 'node:util';

import {
  LetterMonthError,
  PriceSheetError,
  gasReferenceTable,
  parLetterLinks,
  parLetterPrices,
  priceSeries,
  sheetMonth,
  sheetPrices,
} from '../packages/domain/src/prices.ts';

const BUDGET_BYTES = 400 * 1024 * 1024;
const GAS_PAGE = 'https://www.alberta.ca/alberta-natural-gas-reference-price';
const OIL_PAGE = 'https://www.alberta.ca/oil-par-prices';
const DATASET = (year) =>
  `https://open.alberta.ca/api/3/action/package_show?id=monthly-reference-price-calculations-${String(year)}`;
const ALLOWED = /^https:\/\/(www\.alberta\.ca|open\.alberta\.ca|inform\.energy\.gov\.ab\.ca)\//;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function fetchBytes(url) {
  if (!ALLOWED.test(url)) throw new Error(`not one of the province's addresses: ${url}`);
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        headers: { 'user-agent': 'grain-trading-platform price loader' },
        signal: globalThis.AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(2000 * attempt);
    }
  }
}

const text = async (url) => new TextDecoder().decode(await fetchBytes(url));

/** The text of a PDF as `pdftotext -raw` gives it. */
function pdfText(path) {
  return execFileSync('pdftotext', ['-raw', path, '-'], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    // pdftotext's warnings about the files' structure are not the load's business.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** Runs `work` over `items`, at most `width` at a time, in order of the results. */
async function eachLimited(items, width, work) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: width }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i], i);
    }
  });
  await Promise.all(lanes);
  return results;
}

async function fetchAll(dir) {
  mkdirSync(dir, { recursive: true });
  const rows = [];
  const unread = [];
  const keep = (found, url) => {
    for (const row of found) rows.push({ ...row, source: url });
  };

  // Gas: one table, every month since 1994.
  const gas = gasReferenceTable(await text(GAS_PAGE));
  if (gas.length < 12 * 30)
    fail(`The gas price archive gave only ${String(gas.length)} months: nothing was loaded.`, 2);
  keep(gas, GAS_PAGE);

  // Liquids and sulphur: the monthly sheets, listed year by year on the open data site.
  const thisYear = new Date().getUTCFullYear();
  const sheets = [];
  for (let year = 1994; year <= thisYear; year++) {
    let listed;
    try {
      listed = JSON.parse(await text(DATASET(year)));
    } catch {
      continue; // No list for that year (1995 is not published).
    }
    for (const resource of listed?.result?.resources ?? []) {
      const url = String(resource?.url ?? '');
      const month = sheetMonth(url.split('/').pop() ?? '');
      if (month !== null && month.startsWith(String(year)) && ALLOWED.test(url)) {
        sheets.push({ month, url });
      }
    }
  }
  const byMonth = new Map();
  for (const sheet of sheets) if (!byMonth.has(sheet.month)) byMonth.set(sheet.month, sheet);
  const monthly = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  await eachLimited(monthly, 4, async ({ month, url }, i) => {
    const path = join(dir, `sheet-${String(i)}.pdf`);
    try {
      writeFileSync(path, await fetchBytes(url));
    } catch {
      unread.push(url);
      return;
    }
    let found;
    try {
      found = sheetPrices(pdfText(path), month);
    } catch (error) {
      if (error instanceof PriceSheetError)
        fail(`${error.message} (${url}): nothing was loaded.`, 3);
      unread.push(url);
      return;
    }
    if (found.length === 0) unread.push(url);
    keep(found, url);
  });

  // Oil: the par price letters, each linked for its month.
  const letters = parLetterLinks(await text(OIL_PAGE));
  if (letters.length < 12 * 10)
    fail(
      `The oil par price page linked only ${String(letters.length)} letters: nothing was loaded.`,
      2,
    );
  await eachLimited(letters, 4, async ({ month, url }, i) => {
    const path = join(dir, `letter-${String(i)}.pdf`);
    try {
      writeFileSync(path, await fetchBytes(url));
    } catch {
      unread.push(url);
      return;
    }
    try {
      keep(parLetterPrices(pdfText(path), month), url);
    } catch (error) {
      if (error instanceof LetterMonthError) {
        console.error(`Left out: ${error.message} (${url}).`);
        unread.push(url);
        return;
      }
      if (error instanceof PriceSheetError)
        fail(`${error.message} (${url}): nothing was loaded.`, 3);
      unread.push(url);
    }
  });

  const series = new Set(rows.map((r) => r.series));
  console.error(
    `${String(rows.length)} prices in ${String(series.size)} series: gas ${String(gas.length)} months, ${String(monthly.length)} monthly sheets, ${String(letters.length)} oil letters; ${String(unread.length)} files unread.`,
  );
  writeFileSync(join(dir, 'prices.json'), JSON.stringify({ rows, unread: unread.sort() }));
}

/** A value for COPY's CSV format: quoted, always on one line. */
const csv = (value) =>
  `"${String(value)
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('"', '""')}"`;
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

function sql(file, grainBytes) {
  const bytes = /^\d{1,15}$/.test(grainBytes ?? '') ? Number(grainBytes) : Number.NaN;
  if (!file || !Number.isFinite(bytes)) {
    fail('usage: load-prices.js sql <prices.json> <grain-bytes>');
  }
  const { rows, unread } = JSON.parse(readFileSync(file, 'utf8'));
  const lines = [];
  const seen = new Set();
  for (const row of rows) {
    const series = priceSeries(row.series);
    const key = `${row.series}|${row.month}`;
    if (
      !series ||
      !/^\d{4}-\d{2}$/.test(row.month) ||
      !/^-?\d{1,6}(\.\d{1,4})?$/.test(row.price) ||
      !ALLOWED.test(row.source)
    ) {
      fail(`An unexpected price row (${key}): nothing was loaded.`);
    }
    // The first of a series and month wins: the sheets are read oldest first, once each.
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      [row.series, `${row.month}-01`, row.price, series.unit, row.source].map(csv).join(','),
    );
  }
  if (lines.length === 0) fail('No prices: nothing was loaded.', 2);
  const months = rows.map((r) => r.month).sort();
  const list = (unread ?? []).filter((u) => ALLOWED.test(u)).slice(0, 1000);
  const out = [
    '\\set ON_ERROR_STOP on',
    'begin;',
    'truncate petro.reference_prices;',
    'copy petro.reference_prices (series, month, price, unit, source_url) from stdin with (format csv);',
    ...lines,
    '\\.',
    `insert into petro.price_loads (prices, first_month, last_month, unread) values (${String(lines.length)}, '${months[0]}-01', '${months.at(-1)}-01', array[${list.map(sqlText).join(', ')}]::text[]);`,
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(bytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 400 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    'select series, count(*) as months, min(month) as first, max(month) as last from petro.reference_prices group by series order by series;',
  ];
  writeSync(1, `${out.join('\n')}\n`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'fetch' && rest[0]) await fetchAll(rest[0]);
else if (command === 'sql') sql(rest[0], rest[1]);
else fail('usage: load-prices.js fetch <dir> | sql <prices.json> <grain-bytes>');
