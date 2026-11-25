#!/usr/bin/env node
// Loads land held today into the oil and gas database (F-241): Crown petroleum and natural gas
// and oil sands agreements, active offset notices and land whose petroleum and natural gas is
// not the Crown's, from the Government of Alberta's public map services, for one area. Run by
// .github/workflows/load-land.yml, "Load land".
//
//   node --experimental-strip-types scripts/load-land.js fetch <layer> <west> <south> <east> \
//     <north> <out.ndjson>
//
// asks the layer's service for every shape touching the area, a page of 1,000 at a time and one
// request at a time (they are the province's production servers), and writes one row a line.
//
//   node --experimental-strip-types scripts/load-land.js sql <dir> <west> <south> <east> \
//     <north> <grain-bytes> > load.sql
//
// reads <dir>/<layer>.ndjson for the four layers and writes the SQL that replaces the whole copy
// in one transaction, so the map never shows half a load. <grain-bytes> is the size of grain's
// database: the load is refused, and nothing changes, if both databases together would pass
// 450 MB (the free plan's limit is shared, docs/DECISIONS.md, 2026-11-19).
//
// Offset notices come from a server of the province's that can be down while the others answer
// (2026-11-22: it listed its layer groups with none of their layers). When their file is missing,
// the stored offset notices are kept as they are, with their own load's date and box, and the
// other layers are loaded; every other layer's file is required.
//
// The province's data is never written to the repository: the files live only on the runner.

import { existsSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { URLSearchParams } from 'node:url';

import {
  LAND_LAYER_KEYS,
  LAND_LAYERS,
  landRows,
  packLandShape,
} from '../packages/domain/src/land.ts';

const BUDGET_BYTES = 450 * 1024 * 1024;
const ALBERTA = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };
const PAGE = 1000;
/** No layer of one area is expected to hold more; a service that never ends is stopped here. */
const MAX_PAGES = 400;

function usage() {
  return [
    'usage: load-land.js fetch <layer> <west> <south> <east> <north> <out.ndjson>',
    '       load-land.js sql <dir> <west> <south> <east> <north> <grain-bytes>',
    `layers: ${LAND_LAYER_KEYS.join(', ')}`,
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

async function page(layer, area, offset) {
  const body = new URLSearchParams({
    where: '1=1',
    geometry: `${String(area.west)},${String(area.south)},${String(area.east)},${String(area.north)}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '5',
    orderByFields: layer.idField,
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: 'geojson',
  });
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(5000 * attempt);
    try {
      const res = await fetch(`${layer.url}/query`, {
        method: 'POST',
        body,
        signal: globalThis.AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`the service answered ${String(res.status)}`);
      const answer = await res.json();
      // An ArcGIS service reports its own errors inside an answer of 200.
      if (!Array.isArray(answer.features)) throw new Error('the service sent no list of shapes');
      return answer.features;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

async function mainFetch(argv) {
  const [key, west, south, east, north, out] = argv;
  const layer = LAND_LAYERS[key ?? ''];
  const area = areaOf(west, south, east, north);
  if (!layer || !area || !out) fail(usage(), 2);
  const lines = [];
  let skipped = 0;
  for (let n = 0; ; n += 1) {
    if (n >= MAX_PAGES) fail(`${key}: more than ${String(MAX_PAGES)} pages; nothing was written.`);
    const features = await page(layer, area, n * PAGE);
    const read = landRows(layer.key, features);
    skipped += read.skipped;
    for (const row of read.rows) lines.push(JSON.stringify(row));
    if (features.length < PAGE) break;
    await sleep(300);
  }
  writeFileSync(out, lines.length > 0 ? `${lines.join('\n')}\n` : '');
  console.error(
    `${key}: ${String(lines.length)} shapes, ${String(skipped)} skipped as unreadable.`,
  );
}

/** A value for COPY's CSV format: empty for null, quoted otherwise, always on one line. */
function csv(value) {
  if (value === null || value === undefined) return '';
  return `"${String(value)
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('"', '""')}"`;
}

const isText = (v) => v === null || typeof v === 'string';
const isAmount = (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
const isDate = (v) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));

/**
 * The box and the shape as COPY takes them, the shape as whole numbers (F-310); null when the
 * row's place is not what fetch writes.
 */
function placed(row) {
  const b = row.bounds;
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => Number.isFinite(n))) return null;
  const [west, south, east, north] = b;
  if (
    west < ALBERTA.west ||
    east > ALBERTA.east ||
    south < ALBERTA.south ||
    north > ALBERTA.north
  ) {
    return null;
  }
  if (!Array.isArray(row.shape) || row.shape.length === 0) return null;
  const numbers = (v) => (Array.isArray(v) ? v.every(numbers) : Number.isFinite(v));
  if (!numbers(row.shape)) return null;
  const packed = packLandShape(row.shape);
  if (!packed) return null;
  return [
    `(${String(east)},${String(north)}),(${String(west)},${String(south)})`,
    `{${packed.path.join(',')}}`,
    `{${packed.rings.join(',')}}`,
  ];
}

const TABLES = {
  agreements: {
    table: 'petro.land_agreements',
    columns:
      'rights, agreement_type, agreement_number, tract, mineral_type, agreement_group, status, vintage, holder, parties, zone, original_area_ha, area_ha, term_date, continuation_date, expiry_text, bounds, path, rings',
    values(r) {
      const ok =
        (r.rights === 'png' || r.rights === 'oil_sands') &&
        /^[0-9A-Z]{1,3}$/.test(r.agreementType ?? '') &&
        /^[0-9A-Z]{1,10}$/.test(r.agreementNumber ?? '') &&
        [
          r.tract,
          r.mineralType,
          r.agreementGroup,
          r.status,
          r.vintage,
          r.holder,
          r.parties,
          r.zone,
          r.expiryText,
        ].every(isText) &&
        isAmount(r.originalAreaHa) &&
        isAmount(r.areaHa) &&
        isDate(r.termDate) &&
        isDate(r.continuationDate);
      if (!ok) return null;
      return [
        r.rights,
        r.agreementType,
        r.agreementNumber,
        r.tract,
        r.mineralType,
        r.agreementGroup,
        r.status,
        r.vintage,
        r.holder,
        r.parties,
        r.zone,
        r.originalAreaHa,
        r.areaHa,
        r.termDate,
        r.continuationDate,
        r.expiryText,
      ];
    },
  },
  offsets: {
    table: 'petro.land_offsets',
    columns: 'offset_type, offset_number, tract, holder, expiry_date, zone, bounds, path, rings',
    values(r) {
      const ok =
        /^[0-9A-Z]{1,20}$/.test(r.offsetNumber ?? '') &&
        [r.offsetType, r.tract, r.holder, r.zone].every(isText) &&
        isDate(r.expiryDate);
      if (!ok) return null;
      return [r.offsetType, r.offsetNumber, r.tract, r.holder, r.expiryDate, r.zone];
    },
  },
  freehold: {
    table: 'petro.land_freehold',
    columns:
      'land_key, substances, national_park, reserve_number, reserve_name, bounds, path, rings',
    values(r) {
      const ok =
        (r.landKey === null || Number.isSafeInteger(r.landKey)) &&
        [r.substances, r.nationalPark, r.reserveNumber, r.reserveName].every(isText);
      if (!ok) return null;
      return [r.landKey, r.substances, r.nationalPark, r.reserveNumber, r.reserveName];
    },
  },
};
const TABLE_OF = {
  png_agreements: 'agreements',
  oil_sands_agreements: 'agreements',
  offset_notices: 'offsets',
  freehold: 'freehold',
};
/** Layers whose stored copy is kept when the run has no file for them (see the top). */
const OPTIONAL = new Set(['offset_notices']);

function mainSql(argv) {
  const [dir, west, south, east, north, grainBytes] = argv;
  const area = areaOf(west, south, east, north);
  const bytes = /^\d{1,15}$/.test(grainBytes ?? '') ? Number(grainBytes) : Number.NaN;
  if (!dir || !area || !Number.isSafeInteger(bytes)) fail(usage(), 2);

  const lines = { agreements: [], offsets: [], freehold: [] };
  const counts = {};
  const kept = new Set();
  for (const key of LAND_LAYER_KEYS) {
    const kind = TABLE_OF[key];
    const file = join(dir, `${key}.ndjson`);
    if (!existsSync(file)) {
      if (!OPTIONAL.has(key)) fail(`${key}: no file was read; nothing was loaded.`, 2);
      kept.add(key);
      console.error(`${key}: not read this time; the stored copy is kept as it is.`);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    counts[key] = 0;
    for (const line of text.split('\n')) {
      if (line === '') continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        row = null;
      }
      const values = row && typeof row === 'object' ? TABLES[kind].values(row) : null;
      const place = values ? placed(row) : null;
      if (!place) fail(`${key}: a row is not in the form fetch writes; nothing was loaded.`, 2);
      lines[kind].push([...values, ...place].map(csv).join(','));
      counts[key] += 1;
    }
  }
  if (counts.png_agreements === 0) {
    fail('No petroleum and natural gas agreements in the area: nothing was loaded.', 2);
  }

  const out = [];
  const flush = () => {
    writeSync(1, `${out.join('\n')}\n`);
    out.length = 0;
  };
  out.push(
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '15min', true);",
  );
  for (const kind of ['agreements', 'offsets', 'freehold']) {
    const layers = LAND_LAYER_KEYS.filter((key) => TABLE_OF[key] === kind);
    if (layers.every((key) => kept.has(key))) continue;
    const { table, columns } = TABLES[kind];
    // Emptied at once (and put back if the load fails): a delete would leave the old rows as
    // dead weight that the size guard counts. The old copy's files stay on disk until the
    // commit and are counted by pg_database_size until then: its size, taken first, is left
    // out of the guard below (F-310), or a load that makes a table smaller could be refused.
    out.push(
      `select set_config('petro.load_freed', (coalesce(nullif(current_setting('petro.load_freed', true), ''), '0')::bigint + pg_total_relation_size('${table}'))::text, true);`,
      `truncate ${table};`,
      `copy ${table} (${columns}) from stdin with (format csv);`,
    );
    flush();
    for (let i = 0; i < lines[kind].length; i += 2000) {
      out.push(...lines[kind].slice(i, i + 2000));
      flush();
    }
    out.push('\\.');
  }
  const box = `${String(area.west)}, ${String(area.south)}, ${String(area.east)}, ${String(area.north)}`;
  for (const key of LAND_LAYER_KEYS) {
    if (kept.has(key)) continue;
    out.push(
      `insert into petro.land_loads (layer, source_url, west, south, east, north, shapes) values ('${key}', '${LAND_LAYERS[key].url}', ${box}, ${String(counts[key])});`,
    );
  }
  out.push(
    // Measured inside the transaction, with the new rows written and the old copy's files, freed
    // at the commit, left out: over the guard, nothing stays.
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) - coalesce(nullif(current_setting('petro.load_freed', true), ''), '0')::bigint + ${String(bytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 450 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select (select count(*) from petro.land_agreements) as agreement_tracts, (select count(*) from petro.land_offsets) as offset_tracts, (select count(*) from petro.land_freehold) as freehold_shapes, pg_size_pretty(pg_total_relation_size('petro.land_agreements') + pg_total_relation_size('petro.land_offsets') + pg_total_relation_size('petro.land_freehold')) as size, pg_size_pretty(pg_database_size(current_database())) as oil_and_gas_database;",
  );
  flush();
}

async function main(argv) {
  if (argv[0] === 'fetch') await mainFetch(argv.slice(1));
  else if (argv[0] === 'sql') mainSql(argv.slice(1));
  else fail(usage(), 2);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
