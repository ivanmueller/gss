#!/usr/bin/env node
// Records licence transfers in the oil and gas database (F-295). Run by
// .github/workflows/load-licences.yml, "Load licence transfers", once a day.
//
//   node --experimental-strip-types scripts/load-licences.js fetch <dir>
//     fetches the AER's well (a status at a time), facility and pipeline licence lists, reads
//     who holds each licence (packages/domain/src/licenceHolders.ts) and writes <dir>/today.json.
//
//   node --experimental-strip-types scripts/load-licences.js sql <today.json> <holdings.csv> \
//       <previous-load-id> <grain-bytes> [accept-large] > load.sql
//     compares today's holders with those of the last load (holdings.csv: kind,ba_code,licence,
//     dumped by the workflow) and writes the SQL that records the changes and replaces the
//     holdings in one transaction: refused if another load came in between, if more than a
//     tenth of a kind's licences changed company (unless accept-large, after a person looked),
//     or if grain's and the oil and gas databases together would pass 400 MB.
//
// Only the AER's own addresses are asked for, and redirects are not followed.

import { mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  compareHoldings,
  holdingsOf,
  LICENCE_KINDS,
  licenceListRequests,
  readLicenceHolders,
} from '../packages/domain/src/licenceHolders.ts';

const BUDGET_BYTES = 400 * 1024 * 1024;
// Fewer licences than this means a list is not the one expected: nothing is loaded. Read on
// 2026-11-23: 476,023 wells, 41,641 facilities, 57,166 pipelines.
export const FEWEST = { well: 400_000, facility: 35_000, pipeline: 50_000 };
// More than this share of a kind's licences changing company in a day reads as a list gone
// wrong, not as business: nothing is loaded until a person looks and runs it with accept-large.
export const LARGEST_SHARE_CHANGED = 0.1;

const BA = /^[0-9A-Z]{4}$/;
const LICENCE = /^[WFP][ A-Z]?[0-9]{1,8}[A-Z]?$/;
const KINDS = new Set(LICENCE_KINDS);

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        headers: { accept: 'text/csv', 'user-agent': 'grain-trading-platform licence loader' },
        signal: globalThis.AbortSignal.timeout(300_000),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      // The AER's lists are in Windows-1252, as the Worker reads them (aer-lists.ts).
      return new globalThis.TextDecoder('windows-1252').decode(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(10_000 * attempt);
    }
  }
}

/** Today's day in Alberta (MT, UTC-6 all year). */
export function albertaDay(now = new Date()) {
  return new Date(now.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

async function fetchAll(dir) {
  mkdirSync(dir, { recursive: true });
  const lists = { well: [], facility: [], pipeline: [] };
  const names = {};
  let skipped = 0;
  for (const request of licenceListRequests()) {
    let read;
    try {
      read = readLicenceHolders(await download(request.url), request.kind, request.status);
    } catch (error) {
      const what = `${request.kind}${request.status ? ` (${request.status})` : ''}`;
      fail(
        `The AER's ${what} licence list could not be read (${error instanceof Error ? error.message : String(error)}): nothing was loaded.`,
        2,
      );
    }
    console.error(
      `${request.kind}${request.status ? ` ${request.status}` : ''}: ${String(read.holders.length)} licences, ${String(read.skipped)} lines unreadable.`,
    );
    lists[request.kind].push(read.holders);
    skipped += read.skipped;
    for (const h of read.holders) names[h.baCode] = h.name;
  }
  const today = {};
  let ambiguous = 0;
  for (const kind of LICENCE_KINDS) {
    const { holdings, ambiguous: twice } = holdingsOf(lists[kind]);
    if (holdings.size < FEWEST[kind]) {
      fail(`Only ${String(holdings.size)} ${kind} licences read: nothing was loaded.`, 3);
    }
    today[kind] = [...holdings];
    ambiguous += twice;
  }
  writeFileSync(
    join(dir, 'today.json'),
    JSON.stringify({ day: albertaDay(), today, names, skipped, ambiguous }),
  );
}

/** A value for COPY's CSV format: quoted, always on one line; null as an empty field. */
const csv = (value) =>
  value === null
    ? ''
    : `"${String(value)
        .replace(/[\r\n]+/g, ' ')
        .replaceAll('"', '""')}"`;

/** The holdings dumped by the workflow: kind,ba_code,licence lines, as psql's CSV writes them. */
export function readHoldings(text) {
  const previous = { well: new Map(), facility: new Map(), pipeline: new Map() };
  for (const line of text.split(/\r?\n/)) {
    if (line === '') continue;
    const match = /^(well|facility|pipeline),([0-9A-Z]{4}),"?([^"]+)"?$/.exec(line);
    if (!match || !LICENCE.test(match[3])) fail('The holdings dump is not in the form expected.');
    previous[match[1]].set(match[3], match[2]);
  }
  return previous;
}

/** The SQL of one day's load. */
export function sqlFor(
  { day, today, names, skipped, ambiguous },
  previous,
  previousLoadId,
  grainBytes,
  acceptLarge = false,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('today.json has no day.');
  const first = previousLoadId === 0;
  const counts = {};
  const holdingLines = [];
  const transferLines = [];
  let added = 0;
  for (const kind of LICENCE_KINDS) {
    const rows = today[kind];
    if (!KINDS.has(kind) || !Array.isArray(rows)) fail('today.json is not in the form expected.');
    const todayMap = new Map();
    for (const row of rows) {
      if (!Array.isArray(row) || !LICENCE.test(row[0]) || !BA.test(row[1])) {
        // Never echoed: the line could hold the source's data.
        fail('A licence is not in the form the reader writes; nothing was loaded.');
      }
      todayMap.set(row[0], row[1]);
    }
    if (todayMap.size < FEWEST[kind]) fail(`Only ${String(todayMap.size)} ${kind} licences.`, 3);
    counts[kind] = todayMap.size;
    const result = compareHoldings(previous[kind], todayMap);
    added += result.added;
    if (
      !first &&
      result.changes.length > previous[kind].size * LARGEST_SHARE_CHANGED &&
      !acceptLarge
    ) {
      fail(
        `${String(result.changes.length)} of ${String(previous[kind].size)} ${kind} licences changed company since the last load: more than a tenth, which reads as a list gone wrong. Nothing was loaded. If it is real (a large merger), run the workflow by hand with "accept large" ticked.`,
        4,
      );
    }
    if (!first) {
      for (const c of result.changes) {
        transferLines.push([kind, c.licence, c.fromBa, c.toBa].map(csv).join(','));
      }
    }
    const byCompany = new Map();
    for (const [licence, ba] of result.merged) {
      const list = byCompany.get(ba) ?? [];
      list.push(licence);
      byCompany.set(ba, list);
    }
    for (const [ba, licences] of [...byCompany].sort((a, b) => a[0].localeCompare(b[0]))) {
      licences.sort();
      holdingLines.push(
        [kind, ba, `{${licences.map((l) => `"${l}"`).join(',')}}`].map(csv).join(','),
      );
    }
  }
  const nameLines = [];
  for (const [ba, name] of Object.entries(names)) {
    if (!BA.test(ba) || typeof name !== 'string' || name.length < 1 || name.length > 200) {
      fail('A company is not in the form the reader writes; nothing was loaded.');
    }
    nameLines.push([ba, name].map(csv).join(','));
  }
  const n = (v) => String(Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    'lock table petro.licence_loads in exclusive mode;',
    'do $$',
    'begin',
    `  if coalesce((select max(id) from petro.licence_loads), 0) <> ${String(previousLoadId)} then`,
    "    raise exception 'Another load came in since the holdings were read; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    `insert into petro.licence_loads (alberta_day, previous_load_id, wells, facilities, pipelines, added, transfers, skipped, ambiguous) values ('${day}', ${first ? 'null' : String(previousLoadId)}, ${n(counts.well)}, ${n(counts.facility)}, ${n(counts.pipeline)}, ${n(added)}, ${String(transferLines.length)}, ${n(skipped)}, ${n(ambiguous)});`,
    'create temp table today_names (ba_code text primary key, name text not null) on commit drop;',
    'copy today_names (ba_code, name) from stdin with (format csv);',
    ...nameLines,
    '\\.',
    'create temp table today_transfers (kind text, licence text, from_ba text, to_ba text) on commit drop;',
    'copy today_transfers (kind, licence, from_ba, to_ba) from stdin with (format csv);',
    ...transferLines,
    '\\.',
    // The names as they were before today's load, and as the lists write them today.
    'insert into petro.licence_transfers (load_id, kind, licence, from_ba, from_name, to_ba, to_name)',
    '  select (select max(id) from petro.licence_loads), t.kind, t.licence, t.from_ba, c.name, t.to_ba, n.name',
    '  from today_transfers t',
    '  left join petro.licence_companies c on c.ba_code = t.from_ba',
    '  join today_names n on n.ba_code = t.to_ba',
    '  order by t.kind, t.licence;',
    'do $$',
    'begin',
    `  if (select count(*) from petro.licence_transfers where load_id = (select max(id) from petro.licence_loads)) <> ${String(transferLines.length)} then`,
    "    raise exception 'A transfer names a company not in today''s lists; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'insert into petro.licence_companies (ba_code, name)',
    '  select ba_code, name from today_names',
    '  on conflict (ba_code) do update set name = excluded.name, updated_at = now()',
    '  where petro.licence_companies.name is distinct from excluded.name;',
    'truncate petro.licence_holdings;',
    'copy petro.licence_holdings (kind, ba_code, licences) from stdin with (format csv);',
    ...holdingLines,
    '\\.',
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(grainBytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 400 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select l.alberta_day as day, l.wells, l.facilities, l.pipelines, l.added, l.transfers, pg_size_pretty(pg_total_relation_size('petro.licence_holdings') + pg_total_relation_size('petro.licence_transfers') + pg_total_relation_size('petro.licence_companies')) as size from petro.licence_loads l order by l.id desc limit 1;",
    '',
  ].join('\n');
}

function sql(todayFile, holdingsFile, previousArg, grainArg, acceptArg) {
  const bytes = /^\d{1,15}$/.test(grainArg ?? '') ? Number(grainArg) : Number.NaN;
  const previousLoadId = /^\d{1,15}$/.test(previousArg ?? '') ? Number(previousArg) : Number.NaN;
  if (!todayFile || !holdingsFile || !Number.isFinite(bytes) || !Number.isFinite(previousLoadId)) {
    fail(
      'usage: load-licences.js sql <today.json> <holdings.csv> <previous-load-id> <grain-bytes> [accept-large]',
    );
  }
  const previous = readHoldings(readFileSync(holdingsFile, 'utf8'));
  const empty = LICENCE_KINDS.every((k) => previous[k].size === 0);
  if (empty !== (previousLoadId === 0)) {
    fail('The holdings and the last load do not agree (one is empty, the other not).');
  }
  writeSync(
    1,
    sqlFor(
      JSON.parse(readFileSync(todayFile, 'utf8')),
      previous,
      previousLoadId,
      bytes,
      acceptArg === 'accept-large',
    ),
  );
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/').split('/').pop() ?? '\0')) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'fetch' && rest[0]) await fetchAll(rest[0]);
  else if (command === 'sql') sql(rest[0], rest[1], rest[2], rest[3], rest[4]);
  else
    fail(
      'usage: load-licences.js fetch <dir> | sql <today.json> <holdings.csv> <previous-load-id> <grain-bytes> [accept-large]',
    );
}
