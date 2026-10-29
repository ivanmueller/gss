import { FX_SOURCE_LABELS, isCalendarDate, isFxRateStale, type FxQuoteList } from '@grain/domain';

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

/** CAD per USD as decimal text that the money helpers accept. */
const RATE = /^\d{1,18}(?:\.\d{1,12})?$/;

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
  const rates = Array.isArray(resource.data.rates) ? resource.data.rates : [];
  const latest = rates[0];
  if (!latest || !RATE.test(latest.rate) || !isCalendarDate(latest.rateDate)) {
    return {
      fx: null,
      noRate: {
        short: 'no CAD/USD rate',
        long: 'there is no Bank of Canada CAD/USD rate yet. It is fetched each business-day evening.',
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
