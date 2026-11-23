import { PRICE_SERIES } from '@grain/domain';

import type { PriceDbRow, PriceLoad } from './petro-prices-db';

/** The Worker's prices route needs this oil and gas schema (20261206010000). */
export const PRICES_SCHEMA_VERSION = 19;

/** One month's price: YYYY-MM, the price as stored (a decimal string), its source's index. */
export type PricePoint = [month: string, price: string, source: number];

export interface PricesAnswer {
  load: PriceLoad | null;
  /** Each source address once; a point names its own. */
  sources: string[];
  /** The series in PRICE_SERIES order, only those with a price, each month in order. */
  series: { key: string; name: string; unit: string; points: PricePoint[] }[];
}

/** Builds the answer: each series with its months, each source address written once. */
export function pricesAnswer(load: PriceLoad | null, rows: PriceDbRow[]): PricesAnswer {
  const sources: string[] = [];
  const sourceAt = new Map<string, number>();
  const points = new Map<string, PricePoint[]>();
  for (const row of rows) {
    let at = sourceAt.get(row.source_url);
    if (at === undefined) {
      at = sources.push(row.source_url) - 1;
      sourceAt.set(row.source_url, at);
    }
    const list = points.get(row.series) ?? [];
    list.push([row.month, row.price, at]);
    points.set(row.series, list);
  }
  const series = PRICE_SERIES.filter((s) => points.has(s.key)).map((s) => ({
    key: s.key,
    name: s.name,
    unit: s.unit,
    points: (points.get(s.key) ?? []).sort((a, b) => a[0].localeCompare(b[0])),
  }));
  return { load, sources, series };
}
