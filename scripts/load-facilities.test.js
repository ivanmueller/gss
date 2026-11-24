// Tests of scripts/load-facilities.js (F-278): the AER's facility file becomes one transaction
// that replaces the copy under the size guard. Made-up facilities only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';

const SCRIPT = fileURLToPath(new URL('./load-facilities.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-facilities-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
  });

function shapefile(points) {
  const total = 100 + points.length * 28;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, total / 2, false);
  view.setInt32(32, 1, true);
  points.forEach(([x, y], n) => {
    const at = 100 + n * 28;
    view.setInt32(at, n + 1, false);
    view.setInt32(at + 4, 10, false);
    view.setInt32(at + 8, 1, true);
    view.setFloat64(at + 12, x, true);
    view.setFloat64(at + 20, y, true);
  });
  return bytes;
}

const FIELDS = [
  ['FAC_ID', 20],
  ['FAC_NAME', 60],
  ['OP_BA_ID', 4],
  ['OPERATOR', 60],
  ['SUB_CODE', 4],
  ['FAC_SUB_TY', 100],
  ['LIC_NUMBER', 9],
  ['LIC_TYPE', 1],
  ['LIC_BA_ID', 4],
  ['LICENSEE', 60],
  ['FAC_STATUS', 20],
  ['LOC_SOURCE', 20],
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

const battery = {
  FAC_ID: 'ABBT0000001',
  FAC_NAME: 'EXAMPLE "14-29" BATTERY',
  OP_BA_ID: 'A0X1',
  OPERATOR: "Example Energy Ltd.'); drop table x; --",
  SUB_CODE: '311',
  FAC_SUB_TY: 'Crude Oil Single-Well Battery',
  LIC_NUMBER: '6422',
  LIC_TYPE: 'F',
  LIC_BA_ID: 'A0X1',
  LICENSEE: 'Example Energy Ltd.',
  FAC_STATUS: 'Active',
  LOC_SOURCE: 'Facility Licence',
};

function files(into, rows, points) {
  writeFileSync(join(into, 'f.shp'), shapefile(points));
  writeFileSync(join(into, 'f.dbf'), dbase(rows));
  return [join(into, 'f.shp'), join(into, 'f.dbf')];
}

describe('load-facilities.js', () => {
  test("sql: one transaction that replaces the copy with the area's facilities", () => {
    const [shp, dbf] = files(
      dir,
      [battery, { ...battery, FAC_ID: 'ABGP0000002' }, { ...battery, FAC_ID: 'ABBT0000001' }],
      [
        [-116.5, 54.2],
        [-112, 50],
        [-116.4, 54.1],
      ],
    );
    const out = run('sql', shp, dbf, '-117', '53', '-115', '55', '1000', '2026-11-22');
    assert.equal(out.status, 0, out.stderr);
    const sql = out.stdout;
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;/);
    assert.match(sql, /truncate petro\.facilities;\ncopy petro\.facilities \(facility_id,/);
    // Quotes are doubled, so a name or an operator stays one value of the row.
    assert.ok(
      sql.includes(
        '"ABBT0000001","EXAMPLE ""14-29"" BATTERY","A0X1","Example Energy Ltd.\'); drop table x; --","311"',
      ),
    );
    // The one outside the area and the repeated ID are left out.
    assert.doesNotMatch(sql, /ABGP0000002/);
    assert.equal(sql.split('"ABBT0000001"').length - 1, 1);
    assert.match(
      sql,
      /values \('https:\/\/static\.aer\.ca\/prd\/data\/codes\/ST102-SHP\.zip', '2026-11-22', -117, 53, -115, 55, 1\);/,
    );
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 471859200/);
    assert.ok(sql.indexOf('Size guard') < sql.indexOf('commit;'));
    assert.match(out.stderr, /1 facilities in the area, 1 outside it, 1 left out/);
  });

  test('sql: no file date is written as none', () => {
    const [shp, dbf] = files(dir, [battery], [[-116.5, 54.2]]);
    const out = run('sql', shp, dbf, '-117', '53', '-115', '55', '0', '-');
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /ST102-SHP\.zip', null, -117/);
  });

  test('sql: files that do not match, no facility in the area or bad arguments load nothing', () => {
    const [shp, dbf] = files(
      dir,
      [battery],
      [
        [-116.5, 54.2],
        [-116.4, 54.1],
      ],
    );
    let out = run('sql', shp, dbf, '-117', '53', '-115', '55', '0', '-');
    assert.equal(out.status, 2);
    assert.equal(out.stdout, '');
    const [far, farDbf] = files(dir, [battery], [[-112, 50]]);
    assert.equal(run('sql', far, farDbf, '-117', '53', '-115', '55', '0', '-').status, 2);
    out = run('sql', far, farDbf, '-130', '53', '-115', '55', '0', '-');
    assert.equal(out.status, 2);
    assert.equal(run('sql', far, farDbf, '-117', '53', '-115', '55', '1; drop', '-').status, 2);
    assert.equal(run('sql', far, farDbf, '-117', '53', '-115', '55', '0', "2026'").status, 2);
    writeFileSync(join(dir, 'bad.shp'), new Uint8Array(100));
    assert.equal(
      run('sql', join(dir, 'bad.shp'), farDbf, '-117', '53', '-115', '55', '0', '-').status,
      2,
    );
  });
});
