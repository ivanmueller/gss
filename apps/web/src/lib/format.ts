import type { Price } from '../data/types';

const DECIMAL = /^\d+(\.\d+)?$/;

/** "USD 725.00/MT". Built from the decimal string; no floating-point conversion. */
export function formatPrice(price: Price): string {
  if (!DECIMAL.test(price.amount)) {
    throw new Error(`Price amount is not a decimal string: "${price.amount}"`);
  }
  return `${price.currency} ${price.amount}/${price.unit}`;
}

/** "2026-10-26 15:00 UTC". Shown in UTC so every viewer reads the same time. */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Not a timestamp: "${iso}"`);
  }
  const text = date.toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 16)} UTC`;
}

const SIGNED = /^-?\d+(\.\d+)?$/;

/**
 * "CAD +22.00/MT", "CAD −15.00/MT" (a true minus sign), "CAD 0.00/MT": a spread from its
 * decimal string, signed so a negative one is plain to see.
 */
export function formatSignedPrice(price: { amount: string; currency: string; unit: string }) {
  if (!SIGNED.test(price.amount)) {
    throw new Error(`Amount is not a decimal string: "${price.amount}"`);
  }
  const negative = price.amount.startsWith('-');
  const digits = negative ? price.amount.slice(1) : price.amount;
  const zero = /^0+(\.0+)?$/.test(digits);
  const sign = zero ? '' : negative ? '\u2212' : '+';
  return `${price.currency} ${sign}${digits}/${price.unit}`;
}

export function formatQuantityRange(range: { min: string; max: string }): string {
  return `${range.min}–${range.max} MT`;
}
