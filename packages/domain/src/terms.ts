// Checks shared by the forms of priced terms that are kept as revisions: bids and offers
// (quotes.ts) and carrier freight rates (freight.ts). Internal to the package.

export const LABEL_MAX = 200;
export const NOTE_MAX = 2000;
/** A quoted time may run a little ahead of the server's clock, not more. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** A price or rate as entered: up to 17 digits and 12 decimals, never a JavaScript number. */
const AMOUNT = /^\d{1,17}(?:\.\d{1,12})?$/;
const QUANTITY = /^\d{1,11}(?:\.\d{1,3})?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?Z$/;

export function clean(value: string | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

export function cleanLines(value: string | undefined): string | null {
  const text = (value ?? '')
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text === '' ? null : text;
}

export function oneOf<T extends string>(options: readonly T[], value: string | null): T | null {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : null;
}

/** Whether a decimal string is zero ("0", "0.000"). */
export function isZero(text: string): boolean {
  return /^0+(?:\.0+)?$/.test(text);
}

/** Compares two non-negative decimal strings exactly, without floating point. */
export function compareUnsigned(a: string, b: string): number {
  const [ai = '', af = ''] = a.split('.');
  const [bi = '', bf = ''] = b.split('.');
  const aInt = ai.replace(/^0+(?=\d)/, '');
  const bInt = bi.replace(/^0+(?=\d)/, '');
  if (aInt.length !== bInt.length) return aInt.length - bInt.length;
  if (aInt !== bInt) return aInt < bInt ? -1 : 1;
  const width = Math.max(af.length, bf.length);
  const aFrac = af.padEnd(width, '0');
  const bFrac = bf.padEnd(width, '0');
  return aFrac === bFrac ? 0 : aFrac < bFrac ? -1 : 1;
}

function instant(text: string): string | null {
  if (!INSTANT.test(text)) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

type Report<F> = (field: F, message: string) => void;

/** A required amount above zero, as entered ("725.00"); null after reporting why not. */
export function positiveAmount<F>(
  text: string | null,
  field: F,
  example: string,
  issue: Report<F>,
): string | null {
  if (text === null) issue(field, 'is required');
  else if (text.includes(',')) issue(field, 'needs no commas: type 1025.00, not 1,025.00');
  else if (!AMOUNT.test(text)) issue(field, `must be a number such as ${example}`);
  else if (isZero(text)) issue(field, 'must be more than zero');
  else return text;
  return null;
}

/** An optional quantity with at most 3 decimals, as entered; null when empty or wrong. */
export function quantity<F>(
  text: string | null,
  field: F,
  what: string,
  issue: Report<F>,
): string | null {
  if (text === null) return null;
  if (text.includes(',')) issue(field, 'needs no commas: type 1000, not 1,000');
  else if (!QUANTITY.test(text))
    issue(field, `must be ${what} as a number with at most 3 decimals`);
  else return text;
  return null;
}

/**
 * The time quoted (now when left empty, never in the future) and the valid-until time (later
 * than now and than the time quoted), as UTC ISO 8601 instants; null after reporting why not.
 */
export function quoteTimes<F>(
  quotedText: string | null,
  validText: string | null,
  fields: { quotedAt: F; validUntil: F },
  now: Date,
  issue: Report<F>,
): { quotedAt: string | null; validUntil: string | null } {
  let quotedAt: string | null = now.toISOString();
  if (quotedText !== null) {
    quotedAt = instant(quotedText);
    if (quotedAt === null) issue(fields.quotedAt, 'must be a date and time');
    else if (Date.parse(quotedAt) > now.getTime() + CLOCK_SKEW_MS) {
      issue(fields.quotedAt, 'must not be in the future');
      quotedAt = null;
    }
  }
  let validUntil: string | null = null;
  if (validText === null) issue(fields.validUntil, 'is required');
  else {
    validUntil = instant(validText);
    if (validUntil === null) issue(fields.validUntil, 'must be a date and time');
    else if (Date.parse(validUntil) <= now.getTime()) {
      issue(fields.validUntil, 'must be later than now');
      validUntil = null;
    } else if (quotedAt !== null && Date.parse(validUntil) <= Date.parse(quotedAt)) {
      issue(fields.validUntil, 'must be after the time quoted');
      validUntil = null;
    }
  }
  return { quotedAt, validUntil };
}
