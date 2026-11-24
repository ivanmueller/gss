// Alberta's royalty prices (F-285, docs/FEATURES_OIL_GAS.md): the gas reference price of every
// month since 1994, the reference and par prices of the gas liquids and sulphur from the monthly
// reference price calculations, and the oil par prices since January 2012. Read from the
// province's own pages and files by scripts/load-prices.js; prices stay decimal strings, never
// floats.

/** A price series: what the province calls it, and its unit. */
export interface PriceSeries {
  key: string;
  name: string;
  unit: RoyaltyPriceUnit;
}

export type RoyaltyPriceUnit = '$/GJ' | '$/m3' | '$/tonne';

/**
 * Every series kept. Older and newer names that may not mean the same are kept apart: the
 * "Propane Reference Price" of before July 2014 is not merged with the "Spec" price after it.
 */
export const PRICE_SERIES = [
  { key: 'gas_reference', name: 'Gas reference price', unit: '$/GJ' },
  // The rate of methane under both frameworks (F-285 part 4): every monthly sheet since 2009.
  { key: 'methane_isc_par', name: 'Methane ISC par price', unit: '$/GJ' },
  { key: 'ethane_reference', name: 'Ethane reference price', unit: '$/GJ' },
  { key: 'ethane_par', name: 'Ethane par price', unit: '$/GJ' },
  { key: 'propane_reference', name: 'Propane reference price', unit: '$/m3' },
  { key: 'propane_spec_reference', name: 'Propane spec reference price', unit: '$/m3' },
  { key: 'propane_mix_reference', name: 'Propane mix reference price', unit: '$/m3' },
  { key: 'propane_par', name: 'Propane par price', unit: '$/GJ' },
  { key: 'propane_floor', name: 'Propane floor price', unit: '$/m3' },
  { key: 'butanes_reference', name: 'Butanes reference price', unit: '$/m3' },
  { key: 'butanes_spec_reference', name: 'Butanes spec reference price', unit: '$/m3' },
  { key: 'butanes_mix_reference', name: 'Butanes mix reference price', unit: '$/m3' },
  { key: 'butanes_par', name: 'Butanes par price', unit: '$/GJ' },
  { key: 'butanes_floor', name: 'Butanes floor price', unit: '$/m3' },
  { key: 'pentanes_plus_reference', name: 'Pentanes plus reference price', unit: '$/m3' },
  { key: 'pentanes_plus_spec_reference', name: 'Pentanes plus spec reference price', unit: '$/m3' },
  { key: 'pentanes_plus_mix_reference', name: 'Pentanes plus mix reference price', unit: '$/m3' },
  { key: 'pentanes_plus_par', name: 'Pentanes plus par price', unit: '$/m3' },
  { key: 'sulphur_default', name: 'Sulphur default price', unit: '$/tonne' },
  { key: 'oil_light_par', name: 'Light oil par price', unit: '$/m3' },
  { key: 'oil_medium_par', name: 'Medium oil par price', unit: '$/m3' },
  { key: 'oil_heavy_par', name: 'Heavy oil par price', unit: '$/m3' },
  { key: 'oil_ultra_heavy_par', name: 'Ultra heavy oil par price', unit: '$/m3' },
] as const satisfies readonly PriceSeries[];

export type PriceSeriesKey = (typeof PRICE_SERIES)[number]['key'];

const SERIES_BY_KEY = new Map<string, PriceSeries>(PRICE_SERIES.map((s) => [s.key, s]));
export const priceSeries = (key: string): PriceSeries | undefined => SERIES_BY_KEY.get(key);

/** One price: its series, its production month (YYYY-MM) and the price as written. */
export interface PriceRow {
  series: PriceSeriesKey;
  month: string;
  price: string;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const monthKey = (year: number, month: number) =>
  `${String(year)}-${String(month).padStart(2, '0')}`;

/** A month named in words ("January", 2012) as YYYY-MM; null when it is no month. */
export function monthOf(name: string, year: string | number): string | null {
  const m = MONTHS.indexOf(name.trim().toLowerCase());
  const y = Number(year);
  return m < 0 || !Number.isInteger(y) || y < 1980 || y > 2100 ? null : monthKey(y, m + 1);
}

// A price as written: digits with a point and up to four decimals, a sign allowed.
const PRICE = /^-?\d{1,6}(\.\d{1,4})?$/;
/** A written price ("$1,234.50") as a decimal string ("1234.50"); null when it is none. */
export function priceOf(text: string): string | null {
  const plain = text.replace(/[$,\s]/g, '');
  return PRICE.test(plain) ? plain : null;
}

const cellText = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

/**
 * The gas reference prices of the province's price archive (Table 1 of
 * https://www.alberta.ca/alberta-natural-gas-reference-price): one row a year, twelve months.
 * Months not yet published are blank and left out.
 */
export function gasReferenceTable(html: string): PriceRow[] {
  const start = html.indexOf('Table 1.');
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end < 0 ? undefined : end);
  const rows: PriceRow[] = [];
  for (const row of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...(row[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      cellText(c[1] ?? ''),
    );
    const year = Number(cells[0]);
    if (cells.length !== 13 || !Number.isInteger(year) || year < 1994 || year > 2100) continue;
    cells.slice(1).forEach((cell, i) => {
      const price = priceOf(cell);
      if (price !== null)
        rows.push({ series: 'gas_reference', month: monthKey(year, i + 1), price });
    });
  }
  return rows;
}

/**
 * The production month of a monthly reference price calculation, from its file's name as the
 * province's open data site has it: rp199412.pdf, energy-monthly-reference-price-calculations-
 * 1996-12.pdf, 2016-01-monthly-reference-price-calculations-january-2016.pdf.
 */
export function sheetMonth(fileName: string): string | null {
  const name = fileName.toLowerCase();
  const short = /^rp(\d{4})(\d{2})\.pdf$/.exec(name);
  const long = /(?:^|-)(\d{4})-(\d{2})(?:-|\.pdf$)/.exec(name);
  const found = short ?? long;
  if (!found) return null;
  const year = Number(found[1]);
  const month = Number(found[2]);
  return year >= 1994 && year <= 2100 && month >= 1 && month <= 12 ? monthKey(year, month) : null;
}

// The liquids' and sulphur's lines of a monthly sheet, as `pdftotext -raw` gives them: the name
// at the start of a line, then the price, its unit after it or not at all (1998).
const SHEET_LINES: readonly [RegExp, PriceSeriesKey][] = [
  // On one line in the sheets checked of 2010, 2018 and 2022 to 2026; the December 2012 sheet
  // sets the name apart from its price, so such months stay missing (and block an estimate).
  [/^Methane ISC Par Price\b/, 'methane_isc_par'],
  [/^Ethane Reference Price\b/, 'ethane_reference'],
  [/^Ethane Par Price\b/, 'ethane_par'],
  [/^Propane Reference Price\b/, 'propane_reference'],
  [/^Propane Spec Reference Price\b/, 'propane_spec_reference'],
  [/^Propane Mix Reference Price\b/, 'propane_mix_reference'],
  [/^Propane Par Price\b/, 'propane_par'],
  [/^Propane Floor Price\b/, 'propane_floor'],
  // "Butane" in the sheets of the 1990s.
  [/^Butanes? Reference Price\b/, 'butanes_reference'],
  [/^Butanes Spec Reference Price\b/, 'butanes_spec_reference'],
  [/^Butanes Mix Reference Price\b/, 'butanes_mix_reference'],
  [/^Butanes? Par Price\b/, 'butanes_par'],
  [/^Butanes? Floor Price\b/, 'butanes_floor'],
  [/^Pentanes(?: Plus)? Reference Price\b/, 'pentanes_plus_reference'],
  [/^Pentanes Plus Spec Reference Price\b/, 'pentanes_plus_spec_reference'],
  [/^Pentanes Plus Mix Reference Price\b/, 'pentanes_plus_mix_reference'],
  [/^Pentanes(?: Plus)? Par Price\b/, 'pentanes_plus_par'],
  [/^Sulphur Default Price\b/, 'sulphur_default'],
];

// The price and its unit after a series' name: "$904.18/m3", "6.27 $/GJ", "84.22 /tonne", "123.06".
const AFTER_NAME = /^\s*\$?\s*(-?[\d,]+(?:\.\d+)?)\s*(\$\s*)?(?:\/\s*(GJ|m\S?|tonne))?\s*$/i;

function unitOf(written: string | undefined): RoyaltyPriceUnit | null {
  if (written === undefined) return null;
  const unit = written.toLowerCase();
  if (unit === 'gj') return '$/GJ';
  if (unit === 'tonne') return '$/tonne';
  return unit.startsWith('m') ? '$/m3' : null;
}

export class PriceSheetError extends Error {}
/** A letter linked for one month that is another month's: the page's link is wrong. */
export class LetterMonthError extends PriceSheetError {}

/**
 * The liquids' and sulphur's prices of one monthly sheet. A price whose unit is not its series'
 * unit, or two different prices for one series, refuses the sheet: the load stops rather than
 * keep a wrong price.
 */
export function sheetPrices(rawText: string, month: string): PriceRow[] {
  const found = new Map<PriceSeriesKey, string>();
  for (const line of rawText.split(/\r?\n/)) {
    const text = line.trim();
    for (const [name, series] of SHEET_LINES) {
      const match = name.exec(text);
      if (!match) continue;
      const after = AFTER_NAME.exec(text.slice(match[0].length).replace(/^\s*:/, ''));
      if (!after) break;
      const price = priceOf(after[1] ?? '');
      if (price === null) break;
      const unit = unitOf(after[3]);
      const expected = priceSeries(series)?.unit;
      if (unit !== null && unit !== expected) {
        throw new PriceSheetError(
          `${month}: ${series} given in ${unit}, expected ${String(expected)}`,
        );
      }
      const before = found.get(series);
      if (before !== undefined && before !== price) {
        throw new PriceSheetError(`${month}: ${series} given as both ${before} and ${price}`);
      }
      found.set(series, price);
      break;
    }
  }
  return [...found].map(([series, price]) => ({ series, month, price }));
}

/** A par price letter linked from the province's oil par prices page, and its month. */
export interface ParLetterLink {
  month: string;
  url: string;
}

/**
 * The letters of https://www.alberta.ca/oil-par-prices: each month's link, named "January, 2012".
 * Their plain-http addresses are asked for over https (the province's server answers only there).
 */
export function parLetterLinks(html: string): ParLetterLink[] {
  const links: ParLetterLink[] = [];
  const seen = new Set<string>();
  // One table a year, headed "2012 by month"; each link's text is its month. Where a link also
  // says "January, 2012", the two must agree.
  const tables = html.split(/(?=<th[^>]*>\s*\d{4} by month\s*<\/th>)/);
  for (const table of tables) {
    const year = /^<th[^>]*>\s*(\d{4}) by month/.exec(table)?.[1];
    if (year === undefined) continue;
    const pattern =
      /<a href="https?:\/\/inform\.energy\.gov\.ab\.ca\/(Documents\/Published\/IL-\d{4}-\d{1,3}\.pdf)"([^>]*)>([^<]*)<\/a>/g;
    for (const m of table.matchAll(pattern)) {
      const month = monthOf(cellText(m[3] ?? ''), year);
      const labelled = /aria-label="([A-Za-z]+),\s*(\d{4})"/.exec(m[2] ?? '');
      if (month === null || seen.has(month)) continue;
      if (labelled && monthOf(labelled[1] ?? '', labelled[2] ?? '') !== month) continue;
      seen.add(month);
      links.push({ month, url: `https://inform.energy.gov.ab.ca/${m[1] ?? ''}` });
    }
  }
  return links.sort((a, b) => a.month.localeCompare(b.month));
}

const OIL_SERIES: readonly PriceSeriesKey[] = [
  'oil_light_par',
  'oil_medium_par',
  'oil_heavy_par',
  'oil_ultra_heavy_par',
];

/**
 * The four oil par prices of one letter (`pdftotext -raw`): its month from "Par Prices for
 * January 2026 Production Month" (or "Par Prices - January 2012 …"), which must be the month the
 * page linked it for; the prices, in the order light, medium, heavy, ultra heavy, from the table
 * on its first page, between "$/M3" and "For further information". Anything else refuses it.
 */
export function parLetterPrices(rawText: string, month: string): PriceRow[] {
  // A hyphen or a dash, as the PDF tool gives it (poppler: "–"; xpdf: "-").
  const said = /Par Prices\s*(?:[-–—]|for)\s*([A-Za-z]+)\s+(\d{4})\s+Production Month/i.exec(
    rawText,
  );
  const letterMonth = said ? monthOf(said[1] ?? '', said[2] ?? '') : null;
  if (letterMonth !== month) {
    throw new LetterMonthError(`${month}: the letter is for ${String(letterMonth)}`);
  }
  // "$/M3", or "$/M" and its superscript 3 on the next line (poppler).
  const unit = /\$\/M\s*3/.exec(rawText);
  const end = rawText.search(/For further information/i);
  if (!unit || end < unit.index) throw new PriceSheetError(`${month}: no par price table`);
  const table = rawText.slice(unit.index + unit[0].length, end);
  const prices = [...table.matchAll(/\$?(\d{1,4}\.\d{2})\b/g)].map((m) => m[1] ?? '');
  if (prices.length !== 4) {
    throw new PriceSheetError(`${month}: ${String(prices.length)} par prices, expected 4`);
  }
  return prices.map((price, i) => ({ series: OIL_SERIES[i] ?? 'oil_light_par', month, price }));
}
