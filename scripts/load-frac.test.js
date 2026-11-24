// Tests of scripts/load-frac.js (F-288): the wells read become one transaction that replaces the
// copy under the size guard. Made-up wells only; the reading itself is tested in
// packages/domain/src/frac.test.ts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./load-frac.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-frac-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
  });

function file(name, content) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(content));
  return path;
}

const WELL = {
  uwi: '00/11-23-030-27W4/0',
  licenceNumber: '0999999',
  firstFracDate: '2030-01-02',
  lastFracDate: '2030-01-20',
  fracs: 1,
  stages: 30,
  waterM3: '40000.5',
  proppantT: '4784.9',
  upgradeHintT: '0',
  refracProppantT: '0',
  maxTvdM: '2233.5',
  suspect: false,
};

describe('load-frac.js sql', () => {
  test('writes one transaction: the copy replaced, the load recorded, the size guard', () => {
    const path = file('ok.json', {
      wells: [WELL, { ...WELL, uwi: '00/11-23-030-27W4/2', stages: null, maxTvdM: null }],
      skipped: 2,
      sourceDate: '2030-01-28',
    });
    const out = run('sql', path, '1000');
    assert.equal(out.status, 0, out.stderr);
    const sql = out.stdout;
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;\ntruncate petro\.frac_wells;/);
    assert.match(
      sql,
      /"00\/11-23-030-27W4\/0","0999999","2030-01-02","2030-01-20","1","30","40000\.5","4784\.9","0","0","2233\.5","false"/,
    );
    // Nulls as empty fields.
    assert.match(
      sql,
      /"00\/11-23-030-27W4\/2","0999999","2030-01-02","2030-01-20","1",,"40000\.5"/,
    );
    assert.match(
      sql,
      /insert into petro\.frac_loads \(source_url, source_date, wells, skipped\) values \('https:\/\/static\.aer\.ca\/[^']+', '2030-01-28', 2, 2\);/,
    );
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 419430400/);
    assert.match(sql, /commit;/);
  });

  test('refuses a well the reader would never write, without echoing it', () => {
    for (const bad of [
      { ...WELL, uwi: "00/11-23-030-27W4/0'; drop table x; --" },
      { ...WELL, proppantT: '1e9' },
      { ...WELL, lastFracDate: '2029-12-31' },
      { ...WELL, suspect: 'no' },
    ]) {
      const out = run('sql', file('bad.json', { wells: [bad], skipped: 0, sourceDate: null }), '0');
      assert.equal(out.status, 1);
      assert.equal(out.stdout, '');
      assert.doesNotMatch(out.stderr, /drop table/);
    }
  });

  test('refuses no wells, and a missing size', () => {
    assert.equal(run('sql', file('none.json', { wells: [], skipped: 0 }), '0').status, 2);
    assert.equal(run('sql', file('ok2.json', { wells: [WELL] })).status, 1);
  });
});
