import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * Alberta's royalty prices (F-285; 20261206010000_petro_prices.sql): every price the "Load prices"
 * workflow stored, and its latest load. Members only read.
 */

export interface PriceDbRow {
  series: string;
  /** YYYY-MM. */
  month: string;
  /** As stored, a decimal string. */
  price: string;
  unit: string;
  source_url: string;
}

/** The latest load. */
export interface PriceLoad {
  loadedAt: string;
  prices: number;
  firstMonth: string | null;
  lastMonth: string | null;
  /** How many of the province's files could not be read; their months are missing. */
  unread: number;
}

export interface PricesDatabase {
  /** Members: the latest load and every price, by series and month. */
  prices(ctx: PetroleumContext): Promise<{ load: PriceLoad | null; rows: PriceDbRow[] }>;
}

export function priceQueries(sql: postgres.Sql): PricesDatabase {
  return {
    prices(ctx) {
      return sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '15s', true),
                        set_config('petro.user_id', ${ctx.userId}, true),
                        set_config('petro.organization_id', ${ctx.organizationId}, true),
                        set_config('petro.member_role', ${ctx.role}, true),
                        set_config('petro.request_id', ${ctx.requestId}, true)`;
        const [load] = await tx<
          {
            loaded_at: Date;
            prices: number;
            first_month: string | null;
            last_month: string | null;
            unread: number;
          }[]
        >`
          select loaded_at, prices, to_char(first_month, 'YYYY-MM') as first_month,
                 to_char(last_month, 'YYYY-MM') as last_month, cardinality(unread) as unread
          from petro.price_loads order by id desc limit 1`;
        const rows = await tx<PriceDbRow[]>`
          select series, to_char(month, 'YYYY-MM') as month, price::text as price, unit,
                 source_url
          from petro.reference_prices
          order by series, month`;
        return {
          load: load
            ? {
                loadedAt: load.loaded_at.toISOString(),
                prices: load.prices,
                firstMonth: load.first_month,
                lastMonth: load.last_month,
                unread: load.unread,
              }
            : null,
          rows,
        };
      });
    },
  };
}
