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
