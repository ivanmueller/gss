#!/usr/bin/env node
// Loads Crown land sales into the oil and gas database (F-242): the parcels of Alberta Energy
// and Minerals' public offerings of petroleum and natural gas rights, with their results, for
// one area. Run by .github/workflows/load-land-sales.yml, "Load land sales".
//
//   node --experimental-strip-types scripts/load-land-sales.js fetch <dir> <first-year>
//
// reads the department's page of notices and results, year by year from <first-year>, and saves
// each sale's notice and results (their XML files) in <dir>, one request at a time.
//
//   node --experimental-strip-types scripts/load-land-sales.js sections <west> <south> <east> \
//     <north> <out.ndjson>
//
// asks the province's township grid for every section touching the area and writes each one's
// four corners, a line a section.
//
//   node --experimental-strip-types scripts/load-land-sales.js sql <dir> <sections.ndjson> \
//     <west> <south> <east> <north> <grain-bytes> > load.sql
//
// places each parcel's land on those sections, joins the results, and writes the SQL that
// replaces the whole copy in one transaction. Parcels with no land in the area are left out.
// <grain-bytes> is the size of grain's database: the load is refused, and nothing changes, if
// both databases together would pass 400 MB (docs/DECISIONS.md, 2026-11-19).
//
//   node --experimental-strip-types scripts/load-land-sales.js area <west> <south> <east> \
//     <north> <outline.geojson>
//
// prints the area to load for a play: the box around its wells widened to hold the play's
// outline as the map draws it (F-264), as "west south east north".
//
// The province's files are never written to the repository: they live only on the runner.

import { readdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { URLSearchParams } from 'node:url';

import {
  parseSaleNotice,
  parseSaleResults,
  placeParcel,
  sectionCorners,
} from '../packages/domain/src/landSales.ts';

const BUDGET_BYTES = 400 * 1024 * 1024;
const ALBERTA = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };
const SITE = 'https://content2.energy.alberta.ca';
const PAGE_URL = `${SITE}/petroleum-and-natural-gas-tenure-public-offerings-and-results/`;
/** The province's township grid: sections, without the road allowances between them. */
const SECTIONS_URL =
  'https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer/18/query';
const PAGE = 1000;
const MAX_PAGES = 400;
/** The department's files have been XML since 2003. */
const FIRST_YEAR = 2003;

function usage() {
  return [
    'usage: load-land-sales.js fetch <dir> <first-year>',
    '       load-land-sales.js sections <west> <south> <east> <north> <out.ndjson>',
    '       load-land-sales.js sql <dir> <sections.ndjson> <west> <south> <east> <north> <grain-bytes>',
    '       load-land-sales.js area <west> <south> <east> <north> <outline.geojson>',
  ].join('\n');
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

async function get(url, init) {
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(5000 * attempt);
    try {
      const res = await fetch(url, { ...init, signal: globalThis.AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`${new URL(url).host} answered ${String(res.status)}`);
      return res;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/**
 * The notices and results a page of the department's site links to as XML:
 * `/download/?s=png&id=20261104PSR&ft=.xml`, with `&y=2010` for an earlier year.
 */
export function saleFiles(html) {
  const files = new Map();
  const link = /\/download\/\?s=png&amp;id=(\d{8})(PON|PSR)&amp;ft=\.xml(?:&amp;y=(\d{4}))?['"]/g;
  for (const [, date, kind, year] of html.matchAll(link)) {
    files.set(`${date}${kind}`, { date, kind, year: year ?? null });
  }
  return [...files.values()];
}

/** The earlier years the page offers in its list (`<option value='2023'>`), oldest first. */
export function saleYears(html) {
  return [...html.matchAll(/<option value=['"](\d{4})['"]/g)].map((m) => Number(m[1])).sort();
}

async function mainFetch(argv) {
  const [dir, firstYear] = argv;
  const first = /^\d{4}$/.test(firstYear ?? '') ? Number(firstYear) : Number.NaN;
  const thisYear = new Date().getUTCFullYear();
  if (!dir || !(first >= FIRST_YEAR && first <= thisYear)) fail(usage(), 2);
  const files = new Map();
  const keep = (html) => {
    for (const file of saleFiles(html)) {
      if (Number(file.date.slice(0, 4)) >= first) files.set(`${file.date}${file.kind}`, file);
    }
  };
  // The page as it opens holds the current sales, and lists the earlier years it can be asked
  // for by its form.
  const current = await (await get(PAGE_URL)).text();
  keep(current);
  for (const year of saleYears(current).filter((y) => y >= first)) {
    await sleep(300);
    const body = new URLSearchParams({ ddlYear: String(year), btnApply: '1' });
    keep(await (await get(PAGE_URL, { method: 'POST', body })).text());
  }
  if (files.size === 0) fail('The page listed no sale files; nothing was saved.');
  let saved = 0;
  for (const [name, file] of [...files.entries()].sort()) {
    const query = new URLSearchParams({ s: 'png', id: name, ft: '.xml' });
    if (file.year) query.set('y', file.year);
    const res = await get(`${SITE}/download/?${query.toString()}`);
    const text = await res.text();
    // A file the page links to but the site no longer has answers with a short page.
    if (text.includes('<Parcel>') || text.includes('<Contract>')) {
      writeFileSync(join(dir, `${name}.xml`), text);
      saved += 1;
    }
    await sleep(250);
  }
  console.error(
    `Sale files: ${String(files.size)} listed since ${String(first)}, ${String(saved)} saved.`,
  );
}

async function mainSections(argv) {
  const [west, south, east, north, out] = argv;
  const area = areaOf(west, south, east, north);
  if (!area || !out) fail(usage(), 2);
  const lines = [];
  let skipped = 0;
  for (let n = 0; ; n += 1) {
    if (n >= MAX_PAGES)
      fail(`More than ${String(MAX_PAGES)} pages of sections; nothing was written.`);
    const body = new URLSearchParams({
      // A section itself, not the road allowances beside it.
      where: "RA = ' '",
      geometry: `${String(area.west)},${String(area.south)},${String(area.east)},${String(area.north)}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'M,RGE,TWP,SEC',
      returnGeometry: 'true',
      outSR: '4326',
      geometryPrecision: '5',
      orderByFields: 'OBJECTID',
      resultOffset: String(n * PAGE),
      resultRecordCount: String(PAGE),
      f: 'geojson',
    });
    const answer = await (await get(SECTIONS_URL, { method: 'POST', body })).json();
    if (!Array.isArray(answer.features)) fail('The township grid sent no list of sections.');
    for (const feature of answer.features) {
      const p = feature.properties ?? {};
      const ring =
        feature.geometry?.type === 'Polygon' ? feature.geometry.coordinates?.[0] : undefined;
      const corners = sectionCorners(ring);
      const numbers = [p.M, p.RGE, p.TWP, p.SEC];
      if (!corners || !numbers.every((v) => Number.isInteger(v) && v > 0)) {
        skipped += 1;
        continue;
      }
      lines.push(JSON.stringify([numbers.join('-'), corners]));
    }
    if (answer.features.length < PAGE) break;
    await sleep(300);
  }
  if (lines.length === 0) fail('No sections in the area; nothing was written.');
  writeFileSync(out, `${lines.join('\n')}\n`);
  console.error(
    `Sections: ${String(lines.length)} in the area, ${String(skipped)} skipped as unreadable.`,
  );
}

/** A value for COPY's CSV format: empty for null, quoted otherwise, always on one line. */
function csv(value) {
  if (value === null || value === undefined) return '';
  return `"${String(value)
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('"', '""')}"`;
}

function readSections(file) {
  const sections = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line === '') continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      row = null;
    }
    const [key, corners] = Array.isArray(row) ? row : [];
    const ok =
      typeof key === 'string' &&
      /^[4-6]-\d{1,2}-\d{1,3}-\d{1,2}$/.test(key) &&
      Array.isArray(corners) &&
      corners.length === 4 &&
      corners.every(
        (c) =>
          Array.isArray(c) &&
          c.length === 2 &&
          c[0] >= ALBERTA.west &&
          c[0] <= ALBERTA.east &&
          c[1] >= ALBERTA.south &&
          c[1] <= ALBERTA.north,
      );
    if (!ok) fail('A section is not in the form "sections" writes; nothing was loaded.', 2);
    sections.set(key, corners);
  }
  return sections;
}

function mainSql(argv) {
  const [dir, sectionsFile, west, south, east, north, grainBytes] = argv;
  const area = areaOf(west, south, east, north);
  const bytes = /^\d{1,15}$/.test(grainBytes ?? '') ? Number(grainBytes) : Number.NaN;
  if (!dir || !sectionsFile || !area || !Number.isSafeInteger(bytes)) fail(usage(), 2);
  const sections = readSections(sectionsFile);

  const names = readdirSync(dir).filter((name) => /^\d{8}(PON|PSR)\.xml$/.test(name));
  const results = new Map();
  for (const name of names.filter((n) => n.includes('PSR'))) {
    const read = parseSaleResults(readFileSync(join(dir, name), 'utf8'));
    if (read) results.set(read.saleDate, new Map(read.parcels.map((p) => [p.contractNo, p])));
  }
  const rows = [];
  const sales = [];
  let outside = 0;
  for (const name of names.filter((n) => n.includes('PON')).sort()) {
    const notice = parseSaleNotice(readFileSync(join(dir, name), 'utf8'));
    if (!notice) continue;
    sales.push(notice.saleDate);
    const sold = results.get(notice.saleDate);
    const seen = new Set();
    for (const parcel of notice.parcels) {
      if (seen.has(parcel.contractNo) || parcel.lands.length === 0) continue;
      seen.add(parcel.contractNo);
      const placed = placeParcel(parcel.lands, sections);
      if (!placed) {
        outside += 1;
        continue;
      }
      const result = sold?.get(parcel.contractNo);
      const [w, s, e, n] = placed.bounds;
      rows.push(
        [
          notice.saleDate,
          parcel.contractNo,
          parcel.contractType?.slice(0, 20),
          parcel.region?.slice(0, 40),
          parcel.hectares,
          parcel.zone,
          parcel.lands.join(' ').slice(0, 8000),
          parcel.portion || placed.placed < placed.of ? 't' : 'f',
          result?.status,
          result?.bonus,
          result?.dollarsPerHectare,
          result?.buyers,
          `(${String(e)},${String(n)}),(${String(w)},${String(s)})`,
          JSON.stringify(placed.shape),
        ]
          .map(csv)
          .join(','),
      );
    }
  }
  if (sales.length === 0) fail('No sale notice could be read; nothing was loaded.', 2);
  if (rows.length === 0) fail('No parcel of any sale lies in the area; nothing was loaded.', 2);
  sales.sort();
  console.error(
    `Land sales: ${String(sales.length)} sales from ${sales[0]} to ${sales[sales.length - 1]}, ${String(results.size)} results files; ${String(rows.length)} parcels in the area, ${String(outside)} outside it.`,
  );

  const columns =
    'sale_date, contract_no, contract_type, region, hectares, zone, land, inexact, status, bonus, dollars_per_hectare, buyers, bounds, shape';
  const out = [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '15min', true);",
    // Emptied at once (and put back if the load fails): a delete would leave the old rows
    // as dead weight that the size guard counts.
    'truncate petro.land_sale_parcels;',
    `copy petro.land_sale_parcels (${columns}) from stdin with (format csv);`,
  ];
  const flush = () => {
    writeSync(1, `${out.join('\n')}\n`);
    out.length = 0;
  };
  flush();
  for (let i = 0; i < rows.length; i += 2000) {
    out.push(...rows.slice(i, i + 2000));
    flush();
  }
  out.push(
    '\\.',
    'insert into petro.land_sale_loads (source_url, first_sale, last_sale, west, south, east, north, sales, parcels)',
    `values ('${PAGE_URL}', '${sales[0]}', '${sales[sales.length - 1]}', ${String(area.west)}, ${String(area.south)}, ${String(area.east)}, ${String(area.north)}, ${String(sales.length)}, ${String(rows.length)});`,
    // Measured inside the transaction, with the new rows written: over the guard, nothing stays.
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(bytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 400 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select count(*) as parcels, count(status) as with_results, min(sale_date) as first_sale, max(sale_date) as last_sale, pg_size_pretty(pg_total_relation_size('petro.land_sale_parcels')) as size, pg_size_pretty(pg_database_size(current_database())) as oil_and_gas_database from petro.land_sale_parcels;",
  );
  flush();
}

/**
 * The area a play's sales are loaded for (F-264): the box around its wells, widened to hold
 * every point of the play's outline, each edge to two decimals outward and no farther than
 * Alberta's. The map shows a play's sales inside its outline, which reaches beyond the wells.
 */
function mainArea(argv) {
  const [west, south, east, north, outlineFile] = argv;
  const box = areaOf(west, south, east, north);
  if (!box || !outlineFile) fail(usage(), 2);
  let outline;
  try {
    outline = JSON.parse(readFileSync(outlineFile, 'utf8'));
  } catch {
    fail('The outline could not be read; no area was worked out.', 2);
  }
  let points = 0;
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    const [x, y] = value;
    if (typeof x === 'number' && typeof y === 'number') {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      box.west = Math.min(box.west, x);
      box.east = Math.max(box.east, x);
      box.south = Math.min(box.south, y);
      box.north = Math.max(box.north, y);
      points += 1;
      return;
    }
    for (const part of value) walk(part);
  };
  for (const feature of Array.isArray(outline?.features) ? outline.features : []) {
    walk(feature?.geometry?.coordinates);
  }
  if (points === 0) fail('The outline has no points; no area was worked out.', 2);
  const out = (edge, limit, round, keep) => keep(limit, round(edge * 100) / 100).toFixed(2);
  console.log(
    [
      out(box.west, ALBERTA.west, Math.floor, Math.max),
      out(box.south, ALBERTA.south, Math.floor, Math.max),
      out(box.east, ALBERTA.east, Math.ceil, Math.min),
      out(box.north, ALBERTA.north, Math.ceil, Math.min),
    ].join(' '),
  );
}

async function main(argv) {
  if (argv[0] === 'fetch') await mainFetch(argv.slice(1));
  else if (argv[0] === 'sections') await mainSections(argv.slice(1));
  else if (argv[0] === 'sql') mainSql(argv.slice(1));
  else if (argv[0] === 'area') mainArea(argv.slice(1));
  else fail(usage(), 2);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
