// The workspace's view of facilities and their quotes: the made-up demo data, or GSS's real
// bids and offers turned into this shape (lib/workspaceQuotes.ts). The shared quote contract
// is in packages/domain (quotes.ts).

export type FacilityRole = 'seller' | 'buyer';
export type QuoteSide = 'OFFER' | 'BID';
export type QuoteStatus = 'indicative' | 'firm' | 'withdrawn' | 'expired' | 'superseded';
export type Currency = 'CAD' | 'USD';
/** Per metric tonne, short ton, bushel or hundredweight, as quoted. */
export type PriceUnit = 'MT' | 'ST' | 'BU' | 'CWT';

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
  /** Where it came from, in words, e.g. "Phone call". */
  source: string;
  revision: number;
  /** The quote's own page, for real bids and offers. */
  href?: string;
  /** UTC ISO 8601 timestamps. */
  quotedAt: string;
  validUntil: string;
  /** ISO dates; null when not stated. */
  deliveryWindow: { start: string | null; end: string | null };
  /** Decimal strings in metric tonnes; no minimum is null. */
  quantityMt: { min: string | null; max: string };
}

export interface Facility {
  id: string;
  name: string;
  roles: readonly FacilityRole[];
  region: string;
  country: string;
  /** WGS84 degrees, for the map; null when there are no coordinates, so no pin. */
  latitude: number | null;
  longitude: number | null;
  locationPrecision: 'approximate' | 'exact' | null;
  /** The counterparty's page, for real bids and offers. */
  href?: string;
  /** What the facility buys or sells, whether or not it has a quote right now. */
  commodities: readonly string[];
  /** Newest first. */
  quotes: readonly Quote[];
}
