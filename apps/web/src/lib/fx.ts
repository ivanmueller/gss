import {
  FX_SOURCE_LABELS,
  fxRateAgeDays,
  isCalendarDate,
  isFxRateStale,
  type FxQuote,
  type FxQuoteList,
} from '@grain/domain';

import type { FxRate } from '../data/types';
import { formatDay } from './format';
import type { Resource } from './useApiResource';

// The Bank of Canada's daily CAD/USD rate (GET /api/v1/fx-quotes) as the workspace uses it:
// the latest stored day, unless it is stale (more than four days old, docs/DECISIONS.md), in
// which case USD prices are left unconverted and the page says why. Nothing is converted at a
// rate the API did not give.

/** Why USD prices are not converted: a few words beside a price, and a sentence for the book. */
export interface NoRate {
  short: string;
  long: string;
}

export const NO_RATE: NoRate = {
  short: 'no CAD/USD rate',
  long: 'there is no CAD/USD rate to convert them.',
};

/**
 * CAD per USD as plain decimal text, below 10 as the database requires; above zero is checked
 * separately. A JSON number is refused, never coerced.
 */
const RATE = /^\d(?:\.\d{1,12})?$/;

/**
 * The row as the API promises it, or null: a Bank of Canada USD/CAD rate (CAD per USD) as text
 * above zero, for a real day that is not after today in Ottawa. The database only stores such
 * rows; this guards against an answer that is malformed on the way (a proxy, a bug).
 */
function usableRate(row: unknown, now: Date): FxQuote | null {
  if (typeof row !== 'object' || row === null) return null;
  const { base, quote, rate, rateDate, source, series } = row as Record<string, unknown>;
  const valid =
    base === 'USD' &&
    quote === 'CAD' &&
    source === 'bank_of_canada' &&
    series === 'FXUSDCAD' &&
    typeof rate === 'string' &&
    RATE.test(rate) &&
    /[1-9]/.test(rate) &&
    typeof rateDate === 'string' &&
    isCalendarDate(rateDate) &&
    fxRateAgeDays(rateDate, now) >= 0;
  return valid ? (row as FxQuote) : null;
}

export function bankOfCanadaRate(
  resource: Resource<FxQuoteList>,
  now: Date,
): { fx: FxRate | null; noRate: NoRate } {
  if (resource.status === 'loading') {
    return {
      fx: null,
      noRate: { short: 'CAD/USD rate loading', long: 'the CAD/USD rate is loading.' },
    };
  }
  if (resource.status === 'error') {
    return {
      fx: null,
      noRate: {
        short: 'no CAD/USD rate',
        long: `the CAD/USD rate could not be loaded (${resource.error.message.replace(/\.$/, '')}).`,
      },
    };
  }
  // Only the newest day counts: an older one is never used in its place without saying so.
  const rates: unknown = (resource.data as { rates?: unknown } | null)?.rates;
  const newest: unknown = Array.isArray(rates) ? rates[0] : undefined;
  if (newest === undefined) {
    return {
      fx: null,
      noRate: {
        short: 'no CAD/USD rate',
        long: 'there is no Bank of Canada CAD/USD rate yet. It is fetched each business-day evening.',
      },
    };
  }
  const latest = usableRate(newest, now);
  if (!latest) {
    return {
      fx: null,
      noRate: {
        short: 'no CAD/USD rate',
        long: 'the latest CAD/USD rate the server sent could not be used.',
      },
    };
  }
  const label = `${FX_SOURCE_LABELS[latest.source]}, ${formatDay(latest.rateDate)}`;
  if (isFxRateStale(latest.rateDate, now)) {
    return {
      fx: null,
      noRate: {
        short: 'CAD/USD rate out of date',
        long: `the latest CAD/USD rate (${label}) is out of date.`,
      },
    };
  }
  return { fx: { cadPerUsd: latest.rate, source: label }, noRate: NO_RATE };
}
