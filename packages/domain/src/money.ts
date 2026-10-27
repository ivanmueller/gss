import { Decimal } from 'decimal.js';

// Money arithmetic on decimal strings. Uses decimal.js, never JavaScript floating point
// (docs/TRADING_RULES.md §5.3).
//
// Two ranges of input:
// - Quoted values, prices and rates as people enter them: up to 18 integer and 12 fraction
//   digits. toCad multiplies two of them, so its result has at most 36 integer and 24
//   fraction digits.
// - Amounts, anything compared, subtracted or rounded here, quoted or calculated: up to 40
//   integer and 24 fraction digits, which holds every toCad result and the difference of two.
// At 128 significant digits, a product of two quoted values (60 digits at most) and a
// difference of two amounts (65) are always exact.
const Exact = Decimal.clone({ precision: 128, rounding: Decimal.ROUND_HALF_EVEN });

/** A price as quoted: a decimal string ("725.00"), its currency and its unit. */
export interface QuotedPrice {
  amount: string;
  currency: string;
  unit: string;
}

// Plain decimals: an optional minus, digits, an optional fraction; no exponent, no thousands
// separators, no spaces.
const QUOTED = /^-?\d{1,18}(?:\.\d{1,12})?$/;
const AMOUNT = /^-?\d{1,40}(?:\.\d{1,24})?$/;

function parse(text: string, pattern: RegExp): Decimal {
  if (!pattern.test(text)) throw new Error(`Not a decimal amount: "${text}"`);
  return new Exact(text);
}

/** A price or rate as entered. */
const quoted = (text: string) => parse(text, QUOTED);
/** A quoted or calculated amount. */
const amount = (text: string) => parse(text, AMOUNT);

/** Decimal places as written: "790.00" has 2 (decimal.js would count 0). */
function places(text: string): number {
  return text.split('.')[1]?.length ?? 0;
}

/** Compares two decimal amounts exactly: negative if a < b, 0 if equal, positive if a > b. */
export function compareDecimal(a: string, b: string): number {
  return amount(a).comparedTo(amount(b));
}

export type SpreadBlocked = 'CURRENCY_MISMATCH' | 'UNIT_MISMATCH';

export type GrossSpread =
  | { status: 'ok'; amount: string; currency: string; unit: string }
  | { status: 'blocked'; reason: SpreadBlocked };

/**
 * Bid minus offer per unit, exactly, keeping the inputs' decimal places: how far a buyer's
 * price is above (or, when negative, below) a seller's. It is before freight, handling, border
 * costs and basis differences, so it is not a margin (docs/TRADING_RULES.md §5.4).
 *
 * Quotes in different currencies or units cannot be compared without an FX rate or a unit
 * conversion, which this does not invent: the result is blocked, never zero.
 */
export function grossSpread(bid: QuotedPrice, offer: QuotedPrice): GrossSpread {
  if (bid.currency !== offer.currency) return { status: 'blocked', reason: 'CURRENCY_MISMATCH' };
  if (bid.unit !== offer.unit) return { status: 'blocked', reason: 'UNIT_MISMATCH' };
  const bidAmount = amount(bid.amount);
  const offerAmount = amount(offer.amount);
  const difference = bidAmount.minus(offerAmount);
  return {
    status: 'ok',
    // A zero difference prints as "0.00", never "-0.00".
    amount: (difference.isZero() ? new Exact(0) : difference).toFixed(
      Math.max(places(bid.amount), places(offer.amount)),
    ),
    currency: bid.currency,
    unit: bid.unit,
  };
}

export type CadConversion =
  | {
      status: 'ok';
      /** CAD per unit, exact: the quoted amount, or a USD amount times the rate, unrounded. */
      amount: string;
      currency: 'CAD';
      unit: string;
      /** The rate used, CAD per 1 USD; null when the price was already in CAD. */
      cadPerUsd: string | null;
    }
  | { status: 'blocked'; reason: 'FX_MISSING' | 'CURRENCY_UNSUPPORTED' };

/**
 * A price in CAD, the reporting currency (docs/TRADING_RULES.md §5.3): a CAD price as quoted,
 * a USD price as `USD × CAD per USD`, exactly and unrounded. Without a rate a USD price is
 * blocked, never zero; other currencies are not supported yet. The caller keeps the original
 * price and the rate alongside the result, so the conversion can always be shown and redone.
 */
export function toCad(price: QuotedPrice, cadPerUsd: string | null): CadConversion {
  if (price.currency === 'CAD') {
    quoted(price.amount);
    return {
      status: 'ok',
      amount: price.amount,
      currency: 'CAD',
      unit: price.unit,
      cadPerUsd: null,
    };
  }
  if (price.currency !== 'USD') return { status: 'blocked', reason: 'CURRENCY_UNSUPPORTED' };
  if (cadPerUsd === null) return { status: 'blocked', reason: 'FX_MISSING' };
  const rate = quoted(cadPerUsd);
  if (!rate.isPositive() || rate.isZero()) throw new Error(`Not an FX rate: "${cadPerUsd}"`);
  // Exact: the product has at most the sum of both decimal places.
  const product = quoted(price.amount).times(rate);
  return {
    status: 'ok',
    amount: (product.isZero() ? new Exact(0) : product).toFixed(
      places(price.amount) + places(cadPerUsd),
    ),
    currency: 'CAD',
    unit: price.unit,
    cadPerUsd,
  };
}

/**
 * An amount rounded for display or reporting, half away from zero ("986.005" → "986.01").
 * Only at that boundary: sums, comparisons and spreads use the unrounded amounts
 * (docs/TRADING_RULES.md §5.3).
 */
export function roundMoney(value: string, decimalPlaces = 2): string {
  const rounded = amount(value).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return (rounded.isZero() ? new Exact(0) : rounded).toFixed(decimalPlaces);
}
