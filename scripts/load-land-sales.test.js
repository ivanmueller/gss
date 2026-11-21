// Tests of scripts/load-land-sales.js (F-242): the sale files and the grid's sections become
// one transaction that replaces the copy under the size guard. Made-up parcels, buyers and
// prices only; the downloads ask the province's sites and are tried by hand.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./load-land-sales.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'load-land-sales-'));
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args) =>
  spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
    encoding: 'utf8',
  });

const land = (key, portion = '') =>
  `<Land><LandKey>${key}</LandKey><Portion></Portion><MetesBoundsIndicator>${portion}</MetesBoundsIndicator><MetesBounds></MetesBounds></Land>`;
const contract = (no, lands, zone = 'EXAMPLE FM') =>
  `<Contract><ContractNo>${no}</ContractNo><Hectares>256</Hectares><Tract><LandDescription>${lands}</LandDescription>` +
  `<ZoneDescription><Line><Substance>PETROLEUM AND NATURAL GAS</Substance><Qualifier>IN THE</Qualifier><ZoneName>${zone}</ZoneName></Line></ZoneDescription></Tract></Contract>`;
const notice = (date, contracts) =>
  `<?xml version="1.0"?><PublicOfferingNotice xmlns="http://tempuri.org/PON.xsd"><MineralType>PETROLEUM AND NATURAL GAS</MineralType><SaleDate>${date}</SaleDate>` +
  `<Schedule><ContractType>LEASE</ContractType><Region><Name>PLAINS</Name>${contracts}</Region></Schedule><AddendaAndContacts></AddendaAndContacts></PublicOfferingNotice>`;

const files = join(dir, 'files');
const sections = join(dir, 'sections.ndjson');
const square = [
  [-116, 54],
  [-115.975, 54],
  [-115.975, 54.0145],
  [-116, 54.0145],
];

function setUp(into, sold = 'EXAMPLE "LAND" LTD.\'); drop table x; --') {
  mkdirSync(into, { recursive: true });
  writeFileSync(
    join(into, '20261104PON.xml'),
    notice(
      '2026-11-04',
      contract('A0001', land('51806024')) +
        contract('A0002', land('51806024SW', 'P') + land('41203424')) +
        contract('A0003', land('41203424')),
    ),
  );
  writeFileSync(
    join(into, '20261104PSR.xml'),
    '<ROOT><MineralType>PETROLEUM AND NATURAL GAS<SaleDate>2026/11/04' +
      `<Parcel><ParcelNumber>0001</ParcelNumber><ContractFlag>A</ContractFlag><Status>ACCEPTED</Status><Bonus>56888.32</Bonus><DollarPerHectare>222.22</DollarPerHectare><Clients><ClientName>${sold.replaceAll('&', '&amp;')}</ClientName><Percentage>100.0000000</Percentage></Clients></Parcel>` +
      '<Parcel><ParcelNumber>0002</ParcelNumber><ContractFlag>A</ContractFlag><Status>NO OFFERS</Status><Clients /></Parcel>' +
      '</SaleDate></MineralType></ROOT>',
  );
  writeFileSync(
    join(into, '20261202PON.xml'),
    notice('2026-12-02', contract('A0001', land('5180602401'))),
  );
  writeFileSync(join(into, 'notes.txt'), 'not a sale file');
  writeFileSync(sections, `${JSON.stringify(['5-18-60-24', square])}\n`);
}

describe('load-land-sales.js', () => {
  test('sql: one transaction that replaces the copy, joins the results and checks the size', () => {
    setUp(files);
    const out = run('sql', files, sections, '-117', '53', '-115', '55', '1000');
    assert.equal(out.status, 0, out.stderr);
    const sql = out.stdout;
    assert.match(sql, /^\\set ON_ERROR_STOP on\nbegin;/);
    assert.match(
      sql,
      /delete from petro\.land_sale_parcels;\ncopy petro\.land_sale_parcels \(sale_date,/,
    );
    // The sold parcel: its money as published, its buyer's quotes doubled so it stays one value.
    assert.ok(
      sql.includes(
        '"2026-11-04","A0001","LEASE","PLAINS","256","PETROLEUM AND NATURAL GAS IN THE EXAMPLE FM","51806024","f","ACCEPTED","56888.32","222.22","EXAMPLE ""LAND"" LTD.\'); drop table x; -- 100%","(-115.975,54.0145),(-116,54)"',
      ),
      sql,
    );
    // Part of its land outside the area, and a portion: kept, marked inexact, with no offers.
    assert.match(sql, /"2026-11-04","A0002",[^\n]*"51806024SW 41203424","t","NO OFFERS",,,,/);
    // A parcel wholly outside the area is left out; one of a sale not held yet has no result.
    assert.doesNotMatch(sql, /"A0003"/);
    assert.match(sql, /"2026-12-02","A0001",[^\n]*"5180602401","f",,,,,/);
    assert.match(
      sql,
      /values \('https:\/\/content2\.energy\.alberta\.ca\/[^']+', '2026-11-04', '2026-12-02', -117, 53, -115, 55, 2, 3\);/,
    );
    assert.match(sql, /pg_database_size\(current_database\(\)\) \+ 1000 > 419430400/);
    assert.ok(sql.indexOf('Size guard') < sql.indexOf('commit;'));
    assert.match(
      out.stderr,
      /2 sales from 2026-11-04 to 2026-12-02, 1 results files; 3 parcels in the area, 1 outside it\./,
    );
  });

  test('sql: no sale files, no parcel in the area or sections in another form load nothing', () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    assert.equal(run('sql', empty, sections, '-117', '53', '-115', '55', '0').status, 2);
    const elsewhere = join(dir, 'elsewhere.ndjson');
    writeFileSync(elsewhere, `${JSON.stringify(['4-1-1-1', square])}\n`);
    assert.equal(run('sql', files, elsewhere, '-117', '53', '-115', '55', '0').status, 2);
    const bad = join(dir, 'bad.ndjson');
    writeFileSync(bad, `${JSON.stringify(["5-18-60-24'); drop", square])}\n`);
    const refused = run('sql', files, bad, '-117', '53', '-115', '55', '0');
    assert.equal(refused.status, 2);
    assert.equal(refused.stdout, '');
  });

  test('sql: an area outside Alberta or a size that is no number loads nothing', () => {
    assert.equal(run('sql', files, sections, '-130', '53', '-115', '55', '0').status, 2);
    assert.equal(run('sql', files, sections, '-117', '53', '-115', '55', '1; drop').status, 2);
  });

  test('fetch and sections: a year before the files, or a bad area, asks nothing', () => {
    assert.equal(run('fetch', dir, '1999').status, 2);
    assert.equal(run('fetch', dir, 'all').status, 2);
    assert.equal(run('sections', 'west', '53', '-115', '55', join(dir, 'x')).status, 2);
  });
});
