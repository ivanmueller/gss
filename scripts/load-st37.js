#!/usr/bin/env node
// Writes the SQL that loads the AER's ST37 wells into the oil and gas database: one area
// (F-243 part 4) or one formation whole (F-252); run by .github/workflows/load-st37.yml,
// "Load ST37 wells".
//
//   node --experimental-strip-types scripts/load-st37.js <dir> <west> <south> <east> <north> \
//     <source-url> <source-date|-> <grain-bytes> [formation] > load.sql
//
// <dir> holds surface.geojson, bottom.geojson, strings.geojson and paths.geojson, the four
// layers of ST_37_Wells.gdb cut to the area (or to the formation's licences) by ogr2ogr
// (EPSG:4326; the paths with their elevations, -dim XYZ, for the 3D view, F-261). <grain-bytes> is the size of grain's database: the load is refused, and nothing
// changes, if both databases together would pass 400 MB (the free plan's limit is shared,
// docs/DECISIONS.md, 2026-11-19).
//
// With a formation (`duvernay`), <dir> also holds licences.json, written by the first step:
//
//   node --experimental-strip-types scripts/load-st37.js pick <formation> \
//     <pool-strings.geojson> <well-licence.csv> <dir>
//
// which reads the formation's production strings (cut from ST37 by pool code) and Petrinex's
// public Well Licence file, and writes <dir>/licences.csv (every licence of the formation, which
// ogr2ogr cuts the layers by) and <dir>/licences.json (what each licence planned). The load then gives
// each well with no drilled path yet its planned bottom hole, the legal subdivision in its UWI,
// placed from the province's township grid (F-243 part 4b).
//
// The SQL replaces the whole ST37 copy in one transaction, so the map never shows half a load.
// The AER's and Petrinex's data is never written to the repository: the files live only on the
// runner.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { URLSearchParams } from 'node:url';

import {
  buildSt37Wells,
  ST37_FORMATIONS,
  st37FieldPools,
  st37FormationLicences,
  st37LsdCentres,
  st37LsdKey,
  st37NeedsPlan,
  st37PlanBottoms,
  st37UwiLsd,
} from '../packages/domain/src/st37.ts';

const BUDGET_BYTES = 400 * 1024 * 1024;
const ALBERTA = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };
/** The province's township grid, legal subdivisions (as the Worker's daily lists use it). */
const ATS_LSD_QUERY =
  'https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer/20/query';
const LSD_BATCH = 40;

export function usage() {
  return [
    'usage: load-st37.js <dir> <west> <south> <east> <north> <source-url> <source-date|-> <grain-bytes> [formation]',
    '       load-st37.js pick <formation> <pool-strings.geojson> <well-licence.csv> <dir>',
    '       load-st37.js codes <FieldPoolList.txt> <source-url> <source-date|->',
  ].join('\n');
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

/** The box around the wells' surface holes, a little wider, for "Go to the wells loaded". */
export function boxOf(wells) {
  let { east: west, north: south, west: east, south: north } = ALBERTA;
  for (const w of wells) {
    west = Math.min(west, w.surface[0]);
    east = Math.max(east, w.surface[0]);
    south = Math.min(south, w.surface[1]);
    north = Math.max(north, w.surface[1]);
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    west: Math.max(ALBERTA.west, round(west - 0.05)),
    south: Math.max(ALBERTA.south, round(south - 0.05)),
    east: Math.min(ALBERTA.east, round(east + 0.05)),
    north: Math.min(ALBERTA.north, round(north + 0.05)),
  };
}

export function sqlFor(wells, area, sourceUrl, sourceDate, grainBytes, formation = null) {
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
    'field_code',
    'spud_date',
    'final_drill_date',
    'total_depth_m',
    'true_vertical_depth_m',
    'surface_longitude',
    'surface_latitude',
    'bottom_longitude',
    'bottom_latitude',
    'path',
    'licence_date',
    'planned_operation',
    'planned_formation',
    'planned_depth_m',
    'planned_bottom_longitude',
    'planned_bottom_latitude',
    'formation',
    'path_3d',
    'path_surveyed',
    'kb_elevation_m',
    'ground_elevation_m',
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
      w.fieldCode,
      w.spudDate,
      w.finalDrillDate,
      w.totalDepthM,
      w.trueVerticalDepthM,
      w.surface[0],
      w.surface[1],
      w.bottom[0],
      w.bottom[1],
      w.path === null ? null : JSON.stringify(w.path),
      w.licenceDate,
      w.plannedOperation,
      w.plannedFormation,
      w.plannedDepthM,
      w.plannedBottom?.[0] ?? null,
      w.plannedBottom?.[1] ?? null,
      formation,
      w.path3d === null ? null : JSON.stringify(w.path3d),
      w.pathSurveyed,
      w.kbElevationM,
      w.groundElevationM,
    ]
      .map(csv)
      .join(','),
  );
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '10min', true);",
    // Only this play's wells are replaced (or, for a rectangle, the wells of no play): the other
    // plays stay as they are. A well another play already holds stays with that play.
    'create temporary table st37_incoming (like petro.st37_wells) on commit drop;',
    `copy st37_incoming (${columns.join(', ')}) from stdin with (format csv);`,
    ...rows,
    '\\.',
    `delete from petro.st37_wells where formation is not distinct from ${formation ? literal(formation) : 'null'};`,
    `insert into petro.st37_wells (${columns.join(', ')}) select ${columns.join(', ')} from st37_incoming on conflict (uwi) do nothing;`,
    'insert into petro.st37_loads (source_url, source_date, west, south, east, north, wells, formation)',
    `values (${literal(sourceUrl)}, ${sourceDate ? `${literal(sourceDate)}::date` : 'null'}, ${String(area.west)}, ${String(area.south)}, ${String(area.east)}, ${String(area.north)}, ${String(wells.length)}, ${formation ? literal(formation) : 'null'});`,
    // Measured inside the transaction, with the new rows written: over the guard, nothing stays.
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(grainBytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 400 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
    'commit;',
    "select count(*) as wells, count(path) as with_paths, count(path_3d) as with_depths, count(planned_bottom_longitude) as planned_lines, pg_size_pretty(pg_total_relation_size('petro.st37_wells')) as size from petro.st37_wells;",
    '',
  ].join('\n');
}

/**
 * The SQL that replaces the AER's fields and pools (ST103's list) in one transaction (F-256).
 */
export function codesSql(list, sourceUrl, sourceDate) {
  const fields = [...list.fields.entries()].sort(([a], [b]) => a - b);
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    "select set_config('statement_timeout', '10min', true);",
    'delete from petro.fields;',
    'copy petro.fields (field_code, name) from stdin with (format csv);',
    ...fields.map(([code, name]) => `${String(code)},${csv(name)}`),
    '\\.',
    'copy petro.pools (field_code, pool_code, name) from stdin with (format csv);',
    ...list.pools.map((p) => `${String(p.fieldCode)},${String(p.poolCode)},${csv(p.name)}`),
    '\\.',
    'insert into petro.field_pool_loads (source_url, source_date, fields, pools)',
    `values (${literal(sourceUrl)}, ${sourceDate ? `${literal(sourceDate)}::date` : 'null'}, ${String(fields.length)}, ${String(list.pools.length)});`,
    'commit;',
    'select (select count(*) from petro.fields) as fields, (select count(*) from petro.pools) as pools;',
    '',
  ].join('\n');
}

function mainCodes(argv) {
  const [file, sourceUrl, sourceDate] = argv;
  const date = sourceDate && sourceDate !== '-' ? sourceDate : null;
  if (
    !file ||
    !sourceUrl ||
    !/^https:\/\/[a-z.]*aer\.ca\//.test(sourceUrl) ||
    (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))
  ) {
    console.error(usage());
    process.exit(2);
  }
  const list = st37FieldPools(readFileSync(file, 'latin1'));
  console.error(
    `ST103: ${String(list.fields.size)} fields, ${String(list.pools.length)} pools, ${String(list.skipped)} lines skipped as unreadable.`,
  );
  if (list.fields.size === 0) {
    console.error('No fields read: nothing to load.');
    process.exit(1);
  }
  process.stdout.write(codesSql(list, sourceUrl, date));
}

const readFeatures = (file) => JSON.parse(readFileSync(file, 'utf8')).features ?? [];

/**
 * The formation's licences: those of its production strings, and those Petrinex's file says
 * aim at it. Returns the list ogr2ogr cuts by and what each licence planned.
 */
export function pick(formation, poolStrings, licenceCsv) {
  const planned = st37FormationLicences(licenceCsv, formation);
  const licences = new Set(planned.keys());
  let inPools = 0;
  for (const f of poolStrings) {
    const pool = f.properties?.Pool_Code;
    const raw = f.properties?.Well_Licence_Number;
    const licence = typeof raw === 'string' ? raw.trim() : '';
    if (typeof pool !== 'number' || pool < formation.poolFrom || pool > formation.poolTo) continue;
    if (!/^[0-9A-Z]{1,9}$/.test(licence)) continue;
    inPools += 1;
    licences.add(licence);
  }
  return {
    // One licence a line, under a header: ogr2ogr joins the ST37 layers to it.
    csv: ['licence', ...[...licences].sort(), ''].join('\n'),
    licences: Object.fromEntries(planned),
    count: licences.size,
    inPools,
    aimed: planned.size,
  };
}

/** The centres of the legal subdivisions the planned lines need, from the township grid. */
async function lsdCentres(wells) {
  const wanted = new Map();
  for (const w of wells) {
    if (!st37NeedsPlan(w)) continue;
    const lsd = st37UwiLsd(w.uwi);
    if (lsd) wanted.set(st37LsdKey(lsd), lsd);
  }
  const all = [...wanted.values()];
  const centres = new Map();
  for (let i = 0; i < all.length; i += LSD_BATCH) {
    const where = all
      .slice(i, i + LSD_BATCH)
      .map(
        (s) =>
          `(M=${String(s.meridian)} AND RGE=${String(s.range)} AND TWP=${String(s.township)} AND SEC=${String(s.section)} AND LS=${String(s.lsd)})`,
      )
      .join(' OR ');
    const body = new URLSearchParams({
      where,
      outFields: 'M,RGE,TWP,SEC,LS',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'geojson',
    });
    const res = await fetch(ATS_LSD_QUERY, {
      method: 'POST',
      body,
      signal: globalThis.AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`township grid answered ${String(res.status)}`);
    for (const [key, centre] of st37LsdCentres(await res.json())) centres.set(key, centre);
  }
  return { centres, asked: all.length };
}

function mainPick(argv) {
  const [key, poolFile, licenceFile, dir] = argv;
  const formation = ST37_FORMATIONS[key ?? ''];
  if (!formation || !poolFile || !licenceFile || !dir) {
    console.error(usage());
    process.exit(2);
  }
  const picked = pick(formation, readFeatures(poolFile), readFileSync(licenceFile, 'utf8'));
  console.error(
    `${formation.name}: ${String(picked.count)} licences (${String(picked.inPools)} production strings in its pools, ${String(picked.aimed)} licences aimed at it).`,
  );
  if (picked.count === 0) {
    console.error('No licences found: nothing to load.');
    process.exit(1);
  }
  writeFileSync(join(dir, 'licences.csv'), picked.csv);
  writeFileSync(join(dir, 'licences.json'), JSON.stringify(picked.licences));
}

async function main(argv) {
  if (argv[0] === 'codes') {
    mainCodes(argv.slice(1));
    return;
  }
  if (argv[0] === 'pick') {
    mainPick(argv.slice(1));
    return;
  }
  const [dir, west, south, east, north, sourceUrl, sourceDate, grainBytes, formationKey] = argv;
  const area = {
    west: Number(west),
    south: Number(south),
    east: Number(east),
    north: Number(north),
  };
  const bytes = Number(grainBytes);
  const formation = formationKey ? ST37_FORMATIONS[formationKey] : null;
  if (
    !dir ||
    !sourceUrl ||
    !/^https:\/\/[a-z.]*aer\.ca\//.test(sourceUrl) ||
    Object.values(area).some((n) => !Number.isFinite(n)) ||
    !(area.west < area.east && area.south < area.north) ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    formation === undefined
  ) {
    console.error(usage());
    process.exit(2);
  }
  const date = sourceDate && sourceDate !== '-' ? sourceDate : null;
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('source date must be YYYY-MM-DD or -');
    process.exit(2);
  }
  const read = (name) => readFeatures(join(dir, name));
  const licences = formation
    ? new Map(Object.entries(JSON.parse(readFileSync(join(dir, 'licences.json'), 'utf8'))))
    : new Map();
  const { wells, skipped } = buildSt37Wells(
    {
      surface: read('surface.geojson'),
      bottom: read('bottom.geojson'),
      strings: read('strings.geojson'),
      paths: read('paths.geojson'),
    },
    formation ? ALBERTA : area,
    licences,
  );
  const withPaths = wells.filter((w) => w.path !== null).length;
  const withDepths = wells.filter((w) => w.path3d !== null).length;
  console.error(
    `ST37: ${String(wells.length)} wells in ${formation ? `the ${formation.name}` : 'the area'} (${String(withPaths)} with drilled paths, ${String(withDepths)} with depths along the path), ${String(skipped)} records skipped as unreadable.`,
  );
  if (wells.length === 0) {
    console.error('No wells: nothing to load.');
    process.exit(1);
  }
  const { centres, asked } = await lsdCentres(wells);
  const planned = st37PlanBottoms(wells, centres);
  console.error(
    `Planned lines: ${String(planned)} wells with no drilled path yet (${String(asked)} subdivisions asked of the township grid, ${String(centres.size)} found).`,
  );
  process.stdout.write(
    sqlFor(wells, formation ? boxOf(wells) : area, sourceUrl, date, bytes, formation?.key ?? null),
  );
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
