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
 * "805.00", "−17.00": an amount alone, for a column or panel whose heading gives the currency
 * and unit. Built from the decimal string; no floating-point conversion.
 */
export function formatAmount(amount: string): string {
  if (!SIGNED.test(amount)) {
    throw new Error(`Price amount is not a decimal string: "${amount}"`);
  }
  return withMinus(amount);
}

/** "USD 725.00/MT", or "CAD −17.00/MT" for a negative (basis) price. */
export function formatPrice(price: Price): string {
  return `${price.currency} ${formatAmount(price.amount)}/${price.unit}`;
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

/** "+22.00", "−15.00" (a true minus sign), "0.00": a spread, signed so a negative one is plain. */
export function formatSignedAmount(amount: string): string {
  if (!SIGNED.test(amount)) {
    throw new Error(`Amount is not a decimal string: "${amount}"`);
  }
  const shown = withMinus(amount);
  const plus = !shown.startsWith('\u2212') && !/^0+(\.0+)?$/.test(shown);
  return `${plus ? '+' : ''}${shown}`;
}

/** "CAD +22.00/MT", "CAD −15.00/MT", "CAD 0.00/MT". */
export function formatSignedPrice(price: { amount: string; currency: string; unit: string }) {
  return `${price.currency} ${formatSignedAmount(price.amount)}/${price.unit}`;
}

/** "21.000–42.000 MT", or "Up to 42.000 MT" without a minimum. */
export function formatQuantityRange(range: { min: string | null; max: string }): string {
  return range.min === null ? `Up to ${range.max} MT` : `${range.min}–${range.max} MT`;
}

/** "21.000" → "21", "42.500" → "42.5": a decimal string without trailing zeros, as text. */
function trimZeros(text: string): string {
  if (!DECIMAL.test(text)) throw new Error(`Not a decimal string: "${text}"`);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** "21–84 MT", or "≤84 MT" without a minimum: the short form for tight spaces such as the order book. */
export function formatQuantityShort(range: { min: string | null; max: string }): string {
  return range.min === null
    ? `≤${trimZeros(range.max)} MT`
    : `${trimZeros(range.min)}–${trimZeros(range.max)} MT`;
}

/** "MN, US", or just "MN" when the country is not known. */
export function formatPlace(region: string, country: string): string {
  return [region, country].filter((part) => part !== '').join(', ');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-28" → "28 Oct 2026": a calendar day, the same for every viewer and language. */
export function formatDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || month === undefined) throw new Error(`Not a date: "${date}"`);
  return `${String(Number(match[3]))} ${month} ${match[1] ?? ''}`;
}
