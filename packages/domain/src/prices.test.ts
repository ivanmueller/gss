import { describe, expect, it } from 'vitest';

import {
  LetterMonthError,
  PRICE_SERIES,
  PriceSheetError,
  gasReferenceTable,
  monthOf,
  parLetterLinks,
  parLetterPrices,
  priceOf,
  sheetMonth,
  sheetPrices,
} from './prices';

// Alberta's royalty prices (F-285): the province's pages and files read as the loader reads them.
// Every price here is made up; the layouts follow the province's own.

describe('the words of a price', () => {
  it('reads a month and a price, never as a float', () => {
    expect(monthOf('January', 2012)).toBe('2012-01');
    expect(monthOf(' december ', '1994')).toBe('1994-12');
    expect(monthOf('Smarch', 2012)).toBeNull();
    expect(priceOf('$1,234.50')).toBe('1234.50');
    expect(priceOf('0.00')).toBe('0.00');
    expect(priceOf('-11.76')).toBe('-11.76');
    expect(priceOf('')).toBeNull();
    expect(priceOf('n/a')).toBeNull();
  });

  it('gives each series one unit', () => {
    const keys = PRICE_SERIES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('gasReferenceTable', () => {
  const row = (year: string, cells: string[]) =>
    `<tr><td><a href="https://open.alberta.ca/publications/x-${year}">${year}</a></td>${cells
      .map((c) => `<td class="goa-table-number">${c}</td>`)
      .join('')}</tr>`;
  const html = `<p>Chart</p><table><tr><td>January</td><td>9.99</td></tr></table>
    <p><strong>Table 1.</strong>&nbsp;Monthly prices</p><table class="table"><thead><tr><th>Year</th></tr></thead><tbody>
    ${row('2026', ['1.11', '2.22', ...Array<string>(10).fill('&nbsp;')])}
    ${row('1994', ['3.33', '4.44', '5.55', '6.66', '7.77', '8.88', '1.01', '1.02', '1.03', '1.04', '1.05', '1.06'])}
    </tbody></table><p><strong>Table 2.</strong></p><table><tr><td>1993</td></tr></table>`;

  it('reads every month of the archive, and leaves out the months not yet published', () => {
    const rows = gasReferenceTable(html);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({ series: 'gas_reference', month: '2026-01', price: '1.11' });
    expect(rows.find((r) => r.month === '1994-12')?.price).toBe('1.06');
    // The chart's table before the archive is not read.
    expect(rows.some((r) => r.price === '9.99')).toBe(false);
  });

  it('reads nothing without the archive', () => {
    expect(gasReferenceTable('<p>No table</p>')).toEqual([]);
  });
});

describe('sheetMonth', () => {
  it('finds the month in each of the names the open data site uses', () => {
    expect(sheetMonth('rp199412.pdf')).toBe('1994-12');
    expect(sheetMonth('energy-monthly-reference-price-calculations-1996-08.pdf')).toBe('1996-08');
    expect(sheetMonth('2016-01-monthly-reference-price-calculations-january-2016.pdf')).toBe(
      '2016-01',
    );
    expect(sheetMonth('em-monthly-reference-price-calculations-2024-13.pdf')).toBeNull();
    expect(sheetMonth('dataset?q=monthly')).toBeNull();
  });
});

describe('sheetPrices', () => {
  it('reads the liquids of a recent sheet, spec and mix apart', () => {
    const text = [
      'Monthly Reference Price Calculations - January 2030',
      'Propane ISC Reference Price $9.99 /GJ',
      'Methane ISC Reference Price $1.01 /GJ',
      'Methane ISC Par Price $1.02 /GJ',
      'Methane ISC Par Price',
      'Ethane Reference Price $1.11 /GJ',
      'Ethane Par Price $1.12 /GJ',
      'Propane Spec Reference Price $222.22 /m³',
      'Propane Mix Reference Price $0.00 /m³',
      'Butanes Spec Reference Price $1,333.33 /m³',
      'Pentanes Plus Par Price $444.44 /m³',
      'Sulphur Default Price $5.55 /tonne',
    ].join('\n');
    expect(sheetPrices(text, '2030-01')).toEqual([
      { series: 'methane_isc_par', month: '2030-01', price: '1.02' },
      { series: 'ethane_reference', month: '2030-01', price: '1.11' },
      { series: 'ethane_par', month: '2030-01', price: '1.12' },
      { series: 'propane_spec_reference', month: '2030-01', price: '222.22' },
      { series: 'propane_mix_reference', month: '2030-01', price: '0.00' },
      { series: 'butanes_spec_reference', month: '2030-01', price: '1333.33' },
      { series: 'pentanes_plus_par', month: '2030-01', price: '444.44' },
      { series: 'sulphur_default', month: '2030-01', price: '5.55' },
    ]);
  });

  it('reads the older names: no unit, "Butane", "Pentanes", units before the slash', () => {
    const text = [
      'Pentanes Reference Price 111.11',
      'Pentanes Par Price 112.22',
      'Propane Reference Price $/m3',
      'Butane Floor Price 33.33',
      'Butanes Par Price 6.66 $/GJ',
      'Sulphur Default Price 7.77 $ / tonne',
      'Pentanes Old 43.21860 %',
    ].join('\n');
    expect(sheetPrices(text, '1997-06')).toEqual([
      { series: 'pentanes_plus_reference', month: '1997-06', price: '111.11' },
      { series: 'pentanes_plus_par', month: '1997-06', price: '112.22' },
      { series: 'butanes_floor', month: '1997-06', price: '33.33' },
      { series: 'butanes_par', month: '1997-06', price: '6.66' },
      { series: 'sulphur_default', month: '1997-06', price: '7.77' },
    ]);
  });

  it('refuses a price in the wrong unit, or two prices for one series', () => {
    expect(() => sheetPrices('Propane Spec Reference Price $2.22 /GJ', '2030-01')).toThrow(
      PriceSheetError,
    );
    expect(() =>
      sheetPrices('Ethane Par Price $1.11 /GJ\nEthane Par Price $1.12 /GJ', '2030-01'),
    ).toThrow(PriceSheetError);
    // The same price twice is one price.
    expect(
      sheetPrices('Ethane Par Price $1.11 /GJ\nEthane Par Price $1.11 /GJ', '2030-01'),
    ).toHaveLength(1);
  });

  it('reads nothing from a scanned sheet with no text', () => {
    expect(sheetPrices('\f\f', '2030-01')).toEqual([]);
  });
});

describe('parLetterLinks', () => {
  const table = (year: string, links: string) =>
    `<table><thead><tr><th colspan="4">${year} by month</th></tr></thead><tbody><tr>${links}</tr></tbody></table>`;
  const link = (n: string, text: string, label = '') =>
    `<td><a href="http://inform.energy.gov.ab.ca/Documents/Published/IL-${n}.pdf" target="_blank"${label ? ` aria-label="${label}"` : ''}>${text}</a></td>`;

  it('takes each link’s month from its text and its year from the table, over https', () => {
    const html = `${table('2031', link('2030-43', 'January') + link('2030-46', 'February') + '<td>March&nbsp;</td>')}
      ${table('2030', link('2029-40', 'December', 'December, 2030') + link('2029-41', 'November', 'October, 2030'))}
      <a href="https://example.test/IL-2030-01.pdf">January</a>`;
    expect(parLetterLinks(html)).toEqual([
      {
        month: '2030-12',
        url: 'https://inform.energy.gov.ab.ca/Documents/Published/IL-2029-40.pdf',
      },
      {
        month: '2031-01',
        url: 'https://inform.energy.gov.ab.ca/Documents/Published/IL-2030-43.pdf',
      },
      {
        month: '2031-02',
        url: 'https://inform.energy.gov.ab.ca/Documents/Published/IL-2030-46.pdf',
      },
    ]);
  });
});

describe('parLetterPrices', () => {
  const letter = (heading: string, prices: string[]) =>
    [
      'INFORMATION LETTER 2030-43',
      heading,
      'Category of Crude Oil Density',
      'January 2031 Par Prices',
      '$/M3',
      `Light Oil less than 850 kilograms per cubic metre ${prices[0] ?? ''}`,
      'Medium Oil',
      'greater than or equal to 850 kilograms per',
      'cubic metre and less than 900 kilograms',
      prices[1] ?? '',
      'Heavy Oil',
      prices[2] ?? '',
      'Ultra Heavy Oil',
      'greater than or equal to 925 kilograms per',
      prices[3] ?? '',
      'For further information, please contact:',
      'Light Par Price 999.99',
    ].join('\n');

  it('reads the four prices in order, a price of nothing among them', () => {
    const text = letter('Par Prices for January 2031 Production Month', [
      '$111.11',
      '$0.00',
      '$3.30',
      '$44.44',
    ]);
    expect(parLetterPrices(text, '2031-01')).toEqual([
      { series: 'oil_light_par', month: '2031-01', price: '111.11' },
      { series: 'oil_medium_par', month: '2031-01', price: '0.00' },
      { series: 'oil_heavy_par', month: '2031-01', price: '3.30' },
      { series: 'oil_ultra_heavy_par', month: '2031-01', price: '44.44' },
    ]);
    // As poppler's pdftotext gives the older letters: a dash, and the unit's 3 on its own line.
    const poppler = letter('Par Prices – January 2031 Production Month', [
      '1.11',
      '2.22',
      '3.33',
      '4.44',
    ]).replace('$/M3', '$/M\n3');
    expect(parLetterPrices(poppler, '2031-01').map((r) => r.price)).toEqual([
      '1.11',
      '2.22',
      '3.33',
      '4.44',
    ]);
    // The older heading.
    expect(
      parLetterPrices(
        letter('Par Prices - January 2031 Production Month', ['1.11', '2.22', '3.33', '4.44']),
        '2031-01',
      ),
    ).toHaveLength(4);
  });

  it('refuses a letter for another month, or one without four prices', () => {
    const april = letter('Par Prices for April 2031 Production Month', [
      '1.11',
      '2.22',
      '3.33',
      '4.44',
    ]);
    expect(() => parLetterPrices(april, '2031-05')).toThrow(LetterMonthError);
    const short = letter('Par Prices for January 2031 Production Month', [
      '1.11',
      '2.22',
      '3.33',
      '',
    ]);
    expect(() => parLetterPrices(short, '2031-01')).toThrow(PriceSheetError);
    expect(() => parLetterPrices(short, '2031-01')).not.toThrow(LetterMonthError);
  });
});
