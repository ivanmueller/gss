import { compareDecimal, grossSpread, type GrossSpread } from '@grain/domain';

import type { Currency, Facility, Quote } from '../data/types';

// The workspace's order book: for each commodity and grade, the live bids and offers side by
// side, best first, and the gross spread between the best bid and best offer. Prices are only
// compared within one currency: a CAD offer and a USD bid need an FX rate, which the app does
// not have yet, so that comparison is reported as blocked rather than computed or set to zero
// (docs/TRADING_RULES.md §5.3–5.4). A spread is not a margin: freight, handling, border costs
// and basis differences are not in it.

export interface BookQuote {
  facility: Facility;
  quote: Quote;
}

export type BookSpread = GrossSpread | { status: 'missing'; side: 'bid' | 'offer' };

export interface CurrencyBook {
  currency: Currency;
  /** Live offers, lowest price first; equal prices in the order they were quoted. */
  offers: BookQuote[];
  /** Live bids, highest price first; equal prices in the order they were quoted. */
  bids: BookQuote[];
  /** Best bid minus best offer, or which side is missing. */
  spread: BookSpread;
  /** True when the best bid or best offer is only indicative. */
  indicative: boolean;
}

export interface CommodityBook {
  commodity: string;
  grade: string;
  /** One book per currency that has a live quote, CAD before USD. */
  currencies: CurrencyBook[];
  /** Bids and offers exist, but some only in different currencies: comparing them needs FX. */
  needsFx: boolean;
  /** Left out of the book: expired, withdrawn or superseded, or past valid-until. */
  stale: BookQuote[];
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

const earlierFirst = (a: BookQuote, b: BookQuote) =>
  Date.parse(a.quote.quotedAt) - Date.parse(b.quote.quotedAt);

function byPrice(direction: 1 | -1) {
  return (a: BookQuote, b: BookQuote) =>
    direction * compareDecimal(a.quote.price.amount, b.quote.price.amount) || earlierFirst(a, b);
}

function currencyBook(currency: Currency, quotes: BookQuote[]): CurrencyBook {
  const offers = quotes.filter((entry) => entry.quote.side === 'OFFER').sort(byPrice(1));
  const bids = quotes.filter((entry) => entry.quote.side === 'BID').sort(byPrice(-1));
  const [bestOffer] = offers;
  const [bestBid] = bids;
  let spread: BookSpread;
  if (!bestOffer) spread = { status: 'missing', side: 'offer' };
  else if (!bestBid) spread = { status: 'missing', side: 'bid' };
  else spread = grossSpread(bestBid.quote.price, bestOffer.quote.price);
  return {
    currency,
    offers,
    bids,
    spread,
    indicative: [bestOffer, bestBid].some((entry) => entry?.quote.status === 'indicative'),
  };
}

/**
 * The order books for the chosen commodities, in the order given. A commodity with no quotes
 * at all still gets a (empty) book, so the panel can say so.
 */
export function buildOrderBooks(
  facilities: readonly Facility[],
  commodities: readonly string[],
  now: Date,
): CommodityBook[] {
  const entries = facilities.flatMap((facility) =>
    facility.quotes.map((quote) => ({ facility, quote })),
  );
  return commodities.flatMap((commodity) => {
    const ofCommodity = entries.filter((entry) => entry.quote.commodity === commodity);
    const grades = [...new Set(ofCommodity.map((entry) => entry.quote.grade))];
    if (grades.length === 0) {
      return [{ commodity, grade: '', currencies: [], needsFx: false, stale: [] }];
    }
    return grades.map((grade) => {
      const ofGrade = ofCommodity.filter((entry) => entry.quote.grade === grade);
      const live = ofGrade.filter((entry) => isLive(entry.quote, now));
      const currencies = [...new Set(live.map((entry) => entry.quote.price.currency))].sort();
      const books = currencies.map((currency) =>
        currencyBook(
          currency,
          live.filter((entry) => entry.quote.price.currency === currency),
        ),
      );
      const offerCurrencies = new Set(
        live.filter((e) => e.quote.side === 'OFFER').map((e) => e.quote.price.currency),
      );
      const bidCurrencies = new Set(
        live.filter((e) => e.quote.side === 'BID').map((e) => e.quote.price.currency),
      );
      const needsFx = [...offerCurrencies].some((offer) =>
        [...bidCurrencies].some((bid) => bid !== offer),
      );
      return {
        commodity,
        grade,
        currencies: books,
        needsFx,
        stale: ofGrade.filter((entry) => !isLive(entry.quote, now)).sort(earlierFirst),
      };
    });
  });
}

/** The longest quantity in a set of books, for scaling the quantity bars. */
export function largestQuantity(books: readonly CommodityBook[]): string | null {
  let largest: string | null = null;
  for (const book of books) {
    for (const { offers, bids } of book.currencies) {
      for (const { quote } of [...offers, ...bids]) {
        if (largest === null || compareDecimal(quote.quantityMt.max, largest) > 0) {
          largest = quote.quantityMt.max;
        }
      }
    }
  }
  return largest;
}
