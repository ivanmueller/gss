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

export function formatQuantityRange(range: { min: string; max: string }): string {
  return `${range.min}–${range.max} MT`;
}
