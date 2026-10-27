import { Decimal } from 'decimal.js';

// Money arithmetic for prices quoted as decimal strings. Uses decimal.js, never JavaScript
// floating point (docs/TRADING_RULES.md §5.3), with enough precision that subtraction of
// any accepted amount is exact.
const Exact = Decimal.clone({ precision: 64, rounding: Decimal.ROUND_HALF_EVEN });

/** A price as quoted: a decimal string ("725.00"), its currency and its unit. */
export interface QuotedPrice {
  amount: string;
  currency: string;
  unit: string;
}

// A plain decimal: optional minus, up to 18 integer and 12 fraction digits, no exponent,
// no thousands separators, no spaces.
const DECIMAL = /^-?\d{1,18}(?:\.\d{1,12})?$/;

function decimal(text: string): Decimal {
  if (!DECIMAL.test(text)) throw new Error(`Not a decimal amount: "${text}"`);
  return new Exact(text);
}

/** Decimal places as written: "790.00" has 2 (decimal.js would count 0). */
function places(text: string): number {
  return text.split('.')[1]?.length ?? 0;
}

/** Compares two decimal amounts exactly: negative if a < b, 0 if equal, positive if a > b. */
export function compareDecimal(a: string, b: string): number {
  return decimal(a).comparedTo(decimal(b));
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
  const bidAmount = decimal(bid.amount);
  const offerAmount = decimal(offer.amount);
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
    decimal(price.amount);
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
  const rate = decimal(cadPerUsd);
  if (!rate.isPositive() || rate.isZero()) throw new Error(`Not an FX rate: "${cadPerUsd}"`);
  // Exact: the product has at most the sum of both decimal places.
  const product = decimal(price.amount).times(rate);
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
export function roundMoney(amount: string, decimalPlaces = 2): string {
  const rounded = decimal(amount).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return (rounded.isZero() ? new Exact(0) : rounded).toFixed(decimalPlaces);
}
