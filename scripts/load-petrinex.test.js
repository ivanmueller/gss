// Tests of scripts/load-petrinex.js (F-252 step 3): a month's file becomes rows, the rows become
// one transaction that replaces the copy under the size guard. Made-up wells and volumes only.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./load-petrinex.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-petrinex-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
  });

const HEADER =
  'ProductionMonth,OperatorName,ActivityID,ProductID,FromToIDType,FromToIDIdentifier,Volume,Energy,Hours';
const vol = join(dir, 'Vol_2026-08-AB.CSV');
writeFileSync(
  vol,
  [
    HEADER,
    '2026-08,"EXAMPLE ENERGY, LTD.",PROD,OIL,WI,100112303027W402,310.5,,744',
    '2026-08,"EXAMPLE ENERGY, LTD.",PROD,GAS,WI,100112303027W402,120.25,,',
    '2026-08,"EXAMPLE ENERGY, LTD.",PROD,GAS,WI,100020606503W400,9,,100',
    '2026-08,"EXAMPLE ENERGY, LTD.",FUEL,GAS,WI,100112303027W402,5,,',
    '2026-08,"EXAMPLE ENERGY, LTD.",INJ,WATER,WI,100082203820W400,812.5,,720',
    '',
  ].join('\r\n'),
);
const uwis = join(dir, 'uwis.txt');
writeFileSync(uwis, '00/11-23-030-27W4/2\n00/01-27-030-27W4/0\n');
const injectUwis = join(dir, 'inject-uwis.txt');
writeFileSync(injectUwis, '00/08-22-038-20W4/0\n');

describe('load-petrinex.js', () => {
  test('month: the rows of the wells asked for, and no others', () => {
    const out = run('month', vol, '2026-08', uwis);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, '00/11-23-030-27W4/2,2026-08-01,310.500,120.250,,,744\n');
    assert.match(out.stderr, /2026-08: 1 of 2 wells produced\./);
  });

  test("month: a waterflood well's injection goes to its own file (F-300)", () => {
    const injectRows = join(dir, 'inject-rows.csv');
    writeFileSync(injectRows, '');
    const out = run('month', vol, '2026-08', uwis, injectUwis, injectRows);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, '00/11-23-030-27W4/2,2026-08-01,310.500,120.250,,,744\n');
    assert.match(out.stderr, /1 of 2 wells produced, 1 of 1 waterflood wells took injection\./);
    assert.equal(readFileSync(injectRows, 'utf8'), '00/08-22-038-20W4/0,2026-08-01,812.500,,720\n');
    // Half the pair is refused.
    assert.equal(run('month', vol, '2026-08', uwis, injectUwis).status, 2);
  });

  test('waterfloods: the keys of the waterflood pools', () => {
    const out = run('waterfloods');
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout, 'stettler_nisku_a\n');
  });

  test('month: a file of another month is refused', () => {
    const out = run('month', vol, '2026-07', uwis);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /holds 2026-08, not 2026-07/);
    assert.equal(out.stdout, '');
  });

  test('sql: one transaction that replaces the copy, records the load and checks the size', () => {
    const rows = join(dir, 'rows.csv');
    writeFileSync(
      rows,
      '00/11-23-030-27W4/2,2026-07-01,300.000,,,,700\n00/11-23-030-27W4/2,2026-08-01,310.500,120.250,,,744\n',
    );
    const sql = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        SCRIPT,
        'sql',
        rows,
        'duvernay',
        '2022-01',
        '2026-08',
        '56',
        '1000',
      ],
      { encoding: 'utf8' },
    );
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;/);
    assert.match(sql, /delete from petro\.well_production;\ncopy petro\.well_production/);
    assert.match(
      sql,
      /values \('https:\/\/www\.petrinex\.gov\.ab\.ca\/publicdata\/API\/Files\/AB\/Vol\/', 'duvernay', '2022-01-01', '2026-08-01', 56, 1, 2, 0, 0\);/,
    );
    // Without injection rows the injection is emptied with the production.
    assert.match(sql, /delete from petro\.well_injection;\ninsert into petro\.production_loads/);
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 471859200/);
    assert.ok(sql.indexOf('Size guard') < sql.indexOf('commit;'));
  });

  test('sql: the injection replaced in the same transaction (F-300)', () => {
    const rows = join(dir, 'rows-2.csv');
    writeFileSync(rows, '00/11-23-030-27W4/2,2026-08-01,310.500,120.250,,,744\n');
    const injectRows = join(dir, 'inject-2.csv');
    writeFileSync(
      injectRows,
      '00/08-22-038-20W4/0,2026-07-01,800.000,,744\n00/08-22-038-20W4/0,2026-08-01,812.500,1.500,720\n',
    );
    const out = run(
      'sql',
      rows,
      'stettler_nisku_a',
      '2022-01',
      '2026-08',
      '56',
      '1000',
      injectRows,
    );
    assert.equal(out.status, 0, out.stderr);
    assert.match(
      out.stdout,
      /delete from petro\.well_injection;\ncopy petro\.well_injection \(uwi, month, water_m3, gas_e3m3, hours\) from stdin with \(format csv\);\n00\/08-22-038-20W4\/0,2026-07-01,800\.000,,744\n00\/08-22-038-20W4\/0,2026-08-01,812\.500,1\.500,720\n\\\.\n/,
    );
    assert.match(out.stdout, /'stettler_nisku_a', '2022-01-01', '2026-08-01', 56, 1, 1, 1, 2\);/);
    assert.ok(out.stdout.indexOf('well_injection') < out.stdout.indexOf('commit;'));
    // An injection row in another form loads nothing.
    const bad = join(dir, 'inject-bad.csv');
    writeFileSync(bad, "00/08-22-038-20W4/0,2026-08-01,1.000'); drop table x; --,,\n");
    const refused = run('sql', rows, '-', '2026-08', '2026-08', '1', '0', bad);
    assert.equal(refused.status, 2);
    assert.equal(refused.stdout, '');
    assert.doesNotMatch(refused.stderr, /drop table/);
  });

  test('sql: rows in another form, or none, load nothing', () => {
    const bad = join(dir, 'bad.csv');
    writeFileSync(bad, "00/11-23-030-27W4/2,2026-08-01,1.000'); drop table x; --,,,,\n");
    const refused = run('sql', bad, '-', '2026-08', '2026-08', '1', '0');
    assert.equal(refused.status, 2);
    assert.equal(refused.stdout, '');
    assert.doesNotMatch(refused.stderr, /drop table/);
    const empty = join(dir, 'empty.csv');
    writeFileSync(empty, '');
    assert.equal(run('sql', empty, '-', '2026-08', '2026-08', '1', '0').status, 2);
  });
});
