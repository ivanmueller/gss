import { z } from 'zod';

import type { CounterpartyType } from './directory';

// Bids and offers (GT-031, GT-032; MASTER_PROJECT_SPECIFICATION.md sections 2.3 and 5.2).
// Shared by the API, which checks every request, and the web app's forms, so both give the
// same messages. The database checks the same rules again (20261028040000_quotes.sql).

export const QUOTE_SIDES = ['bid', 'offer'] as const;
export type QuoteSide = (typeof QUOTE_SIDES)[number];

export const QUOTE_SIDE_LABELS: Record<QuoteSide, string> = { bid: 'Bid', offer: 'Offer' };

/** Who quotes each side: a buyer bids, a seller offers; a broker may do either. */
export const SIDE_COUNTERPARTY_TYPES: Record<QuoteSide, readonly CounterpartyType[]> = {
  bid: ['buyer', 'broker'],
  offer: ['seller', 'broker'],
};

/** Firm is what a person says the counterparty committed to; the platform does not verify it. */
export const QUOTE_FIRMNESS = ['firm', 'indicative'] as const;
export type QuoteFirmness = (typeof QUOTE_FIRMNESS)[number];

export const QUOTE_CURRENCIES = ['CAD', 'USD'] as const;
export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number];

/** Price units as quoted; converting them is the trading engine's job (docs/TRADING_RULES.md §5.3). */
export const PRICE_UNITS = ['MT', 'ST', 'BU', 'CWT'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const PRICE_UNIT_LABELS: Record<PriceUnit, string> = {
  MT: 'per metric tonne (MT)',
  ST: 'per short ton (2,000 lb)',
  BU: 'per bushel',
  CWT: 'per hundredweight (100 lb)',
};

export const DELIVERY_BASES = ['delivered', 'fob', 'ex_farm', 'ex_elevator', 'other'] as const;
export type DeliveryBasis = (typeof DELIVERY_BASES)[number];

export const DELIVERY_BASIS_LABELS: Record<DeliveryBasis, string> = {
  delivered: 'Delivered',
  fob: 'FOB',
  ex_farm: 'Ex-farm',
  ex_elevator: 'Ex-elevator',
  other: 'Other',
};

/** Sources a person can choose when entering a quote by hand (section 2.3). */
export const ENTRY_SOURCES = ['phone', 'email', 'website', 'manual'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];
/** Every source the database knows; imports and feeds come later. */
export type QuoteSource = EntrySource | 'file_import' | 'licensed_feed';

export const QUOTE_SOURCE_LABELS: Record<QuoteSource, string> = {
  phone: 'Phone call',
  email: 'Email',
  website: 'Website',
  manual: 'In person or other',
  file_import: 'File import',
  licensed_feed: 'Licensed feed',
};

/**
 * A quote's state now: withdrawn, expired (past its valid-until time), or live as firm or
 * indicative. Revisions other than the latest are superseded. Only firm and indicative
 * quotes are live; nothing else may appear as one (section 13, Phase 3 gate).
 */
export type QuoteStatus = QuoteFirmness | 'expired' | 'withdrawn';
export type RevisionStatus = QuoteStatus | 'superseded';

export const QUOTE_STATUS_LABELS: Record<RevisionStatus, string> = {
  firm: 'Firm',
  indicative: 'Indicative',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
  superseded: 'Superseded',
};

export function quoteStatus(
  quote: { withdrawnAt: string | null; validUntil: string; firmness: QuoteFirmness },
  now: Date,
): QuoteStatus {
  if (quote.withdrawnAt !== null) return 'withdrawn';
  if (Date.parse(quote.validUntil) <= now.getTime()) return 'expired';
  return quote.firmness;
}

export function isLive(status: RevisionStatus): boolean {
  return status === 'firm' || status === 'indicative';
}

/** The fields of the bid and offer form, which are a revision's terms. */
export const QUOTE_FIELD_IDS = [
  'firmness',
  'price',
  'currency',
  'priceUnit',
  'grade',
  'deliveryBasis',
  'basisLocation',
  'quantityMin',
  'quantityMax',
  'deliveryStart',
  'deliveryEnd',
  'quotedAt',
  'validUntil',
  'sourceType',
  'sourceReference',
  'notes',
] as const;
export type QuoteFieldId = (typeof QUOTE_FIELD_IDS)[number];
export type QuoteFormValues = Partial<Record<QuoteFieldId, string>>;

export interface QuoteIssue {
  field: QuoteFieldId | null;
  message: string;
}

/** A revision's terms, checked and cleaned; decimals stay strings (never JavaScript numbers). */
export interface QuoteTerms {
  firmness: QuoteFirmness;
  /** Decimal string as entered, e.g. "725.00". */
  price: string;
  currency: QuoteCurrency;
  priceUnit: PriceUnit;
  grade: string | null;
  deliveryBasis: DeliveryBasis;
  basisLocation: string | null;
  /** Metric tonnes as decimal strings; no minimum is null. */
  quantityMinMt: string | null;
  quantityMaxMt: string;
  /** ISO dates (YYYY-MM-DD). */
  deliveryStart: string | null;
  deliveryEnd: string | null;
  /** UTC ISO 8601 instants. */
  quotedAt: string;
  validUntil: string;
  sourceType: EntrySource;
  sourceReference: string | null;
  notes: string | null;
}

const fieldValues = z.partialRecord(z.enum(QUOTE_FIELD_IDS), z.string().max(4000));
const COMMODITY_CODE = /^[a-z][a-z0-9_]{1,39}$/;

/** POST /api/v1/quotes: a new bid or offer and its first terms. */
export const createQuoteSchema = z.object({
  organizationId: z.uuid(),
  counterpartyId: z.uuid(),
  facilityId: z.uuid().nullable().optional(),
  side: z.enum(QUOTE_SIDES),
  commodity: z.string().regex(COMMODITY_CODE),
  values: fieldValues,
});
export type CreateQuoteRequest = z.infer<typeof createQuoteSchema>;

/**
 * POST /api/v1/quotes/{id}/revisions: new terms, for the revision the person was looking at,
 * so new terms someone else recorded meanwhile are never replaced unseen.
 */
export const reviseQuoteSchema = z.object({
  basedOnRevision: z.number().int().min(1).max(1_000_000),
  values: fieldValues,
});
export type ReviseQuoteRequest = z.infer<typeof reviseQuoteSchema>;

const LABEL_MAX = 200;
const NOTE_MAX = 2000;
/** A quoted time may run a little ahead of the server's clock, not more. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const PRICE = /^\d{1,17}(?:\.\d{1,12})?$/;
const QUANTITY = /^\d{1,11}(?:\.\d{1,3})?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function clean(value: string | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

function cleanLines(value: string | undefined): string | null {
  const text = (value ?? '')
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text === '' ? null : text;
}

function oneOf<T extends string>(options: readonly T[], value: string | null): T | null {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : null;
}

/** Whether a decimal string is zero ("0", "0.000"). */
function isZero(text: string): boolean {
  return /^0+(?:\.0+)?$/.test(text);
}

/** Compares two non-negative decimal strings exactly, without floating point. */
function compareUnsigned(a: string, b: string): number {
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

/** A real calendar date in YYYY-MM-DD form. */
function isCalendarDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function instant(text: string): string | null {
  if (!INSTANT.test(text)) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Checks a form's terms. `now` is the server's (or browser's) clock: the quote time defaults
 * to it, may not be later than it, and the quote must still be valid after it.
 */
export function parseQuoteTerms(
  values: QuoteFormValues,
  now: Date,
): { status: 'ok'; value: QuoteTerms } | { status: 'invalid'; issues: QuoteIssue[] } {
  const issues: QuoteIssue[] = [];
  const issue = (field: QuoteFieldId | null, message: string) => {
    issues.push({ field, message });
  };
  const label = (field: QuoteFieldId): string | null => {
    const value = clean(values[field]);
    if (value !== null && value.length > LABEL_MAX) {
      issue(field, `is longer than ${String(LABEL_MAX)} characters`);
      return null;
    }
    if (value !== null && /\p{Cc}/u.test(value)) {
      issue(field, 'has characters that cannot be shown');
      return null;
    }
    return value;
  };
  const choice = <T extends string>(field: QuoteFieldId, options: readonly T[]): T | null => {
    const value = clean(values[field]);
    const chosen = oneOf(options, value);
    if (chosen === null) issue(field, value === null ? 'is required' : 'is not one of the choices');
    return chosen;
  };

  const firmness = choice('firmness', QUOTE_FIRMNESS);
  const currency = choice('currency', QUOTE_CURRENCIES);
  const priceUnit = choice('priceUnit', PRICE_UNITS);
  const deliveryBasis = choice('deliveryBasis', DELIVERY_BASES);
  const sourceType = choice('sourceType', ENTRY_SOURCES);

  const priceText = clean(values.price);
  let price: string | null = null;
  if (priceText === null) issue('price', 'is required');
  else if (priceText.includes(',')) issue('price', 'needs no commas: type 1025.00, not 1,025.00');
  else if (!PRICE.test(priceText)) issue('price', 'must be a number such as 725.00');
  else if (isZero(priceText)) issue('price', 'must be more than zero');
  else price = priceText;

  const quantity = (field: 'quantityMin' | 'quantityMax'): string | null => {
    const text = clean(values[field]);
    if (text === null) return null;
    if (text.includes(',')) issue(field, 'needs no commas: type 1000, not 1,000');
    else if (!QUANTITY.test(text))
      issue(field, 'must be tonnes as a number with at most 3 decimals');
    else return text;
    return null;
  };
  const quantityMin = quantity('quantityMin');
  const quantityMax = quantity('quantityMax');
  if (clean(values.quantityMax) === null) issue('quantityMax', 'is required');
  else if (quantityMax !== null && isZero(quantityMax)) {
    issue('quantityMax', 'must be more than zero');
  }
  if (
    quantityMin !== null &&
    quantityMax !== null &&
    compareUnsigned(quantityMin, quantityMax) > 0
  ) {
    issue('quantityMin', 'must not be more than the maximum');
  }

  const date = (field: 'deliveryStart' | 'deliveryEnd'): string | null => {
    const text = clean(values[field]);
    if (text === null) return null;
    if (!isCalendarDate(text)) {
      issue(field, 'must be a date');
      return null;
    }
    return text;
  };
  const deliveryStart = date('deliveryStart');
  const deliveryEnd = date('deliveryEnd');
  if (deliveryStart !== null && deliveryEnd !== null && deliveryStart > deliveryEnd) {
    issue('deliveryEnd', 'must not be before the start');
  }

  const quotedText = clean(values.quotedAt);
  let quotedAt: string | null = now.toISOString();
  if (quotedText !== null) {
    quotedAt = instant(quotedText);
    if (quotedAt === null) issue('quotedAt', 'must be a date and time');
    else if (Date.parse(quotedAt) > now.getTime() + CLOCK_SKEW_MS) {
      issue('quotedAt', 'must not be in the future');
      quotedAt = null;
    }
  }
  const validText = clean(values.validUntil);
  let validUntil: string | null = null;
  if (validText === null) issue('validUntil', 'is required');
  else {
    validUntil = instant(validText);
    if (validUntil === null) issue('validUntil', 'must be a date and time');
    else if (Date.parse(validUntil) <= now.getTime()) {
      issue('validUntil', 'must be later than now');
      validUntil = null;
    } else if (quotedAt !== null && Date.parse(validUntil) <= Date.parse(quotedAt)) {
      issue('validUntil', 'must be after the time quoted');
      validUntil = null;
    }
  }

  const grade = label('grade');
  const basisLocation = label('basisLocation');
  const sourceReference = label('sourceReference');
  const notes = cleanLines(values.notes);
  if (notes !== null && notes.length > NOTE_MAX) {
    issue('notes', `is longer than ${String(NOTE_MAX)} characters`);
  }

  if (
    issues.length > 0 ||
    firmness === null ||
    currency === null ||
    priceUnit === null ||
    deliveryBasis === null ||
    sourceType === null ||
    price === null ||
    quantityMax === null ||
    quotedAt === null ||
    validUntil === null
  ) {
    return { status: 'invalid', issues };
  }
  return {
    status: 'ok',
    value: {
      firmness,
      price,
      currency,
      priceUnit,
      grade,
      deliveryBasis,
      basisLocation,
      quantityMinMt: quantityMin,
      quantityMaxMt: quantityMax,
      deliveryStart,
      deliveryEnd,
      quotedAt,
      validUntil,
      sourceType,
      sourceReference,
      notes,
    },
  };
}

/** The form values that show a revision's terms again, to start new terms from. */
export function termsToFormValues(terms: QuoteTerms | QuoteRevision): QuoteFormValues {
  return {
    firmness: terms.firmness,
    price: terms.price,
    currency: terms.currency,
    priceUnit: terms.priceUnit,
    grade: terms.grade ?? '',
    deliveryBasis: terms.deliveryBasis,
    basisLocation: terms.basisLocation ?? '',
    quantityMin: terms.quantityMinMt ?? '',
    quantityMax: terms.quantityMaxMt,
    deliveryStart: terms.deliveryStart ?? '',
    deliveryEnd: terms.deliveryEnd ?? '',
    validUntil: terms.validUntil,
    sourceType: ENTRY_SOURCES.includes(terms.sourceType as EntrySource) ? terms.sourceType : '',
    sourceReference: terms.sourceReference ?? '',
    notes: terms.notes ?? '',
  };
}

// The API's answers (apps/api/src/quotes.ts), shared with the web app.

export interface Commodity {
  code: string;
  name: string;
}

/** One revision's terms as recorded; never changed afterwards. */
export interface QuoteRevision extends Omit<QuoteTerms, 'sourceType'> {
  id: string;
  revisionNumber: number;
  sourceType: QuoteSource;
  recordedByName: string;
  /** When it was recorded (UTC ISO 8601). */
  recordedAt: string;
}

/** A quote with its latest terms, as lists show it. */
export interface QuoteSummary {
  id: string;
  side: QuoteSide;
  commodity: Commodity;
  counterparty: { id: string; legalName: string; tradingName: string | null; archived: boolean };
  /** The counterparty's location the quote is at, if one was chosen. */
  facility: {
    id: string;
    name: string | null;
    city: string | null;
    region: string | null;
    country: string;
  } | null;
  status: QuoteStatus;
  withdrawnAt: string | null;
  createdAt: string;
  current: QuoteRevision;
}

/** A quote with every revision, newest first. */
export interface QuoteDetail extends QuoteSummary {
  revisions: QuoteRevision[];
  withdrawnByName: string | null;
}
