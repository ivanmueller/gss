// Tests of scripts/load-licences.js (F-295): today's holders compared with the last load become
// one transaction that records the transfers and replaces the holdings, refused when it reads as
// a list gone wrong. Made-up companies and licences only; the reading itself is tested in
// packages/domain/src/licenceHolders.test.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./load-licences.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-licences-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

function file(name, content) {
  const path = join(dir, name);
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

/** As many made-up licences of a kind as the floors ask for, all held by ZZ01. */
function many(prefix, count) {
  return Array.from({ length: count }, (_, i) => [`${prefix}${String(i + 1)}`, 'ZZ01']);
}

const TODAY = {
  day: '2030-01-02',
  today: {
    well: [['W 0000001', 'ZZ02'], ...many('W 1', 400_000).slice(1)],
    facility: many('F', 35_000),
    pipeline: many('P', 50_000),
  },
  names: { ZZ01: 'Test Oil Corp.', ZZ02: 'Example "Energy", Ltd.' },
  skipped: 3,
  ambiguous: 0,
};

// The last load: W 0000001 and W 0000002, a hundred more wells (so one change is not a tenth)
// and a facility.
const HOLDINGS = [
  'well,ZZ01,W 0000001',
  'well,ZZ01,W 0000002',
  ...many('W 1', 101)
    .slice(1)
    .map(([l]) => `well,ZZ01,${l}`),
  'facility,ZZ01,F1',
  '',
].join('\n');

describe('load-licences.js sql', () => {
  test('a later day: the changes recorded with their names, the holdings replaced, the guards', () => {
    const out = run('sql', file('today.json', TODAY), file('h.csv', HOLDINGS), '7', '1000');
    assert.equal(out.status, 0, out.stderr);
    const sql = out.stdout;
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;\nlock table petro\.licence_loads/);
    assert.match(sql, /coalesce\(\(select max\(id\) from petro\.licence_loads\), 0\) <> 7/);
    // W 0000001 moved from ZZ01 to ZZ02: one transfer.
    assert.match(sql, /values \('2030-01-02', 7, 400000, 35000, 50000, \d+, 1, 3, 0\);/);
    assert.match(sql, /\n"well","W 0000001","ZZ01","ZZ02"\n\\\./);
    // Names quoted for COPY.
    assert.match(sql, /\n"ZZ02","Example ""Energy"", Ltd\."\n/);
    // W 0000002, not in today's lists, keeps its holder.
    assert.match(sql, /"well","ZZ01","\{""W 0000002"",/);
    assert.match(sql, /truncate petro\.licence_holdings;/);
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 471859200/);
    assert.match(sql, /\ncommit;\n/);
  });

  test('the first day records who holds what and no transfers', () => {
    const out = run('sql', file('today.json', TODAY), file('empty.csv', ''), '0', '1000');
    assert.equal(out.status, 0, out.stderr);
    assert.match(
      out.stdout,
      /values \('2030-01-02', null, 400000, 35000, 50000, 485000, 0, 3, 0\);/,
    );
    assert.match(
      out.stdout,
      /copy today_transfers \(kind, licence, from_ba, to_ba\) from stdin with \(format csv\);\n\\\./,
    );
  });

  test('refuses when more than a tenth of a kind changed company, unless accepted', () => {
    const moved = {
      ...TODAY,
      today: { ...TODAY.today, facility: many('F', 35_000).map(([l]) => [l, 'ZZ02']) },
    };
    const holdings = file(
      'all.csv',
      many('F', 35_000)
        .map(([l]) => `facility,ZZ01,${l}`)
        .join('\n'),
    );
    const refused = run('sql', file('moved.json', moved), holdings, '7', '1000');
    assert.equal(refused.status, 4);
    assert.match(refused.stderr, /more than a tenth/);
    const accepted = run('sql', file('moved.json', moved), holdings, '7', '1000', 'accept-large');
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /, 35000, 3, 0\);/);
  });

  test('refuses what is not in the form expected', () => {
    const badLicence = {
      ...TODAY,
      today: { ...TODAY.today, well: [['X1', 'ZZ01'], ...TODAY.today.well] },
    };
    assert.equal(
      run('sql', file('bad.json', badLicence), file('h2.csv', HOLDINGS), '7', '1').status,
      1,
    );
    const few = { ...TODAY, today: { ...TODAY.today, pipeline: many('P', 10) } };
    assert.equal(run('sql', file('few.json', few), file('h3.csv', HOLDINGS), '7', '1').status, 3);
    // Holdings and the last load must agree.
    assert.equal(run('sql', file('t.json', TODAY), file('h4.csv', HOLDINGS), '0', '1').status, 1);
    assert.equal(run('sql', file('t2.json', TODAY), file('h5.csv', ''), '7', '1').status, 1);
    assert.equal(
      run('sql', file('t3.json', TODAY), file('h6.csv', 'well,zz,W 1'), '7', '1').status,
      1,
    );
  });
});
