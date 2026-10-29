// Reference exchange rates (GT-052): the Bank of Canada's daily USD/CAD rate, CAD per 1 USD
// (docs/DECISIONS.md, 2026-10-27; docs/TRADING_RULES.md §5.3). Shared by the API, which
// stores and serves the rates, and the web app, which converts USD prices with them.

/** A rate more than this many calendar days old is stale: USD prices are then not converted. */
export const FX_STALE_AFTER_DAYS = 4;

export const FX_SOURCE_LABELS = { bank_of_canada: 'Bank of Canada' } as const;
export type FxSource = keyof typeof FX_SOURCE_LABELS;

/** One day's reference rate, as stored (GET /api/v1/fx-quotes). */
export interface FxQuote {
  base: 'USD';
  quote: 'CAD';
  /** CAD per 1 USD, decimal text exactly as published ("1.3912"). Never a JavaScript number. */
  rate: string;
  /** The business day it is the average of, YYYY-MM-DD. */
  rateDate: string;
  source: FxSource;
  /** The Bank's series, FXUSDCAD. */
  series: string;
  /** When the Worker fetched it, an ISO 8601 UTC instant. */
  fetchedAt: string;
}

export interface FxQuoteList {
  /** Newest day first. */
  rates: FxQuote[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The Bank publishes in Ottawa, so a rate's age counts Ottawa's calendar days.
const ottawa = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date in Ottawa at the given instant, YYYY-MM-DD. */
export function ottawaDate(now: Date): string {
  const parts = Object.fromEntries(ottawa.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year ?? ''}-${parts.month ?? ''}-${parts.day ?? ''}`;
}

/** True for a real calendar date written YYYY-MM-DD (not 2026-02-30). */
export function isCalendarDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const value = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === text;
}

function dayNumber(date: string): number {
  if (!isCalendarDate(date)) throw new Error(`Not a date: "${date}"`);
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** Calendar days from a rate's day to today in Ottawa: 0 on the day itself. */
export function fxRateAgeDays(rateDate: string, now: Date): number {
  return dayNumber(ottawaDate(now)) - dayNumber(rateDate);
}

/**
 * True when the rate is more than FX_STALE_AFTER_DAYS calendar days old. The Bank does not
 * publish on weekends and holidays, so Friday's rate is still current on Tuesday; a stopped
 * feed makes it stale, and USD prices are then left unconverted, never converted at an old
 * rate without saying so.
 */
export function isFxRateStale(rateDate: string, now: Date): boolean {
  return fxRateAgeDays(rateDate, now) > FX_STALE_AFTER_DAYS;
}
