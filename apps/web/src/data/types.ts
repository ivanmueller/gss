// Provisional view types for the GT-010 shell. They are not the shared domain
// contract; that is agreed and moved to packages/domain before quote work starts.

export type FacilityRole = 'seller' | 'buyer';
export type QuoteSide = 'OFFER' | 'BID';
export type QuoteStatus = 'indicative' | 'firm' | 'withdrawn' | 'expired' | 'superseded';
export type Currency = 'CAD' | 'USD';
export type PriceUnit = 'MT';

export interface Price {
  /** Decimal string, e.g. "725.00". Never a JavaScript number. */
  amount: string;
  currency: Currency;
  unit: PriceUnit;
}

/** A CAD/USD rate and where it came from (docs/TRADING_RULES.md §5.3). */
export interface FxRate {
  /** CAD per 1 USD, a decimal string, e.g. "1.360000". Never a JavaScript number. */
  cadPerUsd: string;
  /** Where the rate came from, shown next to every price converted with it. */
  source: string;
}

export interface Quote {
  id: string;
  side: QuoteSide;
  commodity: string;
  grade: string;
  price: Price;
  deliveryBasis: string;
  status: QuoteStatus;
  sourceType: 'manual';
  revision: number;
  /** UTC ISO 8601 timestamps. */
  quotedAt: string;
  validUntil: string;
  /** ISO dates. */
  deliveryWindow: { start: string; end: string };
  /** Decimal strings in metric tonnes. */
  quantityMt: { min: string; max: string };
}

export interface Facility {
  id: string;
  name: string;
  roles: readonly FacilityRole[];
  region: string;
  country: 'CA' | 'US';
  /** WGS84 degrees, for the map. */
  latitude: number;
  longitude: number;
  locationPrecision: 'approximate' | 'exact';
  /** What the facility buys or sells, whether or not it has a quote right now. */
  commodities: readonly string[];
  /** Newest first. */
  quotes: readonly Quote[];
}
