// Tests of scripts/load-land.js (F-241): the rows fetch writes become one transaction that
// replaces the copy under the size guard. Made-up land only; the fetch itself asks the
// province's services and is tried by hand.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./load-land.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-land-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
  });

const place = {
  bounds: [-116.1, 54, -116, 54.1],
  shape: [
    [
      [
        [-116.1, 54],
        [-116, 54],
        [-116, 54.1],
        [-116.1, 54],
      ],
    ],
  ],
};
const agreement = {
  rights: 'png',
  agreementType: '002',
  agreementNumber: '924',
  tract: '00',
  mineralType: 'NG',
  agreementGroup: 'LEASE',
  status: 'ACTIVE',
  vintage: null,
  holder: 'EXAMPLE "ENERGY" LTD.',
  parties: "EXAMPLE ENERGY LTD. 100%'); drop table x; --",
  zone: 'PNG TO BASE EXAMPLE',
  originalAreaHa: 256,
  areaHa: 256,
  termDate: '2020-02-17',
  continuationDate: null,
  expiryText: 'INDEFINITE',
  ...place,
};
const offset = {
  offsetType: 'AAY',
  offsetNumber: '2050843E02',
  tract: '00',
  holder: 'EXAMPLE ENERGY LTD.',
  expiryDate: '2027-05-08',
  zone: null,
  ...place,
};
const freehold = {
  landKey: 501032312,
  substances: 'ALL MINERALS EXCEPT GOLD,SILVER',
  nationalPark: null,
  reserveNumber: null,
  reserveName: null,
  ...place,
};

function files(into, rows) {
  const lines = (list) => list.map((r) => `${JSON.stringify(r)}\n`).join('');
  writeFileSync(join(into, 'png_agreements.ndjson'), lines(rows.png ?? [agreement]));
  writeFileSync(join(into, 'oil_sands_agreements.ndjson'), lines(rows.oilSands ?? []));
  writeFileSync(join(into, 'offset_notices.ndjson'), lines(rows.offsets ?? [offset]));
  writeFileSync(join(into, 'freehold.ndjson'), lines(rows.freehold ?? [freehold]));
}

describe('load-land.js', () => {
  test('sql: one transaction that replaces the copy, records the loads and checks the size', () => {
    files(dir, {});
    const out = run('sql', dir, '-117', '53', '-115', '55', '1000');
    assert.equal(out.status, 0, out.stderr);
    const sql = out.stdout;
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;/);
    assert.match(sql, /truncate petro\.land_agreements;\ncopy petro\.land_agreements \(rights,/);
    assert.match(sql, /truncate petro\.land_offsets;\ncopy petro\.land_offsets/);
    assert.match(sql, /truncate petro\.land_freehold;\ncopy petro\.land_freehold/);
    // Quotes are doubled, so a holder's or party's text stays one value of the row.
    assert.ok(
      sql.includes('"EXAMPLE ""ENERGY"" LTD.","EXAMPLE ENERGY LTD. 100%\'); drop table x; --"'),
    );
    // The box is written as the database reads it: the north-east corner, then the south-west.
    assert.ok(
      sql.includes(
        '"(-116,54.1),(-116.1,54)","[[[[-116.1,54],[-116,54],[-116,54.1],[-116.1,54]]]]"',
      ),
    );
    assert.match(
      sql,
      /values \('png_agreements', 'https:\/\/geospatial\.alberta\.ca\/titan\/rest\/services\/energy\/mineral_agreement\/MapServer\/8', -117, 53, -115, 55, 1\);/,
    );
    assert.match(sql, /values \('oil_sands_agreements', [^\n]+, 0\);/);
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 471859200/);
    assert.ok(sql.indexOf('Size guard') < sql.indexOf('commit;'));
  });

  test('sql: without the offset notices file, the stored ones are kept and the rest loads', () => {
    const noOffsets = mkdtempSync(join(dir, 'no-offsets-'));
    files(noOffsets, {});
    rmSync(join(noOffsets, 'offset_notices.ndjson'));
    const out = run('sql', noOffsets, '-117', '53', '-115', '55', '1000');
    assert.equal(out.status, 0, out.stderr);
    const sql = out.stdout;
    assert.match(sql, /truncate petro\.land_agreements;/);
    assert.match(sql, /truncate petro\.land_freehold;/);
    // Neither emptied nor refilled; the closing summary still counts them.
    assert.doesNotMatch(sql, /(truncate|copy) petro\.land_offsets/);
    assert.doesNotMatch(sql, /'offset_notices'/);
    assert.match(sql, /values \('freehold', /);
    assert.match(sql, /Size guard/);
    assert.match(out.stderr, /offset_notices: not read this time; the stored copy is kept/);
  });

  test('sql: any other missing file loads nothing', () => {
    for (const name of ['png_agreements', 'oil_sands_agreements', 'freehold']) {
      const missing = mkdtempSync(join(dir, `no-${name}-`));
      files(missing, {});
      rmSync(join(missing, `${name}.ndjson`));
      const out = run('sql', missing, '-117', '53', '-115', '55', '0');
      assert.equal(out.status, 2, name);
      assert.equal(out.stdout, '');
    }
  });

  test('sql: a row in another form loads nothing', () => {
    const bad = mkdtempSync(join(dir, 'bad-'));
    files(bad, { freehold: [{ ...freehold, bounds: [-116.1, 54, -116, '54.1); drop table x'] }] });
    const out = run('sql', bad, '-117', '53', '-115', '55', '0');
    assert.equal(out.status, 2);
    assert.equal(out.stdout, '');
    assert.doesNotMatch(out.stderr, /drop table/);
    files(bad, { png: [{ ...agreement, agreementNumber: "1'; x" }] });
    assert.equal(run('sql', bad, '-117', '53', '-115', '55', '0').status, 2);
  });

  test('sql: no agreements, an area outside Alberta or a size that is no number load nothing', () => {
    const empty = mkdtempSync(join(dir, 'empty-'));
    files(empty, { png: [] });
    assert.equal(run('sql', empty, '-117', '53', '-115', '55', '0').status, 2);
    assert.equal(run('sql', dir, '-130', '53', '-115', '55', '0').status, 2);
    assert.equal(run('sql', dir, '-115', '53', '-117', '55', '0').status, 2);
    assert.equal(run('sql', dir, '-117', '53', '-115', '55', '1; drop').status, 2);
  });

  test('fetch: an unknown layer or a bad area asks nothing', () => {
    assert.equal(run('fetch', 'coal', '-117', '53', '-115', '55', join(dir, 'x')).status, 2);
    assert.equal(run('fetch', 'freehold', 'west', '53', '-115', '55', join(dir, 'x')).status, 2);
  });
});
