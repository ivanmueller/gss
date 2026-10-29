import { z } from 'zod';

import {
  ENTRY_SOURCES,
  QUOTE_CURRENCIES,
  QUOTE_FIRMNESS,
  type EntrySource,
  type QuoteCurrency,
  type QuoteFirmness,
  type QuoteSource,
  type QuoteStatus,
} from './quotes';
import {
  clean,
  cleanLines,
  isZero,
  LABEL_MAX,
  NOTE_MAX,
  oneOf,
  positiveAmount,
  quantity,
  quoteTimes,
} from './terms';

// Carrier freight rates by route (part of GT-050; MASTER_PROJECT_SPECIFICATION.md sections
// 5.2, 5.3 and 8; the owner's request of 2026-10-29). Shared by the API, which checks every
// request, and the web app's forms. The database checks the same rules again
// (20261029020000_freight_quotes.sql). Rates are entered by staff from what a carrier
// quoted; nothing here estimates or invents one.

export const FREIGHT_MODES = ['truck', 'rail'] as const;
export type FreightMode = (typeof FREIGHT_MODES)[number];

export const FREIGHT_MODE_LABELS: Record<FreightMode, string> = { truck: 'Truck', rail: 'Rail' };

/**
 * Rate units as quoted: carriers quote differently (owner, 2026-10-29). Converting a rate to
 * one per tonne is the trading engine's job, with a recorded factor (docs/TRADING_RULES.md §5.3).
 */
export const FREIGHT_RATE_UNITS = ['MT', 'ST', 'BU', 'CWT', 'LOAD'] as const;
export type FreightRateUnit = (typeof FREIGHT_RATE_UNITS)[number];

export const FREIGHT_RATE_UNIT_LABELS: Record<FreightRateUnit, string> = {
  MT: 'per metric tonne (MT)',
  ST: 'per short ton (2,000 lb)',
  BU: 'per bushel',
  CWT: 'per hundredweight (100 lb)',
  LOAD: 'per load (truckload or railcar)',
};

/** Units of a load's payload, as the carrier states it. */
export const PAYLOAD_UNITS = ['MT', 'ST', 'LB'] as const;
export type PayloadUnit = (typeof PAYLOAD_UNITS)[number];

export const PAYLOAD_UNIT_LABELS: Record<PayloadUnit, string> = {
  MT: 'metric tonnes',
  ST: 'short tons (2,000 lb)',
  LB: 'pounds',
};

/** The fields of the freight form, which are a revision's terms. */
export const FREIGHT_FIELD_IDS = [
  'firmness',
  'rate',
  'currency',
  'rateUnit',
  'payload',
  'payloadUnit',
  'inclusions',
  'quotedAt',
  'validUntil',
  'sourceType',
  'sourceReference',
  'notes',
] as const;
export type FreightFieldId = (typeof FREIGHT_FIELD_IDS)[number];
export type FreightFormValues = Partial<Record<FreightFieldId, string>>;

export interface FreightIssue {
  field: FreightFieldId | null;
  message: string;
}

/** A revision's terms, checked and cleaned; decimals stay strings (never JavaScript numbers). */
export interface FreightTerms {
  firmness: QuoteFirmness;
  /** Decimal string as entered, e.g. "105.00". */
  rate: string;
  currency: QuoteCurrency;
  rateUnit: FreightRateUnit;
  /** One load's contract payload as entered; only for a rate per load, otherwise null. */
  payload: string | null;
  payloadUnit: PayloadUnit | null;
  /** What the rate includes, e.g. "Fuel surcharge included". */
  inclusions: string | null;
  /** UTC ISO 8601 instants. */
  quotedAt: string;
  validUntil: string;
  sourceType: EntrySource;
  sourceReference: string | null;
  notes: string | null;
}

const fieldValues = z.partialRecord(z.enum(FREIGHT_FIELD_IDS), z.string().max(4000));

/** POST /api/v1/freight-quotes: a carrier's rate on a route, with its first terms. */
export const createFreightSchema = z.object({
  organizationId: z.uuid(),
  carrierId: z.uuid(),
  originFacilityId: z.uuid(),
  destinationFacilityId: z.uuid(),
  mode: z.enum(FREIGHT_MODES),
  values: fieldValues,
});
export type CreateFreightRequest = z.infer<typeof createFreightSchema>;

/**
 * POST /api/v1/freight-quotes/{id}/revisions: new terms, for the revision the person was
 * looking at, so new terms someone else recorded meanwhile are never replaced unseen.
 */
export const reviseFreightSchema = z.object({
  basedOnRevision: z.number().int().min(1).max(1_000_000),
  values: fieldValues,
});
export type ReviseFreightRequest = z.infer<typeof reviseFreightSchema>;

/**
 * Checks a form's terms. `now` is the server's (or browser's) clock: the quote time defaults
 * to it, may not be later than it, and the rate must still be valid after it. A payload is
 * kept only for a rate per load, which needs one; for other units it is left out.
 */
export function parseFreightTerms(
  values: FreightFormValues,
  now: Date,
): { status: 'ok'; value: FreightTerms } | { status: 'invalid'; issues: FreightIssue[] } {
  const issues: FreightIssue[] = [];
  const issue = (field: FreightFieldId | null, message: string) => {
    issues.push({ field, message });
  };
  const label = (field: FreightFieldId): string | null => {
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
  const choice = <T extends string>(field: FreightFieldId, options: readonly T[]): T | null => {
    const value = clean(values[field]);
    const chosen = oneOf(options, value);
    if (chosen === null) issue(field, value === null ? 'is required' : 'is not one of the choices');
    return chosen;
  };

  const firmness = choice('firmness', QUOTE_FIRMNESS);
  const rate = positiveAmount(clean(values.rate), 'rate', '105.00', issue);
  const currency = choice('currency', QUOTE_CURRENCIES);
  const rateUnit = choice('rateUnit', FREIGHT_RATE_UNITS);

  // A rate per load converts to a rate per tonne only with the load's actual contract
  // payload, never one inferred from the truck or railcar (docs/TRADING_RULES.md §5.3).
  let payload: string | null = null;
  let payloadUnit: PayloadUnit | null = null;
  if (rateUnit === 'LOAD') {
    const text = clean(values.payload);
    payload = quantity(text, 'payload', 'the payload', issue);
    if (text === null) issue('payload', 'is required for a rate per load');
    else if (payload !== null && isZero(payload)) {
      issue('payload', 'must be more than zero');
      payload = null;
    }
    payloadUnit = choice('payloadUnit', PAYLOAD_UNITS);
  }

  const inclusions = label('inclusions');
  const { quotedAt, validUntil } = quoteTimes(
    clean(values.quotedAt),
    clean(values.validUntil),
    { quotedAt: 'quotedAt', validUntil: 'validUntil' },
    now,
    issue,
  );
  const sourceType = choice('sourceType', ENTRY_SOURCES);
  const sourceReference = label('sourceReference');
  const notes = cleanLines(values.notes);
  if (notes !== null && notes.length > NOTE_MAX) {
    issue('notes', `is longer than ${String(NOTE_MAX)} characters`);
  }

  if (
    issues.length > 0 ||
    firmness === null ||
    rate === null ||
    currency === null ||
    rateUnit === null ||
    sourceType === null ||
    quotedAt === null ||
    validUntil === null
  ) {
    return { status: 'invalid', issues };
  }
  return {
    status: 'ok',
    value: {
      firmness,
      rate,
      currency,
      rateUnit,
      payload,
      payloadUnit,
      inclusions,
      quotedAt,
      validUntil,
      sourceType,
      sourceReference,
      notes,
    },
  };
}

/** The form values that show a revision's terms again, to start new terms from. */
export function freightTermsToFormValues(terms: FreightTerms | FreightRevision): FreightFormValues {
  return {
    firmness: terms.firmness,
    rate: terms.rate,
    currency: terms.currency,
    rateUnit: terms.rateUnit,
    payload: terms.payload ?? '',
    payloadUnit: terms.payloadUnit ?? '',
    inclusions: terms.inclusions ?? '',
    validUntil: terms.validUntil,
    sourceType: ENTRY_SOURCES.includes(terms.sourceType as EntrySource) ? terms.sourceType : '',
    sourceReference: terms.sourceReference ?? '',
    notes: terms.notes ?? '',
  };
}

// The API's answers (apps/api/src/freight.ts), shared with the web app.

/** One revision's terms as recorded; never changed afterwards. */
export interface FreightRevision extends Omit<FreightTerms, 'sourceType'> {
  id: string;
  revisionNumber: number;
  sourceType: QuoteSource;
  recordedByName: string;
  /** When it was recorded (UTC ISO 8601). */
  recordedAt: string;
}

/** One end of a route: a location in the directory and the counterparty it belongs to. */
export interface FreightLocation {
  id: string;
  name: string | null;
  city: string | null;
  region: string | null;
  country: string;
  counterparty: { id: string; legalName: string; archived: boolean };
}

/** A freight quote with its latest terms, as lists show it. */
export interface FreightSummary {
  id: string;
  mode: FreightMode;
  carrier: { id: string; legalName: string; tradingName: string | null; archived: boolean };
  origin: FreightLocation;
  destination: FreightLocation;
  /** Withdrawn, expired, or live as firm or indicative (quoteStatus). */
  status: QuoteStatus;
  withdrawnAt: string | null;
  createdAt: string;
  current: FreightRevision;
}

/** A freight quote with every revision, newest first. */
export interface FreightDetail extends FreightSummary {
  revisions: FreightRevision[];
  withdrawnByName: string | null;
}
