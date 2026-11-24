#!/usr/bin/env node
// Loads geology into the oil and gas database (F-287 part 1); run by
// .github/workflows/load-geology.yml, "Load geology".
//
// Two sets, both the Alberta Geological Survey's, under the Open Government Licence – Alberta:
//
// 1. Formation tops picked in wells: the picks of the Geological Framework of Alberta, Version 4
//    (its bulk download "Point data.zip": a shapefile pair per zone, NAD83 latitude and longitude
//    in the "_wgs84" files; about 1.26 million picks in 291,000 wells). Only the wells near the
//    wells we hold are kept (KEEP_NEAREST, KEEP_KM), each well as one row with its picks as lists.
//
//      node --experimental-strip-types scripts/load-geology.js picks <zip|dir> <held.csv> <out.json>
//
//    <held.csv> has a line a well we hold: licence, surface longitude, surface latitude, bottom
//    longitude, bottom latitude. <zip|dir> is the Survey's zip (read with `unzip -p`, a file at a
//    time) or a folder of its .dbf and .shp files.
//
// 2. Rock-Eval samples: Digital Dataset 2013-0003 (one tab-delimited text file, 3,472 lines:
//    Tmax, TOC, hydrogen index and the rest, by well or outcrop). The laboratory's standards are
//    left out.
//
//      node --experimental-strip-types scripts/load-geology.js samples <zip|txt> <out.json>
//
// Then, for either:
//
//      node --experimental-strip-types scripts/load-geology.js sql <picks|samples> <out.json> \
//        <source-url> <source-date|-> <grain-bytes> > load.sql
//
// writes the SQL that replaces that set in one transaction, refused if grain's and the oil and
// gas databases together would pass 450 MB.

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import {
  createReadStream,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BUDGET_BYTES = 450 * 1024 * 1024;
/** For each well we hold, the picked wells kept nearest to its surface or bottom hole. */
export const KEEP_NEAREST = 3;
/** And no farther than this, in kilometres. */
export const KEEP_KM = 5;
/** Fewer picks than this in the Survey's file means it is not the one expected. */
const FEWEST_PICKS = 500_000;
const FEWEST_SAMPLES = 2_000;

export const PICKS_SOURCE =
  'https://aercclrsuatagsgispub01.blob.core.windows.net/arcgis-online/projects/GFA/Bulk_download/Point%20data.zip';
export const SAMPLES_SOURCE = 'https://static.ags.aer.ca/files/document/DIG/DIG_2013_0003.zip';

const UWI = /^[0-9A-Z]{2}\/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]\/[0-9A-Z]$/;
const LICENCE = /^[0-9A-Z]{0,9}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The pick's source, as stored: 1 the Survey's own, 2 the AER's other picks, 0 unknown. */
const SOURCES = new Map([
  ['Alberta Energy Regulator - Alberta Geological Survey', 1],
  ['Alberta Energy Regulator - other', 2],
  ['unknown', 0],
]);

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

/**
 * A UWI as the Survey writes it (16 characters: 1, the location exception, LSD, section,
 * township, range, W, meridian, event: 100010503705W500), or as Digital Dataset 2013-0003 writes
 * it (102/11-32-017-11W4/00), in the form of petro.st37_wells: 00/01-05-037-05W5/0. Null when it
 * is neither, or its event does not fit one character.
 */
export function ourUwi(raw) {
  const text = String(raw).trim().toUpperCase();
  let m = /^1([0-9A-Z]{2})(\d{2})(\d{2})(\d{3})(\d{2})W([4-6])0([0-9A-Z])$/.exec(text);
  if (!m) m = /^1([0-9A-Z]{2})\/(\d{2})-(\d{2})-(\d{3})-(\d{2})W([4-6])\/0([0-9A-Z])$/.exec(text);
  if (!m) return null;
  return `${m[1]}/${m[2]}-${m[3]}-${m[4]}-${m[5]}W${m[6]}/${m[7]}`;
}

/** A licence number as petro.st37_wells keeps it: seven digits, zero-padded (0152982). */
export function ourLicence(raw) {
  const text = String(raw).trim().toUpperCase();
  if (/^\d{1,7}$/.test(text)) return text.padStart(7, '0');
  return LICENCE.test(text) ? text : '';
}

/**
 * Reads a dBase file as a stream of [record number, { fieldName: text }] (names in lower case,
 * numbers from 0 in file order, as the shapefile's points), a chunk at a time, so a file of a
 * gigabyte is never held whole. Deleted records are skipped; their numbers are not reused.
 */
export async function* dbfRecords(chunks) {
  let buf = Buffer.alloc(0);
  let fields = null;
  let headerLen = 0;
  let recLen = 0;
  let left = 0;
  let index = 0;
  let started = false;
  for await (const chunk of chunks) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
    if (!fields) {
      if (buf.length < 32) continue;
      headerLen = buf.readUInt16LE(8);
      if (buf.length < headerLen) continue;
      left = buf.readUInt32LE(4);
      recLen = buf.readUInt16LE(10);
      fields = [];
      let off = 1;
      for (let o = 32; o + 32 <= headerLen && buf[o] !== 0x0d; o += 32) {
        const name = buf
          .toString('latin1', o, o + 11)
          .replace(/\0.*$/s, '')
          .toLowerCase();
        const len = buf[o + 16];
        fields.push({ name, off, len });
        off += len;
      }
      if (recLen < 1 || fields.length === 0) throw new Error('Not a dBase file.');
    }
    let at = started ? 0 : headerLen;
    started = true;
    while (left > 0 && at + recLen <= buf.length) {
      if (buf[at] !== 0x2a) {
        const row = {};
        for (const f of fields)
          row[f.name] = buf.toString('latin1', at + f.off, at + f.off + f.len).trim();
        yield [index, row];
      }
      at += recLen;
      index += 1;
      left -= 1;
    }
    buf = buf.subarray(at);
    if (left === 0) return;
  }
  if (!fields) throw new Error('Not a dBase file.');
}

const EARTH_M = 6378137;

/** A Web Mercator point (EPSG:3857, metres) as [longitude, latitude]. */
export function fromWebMercator(x, y) {
  return [
    (x / EARTH_M) * (180 / Math.PI),
    (2 * Math.atan(Math.exp(y / EARTH_M)) - Math.PI / 2) * (180 / Math.PI),
  ];
}

/**
 * The points of a point shapefile, in record order, as [longitude, latitude]. The Survey's
 * "_wgs84" files are in Web Mercator (their .prj: WGS_1984_Web_Mercator_Auxiliary_Sphere).
 */
export function shpPoints(buf, mercator) {
  const points = [];
  let at = 100;
  while (at + 8 <= buf.length) {
    const words = buf.readInt32BE(at + 4);
    const type = buf.readInt32LE(at + 8);
    // 1 Point, 11 PointZ, 21 PointM: x and y come first in all three.
    if (type !== 1 && type !== 11 && type !== 21) points.push(null);
    else {
      const x = buf.readDoubleLE(at + 12);
      const y = buf.readDoubleLE(at + 20);
      points.push(mercator ? fromWebMercator(x, y) : [x, y]);
    }
    at += 8 + words * 2;
  }
  return points;
}

/** Whether a .prj is Web Mercator (true) or plain latitude and longitude (false); else throws. */
export function prjIsMercator(prj) {
  if (/Web_Mercator|Mercator_Auxiliary_Sphere/i.test(prj)) return true;
  if (/^\s*GEOGCS\[/i.test(prj)) return false;
  throw new Error('A point file is in a projection the loader does not read.');
}

/** The first field of a record that is present, among names the Survey's files use. */
const pick = (row, ...names) => {
  for (const name of names) if (name in row) return row[name];
  return undefined;
};

/** Kilometres between two places, near enough at Alberta's latitudes. */
export function km(a, b) {
  const kx = 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.574);
}

/**
 * Gathers the picks of every file into one entry a well. A pick is the well, the surface it
 * marks and its name; the same pick listed in two zones' files is kept once (a second with a
 * different depth is counted as a conflict, the first kept).
 */
export function newPickReader() {
  const wells = new Map();
  const names = new Map();
  const counts = {
    rows: 0,
    kept: 0,
    skipped: 0,
    why: { uwi: 0, place: 0, name: 0, depth: 0 },
    conflicts: 0,
    notBorehole: 0,
  };
  return {
    counts,
    wells,
    names,
    add(row, point) {
      counts.rows += 1;
      if (String(pick(row, 'data_type') ?? '').toLowerCase() !== 'borehole') {
        counts.notBorehole += 1;
        return;
      }
      const uwi = ourUwi(pick(row, 'well_ident', 'well_id') ?? '');
      const name = String(pick(row, 'geo_name', 'geol_name', 'geological') ?? '').trim();
      const surface = String(pick(row, 'in_surface', 'input_surf') ?? '').trim();
      const tvd = Number(pick(row, 'tvd_m'));
      const kb = Number(pick(row, 'kbel_masl', 'kb_el_masl', 'kbel_masl28'));
      const source = SOURCES.get(String(pick(row, 'datasource', 'data_sourc') ?? '').trim()) ?? 0;
      const why = !uwi
        ? 'uwi'
        : !point ||
            !Number.isFinite(point[0]) ||
            !Number.isFinite(point[1]) ||
            point[0] < -121 ||
            point[0] > -109 ||
            point[1] < 48 ||
            point[1] > 61
          ? 'place'
          : !name || name.length > 120 || !/^[0-9]{2}[a-z]?_[A-Za-z0-9_ -]{1,60}$/.test(surface)
            ? 'name'
            : !Number.isFinite(tvd) || tvd < 0 || tvd > 9000
              ? 'depth'
              : null;
      if (why) {
        counts.skipped += 1;
        counts.why[why] += 1;
        return;
      }
      const nameKey = `${name}\t${surface}`;
      let nameId = names.get(nameKey);
      if (nameId === undefined) {
        nameId = names.size + 1;
        names.set(nameKey, nameId);
      }
      let well = wells.get(uwi);
      if (!well) {
        well = {
          uwi,
          licence: ourLicence(pick(row, 'welllicno', 'well_licen') ?? ''),
          kb: Number.isFinite(kb) && kb > -100 && kb < 4000 ? Math.round(kb * 100) / 100 : null,
          lon: 0,
          lat: 0,
          picks: new Map(),
        };
        wells.set(uwi, well);
      }
      const had = well.picks.get(nameId);
      if (had) {
        if (Math.abs(had.tvd - tvd) > 0.05) counts.conflicts += 1;
        return;
      }
      // The well's place: the average of its picks' places (a deviated well's picks drift).
      const n = well.picks.size;
      well.lon = (well.lon * n + point[0]) / (n + 1);
      well.lat = (well.lat * n + point[1]) / (n + 1);
      well.picks.set(nameId, { tvd: Math.round(tvd * 10) / 10, source });
      counts.kept += 1;
    },
  };
}

/** The wells we hold, from the workflow's CSV: licence and both ends of each well. */
export function heldWells(csv) {
  const held = [];
  for (const line of csv.split(/\r?\n/)) {
    const [licence, ...rest] = line.split(',');
    const n = rest.map(Number);
    if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) continue;
    held.push({
      licence: ourLicence(licence ?? ''),
      points: [
        [n[0], n[1]],
        [n[2], n[3]],
      ],
    });
  }
  return held;
}

/**
 * Which picked wells to keep: every one under a licence we hold, and for each well we hold the
 * KEEP_NEAREST picked wells nearest to either of its ends, within KEEP_KM.
 */
export function keptWells(wells, held, nearest = KEEP_NEAREST, reachKm = KEEP_KM) {
  const cell = 0.05;
  const key = (lon, lat) => `${String(Math.floor(lon / cell))},${String(Math.floor(lat / cell))}`;
  const buckets = new Map();
  for (const w of wells.values()) {
    const k = key(w.lon, w.lat);
    const list = buckets.get(k);
    if (list) list.push(w);
    else buckets.set(k, [w]);
  }
  const licences = new Set(held.map((h) => h.licence).filter(Boolean));
  const keep = new Set();
  for (const w of wells.values()) if (w.licence && licences.has(w.licence)) keep.add(w.uwi);
  // At 49° to 60° north, 0.05° of longitude is 2.8 to 3.7 km: three cells reach past 5 km.
  const span = Math.ceil(reachKm / 2.7);
  for (const h of held) {
    const near = new Map();
    for (const p of h.points) {
      const cx = Math.floor(p[0] / cell);
      const cy = Math.floor(p[1] / cell);
      for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
          for (const w of buckets.get(`${String(cx + dx)},${String(cy + dy)}`) ?? []) {
            const d = km(p, [w.lon, w.lat]);
            if (d <= reachKm && d < (near.get(w.uwi) ?? Infinity)) near.set(w.uwi, d);
          }
        }
      }
    }
    [...near]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .slice(0, nearest)
      .forEach(([uwi]) => keep.add(uwi));
  }
  return keep;
}

/** The kept wells and the names their picks use, ready for the SQL. */
export function picksOut(reader, held) {
  const keep = keptWells(reader.wells, held);
  const usedNames = new Set();
  const wells = [];
  for (const uwi of [...keep].sort()) {
    const w = reader.wells.get(uwi);
    const picks = [...w.picks].sort((a, b) => a[1].tvd - b[1].tvd || a[0] - b[0]);
    picks.forEach(([id]) => usedNames.add(id));
    wells.push({
      uwi: w.uwi,
      licence: w.licence,
      lon: Math.round(w.lon * 1e6) / 1e6,
      lat: Math.round(w.lat * 1e6) / 1e6,
      kb: w.kb,
      names: picks.map(([id]) => id),
      tvd: picks.map(([, p]) => p.tvd),
      sources: picks.map(([, p]) => p.source),
    });
  }
  const names = [...reader.names]
    .filter(([, id]) => usedNames.has(id))
    .map(([k, id]) => {
      const [name, surface] = k.split('\t');
      return { id, name, surface };
    });
  return { wells, names, counts: reader.counts, picked: reader.wells.size };
}

function zipNames(zip) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-Z1', zip]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(out.split(/\r?\n/).filter(Boolean))
        : reject(new Error(`unzip -Z1 exited ${String(code)}`)),
    );
  });
}

function zipStream(zip, name) {
  const child = spawn('unzip', ['-p', zip, name]);
  return child.stdout;
}

async function readAll(stream) {
  const parts = [];
  for await (const c of stream) parts.push(c);
  return Buffer.concat(parts);
}

/** Reads every zone's wgs84 point files from the zip or folder into the reader. */
export async function readPicks(source, reader) {
  const isDir = statSync(source).isDirectory();
  const all = isDir ? readdirSync(source) : await zipNames(source);
  const dbfs = all.filter((n) => /Point_Data_Zone_(Top|Base)_.*_wgs84\.dbf$/i.test(n)).sort();
  if (dbfs.length === 0) throw new Error("No point files in the Survey's download.");
  for (const dbf of dbfs) {
    const shp = dbf.replace(/\.dbf$/i, '.shp');
    const prj = dbf.replace(/\.dbf$/i, '.prj');
    if (!all.includes(shp) || !all.includes(prj)) throw new Error(`${shp} or its .prj is missing.`);
    const read = async (name) =>
      isDir ? readFileSync(join(source, name)) : await readAll(zipStream(source, name));
    const points = shpPoints(await read(shp), prjIsMercator((await read(prj)).toString('latin1')));
    const stream = isDir ? createReadStream(join(source, dbf)) : zipStream(source, dbf);
    for await (const [i, row] of dbfRecords(stream)) reader.add(row, points[i] ?? null);
  }
  return dbfs.length;
}

// ---------------------------------------------------------------------------------------------
// Samples

/** The laboratory's standards and its repeats of them are not samples of the ground. */
const SAMPLE_TYPES = new Set(['core', 'outcrop', 'duplicate', 'combined', 're-run', 'cuttings']);
const SITE_TYPES = new Set(['outcrop', 'oil or gas well']);
const MONTHS = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

/** A measurement as the text the database stores, or null: decimal, never through a float. */
export function decimalText(raw, digits = 3, max = 1e7) {
  const text = String(raw ?? '').trim();
  if (!/^-?\d{1,9}(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const out = frac ? `${whole}.${frac.slice(0, digits)}` : whole;
  return Math.abs(Number(out)) < max ? out.replace(/\.$/, '') : null;
}

/** 01-Sep-2007 as 2007-09-01. */
function sampleDay(raw) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(raw ?? '').trim());
  const month = m ? MONTHS[m[2].toUpperCase()] : undefined;
  if (!m || !month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** A depth in metres, from the file's metres or feet. */
function metres(raw, unit) {
  // Up to 40,000: a deep well in feet.
  const text = decimalText(raw, 2, 40_000);
  if (text === null) return null;
  if (unit === 'metres') return text;
  if (unit === 'feet') return (Math.round(Number(text) * 0.3048 * 100) / 100).toFixed(2);
  return null;
}

/** Digital Dataset 2013-0003's lines as samples: the ground's only, each checked. */
export function sampleRows(text) {
  const lines = text
    .replace(new RegExp('^' + String.fromCharCode(0xfeff)), '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const head = (lines[0] ?? '').split('\t');
  const at = (name) => head.indexOf(name);
  for (const name of [
    'Sample_ID',
    'Site_Type',
    'UWI',
    'Lat_NAD83',
    'Long_NAD83',
    'Tmax',
    'TOC',
    'S2',
    'Stratigraphic_Unit',
  ]) {
    if (at(name) < 0) throw new Error(`The samples file has no column ${name}.`);
  }
  const samples = [];
  let skipped = 0;
  let standards = 0;
  // A sample measured again (by another laboratory) keeps its number: its runs are counted.
  const runs = new Map();
  for (const line of lines.slice(1)) {
    const f = line.split('\t');
    const get = (name) => (at(name) >= 0 ? (f[at(name)] ?? '').trim() : '');
    const site = get('Site_Type').toLowerCase();
    const type = get('Sample_Type').toLowerCase();
    if (!SITE_TYPES.has(site) || !SAMPLE_TYPES.has(type)) {
      standards += 1;
      continue;
    }
    const id = Number(get('Sample_ID'));
    const lat = Number(get('Lat_NAD83'));
    const lon = Number(get('Long_NAD83'));
    const uwiText = get('UWI');
    const uwi = uwiText ? ourUwi(uwiText) : null;
    if (
      f.length !== head.length ||
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !(lat > 48 && lat < 61) ||
      !(lon > -121 && lon < -109) ||
      (uwiText && !uwi)
    ) {
      skipped += 1;
      continue;
    }
    const run = (runs.get(id) ?? 0) + 1;
    runs.set(id, run);
    const unit = get('Depth_Unit_of_Measure').toLowerCase();
    const short = (name, max) => {
      const v = get(name).replace(/\s+/g, ' ');
      return v ? v.slice(0, max) : null;
    };
    samples.push({
      id,
      run,
      uwi,
      site: site === 'outcrop' ? 'outcrop' : 'well',
      siteName: short('Site_Name', 120),
      lon: decimalText(lon.toFixed(6), 6),
      lat: decimalText(lat.toFixed(6), 6),
      topM: metres(get('Upper_Core_Depth') || get('Upper_Log_Depth'), unit),
      baseM: metres(get('Lower_Core_Depth') || get('Lower_Log_Depth'), unit),
      topElevationM: decimalText(get('Top_EL_MASL28'), 2, 10_000),
      unit: short('Stratigraphic_Unit', 80),
      lithology: short('Lithology', 80),
      sampleType: type,
      collected: sampleDay(get('Date_Collected')),
      lab: short('Lab_Name', 120),
      s1: decimalText(get('S1'), 3, 1e5),
      s2: decimalText(get('S2'), 3, 1e5),
      s3: decimalText(get('S3'), 3, 1e5),
      tmax: decimalText(get('Tmax'), 0, 1000),
      toc: decimalText(get('TOC'), 3, 100),
      hi: decimalText(get('HI'), 0, 1e5),
      oi: decimalText(get('OI'), 0, 1e5),
      pi: decimalText(get('PI'), 3, 10),
      roCalc: decimalText(get('Ro_Calc'), 3, 20),
    });
  }
  return { samples, skipped, standards };
}

// ---------------------------------------------------------------------------------------------
// SQL

/** A value for COPY's CSV format: quoted, always on one line; null as an empty field. */
const csv = (value) =>
  value === null || value === undefined
    ? ''
    : `"${String(value)
        .replace(/[\r\n]+/g, ' ')
        .replaceAll('"', '""')}"`;
const pgArray = (values) => `{${values.map(String).join(',')}}`;
const NUM = /^-?\d{1,9}(\.\d{1,6})?$/;

/** Refuses a well the reader would never write, before any SQL is made of it. */
export function checkedWell(w, nameIds) {
  const n = w.names?.length ?? 0;
  const ok =
    UWI.test(w.uwi) &&
    LICENCE.test(w.licence) &&
    Number.isFinite(w.lon) &&
    w.lon > -121 &&
    w.lon < -109 &&
    Number.isFinite(w.lat) &&
    w.lat > 48 &&
    w.lat < 61 &&
    (w.kb === null || (Number.isFinite(w.kb) && w.kb > -100 && w.kb < 4000)) &&
    n >= 1 &&
    n <= 400 &&
    w.tvd.length === n &&
    w.sources.length === n &&
    w.names.every((id) => nameIds.has(id)) &&
    w.tvd.every((v) => Number.isFinite(v) && v >= 0 && v <= 9000) &&
    w.sources.every((s) => s === 0 || s === 1 || s === 2);
  if (!ok) return null;
  return [
    w.uwi,
    w.licence,
    w.lon.toFixed(6),
    w.lat.toFixed(6),
    w.kb === null ? null : w.kb.toFixed(2),
    pgArray(w.names),
    pgArray(w.tvd.map((v) => v.toFixed(1))),
    pgArray(w.sources),
  ]
    .map(csv)
    .join(',');
}

export function checkedSample(s) {
  const nums = [
    s.lon,
    s.lat,
    s.topM,
    s.baseM,
    s.topElevationM,
    s.s1,
    s.s2,
    s.s3,
    s.tmax,
    s.toc,
    s.hi,
    s.oi,
    s.pi,
    s.roCalc,
  ];
  const ok =
    Number.isSafeInteger(s.id) &&
    s.id > 0 &&
    Number.isSafeInteger(s.run) &&
    s.run >= 1 &&
    s.run <= 99 &&
    (s.uwi === null || UWI.test(s.uwi)) &&
    (s.site === 'well' || s.site === 'outcrop') &&
    s.lon !== null &&
    s.lat !== null &&
    nums.every((v) => v === null || NUM.test(v)) &&
    (s.collected === null || DAY.test(s.collected)) &&
    typeof s.sampleType === 'string' &&
    SAMPLE_TYPES.has(s.sampleType);
  if (!ok) return null;
  return [
    s.id,
    s.run,
    s.uwi,
    s.site,
    s.siteName,
    s.lon,
    s.lat,
    s.topM,
    s.baseM,
    s.topElevationM,
    s.unit,
    s.lithology,
    s.sampleType,
    s.collected,
    s.lab,
    s.s1,
    s.s2,
    s.s3,
    s.tmax,
    s.toc,
    s.hi,
    s.oi,
    s.pi,
    s.roCalc,
  ]
    .map(csv)
    .join(',');
}

function guard(grainBytes) {
  return [
    'do $$',
    'begin',
    `  if pg_database_size(current_database()) + ${String(grainBytes)} > ${String(BUDGET_BYTES)} then`,
    "    raise exception 'Size guard: grain''s and the oil and gas databases together would pass 450 MB; nothing was loaded.';",
    '  end if;',
    'end',
    '$$;',
  ];
}

const sqlText = (v) => `'${String(v).replaceAll("'", "''")}'`;

export function sqlForPicks({ wells, names, counts }, sourceUrl, sourceDate, grainBytes) {
  const nameIds = new Set();
  const nameLines = [];
  for (const n of names) {
    if (
      !Number.isSafeInteger(n.id) ||
      n.id < 1 ||
      n.id > 32767 ||
      typeof n.name !== 'string' ||
      n.name.length < 1 ||
      n.name.length > 120 ||
      !/^[0-9]{2}[a-z]?_[A-Za-z0-9_ -]{1,60}$/.test(n.surface)
    ) {
      fail('A pick name is not in the form the reader writes; nothing was loaded.');
    }
    nameIds.add(n.id);
    nameLines.push([n.id, n.name, n.surface].map(csv).join(','));
  }
  const lines = [];
  for (const w of wells) {
    const row = checkedWell(w, nameIds);
    if (row === null) fail('A well is not in the form the reader writes; nothing was loaded.');
    lines.push(row);
  }
  if (lines.length === 0) fail('No picked wells near the wells held: nothing was loaded.', 2);
  const picks = wells.reduce((sum, w) => sum + w.names.length, 0);
  const date = sourceDate && DAY.test(sourceDate) ? `'${sourceDate}'` : 'null';
  const skipped = Number.isSafeInteger(counts?.skipped) ? counts.skipped : 0;
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    'truncate petro.formation_pick_wells, petro.formation_pick_names;',
    'copy petro.formation_pick_names (id, name, surface) from stdin with (format csv);',
    ...nameLines,
    '\\.',
    'copy petro.formation_pick_wells (uwi, licence_number, longitude, latitude, kb_elevation_m, names, tvd_m, sources) from stdin with (format csv);',
    ...lines,
    '\\.',
    `insert into petro.geology_loads (kind, source_url, source_date, rows_loaded, skipped) values ('picks', ${sqlText(sourceUrl)}, ${date}, ${String(picks)}, ${String(skipped)});`,
    ...guard(grainBytes),
    'commit;',
    "select count(*) as wells, sum(cardinality(names)) as picks, pg_size_pretty(pg_total_relation_size('petro.formation_pick_wells')) as size from petro.formation_pick_wells;",
    '',
  ].join('\n');
}

export function sqlForSamples({ samples, skipped }, sourceUrl, sourceDate, grainBytes) {
  const lines = [];
  for (const s of samples) {
    const row = checkedSample(s);
    if (row === null) fail('A sample is not in the form the reader writes; nothing was loaded.');
    lines.push(row);
  }
  if (lines.length === 0) fail('No samples: nothing was loaded.', 2);
  const date = sourceDate && DAY.test(sourceDate) ? `'${sourceDate}'` : 'null';
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    'truncate petro.maturity_samples;',
    'copy petro.maturity_samples (sample_id, run, uwi, site, site_name, longitude, latitude, top_depth_m, base_depth_m, top_elevation_m, unit, lithology, sample_type, collected_on, lab, s1, s2, s3, tmax_c, toc_pct, hydrogen_index, oxygen_index, production_index, ro_calc_pct) from stdin with (format csv);',
    ...lines,
    '\\.',
    `insert into petro.geology_loads (kind, source_url, source_date, rows_loaded, skipped) values ('samples', ${sqlText(sourceUrl)}, ${date}, ${String(lines.length)}, ${String(Number.isSafeInteger(skipped) ? skipped : 0)});`,
    ...guard(grainBytes),
    'commit;',
    "select count(*) as samples, count(tmax_c) as with_tmax, count(uwi) as in_wells, pg_size_pretty(pg_total_relation_size('petro.maturity_samples')) as size from petro.maturity_samples;",
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------

async function commandPicks(source, heldFile, out) {
  const held = heldWells(readFileSync(heldFile, 'utf8'));
  if (held.length === 0) fail('No wells held: run Load ST37 wells first.');
  const reader = newPickReader();
  const files = await readPicks(source, reader);
  if (reader.counts.kept < FEWEST_PICKS) {
    fail(`Only ${String(reader.counts.kept)} picks in the Survey's file: nothing was loaded.`, 3);
  }
  const result = picksOut(reader, held);
  const picks = result.wells.reduce((sum, w) => sum + w.names.length, 0);
  const own = new Set(held.map((h) => h.licence));
  const heldPicked = result.wells.filter((w) => own.has(w.licence)).length;
  console.error(
    `${String(files)} files, ${String(reader.counts.rows)} lines: ${String(reader.counts.kept)} picks in ${String(result.picked)} wells (${String(reader.counts.notBorehole)} not in a borehole, ${String(reader.counts.skipped)} unreadable: ${JSON.stringify(reader.counts.why)}; ${String(reader.counts.conflicts)} listed twice with different depths). Kept for the ${String(held.length)} wells held: ${String(result.wells.length)} picked wells (${String(heldPicked)} under a licence held), ${String(picks)} picks, ${String(result.names.length)} names.`,
  );
  writeFileSync(out, JSON.stringify(result));
}

async function commandSamples(source, out) {
  const text = /\.zip$/i.test(source)
    ? (await readAll(zipStream(source, 'DIG_2013_0003_rockeval_data.txt'))).toString('utf8')
    : readFileSync(source, 'utf8');
  const result = sampleRows(text);
  if (result.samples.length < FEWEST_SAMPLES) {
    fail(`Only ${String(result.samples.length)} samples in the file: nothing was loaded.`, 3);
  }
  console.error(
    `${String(result.samples.length)} samples (${String(result.samples.filter((s) => s.tmax !== null).length)} with Tmax); ${String(result.standards)} laboratory standards left out, ${String(result.skipped)} unreadable.`,
  );
  writeFileSync(out, JSON.stringify(result));
}

function commandSql(kind, file, sourceUrl, sourceDate, grainArg) {
  const bytes = /^\d{1,15}$/.test(grainArg ?? '') ? Number(grainArg) : Number.NaN;
  const expected = kind === 'picks' ? PICKS_SOURCE : SAMPLES_SOURCE;
  if (
    !file ||
    !Number.isFinite(bytes) ||
    (kind !== 'picks' && kind !== 'samples') ||
    sourceUrl !== expected
  ) {
    fail(usage(), 2);
  }
  const date = sourceDate && sourceDate !== '-' ? sourceDate : null;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  writeSync(
    1,
    kind === 'picks'
      ? sqlForPicks(data, sourceUrl, date, bytes)
      : sqlForSamples(data, sourceUrl, date, bytes),
  );
}

export function usage() {
  return [
    'usage: load-geology.js picks <zip|dir> <held.csv> <out.json>',
    '       load-geology.js samples <zip|txt> <out.json>',
    '       load-geology.js sql <picks|samples> <out.json> <source-url> <source-date|-> <grain-bytes>',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === 'picks' && rest.length === 3) await commandPicks(rest[0], rest[1], rest[2]);
    else if (command === 'samples' && rest.length === 2) await commandSamples(rest[0], rest[1]);
    else if (command === 'sql' && rest.length === 5) commandSql(...rest);
    else fail(usage(), 2);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
