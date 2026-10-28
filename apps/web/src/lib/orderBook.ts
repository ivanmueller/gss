import { compareDecimal, grossSpread, roundMoney, toCad, type SpreadBlocked } from '@grain/domain';

import type { Facility, FxRate, Quote } from '../data/types';

// The workspace's order book: for each commodity and grade, the live asks (sellers' offers) and
// bids side by side, best first, and the gross spread between the best bid and the best ask.
// Every price is shown in CAD, the reporting currency: a USD quote is converted at the given
// CAD/USD rate, exactly, and keeps its original price and the rate so the conversion can be
// shown. Without a rate a USD quote cannot be placed and is listed apart, never priced at zero
// (docs/TRADING_RULES.md §5.3–5.4). A spread is not a margin: freight, handling, border costs
// and basis differences are not in it.

/** A live quote placed in the book, with its price in CAD. */
export interface BookQuote {
  facility: Facility;
  quote: Quote;
  /** CAD per unit, exact (unrounded): sorting and the spread use this. */
  cad: string;
  /** CAD per unit for display: as quoted, or rounded to cents when converted. */
  cadDisplay: string;
  /** The rate used to convert a USD quote; null when it was quoted in CAD. */
  fx: FxRate | null;
}

/** A quote left out of the book, and why. */
export interface OutOfBook {
  facility: Facility;
  quote: Quote;
  /**
   * Expired, withdrawn, superseded or past valid-until; a price not per metric tonne (the
   * book is per tonne, and converting needs a factor not built yet); or a USD quote without
   * a rate.
   */
  reason: 'NOT_LIVE' | 'UNIT_NOT_MT' | 'FX_MISSING';
  /** Its price in CAD for display, when it can be converted. */
  cadDisplay: string | null;
}

export type BookSpread =
  | { status: 'ok'; amount: string; currency: 'CAD'; unit: string }
  | { status: 'missing'; side: 'bid' | 'ask' }
  | { status: 'blocked'; reason: SpreadBlocked };

export interface CommodityBook {
  commodity: string;
  grade: string;
  /** Live asks (sellers' offers), lowest CAD price first; equal prices in the order quoted. */
  asks: BookQuote[];
  /** Live bids, highest CAD price first; equal prices in the order quoted. */
  bids: BookQuote[];
  /** Best bid minus best ask in CAD, or which side is missing. */
  spread: BookSpread;
  /** True when the best bid or best ask is only indicative. */
  indicative: boolean;
  /** Left out of the book: not live, or not convertible to CAD. */
  outOfBook: OutOfBook[];
}

/** Firm or indicative and still before its valid-until time. Neither is a trade. */
export function isLive(quote: Quote, now: Date): boolean {
  return (
    (quote.status === 'firm' || quote.status === 'indicative') &&
    Date.parse(quote.validUntil) > now.getTime()
  );
}

/** The status to show: a firm or indicative quote past its valid-until time shows as expired. */
export function displayStatus(quote: Quote, now: Date): Quote['status'] {
  if ((quote.status === 'firm' || quote.status === 'indicative') && !isLive(quote, now)) {
    return 'expired';
  }
  return quote.status;
}

/** A quote's price in CAD: exact, for display, and the rate used; null without a rate. */
export function cadPrice(
  quote: Quote,
  fx: FxRate | null,
): { cad: string; cadDisplay: string; fx: FxRate | null } | null {
  const converted = toCad(quote.price, fx?.cadPerUsd ?? null);
  if (converted.status === 'blocked') return null;
  if (converted.cadPerUsd === null) {
    return { cad: converted.amount, cadDisplay: converted.amount, fx: null };
  }
  // Rounded only for display; the book compares the exact amount.
  return { cad: converted.amount, cadDisplay: roundMoney(converted.amount), fx };
}

const earlierFirst = (a: { quote: Quote }, b: { quote: Quote }) =>
  Date.parse(a.quote.quotedAt) - Date.parse(b.quote.quotedAt);

function byPrice(direction: 1 | -1) {
  return (a: BookQuote, b: BookQuote) =>
    direction * compareDecimal(a.cad, b.cad) || earlierFirst(a, b);
}

function bookSpread(bestBid: BookQuote | undefined, bestAsk: BookQuote | undefined): BookSpread {
  if (!bestAsk) return { status: 'missing', side: 'ask' };
  if (!bestBid) return { status: 'missing', side: 'bid' };
  const unit = bestBid.quote.price.unit;
  const spread = grossSpread(
    { amount: bestBid.cad, currency: 'CAD', unit },
    { amount: bestAsk.cad, currency: 'CAD', unit: bestAsk.quote.price.unit },
  );
  if (spread.status === 'blocked') return spread;
  // From the exact prices, then rounded to cents if either was converted.
  const converted = bestBid.fx !== null || bestAsk.fx !== null;
  return {
    status: 'ok',
    amount: converted ? roundMoney(spread.amount) : spread.amount,
    currency: 'CAD',
    unit,
  };
}

/**
 * The order books for the chosen commodities, in the order given, with USD quotes converted
 * at `fx` (none converted when it is null). A commodity with no quotes at all still gets an
 * (empty) book, so the panel can say so.
 */
export function buildOrderBooks(
  facilities: readonly Facility[],
  commodities: readonly string[],
  fx: FxRate | null,
  now: Date,
): CommodityBook[] {
  const entries = facilities.flatMap((facility) =>
    facility.quotes.map((quote) => ({ facility, quote })),
  );
  return commodities.flatMap((commodity) => {
    const ofCommodity = entries.filter((entry) => entry.quote.commodity === commodity);
    const grades = [...new Set(ofCommodity.map((entry) => entry.quote.grade))];
    if (grades.length === 0) {
      return [
        {
          commodity,
          grade: '',
          asks: [],
          bids: [],
          spread: { status: 'missing', side: 'ask' } as const,
          indicative: false,
          outOfBook: [],
        },
      ];
    }
    return grades.map((grade) => {
      const placed: BookQuote[] = [];
      const outOfBook: OutOfBook[] = [];
      for (const entry of ofCommodity.filter((e) => e.quote.grade === grade)) {
        const price = cadPrice(entry.quote, fx);
        if (!isLive(entry.quote, now)) {
          outOfBook.push({ ...entry, reason: 'NOT_LIVE', cadDisplay: price?.cadDisplay ?? null });
        } else if (entry.quote.price.unit !== 'MT') {
          outOfBook.push({
            ...entry,
            reason: 'UNIT_NOT_MT',
            cadDisplay: price?.cadDisplay ?? null,
          });
        } else if (!price) {
          outOfBook.push({ ...entry, reason: 'FX_MISSING', cadDisplay: null });
        } else {
          placed.push({ ...entry, ...price });
        }
      }
      const asks = placed.filter((entry) => entry.quote.side === 'OFFER').sort(byPrice(1));
      const bids = placed.filter((entry) => entry.quote.side === 'BID').sort(byPrice(-1));
      const [bestAsk] = asks;
      const [bestBid] = bids;
      return {
        commodity,
        grade,
        asks,
        bids,
        spread: bookSpread(bestBid, bestAsk),
        indicative: [bestAsk, bestBid].some((entry) => entry?.quote.status === 'indicative'),
        outOfBook: outOfBook.sort(earlierFirst),
      };
    });
  });
}
