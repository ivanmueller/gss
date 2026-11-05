import { z } from 'zod';

import { albertaToUtc, formatAlberta } from './alberta';
import type { TranscriptLine } from './calls';
import { COMMODITIES, type CommodityCode } from './commodities';
import type { FollowUpFormValues } from './crm';
import type { ContactFieldId } from './directory';
import { isCalendarDate } from './fx';
import {
  DELIVERY_BASES,
  PRICE_UNITS,
  QUOTE_CURRENCIES,
  QUOTE_FIRMNESS,
  QUOTE_SIDES,
  SIDE_COUNTERPARTY_TYPES,
  type QuoteFormValues,
  type QuoteSide,
} from './quotes';
import { LABEL_MAX, NOTE_MAX } from './terms';

// Claude reads each call's transcript and drafts what was said (the owner's request and
// answers of 2026-11-05, docs/DECISIONS.md): a few lines of notes, whether the call reached a
// voicemail, and drafts of bids and offers, follow-ups and contact details. A person opens each
// draft in the usual form and saves it, or dismisses it; nothing is saved before. The Worker
// asks Claude for CALL_READING_JSON_SCHEMA and passes the answer through checkReading, which
// keeps only what the transcript bears out: a price, quantity or phone number is kept only when
// its digits were said in the lines the draft points to, and anything missing stays blank.
// The database keeps the drafts (20261105010000_call_readings.sql).

export const DRAFT_KINDS = ['quote', 'follow_up', 'contact'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_STATUSES = ['open', 'accepted', 'dismissed'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Most drafts of each kind kept from one call. */
export const DRAFTS_PER_KIND_MAX = 10;
/** Most transcript lines a draft points to. */
const DRAFT_LINES_MAX = 20;
/** Longest notes of a call (call_recordings.read_summary). */
export const READING_SUMMARY_MAX = 2000;

const COMMODITY_CODES = COMMODITIES.map((commodity) => commodity.code) as [
  CommodityCode,
  ...CommodityCode[],
];

const nullableText = z.string().nullable();

/** What Claude answers, as it is checked before anything else is done with it. */
export const callReadingSchema = z.object({
  voicemail: z.boolean(),
  summary: nullableText,
  quotes: z.array(
    z.object({
      side: z.enum(QUOTE_SIDES),
      commodity: z.enum(COMMODITY_CODES).nullable(),
      firmness: z.enum(QUOTE_FIRMNESS).nullable(),
      price: nullableText,
      currency: z.enum(QUOTE_CURRENCIES).nullable(),
      priceUnit: z.enum(PRICE_UNITS).nullable(),
      grade: nullableText,
      deliveryBasis: z.enum(DELIVERY_BASES).nullable(),
      basisLocation: nullableText,
      quantityMinMt: nullableText,
      quantityMaxMt: nullableText,
      deliveryStart: nullableText,
      deliveryEnd: nullableText,
      validUntil: nullableText,
      notes: nullableText,
      lines: z.array(z.number()),
    }),
  ),
  followUps: z.array(
    z.object({ task: z.string(), dueAt: nullableText, lines: z.array(z.number()) }),
  ),
  contacts: z.array(
    z.object({
      contactId: nullableText,
      name: nullableText,
      role: nullableText,
      email: nullableText,
      phone: nullableText,
      lines: z.array(z.number()),
    }),
  ),
});
export type CallReading = z.infer<typeof callReadingSchema>;

type JsonSchema = Record<string, unknown>;
const text = (description: string): JsonSchema => ({
  anyOf: [{ type: 'string' }, { type: 'null' }],
  description,
});
const choice = (values: readonly string[], description: string): JsonSchema => ({
  anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }],
  description,
});
const lineNumbers: JsonSchema = {
  type: 'array',
  items: { type: 'integer' },
  description: 'The numbers of the transcript lines this comes from, e.g. [4, 5].',
};
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/**
 * The JSON schema Claude answers with (structured outputs). It names the same fields as
 * callReadingSchema; a test keeps them in step. Only what structured outputs accept: no
 * lengths or numeric limits, every object closed.
 */
export const CALL_READING_JSON_SCHEMA: JsonSchema = object({
  voicemail: {
    type: 'boolean',
    description:
      "True when the counterparty's side was a voicemail greeting or system and no person answered.",
  },
  summary: text(
    'Two to five short plain sentences of notes on the call, or null when nothing was said worth noting.',
  ),
  quotes: {
    type: 'array',
    description: 'Bids and offers the counterparty made on the call; empty when none.',
    items: object({
      side: {
        type: 'string',
        enum: [...QUOTE_SIDES],
        description: 'bid: the counterparty wants to buy. offer: the counterparty wants to sell.',
      },
      commodity: choice(COMMODITY_CODES, 'The commodity code, or null when not clear.'),
      firmness: choice(
        QUOTE_FIRMNESS,
        'firm only when the counterparty said it is firm; indicative when they said it is indicative or only an idea; null otherwise.',
      ),
      price: text('The price exactly as said, digits only with a decimal point (e.g. 725.50).'),
      currency: choice(QUOTE_CURRENCIES, 'Only when said or plainly meant.'),
      priceUnit: choice(PRICE_UNITS, 'MT tonne, ST short ton, BU bushel, CWT hundredweight.'),
      grade: text('The grade or spec as said, e.g. "1 CW", "feed".'),
      deliveryBasis: choice(DELIVERY_BASES, 'How the price is delivered, when said.'),
      basisLocation: text('The place the price is for, as said.'),
      quantityMinMt: text('A smallest quantity in metric tonnes, only when said in tonnes.'),
      quantityMaxMt: text('The quantity in metric tonnes, only when said in tonnes.'),
      deliveryStart: text('The first day of delivery, YYYY-MM-DD.'),
      deliveryEnd: text('The last day of delivery, YYYY-MM-DD.'),
      validUntil: text(
        'Until when the price holds, as Alberta time YYYY-MM-DDTHH:MM, only when said.',
      ),
      notes: text('Anything else said about this bid or offer, such as a quantity in bushels.'),
      lines: lineNumbers,
    }),
  },
  followUps: {
    type: 'array',
    description: 'Things to do after the call that were said or agreed; empty when none.',
    items: object({
      task: { type: 'string', description: 'What to do, short, e.g. "Send the canola bid".' },
      dueAt: text('When, as Alberta time YYYY-MM-DDTHH:MM, only when a day or time was said.'),
      lines: lineNumbers,
    }),
  },
  contacts: {
    type: 'array',
    description:
      'New people, or new details of listed contacts, said on the call; empty when none.',
    items: object({
      contactId: text('The id of the listed contact these details are for; null for a new person.'),
      name: text("The person's name, as said."),
      role: text('Their job, as said.'),
      email: text('Their email address, as said.'),
      phone: text('Their phone number, digits as said.'),
      lines: lineNumbers,
    }),
  },
});

/** What checkReading needs to know about the call. */
export interface ReadingContext {
  /** The transcript's lines, numbered from 0 as Claude was given them. */
  lines: readonly TranscriptLine[];
  /** The company's kinds (buyer, seller, broker, carrier, ...). */
  counterpartyTypes: readonly string[];
  contacts: readonly {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
  }[];
  /** Who placed the call: the follow-ups are theirs. */
  callerId: string;
  /** When the call connected (UTC instant): the bids and offers are quoted then. */
  calledAt: string;
}

export type ContactFormValues = Partial<Record<ContactFieldId, string>>;

/** A draft as kept: what its form opens with, and the transcript lines it came from. */
export type DraftInput =
  | {
      kind: 'quote';
      fields: { side: QuoteSide; commodity: CommodityCode | null; values: QuoteFormValues };
      lines: number[];
    }
  | { kind: 'follow_up'; fields: { values: FollowUpFormValues }; lines: number[] }
  | {
      kind: 'contact';
      /** A listed contact these are new details of; null for a new person. */
      contactId: string | null;
      fields: { values: ContactFormValues };
      lines: number[];
    };

export interface CheckedReading {
  voicemail: boolean;
  summary: string | null;
  drafts: DraftInput[];
}

/** A line of text without control characters, or null when empty or too long. */
function label(value: string | null, max = LABEL_MAX): string | null {
  const cleaned = (value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' || cleaned.length > max ? null : cleaned;
}

/** Notes over several lines, without other control characters; null when empty. */
function notes(value: string | null, max: number): string | null {
  const cleaned = (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('')
    .filter((ch) => ch === '\n' || !/\p{Cc}/u.test(ch))
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned === '') return null;
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

/** A decimal as a comparable key: 0725.50 and 725.5 are the same number. */
function decimalKey(value: string): string {
  const [whole = '', fraction = ''] = value.split('.');
  const digits = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  return decimals === '' ? digits : `${digits}.${decimals}`;
}

/** The numbers written in a text, thousands separators read as part of the number. */
function numbersIn(words: string): string[] {
  const joined = words.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return (joined.match(/\d+(?:\.\d+)?/g) ?? []).map(decimalKey);
}

/** Whether a number such as 725.50 was said, as digits, in the text. */
export function numberSaid(value: string, words: string): boolean {
  return numbersIn(words).includes(decimalKey(value));
}

/** A number as a form takes it (digits, a decimal point), when it was said; else null. */
function saidAmount(value: string | null, words: string, pattern: RegExp): string | null {
  const amount = (value ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!pattern.test(amount) || /^0*(?:\.0*)?$/.test(amount)) return null;
  return numberSaid(amount, words) ? amount : null;
}
const PRICE = /^\d{1,17}(?:\.\d{1,12})?$/;
const QUANTITY = /^\d{1,11}(?:\.\d{1,3})?$/;

/** A phone number whose digits were said in the text, in one run; else null. */
function saidPhone(value: string | null, words: string): string | null {
  const phone = label(value, 40);
  if (phone === null || !/^[0-9+(). /x-]+$/.test(phone)) return null;
  let digits = phone.replace(/x.*$/i, '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length < 7) return null;
  const spoken = words.replace(/(?<=\d)[\s().-]+(?=\d)/g, '');
  return spoken.includes(digits) ? phone : null;
}

const EMAIL = /^[^@\s\p{Cc}]+@[^@\s\p{Cc}]+\.[^@\s\p{Cc}]+$/u;

/** The line numbers that exist, once each, in order; at most 20. */
function lineNumbersOf(numbers: readonly number[], count: number): number[] {
  const valid = numbers.filter((n) => Number.isInteger(n) && n >= 0 && n < count);
  return [...new Set(valid)].sort((a, b) => a - b).slice(0, DRAFT_LINES_MAX);
}

/** An Alberta wall-clock time as a UTC instant between 2000 and 2099; else null. */
function albertaInstant(value: string | null): string | null {
  const wall = (value ?? '').trim();
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall) ? albertaToUtc(wall) : null;
  if (instant === null) return null;
  const year = Number(instant.slice(0, 4));
  return year >= 2000 && year < 2100 ? instant : null;
}

/** Sets a form value only when there is one. */
function put<K extends string>(values: Partial<Record<K, string>>, key: K, value: string | null) {
  if (value !== null) values[key] = value;
}

/**
 * Claude's answer, kept to what the transcript bears out (see the file's opening comment).
 * Drafts without a transcript line are left out, and so are bids from a company that does not
 * buy, offers from one that does not sell, and contact details that change nothing.
 */
export function checkReading(reading: CallReading, context: ReadingContext): CheckedReading {
  const count = context.lines.length;
  const evidence = (numbers: readonly number[]) => {
    const lines = lineNumbersOf(numbers, count);
    return { lines, words: lines.map((n) => context.lines[n]?.text ?? '').join('\n') };
  };
  const drafts: DraftInput[] = [];
  const quotedAt = new Date(context.calledAt).toISOString();
  const reference = label(`Call of ${formatAlberta(quotedAt)}, drafted by Claude`);

  for (const quote of reading.quotes.slice(0, DRAFTS_PER_KIND_MAX)) {
    const { lines, words } = evidence(quote.lines);
    if (lines.length === 0) continue;
    if (!SIDE_COUNTERPARTY_TYPES[quote.side].some((t) => context.counterpartyTypes.includes(t))) {
      continue;
    }
    const values: QuoteFormValues = { quotedAt, sourceType: 'phone' };
    put(values, 'sourceReference', reference);
    put(values, 'firmness', quote.firmness);
    put(values, 'price', saidAmount(quote.price, words, PRICE));
    put(values, 'currency', quote.currency);
    put(values, 'priceUnit', quote.priceUnit);
    put(values, 'grade', label(quote.grade));
    put(values, 'deliveryBasis', quote.deliveryBasis);
    put(values, 'basisLocation', label(quote.basisLocation));
    put(values, 'quantityMin', saidAmount(quote.quantityMinMt, words, QUANTITY));
    put(values, 'quantityMax', saidAmount(quote.quantityMaxMt, words, QUANTITY));
    const start = (quote.deliveryStart ?? '').trim();
    const end = (quote.deliveryEnd ?? '').trim();
    put(values, 'deliveryStart', isCalendarDate(start) ? start : null);
    put(values, 'deliveryEnd', isCalendarDate(end) ? end : null);
    const validUntil = albertaInstant(quote.validUntil);
    put(
      values,
      'validUntil',
      validUntil !== null && Date.parse(validUntil) > Date.parse(quotedAt) ? validUntil : null,
    );
    put(values, 'notes', notes(quote.notes, NOTE_MAX));
    drafts.push({
      kind: 'quote',
      fields: { side: quote.side, commodity: quote.commodity, values },
      lines,
    });
  }

  for (const followUp of reading.followUps.slice(0, DRAFTS_PER_KIND_MAX)) {
    const { lines } = evidence(followUp.lines);
    const task = label(followUp.task);
    if (lines.length === 0 || task === null) continue;
    const values: FollowUpFormValues = { task, assignedTo: context.callerId };
    put(values, 'dueAt', albertaInstant(followUp.dueAt));
    drafts.push({ kind: 'follow_up', fields: { values }, lines });
  }

  for (const contact of reading.contacts.slice(0, DRAFTS_PER_KIND_MAX)) {
    const { lines, words } = evidence(contact.lines);
    if (lines.length === 0) continue;
    const listed = context.contacts.find((c) => c.id === contact.contactId) ?? null;
    const email = label(contact.email, 254)?.toLowerCase() ?? null;
    const found: ContactFormValues = {};
    put(found, 'contactName', label(contact.name));
    put(found, 'contactRole', label(contact.role));
    put(found, 'contactEmail', email !== null && EMAIL.test(email) ? email : null);
    put(found, 'contactPhone', saidPhone(contact.phone, words));
    const values: ContactFormValues = {};
    const same = (a: string | null | undefined, b: string | null) =>
      (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
    const digits = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '');
    if (listed === null) {
      if (found.contactName === undefined) continue;
      Object.assign(values, found);
    } else {
      if (found.contactName !== undefined && !same(found.contactName, listed.name)) {
        values.contactName = found.contactName;
      }
      if (found.contactRole !== undefined && !same(found.contactRole, listed.role)) {
        values.contactRole = found.contactRole;
      }
      if (found.contactEmail !== undefined && !same(found.contactEmail, listed.email)) {
        values.contactEmail = found.contactEmail;
      }
      if (
        found.contactPhone !== undefined &&
        !digits(listed.phone).endsWith(digits(found.contactPhone).slice(-10))
      ) {
        values.contactPhone = found.contactPhone;
      }
      if (Object.keys(values).length === 0) continue;
    }
    drafts.push({
      kind: 'contact',
      contactId: listed?.id ?? null,
      fields: { values },
      lines,
    });
  }

  return {
    voicemail: reading.voicemail,
    summary: notes(reading.summary, READING_SUMMARY_MAX),
    drafts,
  };
}

/**
 * The transcript as Claude reads it: one numbered line per turn, with who said it. The
 * caller's and the counterparty's names come from the call; a line of unknown side says so.
 */
export function numberedTranscript(
  lines: readonly TranscriptLine[],
  names: { caller: string; counterparty: string },
): string {
  return lines
    .map((line, n) => {
      const who =
        line.side === 'caller'
          ? `GSS (${names.caller})`
          : line.side === 'counterparty'
            ? `Counterparty (${names.counterparty})`
            : 'Unknown side';
      return `[${String(n)}] ${who}: ${line.text.replace(/\s+/g, ' ').trim()}`;
    })
    .join('\n');
}

/** A draft as the API returns it. */
export interface CallDraftView {
  id: string;
  kind: DraftKind;
  status: DraftStatus;
  /** What the form opens with (DraftInput's fields for its kind). */
  fields: DraftInput['fields'];
  lines: number[];
  contactId: string | null;
  decidedByName: string | null;
  /** UTC instant. */
  decidedAt: string | null;
  /** The bid or offer, follow-up or contact saved from it. */
  resultId: string | null;
}

/** Claude's reading of a call's transcript, as the API returns it with the recording. */
export interface CallReadingView {
  /** UTC instant. */
  readAt: string;
  model: string;
  /** Whether the call reached a voicemail: a person's correction, else Claude's answer. */
  voicemail: boolean;
  claudeVoicemail: boolean;
  voicemailCorrectedByName: string | null;
  voicemailCorrectedAt: string | null;
  summary: string | null;
  drafts: CallDraftView[];
}

/** POST /api/v1/calls/drafts/{id}/decision: accepted with what was saved from it, or dismissed. */
export const decideDraftSchema = z
  .object({
    decision: z.enum(['accepted', 'dismissed']),
    resultId: z.uuid().nullable().optional(),
  })
  .refine((body) => (body.decision === 'accepted') === (body.resultId != null), {
    message: 'An accepted draft names what was saved from it; a dismissed one names nothing.',
  });
export type DecideDraftRequest = z.infer<typeof decideDraftSchema>;

/** POST /api/v1/calls/recordings/{id}/voicemail: a person's answer to "was it a voicemail?". */
export const correctVoicemailSchema = z.object({ voicemail: z.boolean() });
export type CorrectVoicemailRequest = z.infer<typeof correctVoicemailSchema>;
