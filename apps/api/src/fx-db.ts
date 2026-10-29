import type { FxQuote } from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

// Reference exchange rates in Postgres (20261029010000_fx_quotes.sql). Reading runs as the
// verified user, so row level security applies; storing runs without a user, as the Worker's
// daily job has none, and goes only through app.record_bank_of_canada_rate().

/** Most rates returned by listFxQuotes. */
export const FX_LIST_LIMIT = 10;

/** What storing one day's rate did: see app.record_bank_of_canada_rate(). */
export type FxStoreOutcome = 'stored' | 'unchanged' | 'differs';

export interface BankOfCanadaRate {
  /** YYYY-MM-DD */
  date: string;
  /** CAD per 1 USD, decimal text exactly as published. */
  cadPerUsd: string;
}

export interface FxDatabase {
  /** The latest USD/CAD rates, newest day first, up to FX_LIST_LIMIT. */
  listFxQuotes: (ctx: RequestContext) => Promise<FxQuote[]>;
  /**
   * Stores Bank of Canada rates for days not stored yet, each in its own transaction so one
   * refused day does not lose the others. Never changes a stored rate.
   */
  storeBankOfCanadaRates: (
    rates: readonly BankOfCanadaRate[],
  ) => Promise<{ rate: BankOfCanadaRate; outcome: FxStoreOutcome | 'refused' }[]>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

interface FxRow {
  rate: string;
  rate_date: string;
  source_series: string;
  fetched_at: Date;
}

const OUTCOMES = new Set<string>(['stored', 'unchanged', 'differs']);

/** A value Postgres refused (SQLSTATE class 22 or 23), as opposed to a lost connection. */
function refusedValue(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return /^2[23]/.test(code);
}

export function fxQueries(asUser: AsUser, sql: postgres.Sql): FxDatabase {
  return {
    listFxQuotes(ctx) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<FxRow[]>`
          select rate::text as rate, to_char(rate_date, 'YYYY-MM-DD') as rate_date,
                 source_series, fetched_at
          from app.fx_quotes
          where base_currency = 'USD' and quote_currency = 'CAD' and source = 'bank_of_canada'
          order by rate_date desc
          limit ${FX_LIST_LIMIT}
        `;
        return rows.map((row) => ({
          base: 'USD',
          quote: 'CAD',
          rate: row.rate,
          rateDate: row.rate_date,
          source: 'bank_of_canada',
          series: row.source_series,
          fetchedAt: row.fetched_at.toISOString(),
        }));
      });
    },

    async storeBankOfCanadaRates(rates) {
      const results: { rate: BankOfCanadaRate; outcome: FxStoreOutcome | 'refused' }[] = [];
      for (const rate of rates) {
        try {
          // No app.user_id is set: the job acts for nobody, and the function needs no user.
          const [row] = await sql<{ outcome: string }[]>`
            select app.record_bank_of_canada_rate(${rate.date}::date, ${rate.cadPerUsd}::numeric)
              as outcome`;
          const outcome = row?.outcome ?? '';
          if (!OUTCOMES.has(outcome)) throw new Error('Unexpected answer from the database');
          results.push({ rate, outcome: outcome as FxStoreOutcome });
        } catch (error) {
          if (!refusedValue(error)) throw error;
          results.push({ rate, outcome: 'refused' });
        }
      }
      return results;
    },
  };
}
