// Tests of scripts/load-geology.js (F-287 part 1): the Survey's picks read from its point files
// (dBase records beside Web Mercator points), the wells near the wells held kept, the Rock-Eval
// samples read with the laboratory's standards left out, and the SQL refused for anything the
// reader would never write. Made-up wells and samples only.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PICKS_SOURCE,
  SAMPLES_SOURCE,
  dbfRecords,
  fromWebMercator,
  heldWells,
  keptWells,
  newPickReader,
  ourLicence,
  ourUwi,
  picksOut,
  prjIsMercator,
  readPicks,
  sampleRows,
  shpPoints,
  sqlForPicks,
  sqlForSamples,
} from './load-geology.js';

const SCRIPT = fileURLToPath(new URL('./load-geology.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-geology-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
  });

const EARTH_M = 6378137;
const toMercator = (lon, lat) => [
  (lon * Math.PI * EARTH_M) / 180,
  EARTH_M * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

/** A dBase file of character fields; a record whose first value is '*' is marked deleted. */
function dbf(fields, records) {
  const headerLen = 32 + fields.length * 32 + 1;
  const recLen = 1 + fields.reduce((s, f) => s + f.len, 0);
  const buf = Buffer.alloc(headerLen + records.length * recLen + 1, 0x20);
  buf.fill(0, 0, headerLen);
  buf[0] = 3;
  buf.writeUInt32LE(records.length, 4);
  buf.writeUInt16LE(headerLen, 8);
  buf.writeUInt16LE(recLen, 10);
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    buf.write(f.name, o, 'latin1');
    buf[o + 11] = 'C'.charCodeAt(0);
    buf[o + 16] = f.len;
  });
  buf[headerLen - 1] = 0x0d;
  records.forEach((r, i) => {
    let o = headerLen + i * recLen;
    buf[o] = r.deleted ? 0x2a : 0x20;
    o += 1;
    for (const f of fields) {
      buf.write(String(r[f.name] ?? '').slice(0, f.len), o, 'latin1');
      o += f.len;
    }
  });
  buf[buf.length - 1] = 0x1a;
  return buf;
}

/** A point shapefile (type 1, or 11 with z and m) of Web Mercator points. */
function shp(points, type = 1) {
  const body = type === 11 ? 36 : 20;
  const buf = Buffer.alloc(100 + points.length * (8 + body));
  buf.writeInt32BE(9994, 0);
  buf.writeInt32LE(type, 32);
  points.forEach(([lon, lat], i) => {
    const o = 100 + i * (8 + body);
    buf.writeInt32BE(i + 1, o);
    buf.writeInt32BE(body / 2, o + 4);
    buf.writeInt32LE(type, o + 8);
    const [x, y] = toMercator(lon, lat);
    buf.writeDoubleLE(x, o + 12);
    buf.writeDoubleLE(y, o + 20);
  });
  return buf;
}

const MERCATOR_PRJ = 'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984"]]';
const FIELDS = [
  { name: 'Well_Ident', len: 25 },
  { name: 'WellLicNo', len: 10 },
  { name: 'Data_Type', len: 20 },
  { name: 'TVD_m', len: 19 },
  { name: 'KBEl_masl', len: 19 },
  { name: 'Geo_Name', len: 60 },
  { name: 'In_Surface', len: 40 },
  { name: 'DataSource', len: 60 },
];
const AGS = 'Alberta Energy Regulator - Alberta Geological Survey';
const AER = 'Alberta Energy Regulator - other';

const pickRow = (well, licence, tvd, name, surface, source = AGS, type = 'borehole') => ({
  Well_Ident: well,
  WellLicNo: licence,
  Data_Type: type,
  TVD_m: tvd,
  KBEl_masl: '812.4',
  Geo_Name: name,
  In_Surface: surface,
  DataSource: source,
});

describe("reading the Survey's files", () => {
  test("a UWI in either of the Survey's forms becomes ours; others are refused", () => {
    assert.equal(ourUwi('100010503705W500'), '00/01-05-037-05W5/0');
    assert.equal(ourUwi('102112807211W602'), '02/11-28-072-11W6/2');
    assert.equal(ourUwi('102/11-32-017-11W4/00'), '02/11-32-017-11W4/0');
    assert.equal(ourUwi('-9999'), null);
    assert.equal(ourUwi('100010503705W512'), null, 'an event that does not fit one character');
    assert.equal(ourLicence('225960'), '0225960');
    assert.equal(ourLicence('0152982'), '0152982');
  });

  test('Web Mercator points come back as longitude and latitude', () => {
    const [lon, lat] = fromWebMercator(...toMercator(-116.68156, 53.80313));
    assert.ok(Math.abs(lon + 116.68156) < 1e-9 && Math.abs(lat - 53.80313) < 1e-9);
    assert.equal(prjIsMercator(MERCATOR_PRJ), true);
    assert.equal(prjIsMercator('GEOGCS["GCS_North_American_1983"]'), false);
    assert.throws(() => prjIsMercator('PROJCS["NAD83 / Alberta 10-TM (Forest)"]'));
  });

  test('records stream a few bytes at a time, deleted ones skipped without losing their place', async () => {
    const buf = dbf(FIELDS.slice(0, 2), [
      { Well_Ident: 'a', WellLicNo: '1' },
      { Well_Ident: 'b', WellLicNo: '2', deleted: true },
      { Well_Ident: 'c', WellLicNo: '3' },
    ]);
    const chunks = [];
    for (let i = 0; i < buf.length; i += 7) chunks.push(buf.subarray(i, i + 7));
    const got = [];
    for await (const [i, row] of dbfRecords(Readable.from(chunks)))
      got.push([i, row.well_ident, row.welllicno]);
    assert.deepEqual(got, [
      [0, 'a', '1'],
      [2, 'c', '3'],
    ]);
  });

  test('point and PointZ shapefiles give their points in order', () => {
    for (const type of [1, 11]) {
      const points = shpPoints(
        shp(
          [
            [-116.5, 54.2],
            [-113, 52],
          ],
          type,
        ),
        true,
      );
      assert.equal(points.length, 2);
      assert.ok(Math.abs(points[1][0] + 113) < 1e-9 && Math.abs(points[1][1] - 52) < 1e-9);
    }
  });
});

describe('the picks kept', () => {
  test('a folder of zone files is read: one row a well, a pick listed in two zones kept once', async () => {
    const zone = join(dir, 'zones');
    rmSync(zone, { recursive: true, force: true });
    spawnSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(zone)})`]);
    const a = 'Point_Data_Zone_Base_67_D_Ir_v4_wgs84';
    const b = 'Point_Data_Zone_Top_68_D_Dv_Mu_v4_wgs84';
    writeFileSync(
      join(zone, `${a}.dbf`),
      dbf(FIELDS, [
        pickRow(
          '100112303027W400',
          '999999',
          '3105.24',
          'Duvernay Formation top',
          '68_D_Dv_Mu_top',
        ),
        pickRow('100112303027W400', '999999', '3010.5', 'Ireton Formation top', '67_D_Ir_top', AER),
        pickRow('-9999', '', '-9999', 'Ireton Formation top', '67_D_Ir_top'),
        pickRow(
          '100010101001W500',
          '',
          '100',
          'Ireton Formation top',
          '67_D_Ir_top',
          AGS,
          'control points',
        ),
      ]),
    );
    writeFileSync(
      join(zone, `${a}.shp`),
      shp([
        [-116.5, 54.2],
        [-116.5, 54.2],
        [-116.5, 54.2],
        [-116, 54],
      ]),
    );
    writeFileSync(join(zone, `${a}.prj`), MERCATOR_PRJ);
    writeFileSync(
      join(zone, `${b}.dbf`),
      dbf(FIELDS, [
        pickRow('100112303027W400', '999999', '3105.9', 'Duvernay Formation top', '68_D_Dv_Mu_top'),
        pickRow('100062303027W400', '', '2990', 'Ireton Formation top', '67_D_Ir_top'),
      ]),
    );
    writeFileSync(
      join(zone, `${b}.shp`),
      shp(
        [
          [-116.5, 54.2],
          [-116.52, 54.21],
        ],
        11,
      ),
    );
    writeFileSync(join(zone, `${b}.prj`), MERCATOR_PRJ);

    const reader = newPickReader();
    assert.equal(await readPicks(zone, reader), 2);
    assert.equal(reader.counts.kept, 3);
    assert.equal(reader.counts.notBorehole, 1);
    assert.deepEqual(reader.counts.why, { uwi: 1, place: 0, name: 0, depth: 0 });
    assert.equal(
      reader.counts.conflicts,
      1,
      'the same pick at another depth is counted, the first kept',
    );

    const held = heldWells('0999999,-116.5,54.2,-116.49,54.25\n');
    const out = picksOut(reader, held);
    assert.equal(out.wells.length, 2);
    const own = out.wells.find((w) => w.uwi === '00/11-23-030-27W4/0');
    assert.equal(own.licence, '0999999');
    assert.deepEqual(own.tvd, [3010.5, 3105.2], 'shallowest first, to a tenth of a metre');
    assert.deepEqual(own.sources, [2, 1]);
    assert.deepEqual(
      own.names.map((id) => out.names.find((n) => n.id === id).name),
      ['Ireton Formation top', 'Duvernay Formation top'],
    );
  });

  test('a held licence is always kept; otherwise the nearest few within reach', () => {
    const well = (uwi, licence, lon, lat) => [uwi, { uwi, licence, lon, lat }];
    const wells = new Map([
      well('w-own', '0000001', -110.9, 59), // far away, but under a licence held
      well('w-near1', '', -116.501, 54.2),
      well('w-near2', '', -116.51, 54.2),
      well('w-near3', '', -116.52, 54.2),
      well('w-near4', '', -116.53, 54.2),
      well('w-far', '', -116.6, 54.2), // 6.5 km
    ]);
    const held = [
      {
        licence: '0000001',
        points: [
          [-116.5, 54.2],
          [-116.5, 54.21],
        ],
      },
    ];
    assert.deepEqual([...keptWells(wells, held, 3, 5)].sort(), [
      'w-near1',
      'w-near2',
      'w-near3',
      'w-own',
    ]);
    assert.deepEqual([...keptWells(wells, held, 10, 5)].sort(), [
      'w-near1',
      'w-near2',
      'w-near3',
      'w-near4',
      'w-own',
    ]);
  });
});

describe('the samples', () => {
  const HEAD = [
    'Sample_ID',
    'Site_ID',
    'Site_Type',
    'UWI',
    'Site_Name',
    'Lat_NAD83',
    'Long_NAD83',
    'Top_EL_MASL28',
    'Depth_Unit_of_Measure',
    'Upper_Core_Depth',
    'Lower_Core_Depth',
    'Upper_Log_Depth',
    'Lower_Log_Depth',
    'Lithology',
    'Stratigraphic_Unit',
    'Date_Collected',
    'Sample_Type',
    'Lab_Name',
    'S1',
    'S2',
    'PI',
    'S3',
    'Tmax',
    'TOC',
    'HI',
    'OI',
    'Ro_Calc',
  ];
  const line = (o) => HEAD.map((h) => o[h] ?? '').join('\t');
  const base = {
    Site_Type: 'oil or gas well',
    UWI: '100/11-23-030-27W4/00',
    Lat_NAD83: '54.2',
    Long_NAD83: '-116.5',
    Depth_Unit_of_Measure: 'feet',
    Upper_Core_Depth: '10000',
    Stratigraphic_Unit: 'Duvernay',
    Lithology: 'shale',
    Date_Collected: '01-Sep-2007',
    Sample_Type: 'core',
    Lab_Name: 'Made-up Lab',
    S2: '6.1',
    Tmax: '448',
    TOC: '4.25',
  };
  const text = [
    `${String.fromCharCode(0xfeff)}${HEAD.join('\t')}`,
    line({ ...base, Sample_ID: '1' }),
    line({ ...base, Sample_ID: '1', Lab_Name: 'Second Lab', Tmax: '' }),
    line({
      ...base,
      Sample_ID: '2',
      Site_Type: 'standard',
      Sample_Type: 'standard_lab',
      UWI: '',
      Stratigraphic_Unit: 'Not Applicable',
    }),
    line({
      ...base,
      Sample_ID: '3',
      Site_Type: 'outcrop',
      UWI: '',
      Sample_Type: 'outcrop',
      Depth_Unit_of_Measure: '',
      Upper_Core_Depth: '',
      Top_EL_MASL28: '1327',
    }),
    line({ ...base, Sample_ID: '4', Lat_NAD83: '' }),
  ].join('\r\n');

  test("standards left out, a second laboratory's run kept, feet made metres, decimals kept as text", () => {
    const { samples, skipped, standards } = sampleRows(text);
    assert.equal(standards, 1);
    assert.equal(skipped, 1, 'a sample with no place');
    assert.deepEqual(
      samples.map((s) => [s.id, s.run, s.site, s.uwi, s.topM, s.tmax, s.toc, s.collected]),
      [
        [1, 1, 'well', '00/11-23-030-27W4/0', '3048.00', '448', '4.25', '2007-09-01'],
        [1, 2, 'well', '00/11-23-030-27W4/0', '3048.00', null, '4.25', '2007-09-01'],
        [3, 1, 'outcrop', null, null, '448', '4.25', '2007-09-01'],
      ],
    );
    assert.equal(samples[2].topElevationM, '1327');
  });

  test('a file without the expected columns is refused', () => {
    assert.throws(() => sampleRows('Sample_ID\tUWI\n1\t'), /no column/);
  });
});

describe('the SQL', () => {
  const picks = {
    names: [{ id: 1, name: 'Duvernay Formation top', surface: '68_D_Dv_Mu_top' }],
    wells: [
      {
        uwi: '00/11-23-030-27W4/0',
        licence: '0999999',
        lon: -116.5,
        lat: 54.2,
        kb: 812.4,
        names: [1],
        tvd: [3105.2],
        sources: [1],
      },
    ],
    counts: { skipped: 3 },
  };

  test('picks replace the whole set in one transaction under the size guard', () => {
    const sql = sqlForPicks(picks, PICKS_SOURCE, '2026-10-31', 12345);
    assert.match(
      sql,
      /^\\set ON_ERROR_STOP on\nbegin;\ntruncate petro\.formation_pick_wells, petro\.formation_pick_names;/,
    );
    assert.match(
      sql,
      /"00\/11-23-030-27W4\/0","0999999","-116\.500000","54\.200000","812\.40","\{1\}","\{3105\.2\}","\{1\}"/,
    );
    assert.match(sql, /values \('picks', '.*Point%20data\.zip', '2026-10-31', 1, 3\);/);
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 12345 > 471859200/);
    assert.match(sql, /\ncommit;\n/);
  });

  test('samples too', () => {
    const { samples } = sampleRows(
      `Sample_ID\tSite_Type\tUWI\tLat_NAD83\tLong_NAD83\tTmax\tTOC\tS2\tStratigraphic_Unit\tSample_Type\n7\toil or gas well\t100/11-23-030-27W4/00\t54.2\t-116.5\t448\t4.25\t6.1\tDuvernay\tcore`,
    );
    const sql = sqlForSamples({ samples, skipped: 0 }, SAMPLES_SOURCE, null, 1);
    assert.match(sql, /truncate petro\.maturity_samples;/);
    assert.match(sql, /"7","1","00\/11-23-030-27W4\/0","well",/);
    assert.match(sql, /values \('samples', '.*DIG_2013_0003\.zip', null, 1, 0\);/);
  });

  test('a well or sample the reader would never write stops the load, and another address is refused', () => {
    const bad = { ...picks, wells: [{ ...picks.wells[0], tvd: [3105.2, 1] }] };
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad));
    let r = run('sql', 'picks', join(dir, 'bad.json'), PICKS_SOURCE, '-', '1');
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /nothing was loaded/);

    writeFileSync(join(dir, 'ok.json'), JSON.stringify(picks));
    r = run('sql', 'picks', join(dir, 'ok.json'), 'https://example.test/x.zip', '-', '1');
    assert.equal(r.status, 2, "only the Survey's own address");
    r = run('sql', 'picks', join(dir, 'ok.json'), PICKS_SOURCE, '-', '1');
    assert.equal(r.status, 0);

    const badSample = {
      samples: [
        { id: 1, run: 1, uwi: 'x', site: 'well', lon: '-116.5', lat: '54.2', sampleType: 'core' },
      ],
      skipped: 0,
    };
    writeFileSync(join(dir, 'bad-sample.json'), JSON.stringify(badSample));
    r = run('sql', 'samples', join(dir, 'bad-sample.json'), SAMPLES_SOURCE, '-', '1');
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
  });
});
