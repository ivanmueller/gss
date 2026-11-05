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
  /** The call's names (the company, the contact called, the caller): ordinary in its lines. */
  names?: readonly string[];
  /** When the call connected (UTC instant): the bids and offers are quoted then. */
  calledAt: string;
}

export type ContactFormValues = Partial<Record<ContactFieldId, string>>;

/** A draft as kept: what its form opens with, and the transcript lines it came from. */
/** Where a draft bid or offer's amounts were said, and why to look twice at any of them. */
export type QuoteChecks = Partial<Record<'price' | 'quantityMin' | 'quantityMax', SaidCheck>>;
/** Where a draft contact's phone number was said, and why to look twice at it. */
export type ContactChecks = Partial<Record<'contactPhone', SaidCheck>>;

export type DraftInput =
  | {
      kind: 'quote';
      fields: {
        side: QuoteSide;
        commodity: CommodityCode | null;
        values: QuoteFormValues;
        checks: QuoteChecks;
      };
      lines: number[];
    }
  | { kind: 'follow_up'; fields: { values: FollowUpFormValues }; lines: number[] }
  | {
      kind: 'contact';
      /** A listed contact these are new details of; null for a new person. */
      contactId: string | null;
      fields: { values: ContactFormValues; checks: ContactChecks };
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
const squash = (text: string) =>
  // NFKC makes full-width and other compatibility digits plain ("１" is "1"; Codex's review of
  // 5d1ecfa), so no check can be passed with a digit written another way.
  text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** A cited transcript line: its number, as Claude was given it, and its words. */
export interface CitedLine {
  line: number;
  text: string;
}

/**
 * Where a price, quantity or phone number in a draft came from, for the person checking it (the
 * owner's choice of 2026-11-05: fill in what was said, show where, and mark what is unusual).
 */
export interface SaidCheck {
  /** The words copied, exactly as Claude gave them. */
  said: string;
  /** The number of the transcript line they stand in. */
  line: number;
  /** Why the person should look twice; null when nothing about it is unusual. */
  doubt: string | null;
}

/** Where copied words stand in a cited line, and what is around them (squashed). */
interface Found {
  line: number;
  before: string;
  after: string;
  /** The rest of the line they stand in, without them. */
  rest: string;
  /** Where they stand in the line (squashed), and how long they are. */
  at: number;
  length: number;
}

/**
 * The first place in the cited lines where `said` stands as Claude copied it (case and spacing
 * aside): never inside a longer word or number, and not refused by `refuse`, which sees the
 * words right before and after. Null when it stands nowhere: then it was not said.
 */
function find(
  said: string,
  cited: readonly CitedLine[],
  refuse: (before: string, after: string) => boolean,
): Found | null {
  const needle = squash(said);
  if (needle === '') return null;
  for (const { line, text: words } of cited) {
    const text = squash(words);
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
      const before = text.slice(0, at);
      const after = text.slice(at + needle.length);
      const glued =
        (/[\p{L}\p{N}]$/u.test(before) && /^[\p{L}\p{N}]/u.test(needle)) ||
        (/[\p{L}\p{N}]$/u.test(needle) && /^[\p{L}\p{N}]/u.test(after));
      if (glued || refuse(before, after)) continue;
      return { line, before, after, rest: `${before} ${after}`, at, length: needle.length };
    }
  }
  return null;
}

/**
 * Copied words that are only part of a number are not what was said, so they are refused: a
 * decimal point or thousands separator against them (".50" copied as "50", "1,500" as "500").
 */
const AMOUNT_CUT = (before: string, after: string) =>
  /(?:\.|\p{N},)$/u.test(before) || /^[.,]\p{N}/u.test(after);

/**
 * Words that may turn an amount around: a sign, a deduction, a negative. Anywhere in the line,
 * they mark the amount for a second look rather than refuse it (the owner's choice of
 * 2026-11-05; Codex's reviews found ever more ways to say them, so none is relied on alone).
 */
const SIGN_WORDS =
  /\b(?:minus|negative|less|below|plus|deduct(?:ed|ing|ion)?|discount(?:ed)?|off|under zero|in the red)\b/;
/**
 * A dash, minus or plus sign anywhere in the line, whatever character it is written with,
 * other than a hyphen inside a word ("well-known"): wherever it stands, it may be a sign or a
 * range (Codex's review of 5d1ecfa: "- ($725 per tonne)", "- EUR $725").
 */
const SIGN_MARK = /(?<!\p{L})[\p{Pd}\u2212+]|[\p{Pd}\u2212+](?!\p{L})/u;
/** A fraction or scale said right after the amount: "½", "thousand", "million". */
const SCALE_AFTER =
  /^\s*(?:\p{No}|thousand\b|million\b|billion\b|grand\b|hundred\b|k\b|m\b|mm\b|mn\b|mil\b|mln\b|b\b|bn\b)/u;
/** Currency, dollars or a unit right before or after the copied words: they may belong to it. */
const PRICE_WORD_BEFORE = /(?:\$|\b(?:usd|cad|cdn|us|u\.s\.?|c|canadian|american|dollars?)\.?)\s*$/;
const PRICE_WORD_AFTER =
  /^\s*(?:usd|cad|cdn|canadian|american|us|u\.s\.|dollars?|bucks|(?:a|an|per)\s+(?:metric\s+)?(?:tonnes?|tons?|t|mts?|bushels?|bu|hundredweights?|cwt)\b|\/)/;

/**
 * The only words a line may hold, besides its numbers' own words and the call's names, for a
 * price or quantity to stay plain: a plain statement of a bid or offer ("we bid", "our offer is",
 * "can do", "delivered", "firm") and the grains and units. None of them can say "not", "less",
 * "down", "take … for dockage", a range or a condition; any other word marks the number "Check
 * this" (the owner's choice of 2026-11-05: a text check cannot read meaning, so anything but a
 * plain statement is left to the person, with the number still filled in; Codex's reviews of
 * 9773921 and 6b9d065).
 */
const PLAIN_AMOUNT_WORDS: ReadonlySet<string> = new Set(
  `a an and are at barley be beans bid bidding bids bushel
bushels can canary canola cash chickpeas corn cwt delivered delivery do durum
elevator ex faba farm feed firm flax flaxseed fob for grain green
has have hello hi hundredweight i indicative is it it's lentil lentils
malt metric mt mts mustard my oat oats offer offering offers ok
okay our pea peas plant price priced prices red rye seed soybean
soybeans spring sunflower thanks that that's the this today tonne tonnes we
wheat will winter would yeah yellow yes`.split(/\s+/),
);
/** The same for a phone number: how one is given ("call", "reach me at", "cell", "extension"). */
const PLAIN_PHONE_WORDS: ReadonlySet<string> = new Set(
  `a an are at be call can cell desk ext extension hello
her hi his i is it it's me my number office ok
okay on our phone reach thanks that that's the their this us
we will x yeah yes`.split(/\s+/),
);
/** Numbers in words: never ordinary, even as a name. */
const NUMBER_WORDS = new Set(
  `billion couple double dozen eight eighteen eighty eleven few fifteen fifth fifty
five forty four fourteen fourth half halves hundred hundreds million millions nine
nineteen ninety oh one point quarter quarters seven seventeen seventy several six
sixteen sixty ten tenth third thirds thirteen thirty thousand thousands three triple
twelve twenty two zero`.split(/\s+/),
);

/** No names known. */
const NO_NAMES: ReadonlySet<string> = new Set();

/**
 * The call's full names (the company, the contact called, the caller, its contacts), squashed,
 * as phrases of at least two words: only a whole name in a line is a name, never one of its
 * words alone ("down" is not "Sam Down"; Codex's review of 6b9d065).
 */
export function nameWords(names: readonly (string | null | undefined)[]): ReadonlySet<string> {
  const phrases = new Set<string>();
  for (const name of names) {
    const phrase = squash(name ?? '');
    if (phrase.split(' ').length >= 2) phrases.add(phrase);
  }
  return phrases;
}

/** The marks an ordinary line may hold: spaces, everyday punctuation, quotes, hyphens. */
const ORDINARY_MARK = /[\p{L}\p{N}\s.,!?;:'"()\u2018\u2019\u201C\u201D\p{Pd}]/u;

/**
 * The first word or mark in a line, other than the copied words, the draft's own filled-in
 * amounts (`masked`) and the call's whole names (`names`), that is not plain, or null: a word not
 * in `plain`, a number in words, or any symbol other than everyday punctuation ("➖", "±", "%").
 */
function unusualWord(
  line: string,
  masked: readonly { at: number; length: number }[],
  names: ReadonlySet<string>,
  plain: ReadonlySet<string>,
): string | null {
  let text = squash(line);
  for (const { at, length } of masked) {
    text = `${text.slice(0, at)}${' '.repeat(length)}${text.slice(at + length)}`;
  }
  for (const name of names) {
    text = text.split(name).join(' '.repeat(name.length));
  }
  for (const char of text) {
    if (!ORDINARY_MARK.test(char)) return char;
  }
  for (const match of text.matchAll(/[\p{L}][\p{L}'\u2019]*/gu)) {
    const word = match[0].replace(/\u2019/g, "'");
    if (NUMBER_WORDS.has(word)) return match[0];
    if (plain.has(word)) continue;
    return match[0];
  }
  return null;
}

/** Where each of `phrases` first stands in a squashed line, to mask it. */
function spansOf(line: string, phrases: readonly string[]): { at: number; length: number }[] {
  const text = squash(line);
  return phrases.flatMap((phrase) => {
    const words = squash(phrase);
    const at = words === '' ? -1 : text.indexOf(words);
    return at === -1 ? [] : [{ at, length: words.length }];
  });
}

/**
 * Why a person should look twice at an amount found in a transcript line, or null: a sign word
 * or a dash, minus or plus sign anywhere in the line, a fraction or scale after it, another
 * number anywhere in the line (other than the ones `explained`: the draft's own price and
 * quantities, only those filled in), or currency or unit words next to it left out of the copy.
 */
function amountDoubt(
  found: Found,
  line: string,
  explained: readonly string[],
  names: ReadonlySet<string>,
): string | null {
  const text = squash(line);
  const sign = SIGN_WORDS.exec(text);
  if (sign !== null) return `The line says “${sign[0]}”.`;
  if (SIGN_MARK.test(text)) return 'The line has a dash, minus or plus sign.';
  const scale = SCALE_AFTER.exec(found.after);
  if (scale !== null) return `It is said with “${scale[0].trim()}”.`;
  // Any other number in the line, but the draft's own price and quantities that were filled in.
  let rest = found.rest;
  for (const other of explained) {
    const words = squash(other);
    if (words !== '') rest = rest.replace(words, ' ');
  }
  const number = /\p{N}[\p{N},.]*/u.exec(rest);
  if (number !== null) return `The line has another number, “${number[0]}”.`;
  if (PRICE_WORD_BEFORE.test(found.before) || PRICE_WORD_AFTER.test(found.after)) {
    return 'Words right next to it may belong to it.';
  }
  const word = unusualWord(line, [found, ...spansOf(line, explained)], names, PLAIN_AMOUNT_WORDS);
  if (word !== null) return `The line has a word to check, “${word}”.`;
  return null;
}

/**
 * A sign copied with the amount ("-$5", "+$5", "minus 5", "plus 500 tonnes"): it is read without
 * it, and marked for a second look.
 */
const SIGN_COPIED = /^(?:[-\u2212+]|minus\s+|negative\s+|plus\s+)\s*/;

/** A number as written: "1,500", "1 500", "725.50", ".50". */
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?: \d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;
const UNIT = String.raw`(metric[- ]tonnes?|metric tons?|tonnes?|mts?|t|short tons?|tons?|bushels?|bu|hundredweights?|cwt)`;
const CURRENCY_AFTER = String.raw`(usd|cad|cdn\.?|canadian|american|us|u\.s\.)`;

/**
 * A price as said, whole: an optional currency before ("CAD", "USD $", "US$", "US $", "C$",
 * "Cdn. $", "Canadian dollars", "$"), the number, an optional currency after ("Canadian", "USD",
 * "US"), "dollars" (then optionally a currency: "dollars Canadian"), an optional unit ("a tonne",
 * "per bushel", "/mt", "/ t") and optionally a currency after the unit ("per tonne CAD").
 */
const PRICE_SAID = new RegExp(
  String.raw`^(?:(usd|cad|cdn\.?)\s*\$?|(us|u\.s\.|c|canadian|american)\s*\$|(canadian|american|us|u\.s\.)\s+dollars|(\$))?\s*${NUMBER}\s*${CURRENCY_AFTER}?\s*(dollars?|bucks)?\s*${CURRENCY_AFTER}?\s*(?:(?:a|an|per|/)\s*${UNIT})?\s*${CURRENCY_AFTER}?$`,
);
/** A quantity as said, whole: the number and metric tonnes ("500 tonnes", "500 t", "500 mts"). */
const TONNES_SAID = new RegExp(
  String.raw`^${NUMBER}\s*(metric[- ]tonnes?|metric tons?|tonnes?|mts?|t)$`,
);

/** A number as the forms take it: no thousands separators, a leading 0 before a decimal point. */
function plainNumber(written: string): string {
  const number = written.replace(/[, ]/g, '');
  return number.startsWith('.') ? `0${number}` : number;
}

/** The price unit a unit word names; "ton" alone is not clear (short or metric). */
function unitOf(word: string | undefined): PriceUnit | null {
  if (word === undefined) return null;
  if (/^(?:metric[- ]tonnes?|metric tons?|tonnes?|mts?|t)$/.test(word)) return 'MT';
  if (/^short tons?$/.test(word)) return 'ST';
  if (/^(?:bushels?|bu)$/.test(word)) return 'BU';
  if (/^(?:hundredweights?|cwt)$/.test(word)) return 'CWT';
  return null;
}

function currencyOf(word: string | undefined): QuoteCurrency | null {
  if (word === undefined) return null;
  if (/^(?:cad|cdn\.?|canadian|c)$/.test(word)) return 'CAD';
  if (/^(?:usd|us|u\.s\.|american)$/.test(word)) return 'USD';
  return null;
}

const PRICE = /^\d{1,17}(?:\.\d{1,12})?$/;
const QUANTITY = /^\d{1,11}(?:\.\d{1,3})?$/;
const isZero = (amount: string) => /^0*(?:\.0*)?$/.test(amount);

/**
 * A price as one thing said in the cited lines: its amount, and its currency and unit only from
 * those same words, so they are never put together from different prices; with where it was
 * said and, when something about it is unusual, why to look twice. Null when the words were not
 * said, or do not read as one price: a dollar sign, a currency code, "dollars" or a unit marks
 * one ("725 US customers" is not one), and two different currencies make it none.
 */
export function saidPrice(
  said: string | null,
  cited: readonly CitedLine[],
  explained: readonly (string | null)[] = [],
  names: ReadonlySet<string> = NO_NAMES,
): {
  amount: string;
  currency: QuoteCurrency | null;
  unit: PriceUnit | null;
  check: SaidCheck;
} | null {
  if (said === null) return null;
  const words = squash(said);
  const sign = SIGN_COPIED.exec(words);
  const match = PRICE_SAID.exec(sign === null ? words : words.slice(sign[0].length));
  if (match === null) return null;
  const [
    ,
    codeBefore,
    shortBefore,
    wordsBefore,
    dollarSign,
    written = '',
    after1,
    dollars,
    after2,
    unitWord,
    after3,
  ] = match;
  const codes = [after1, after2, after3].filter((code) => code !== undefined);
  const codeOnly = codes.some((code) => /^(?:usd|cad|cdn\.?)$/.test(code));
  if (
    !(codeBefore ?? shortBefore ?? wordsBefore ?? dollarSign ?? dollars ?? unitWord) &&
    !codeOnly
  ) {
    return null;
  }
  const currencies = new Set(
    [codeBefore, shortBefore, wordsBefore, ...codes]
      .map((word) => currencyOf(word))
      .filter((currency) => currency !== null),
  );
  if (currencies.size > 1) return null;
  const amount = plainNumber(written);
  if (!PRICE.test(amount) || isZero(amount)) return null;
  const found = find(said, cited, AMOUNT_CUT);
  if (found === null) return null;
  const line = cited.find((c) => c.line === found.line)?.text ?? '';
  return {
    amount,
    currency: [...currencies][0] ?? null,
    unit: unitOf(unitWord),
    check: {
      said,
      line: found.line,
      doubt:
        sign === null
          ? amountDoubt(
              found,
              line,
              explained.filter((e) => e !== null),
              names,
            )
          : 'It was said with a sign.',
    },
  };
}

/** A quantity in metric tonnes as one thing said in the cited lines, with where; else null. */
export function saidTonnes(
  said: string | null,
  cited: readonly CitedLine[],
  explained: readonly (string | null)[] = [],
  names: ReadonlySet<string> = NO_NAMES,
): { amount: string; check: SaidCheck } | null {
  if (said === null) return null;
  const words = squash(said);
  const sign = SIGN_COPIED.exec(words);
  const match = TONNES_SAID.exec(sign === null ? words : words.slice(sign[0].length));
  if (match === null) return null;
  const amount = plainNumber(match[1] ?? '');
  if (!QUANTITY.test(amount) || isZero(amount)) return null;
  const found = find(said, cited, AMOUNT_CUT);
  if (found === null) return null;
  const line = cited.find((c) => c.line === found.line)?.text ?? '';
  let doubt = amountDoubt(
    found,
    line,
    explained.filter((e) => e !== null),
    names,
  );
  // "Per 500 tonnes" is part of a price, not a quantity on offer (Codex's review of 5d1ecfa).
  if (sign !== null) doubt = 'It was said with a sign.';
  else if (/(?:\b(?:per|a|an|each)|\/)\s*$/.test(found.before)) {
    doubt = 'It is said after “per”: it may be part of a price.';
  } else if (doubt === null && /\$\s*$/.test(found.before)) {
    doubt = 'A dollar sign is right before it.';
  }
  return { amount, check: { said, line: found.line, doubt } };
}

/**
 * A North American phone number as said, whole: a "1" or "+1" only when said, the area code,
 * the number (spaces, dots, dashes or slashes between), and at most one extension ("x12",
 * "ext. 12", "ext: 12", "extn 12", "extension 12", "#12").
 */
const PHONE_SAID =
  /^(?:\+?1[\s./-]*)?(?:\((\d{3})\)|(\d{3}))[\s./-]*(\d{3})[\s./-]*(\d{4})(?:\s*[,;]?\s*\(?\s*(?:(?:x|ext\.?|extn\.?|extension)\s*[:=#]?|#)\s*(\d{1,10})\s*\)?)?$/;
/**
 * A copy that is part of a longer number is not the number said: digits or a "+" before it
 * ("+44/4035550177", "+44:4035550177"), or more digits joined to it after ("4035550177/9",
 * "…,9", "… - 9"). A number after a space ("… 0177 2 loads") is another number: the phone is
 * filled in and marked.
 */
const PHONE_CUT = (before: string, after: string) =>
  /[\p{N}+][\s()./:=-]*$/u.test(before) ||
  /^\s*[/-]\s*\p{N}/u.test(after) ||
  /^[().,]\s*\p{N}/u.test(after);
/** Words after a copied number that may be an extension it left out. */
const EXTENSION_AFTER = /^\s*[,;:(]?\s*(?:x\s*\d|ext|extn|extension|#\s*\d)/;

/**
 * A phone number as one thing said in the cited lines, written as the directory keeps it,
 * "(403) 555-0177 x12", from the parts checked, with where it was said and why to look twice
 * (an extension that may have been left out, another number in the sentence). Null when it was
 * not said whole; a number from another country is left for the person to add.
 */
export function saidPhone(
  said: string | null,
  cited: readonly CitedLine[],
  names: ReadonlySet<string> = NO_NAMES,
): { phone: string; check: SaidCheck } | null {
  if (said === null) return null;
  const match = PHONE_SAID.exec(squash(said));
  if (match === null) return null;
  const found = find(said, cited, PHONE_CUT);
  if (found === null) return null;
  const [, bracketed, area = bracketed ?? '', exchange = '', number = '', extension] = match;
  const written = `(${area}) ${exchange}-${number}`;
  let doubt: string | null = null;
  if (extension === undefined && EXTENSION_AFTER.test(found.after)) {
    doubt = 'An extension may follow it.';
  } else if (/\p{N}/u.test(found.rest)) {
    doubt = 'The line has another number.';
  } else {
    const line = cited.find((c) => c.line === found.line)?.text ?? '';
    const word = unusualWord(line, [found], names, PLAIN_PHONE_WORDS);
    if (word !== null) doubt = `The line has a word to check, “${word}”.`;
  }
  return {
    phone: extension === undefined ? written : `${written} x${extension}`,
    check: { said, line: found.line, doubt },
  };
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
    return { lines, cited: lines.map((n) => ({ line: n, text: context.lines[n]?.text ?? '' })) };
  };
  const drafts: DraftInput[] = [];
  const names = nameWords([...(context.names ?? []), ...context.contacts.map((c) => c.name)]);
  const quotedAt = new Date(context.calledAt).toISOString();
  const reference = label(`Call of ${formatAlberta(quotedAt)}, drafted by Claude`);

  for (const quote of reading.quotes.slice(0, DRAFTS_PER_KIND_MAX)) {
    const { lines, cited } = evidence(quote.lines);
    if (lines.length === 0) continue;
    if (!SIDE_COUNTERPARTY_TYPES[quote.side].some((t) => context.counterpartyTypes.includes(t))) {
      continue;
    }
    const values: QuoteFormValues = { quotedAt, sourceType: 'phone' };
    put(values, 'sourceReference', reference);
    put(values, 'firmness', quote.firmness);
    // The price, its currency and its unit from one price said whole (saidPrice); each amount
    // with where it was said and, when unusual, why to look twice.
    const checks: QuoteChecks = {};
    // Only amounts that were filled in may explain the other numbers in a line: a copy that was
    // refused explains nothing (Codex's review of 5d1ecfa).
    const filled = (said: string | null, ok: unknown) => (ok === null ? null : said);
    const minOk = filled(quote.quantityMinSaid, saidTonnes(quote.quantityMinSaid, cited));
    const maxOk = filled(quote.quantityMaxSaid, saidTonnes(quote.quantityMaxSaid, cited));
    const priceOk = filled(quote.priceSaid, saidPrice(quote.priceSaid, cited));
    const price = saidPrice(quote.priceSaid, cited, [minOk, maxOk], names);
    if (price !== null) checks.price = price.check;
    put(values, 'price', price?.amount ?? null);
    put(values, 'currency', price?.currency ?? null);
    put(values, 'priceUnit', price?.unit ?? null);
    put(values, 'grade', label(quote.grade));
    put(values, 'deliveryBasis', quote.deliveryBasis);
    put(values, 'basisLocation', label(quote.basisLocation));
    const quantityMin = saidTonnes(quote.quantityMinSaid, cited, [priceOk, maxOk], names);
    const quantityMax = saidTonnes(quote.quantityMaxSaid, cited, [priceOk, minOk], names);
    if (quantityMin !== null) checks.quantityMin = quantityMin.check;
    if (quantityMax !== null) checks.quantityMax = quantityMax.check;
    put(values, 'quantityMin', quantityMin?.amount ?? null);
    put(values, 'quantityMax', quantityMax?.amount ?? null);
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
      fields: { side: quote.side, commodity: quote.commodity, values, checks },
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
    const { lines, cited } = evidence(contact.lines);
    if (lines.length === 0) continue;
    const listed = context.contacts.find((c) => c.id === contact.contactId) ?? null;
    const email = label(contact.email, 254)?.toLowerCase() ?? null;
    const found: ContactFormValues = {};
    put(found, 'contactName', label(contact.name));
    put(found, 'contactRole', label(contact.role));
    put(found, 'contactEmail', email !== null && EMAIL.test(email) ? email : null);
    // The person drafted is a name in the line their number was said in.
    const phone = saidPhone(
      contact.phoneSaid,
      cited,
      new Set([...names, ...nameWords([contact.name])]),
    );
    put(found, 'contactPhone', phone?.phone ?? null);
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
      fields: {
        values,
        checks:
          phone !== null && values.contactPhone !== undefined ? { contactPhone: phone.check } : {},
      },
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
