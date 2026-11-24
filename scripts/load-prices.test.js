// Tests of scripts/load-prices.js (F-285): the prices read become one transaction that replaces
// the copy under the size guard. Made-up prices only; the fetch step is tested through
// packages/domain/src/prices.test.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./load-prices.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-prices-'));
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

const GAS = 'https://www.alberta.ca/alberta-natural-gas-reference-price';
const LETTER = 'https://inform.energy.gov.ab.ca/Documents/Published/IL-2030-43.pdf';

describe('load-prices.js sql', () => {
  test('writes one transaction: the copy replaced, the load recorded, the size guard', () => {
    const path = file('ok.json', {
      rows: [
        { series: 'gas_reference', month: '2030-02', price: '2.22', source: GAS },
        { series: 'gas_reference', month: '2030-01', price: '1.11', source: GAS },
        // A series and month already given: the first wins.
        { series: 'gas_reference', month: '2030-01', price: '9.99', source: GAS },
        { series: 'oil_light_par', month: '2031-01', price: '0.00', source: LETTER },
      ],
      unread: ["https://open.alberta.ca/x'y.pdf", 'https://example.test/not-ours.pdf'],
    });
    const result = run('sql', path, '1000');
    assert.equal(result.status, 0, result.stderr);
    const sql = result.stdout;
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;\ntruncate petro\.reference_prices;/);
    assert.match(sql, /"gas_reference","2030-02-01","2.22","\$\/GJ","https:\/\/www\.alberta\.ca\//);
    assert.match(sql, /"oil_light_par","2031-01-01","0.00","\$\/m3",/);
    assert.equal(sql.includes('9.99'), false);
    assert.match(
      sql,
      /insert into petro\.price_loads \(prices, first_month, last_month, unread\) values \(3, '2030-01-01', '2031-01-01', array\['https:\/\/open\.alberta\.ca\/x''y\.pdf'\]::text\[\]\);/,
    );
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 471859200/);
    assert.match(sql, /commit;/);
  });

  test('refuses a price of no known series, an unparsed price, or another site', () => {
    const cases = [
      { series: 'gold', month: '2030-01', price: '1.00', source: GAS },
      { series: 'gas_reference', month: '2030-01', price: '1.0.0', source: GAS },
      { series: 'gas_reference', month: '2030-1', price: '1.00', source: GAS },
      { series: 'gas_reference', month: '2030-01', price: '1.00', source: 'https://example.test/' },
    ];
    cases.forEach((row, i) => {
      const result = run('sql', file(`bad-${String(i)}.json`, { rows: [row], unread: [] }), '0');
      assert.equal(result.status, 1, JSON.stringify(row));
      assert.equal(result.stdout, '');
    });
  });

  test('loads nothing without prices or without the grain database size', () => {
    assert.equal(run('sql', file('empty.json', { rows: [], unread: [] }), '0').status, 2);
    assert.equal(
      run(
        'sql',
        file('one.json', {
          rows: [{ series: 'gas_reference', month: '2030-01', price: '1.00', source: GAS }],
          unread: [],
        }),
        'many',
      ).status,
      1,
    );
  });
});
