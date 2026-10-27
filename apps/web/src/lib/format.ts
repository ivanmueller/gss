import type { Price } from '../data/types';

const DECIMAL = /^\d+(\.\d+)?$/;
const SIGNED = /^-?\d+(\.\d+)?$/;

/** "−12.50" with a true minus sign, "0.00" without one: a signed decimal string as text. */
function withMinus(amount: string): string {
  if (!amount.startsWith('-')) return amount;
  const digits = amount.slice(1);
  return /^0+(\.0+)?$/.test(digits) ? digits : `\u2212${digits}`;
}

/**
 * "USD 725.00/MT", or "CAD −17.00/MT" for a negative (basis) price. Built from the decimal
 * string; no floating-point conversion.
 */
export function formatPrice(price: Price): string {
  if (!SIGNED.test(price.amount)) {
    throw new Error(`Price amount is not a decimal string: "${price.amount}"`);
  }
  return `${price.currency} ${withMinus(price.amount)}/${price.unit}`;
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

/**
 * "CAD +22.00/MT", "CAD −15.00/MT" (a true minus sign), "CAD 0.00/MT": a spread from its
 * decimal string, signed so a negative one is plain to see.
 */
export function formatSignedPrice(price: { amount: string; currency: string; unit: string }) {
  if (!SIGNED.test(price.amount)) {
    throw new Error(`Amount is not a decimal string: "${price.amount}"`);
  }
  const shown = withMinus(price.amount);
  const plus = !shown.startsWith('\u2212') && !/^0+(\.0+)?$/.test(shown);
  return `${price.currency} ${plus ? '+' : ''}${shown}/${price.unit}`;
}

export function formatQuantityRange(range: { min: string; max: string }): string {
  return `${range.min}–${range.max} MT`;
}

/** "21.000" → "21", "42.500" → "42.5": a decimal string without trailing zeros, as text. */
function trimZeros(text: string): string {
  if (!DECIMAL.test(text)) throw new Error(`Not a decimal string: "${text}"`);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** "21–84 MT": the short form for tight spaces such as the order book. */
export function formatQuantityShort(range: { min: string; max: string }): string {
  return `${trimZeros(range.min)}–${trimZeros(range.max)} MT`;
}
