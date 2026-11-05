import { z } from 'zod';

import { albertaToUtc, formatAlberta } from './alberta';
import type { TranscriptLine } from './calls';
import { COMMODITIES, type CommodityCode } from './commodities';
import type { FollowUpFormValues } from './crm';
import type { ContactFieldId } from './directory';
import { isCalendarDate } from './fx';
import {
  DELIVERY_BASES,
  QUOTE_FIRMNESS,
  QUOTE_SIDES,
  SIDE_COUNTERPARTY_TYPES,
  type PriceUnit,
  type QuoteCurrency,
  type QuoteFormValues,
  type QuoteSide,
} from './quotes';
import { LABEL_MAX, NOTE_MAX } from './terms';

// Claude reads each call's transcript and drafts what was said (the owner's request and
// answers of 2026-11-05, docs/DECISIONS.md): a few lines of notes, whether the call reached a
// voicemail, and drafts of bids and offers, follow-ups and contact details. A person opens each
// draft in the usual form and saves it, or dismisses it; nothing is saved before. The Worker
// asks Claude for CALL_READING_JSON_SCHEMA and passes the answer through checkReading, which
// keeps only what the transcript bears out. Claude copies each price, quantity and phone number
// exactly as said; the Worker keeps one only when those words stand whole in a line the draft
// points to and read as a price (its currency and unit from the same words), a quantity in
// tonnes, or a North American phone number. Anything else stays blank.
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
      priceSaid: nullableText,
      grade: nullableText,
      deliveryBasis: z.enum(DELIVERY_BASES).nullable(),
      basisLocation: nullableText,
      quantityMinSaid: nullableText,
      quantityMaxSaid: nullableText,
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
      phoneSaid: nullableText,
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
      priceSaid: text(
        'The price exactly as written in one transcript line, copied character for character with its currency and unit when they are said with it, e.g. "$725.50 Canadian a tonne", "US$7.25 a bushel", "CAD $310 per tonne". Null when no single price was said.',
      ),
      grade: text('The grade or spec as said, e.g. "1 CW", "feed".'),
      deliveryBasis: choice(DELIVERY_BASES, 'How the price is delivered, when said.'),
      basisLocation: text('The place the price is for, as said.'),
      quantityMinSaid: text(
        'A smallest quantity exactly as written in one transcript line, in metric tonnes, e.g. "500 tonnes". Null otherwise.',
      ),
      quantityMaxSaid: text(
        'The quantity exactly as written in one transcript line, in metric tonnes, e.g. "1,500 tonnes". Null otherwise.',
      ),
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
      phoneSaid: text(
        'Their phone number exactly as written in one transcript line, with its extension when said with it, e.g. "403 555 0177 extension 12". Null otherwise.',
      ),
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

/** A text as compared: spaces collapsed, lower case. */
const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Whether `said` stands in one of `lines` exactly as Claude copied it (case and spacing aside),
 * as a whole expression: never inside a longer word or number, and with nothing right before or
 * after it that changes what it says (`joinsBefore`, `joinsAfter`). This is how a draft's price,
 * quantity and phone number are tied to one thing that was said (Codex's reviews of the call
 * readings: c9222d3, 1485b23, a5c8986 and 66e61ae).
 */
function standsAlone(
  said: string,
  lines: readonly string[],
  joinsBefore: RegExp,
  joinsAfter: RegExp,
): boolean {
  const needle = squash(said);
  if (needle === '') return false;
  for (const line of lines) {
    const text = squash(line);
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
      const before = text.slice(0, at);
      const after = text.slice(at + needle.length);
      const glued =
        (/[a-z0-9]$/.test(before) && /^[a-z0-9]/.test(needle)) ||
        (/[a-z0-9]$/.test(needle) && /^[a-z0-9]/.test(after));
      if (!glued && !joinsBefore.test(before) && !joinsAfter.test(after)) return true;
    }
  }
  return false;
}

/**
 * Right before an amount, what makes it part of something else: a sign ("-$5", "minus", "less"),
 * another digit, a decimal point or thousands separator against it (".50" copied as "50",
 * "1,500" as "500"), a dollar sign or currency left out of it ("CAD $5" copied as "$5"), the
 * first end of a range ("from", "to", "between … and"), and a currency word ("minus Canadian
 * $5" copied as "$5"; Codex's review of 5e25edd, finding 1). A comma or full stop ending the
 * words before (", US$7.25") is not part of it.
 */
const AMOUNT_JOINS_BEFORE =
  /(?:(?:[\d$+\-−–—/]|\b(?:minus|negative|less|plus|from|to|usd|cad|cdn|us|u\.s|c|canadian|american)|\bbetween\b[^.;]*\band)\s*|\.|\d,)$/;
/** Right after an amount: more of the number, or the other end of a range ("-725", "to CAD $725"). */
const AMOUNT_JOINS_AFTER =
  /^\s*(?:\d|[.,]\d|(?:[-−–—/]|(?:to|and|or)\s)\s*(?:(?:usd|cad|cdn|us|u\.s\.|c|canadian|american)\s*)?\$?\s*\.?\d|%)/;

/** A number as written: "1,500", "725.50", ".50". */
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;
const UNIT = String.raw`(metric tonnes?|metric tons?|tonnes?|mt|short tons?|tons?|bushels?|bu|hundredweights?|cwt)`;

/**
 * A price as said, whole: an optional currency before ("CAD", "USD $", "US$", "US $", "C$", "$"), the
 * number, an optional currency after ("Canadian", "USD", "US"), "dollars", and an optional unit
 * ("a tonne", "per bushel", "/mt"). Nothing else: no sign, no second number.
 */
const PRICE_SAID = new RegExp(
  String.raw`^(?:(usd|cad|cdn)\s*\$?|(us|u\.s\.|c|canadian|american)\s*\$|(\$))?\s*${NUMBER}\s*(usd|cad|cdn|canadian|american|us|u\.s\.)?\s*(dollars?|bucks)?\s*(?:(?:a|an|per|/)\s*${UNIT})?$`,
);
/** A quantity as said, whole: the number and metric tonnes. */
const TONNES_SAID = new RegExp(String.raw`^${NUMBER}\s*(metric tonnes?|metric tons?|tonnes?|mt)$`);

/** A number as the forms take it: no thousands separators, a leading 0 before a decimal point. */
function plainNumber(written: string): string {
  const number = written.replace(/,/g, '');
  return number.startsWith('.') ? `0${number}` : number;
}

/** The price unit a unit word names; "ton" alone is not clear (short or metric). */
function unitOf(word: string | undefined): PriceUnit | null {
  if (word === undefined) return null;
  if (/^(?:metric tonnes?|metric tons?|tonnes?|mt)$/.test(word)) return 'MT';
  if (/^short tons?$/.test(word)) return 'ST';
  if (/^(?:bushels?|bu)$/.test(word)) return 'BU';
  if (/^(?:hundredweights?|cwt)$/.test(word)) return 'CWT';
  return null;
}

function currencyOf(word: string | undefined): QuoteCurrency | null {
  if (word === undefined) return null;
  if (/^(?:cad|cdn|canadian|c)$/.test(word)) return 'CAD';
  if (/^(?:usd|us|u\.s\.|american)$/.test(word)) return 'USD';
  return null;
}

const PRICE = /^\d{1,17}(?:\.\d{1,12})?$/;
const QUANTITY = /^\d{1,11}(?:\.\d{1,3})?$/;
const isZero = (amount: string) => /^0*(?:\.0*)?$/.test(amount);

/**
 * A price as one thing said in the cited lines: its amount, and its currency and unit only when
 * said in that same expression. The three always come from the same words, so they can never be
 * put together from different prices. Null when the words were not said as a whole price.
 */
export function saidPrice(
  said: string | null,
  lines: readonly string[],
): { amount: string; currency: QuoteCurrency | null; unit: PriceUnit | null } | null {
  if (said === null) return null;
  const match = PRICE_SAID.exec(squash(said));
  if (match === null) return null;
  const [, codeBefore, shortBefore, dollarSign, written = '', codeAfter, dollars, unitWord] = match;
  // A price says so: a dollar sign, a currency code, "dollars" or a unit. A country word alone
  // after a number is not one ("725 US customers"; Codex's review of 5e25edd, finding 2).
  const codeOnly = codeAfter !== undefined && /^(?:usd|cad|cdn)$/.test(codeAfter);
  if (!(codeBefore ?? shortBefore ?? dollarSign ?? dollars ?? unitWord) && !codeOnly) return null;
  const before = currencyOf(codeBefore ?? shortBefore);
  const after = currencyOf(codeAfter);
  if (before !== null && after !== null && before !== after) return null;
  const amount = plainNumber(written);
  if (!PRICE.test(amount) || isZero(amount)) return null;
  if (!standsAlone(said, lines, AMOUNT_JOINS_BEFORE, AMOUNT_JOINS_AFTER)) return null;
  return { amount, currency: before ?? after, unit: unitOf(unitWord) };
}

/** A quantity in metric tonnes as one thing said in the cited lines; else null. */
export function saidTonnes(said: string | null, lines: readonly string[]): string | null {
  if (said === null) return null;
  const match = TONNES_SAID.exec(squash(said));
  if (match === null) return null;
  const amount = plainNumber(match[1] ?? '');
  if (!QUANTITY.test(amount) || isZero(amount)) return null;
  return standsAlone(said, lines, AMOUNT_JOINS_BEFORE, AMOUNT_JOINS_AFTER) ? amount : null;
}

/**
 * A North American phone number as said, whole: a "1" or "+1" only when said, the area code,
 * the number, and at most one extension after "x", "ext" or "extension".
 */
const PHONE_SAID =
  /^(?:\+?1[\s.-]*)?(?:\((\d{3})\)|(\d{3}))[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*,?\s*(?:x|ext\.?|extension)\s*(\d{1,10}))?$/;
/**
 * Right before or after a phone number: more of a number ("+44 20 …", "… 0177 9"), or an
 * extension said after it and left out of the copy (Codex's review of 5e25edd, finding 3).
 */
const PHONE_JOINS_BEFORE = /(?:\d[\s().-]*|\+\s*)$/;
const PHONE_JOINS_AFTER = /^(?:[\s().-]*\d|\s*,?\s*(?:x|ext\b|extension)\s*\.?\s*\d)/;

/**
 * A phone number as one thing said in the cited lines, written as the directory keeps it,
 * "(403) 555-0177 x12", from the parts checked; null when it was not said whole. A number from
 * another country is left for the person to add.
 */
export function saidPhone(said: string | null, lines: readonly string[]): string | null {
  if (said === null) return null;
  const match = PHONE_SAID.exec(squash(said));
  if (match === null) return null;
  if (!standsAlone(said, lines, PHONE_JOINS_BEFORE, PHONE_JOINS_AFTER)) return null;
  const [, bracketed, area = bracketed ?? '', exchange = '', line = '', extension] = match;
  const number = `(${area}) ${exchange}-${line}`;
  return extension === undefined ? number : `${number} x${extension}`;
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
    return { lines, texts: lines.map((n) => context.lines[n]?.text ?? '') };
  };
  const drafts: DraftInput[] = [];
  const quotedAt = new Date(context.calledAt).toISOString();
  const reference = label(`Call of ${formatAlberta(quotedAt)}, drafted by Claude`);

  for (const quote of reading.quotes.slice(0, DRAFTS_PER_KIND_MAX)) {
    const { lines, texts } = evidence(quote.lines);
    if (lines.length === 0) continue;
    if (!SIDE_COUNTERPARTY_TYPES[quote.side].some((t) => context.counterpartyTypes.includes(t))) {
      continue;
    }
    const values: QuoteFormValues = { quotedAt, sourceType: 'phone' };
    put(values, 'sourceReference', reference);
    put(values, 'firmness', quote.firmness);
    // The price, its currency and its unit from one price said whole (saidPrice).
    const price = saidPrice(quote.priceSaid, texts);
    put(values, 'price', price?.amount ?? null);
    put(values, 'currency', price?.currency ?? null);
    put(values, 'priceUnit', price?.unit ?? null);
    put(values, 'grade', label(quote.grade));
    put(values, 'deliveryBasis', quote.deliveryBasis);
    put(values, 'basisLocation', label(quote.basisLocation));
    put(values, 'quantityMin', saidTonnes(quote.quantityMinSaid, texts));
    put(values, 'quantityMax', saidTonnes(quote.quantityMaxSaid, texts));
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
    const { lines, texts } = evidence(contact.lines);
    if (lines.length === 0) continue;
    const listed = context.contacts.find((c) => c.id === contact.contactId) ?? null;
    const email = label(contact.email, 254)?.toLowerCase() ?? null;
    const found: ContactFormValues = {};
    put(found, 'contactName', label(contact.name));
    put(found, 'contactRole', label(contact.role));
    put(found, 'contactEmail', email !== null && EMAIL.test(email) ? email : null);
    put(found, 'contactPhone', saidPhone(contact.phoneSaid, texts));
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
