// Tests of scripts/load-pipelines.js (F-249): the AER's pipeline file becomes one transaction
// that replaces the copy under the size guard. Made-up segments only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';

const SCRIPT = fileURLToPath(new URL('./load-pipelines.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-pipelines-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
  });

/** A shapefile of lines: each record its parts, each part its points. */
function shapefile(records) {
  const sizes = records.map((parts) =>
    parts ? 44 + 4 * parts.length + 16 * parts.reduce((n, p) => n + p.length, 0) : 4,
  );
  const total = 100 + sizes.reduce((sum, size) => sum + 8 + size, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, total / 2, false);
  view.setInt32(32, 3, true);
  let at = 100;
  records.forEach((parts, n) => {
    const size = sizes[n];
    view.setInt32(at, n + 1, false);
    view.setInt32(at + 4, size / 2, false);
    const s = at + 8;
    view.setInt32(s, parts ? 3 : 0, true);
    if (parts) {
      const points = parts.flat();
      view.setFloat64(s + 4, Math.min(...points.map((p) => p[0])), true);
      view.setFloat64(s + 12, Math.min(...points.map((p) => p[1])), true);
      view.setFloat64(s + 20, Math.max(...points.map((p) => p[0])), true);
      view.setFloat64(s + 28, Math.max(...points.map((p) => p[1])), true);
      view.setInt32(s + 36, parts.length, true);
      view.setInt32(s + 40, points.length, true);
      let start = 0;
      parts.forEach((part, p) => {
        view.setInt32(s + 44 + 4 * p, start, true);
        start += part.length;
      });
      const first = s + 44 + 4 * parts.length;
      points.forEach(([x, y], i) => {
        view.setFloat64(first + 16 * i, x, true);
        view.setFloat64(first + 16 * i + 8, y, true);
      });
    }
    at += 8 + size;
  });
  return bytes;
}

const FIELDS = [
  ['LICENCE_NO', 9],
  ['IS_NEB', 3],
  ['LINE_NO', 31],
  ['PLLICSEGID', 31],
  ['COMP_NAME', 50],
  ['BA_CODE', 10],
  ['SEG_LENGTH', 31],
  ['SEG_STATUS', 30],
  ['OUT_DIAMET', 20],
  ['SUBSTANCE1', 30],
  ['SUBSTANCE2', 30],
  ['LICAPPDATE', 8],
];

function dbase(rows) {
  const headerLength = 32 + FIELDS.length * 32 + 1;
  const recordLength = 1 + FIELDS.reduce((sum, [, length]) => sum + length, 0);
  const bytes = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  FIELDS.forEach(([name, length], i) => {
    bytes.set(new TextEncoder().encode(name), 32 + i * 32);
    bytes[32 + i * 32 + 16] = length;
  });
  bytes[headerLength - 1] = 0x0d;
  rows.forEach((row, n) => {
    let at = headerLength + n * recordLength;
    bytes[at] = 0x20;
    at += 1;
    for (const [name, length] of FIELDS) {
      bytes.set(new TextEncoder().encode((row[name] ?? '').padEnd(length, ' ')), at);
      at += length;
    }
  });
  return bytes;
}

const segment = {
  LICENCE_NO: '11130',
  IS_NEB: 'N',
  LINE_NO: '1',
  PLLICSEGID: '51822',
  COMP_NAME: 'Example "Pipelines" Ltd.\'); drop table x; --',
  BA_CODE: 'A0X1',
  SEG_LENGTH: '10.27',
  SEG_STATUS: 'Operating',
  OUT_DIAMET: '323.9',
  SUBSTANCE1: 'Natural Gas',
  SUBSTANCE2: 'Fuel "Gas"',
  LICAPPDATE: '20020920',
};
const LINE = [
  [
    [-116.5, 54.1],
    [-116.4, 54.2],
  ],
];

function files(into, rows, lines) {
  writeFileSync(join(into, 'p.shp'), shapefile(lines));
  writeFileSync(join(into, 'p.dbf'), dbase(rows));
  return [join(into, 'p.shp'), join(into, 'p.dbf')];
}

describe('load-pipelines.js', () => {
  test("sql: one transaction that replaces the copy with the area's segments", () => {
    const [shp, dbf] = files(
      dir,
      [
        segment,
        { ...segment, LICENCE_NO: '99999' },
        { ...segment, LICENCE_NO: '' },
        { ...segment, LICENCE_NO: '3115', LINE_NO: '52' },
      ],
      [
        LINE,
        [
          [
            [-112, 50],
            [-112.1, 50.1],
          ],
        ],
        LINE,
        // Two parts, reaching past the area: it touches it, so it is kept whole.
        [
          [
            [-115.1, 54.5],
            [-114.9, 54.6],
          ],
          [
            [-114.9, 54.6],
            [-114.8, 54.7],
          ],
        ],
      ],
    );
    const out = run('sql', shp, dbf, '-117', '53', '-115', '55', '1000', '2026-11-22');
    assert.equal(out.status, 0, out.stderr);
    const sql = out.stdout;
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;/);
    assert.match(
      sql,
      /truncate petro\.pipelines restart identity;\ncopy petro\.pipelines \(segment_id,/,
    );
    // Quotes are doubled for the CSV, and escaped within the substances' array.
    assert.ok(
      sql.includes(
        '"51822","11130","1","f","A0X1","Example ""Pipelines"" Ltd.\'); drop table x; --","Operating","{""Natural Gas"",""Fuel \\""Gas\\""""}"',
      ),
      sql,
    );
    // The line as whole hundred-thousandths of a degree, and its box.
    assert.ok(
      sql.includes('"(-116.4,54.2),(-116.5,54.1)","{-11650000,5410000,-11640000,5420000}","{}"'),
    );
    assert.ok(
      sql.includes(
        '"{-11510000,5450000,-11490000,5460000,-11490000,5460000,-11480000,5470000}","{2}"',
      ),
    );
    assert.ok(sql.includes('"2002-09-20"'));
    // The one outside the area and the one with no licence are left out.
    assert.doesNotMatch(sql, /"99999"/);
    assert.match(
      sql,
      /values \('https:\/\/static\.aer\.ca\/prd\/data\/pipeline\/Pipelines_SHP\.zip', '2026-11-22', -117, 53, -115, 55, 2\);/,
    );
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 471859200/);
    assert.ok(sql.indexOf('Size guard') < sql.indexOf('commit;'));
    assert.match(out.stderr, /2 segments in the area, 1 outside it, 1 left out/);
  });

  test('sql: no file date is written as none', () => {
    const [shp, dbf] = files(dir, [segment], [LINE]);
    const out = run('sql', shp, dbf, '-117', '53', '-115', '55', '0', '-');
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /Pipelines_SHP\.zip', null, -117/);
  });

  test('sql: files that do not match, no segment in the area or bad arguments load nothing', () => {
    const [shp, dbf] = files(dir, [segment], [LINE, LINE]);
    let out = run('sql', shp, dbf, '-117', '53', '-115', '55', '0', '-');
    assert.equal(out.status, 2);
    assert.equal(out.stdout, '');
    const far = [
      [
        [-112, 50],
        [-112.1, 50.1],
      ],
    ];
    const [farShp, farDbf] = files(dir, [segment], [far]);
    assert.equal(run('sql', farShp, farDbf, '-117', '53', '-115', '55', '0', '-').status, 2);
    out = run('sql', farShp, farDbf, '-130', '53', '-115', '55', '0', '-');
    assert.equal(out.status, 2);
    assert.equal(run('sql', farShp, farDbf, '-117', '53', '-115', '55', '1; drop', '-').status, 2);
    assert.equal(run('sql', farShp, farDbf, '-117', '53', '-115', '55', '0', "2026'").status, 2);
    writeFileSync(join(dir, 'bad.shp'), new Uint8Array(100));
    assert.equal(
      run('sql', join(dir, 'bad.shp'), farDbf, '-117', '53', '-115', '55', '0', '-').status,
      2,
    );
  });
});
