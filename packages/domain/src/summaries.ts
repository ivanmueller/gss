import { z } from 'zod';

// Claude's summary of a company at the top of its page (the owner's request and answers of
// 2026-11-05, docs/DECISIONS.md): a few short lines from GSS's own records, for reading only.
// The Worker checks the answer before keeping it: plain lines, a few of them, and every number
// in them found in the records Claude was given, so a summary never shows a price, quantity or
// date that is not in the records.

/** Lines in a summary, at most. */
export const SUMMARY_MAX_LINES = 6;
/** Characters in a line, at most. */
export const SUMMARY_LINE_MAX = 300;

/** The JSON shape Claude answers in (structured outputs): no optional or either-or fields. */
export const COUNTERPARTY_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    lines: { type: 'array', items: { type: 'string' } },
  },
  required: ['lines'],
  additionalProperties: false,
} as const;

export const counterpartySummaryAnswerSchema = z.object({ lines: z.array(z.string()).max(50) });
export type CounterpartySummaryAnswer = z.infer<typeof counterpartySummaryAnswerSchema>;

/** A number as written, in one form: digit-group commas dropped, trailing decimal zeros too. */
function canonicalNumber(text: string): string {
  const plain = text.replace(/,/g, '');
  if (!plain.includes('.')) return plain.replace(/^0+(?=\d)/, '');
  const [whole = '', fraction = ''] = plain.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const wholePart = whole.replace(/^0+(?=\d)/, '') || '0';
  return trimmed === '' ? wholePart : `${wholePart}.${trimmed}`;
}

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
/**
 * Dates and times as the records write them (Thu 5 Nov 2026, 9:00 am; 2026-11-30) and as a
 * summary may (Nov 5, 9 am, 5th Nov). Their numbers are checked against the records' dates and
 * times only, and every other number against the records' other numbers.
 */
const DATE_PARTS = new RegExp(
  [
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}:\d{2}(?:\s?[ap]\.?m\.?)?`,
    String.raw`\b\d{1,2}\s?[ap]\.?m\b\.?`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}`,
    String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?\b`,
    String.raw`\b(?:19|20)\d{2}\b`,
  ].join('|'),
  'gi',
);

/**
 * A number with what touches it: a sign right before it (not after a letter or digit, as in
 * UTC-6 or 700-725), a leading decimal point (.50), digit groups and decimals.
 */
const NUMBER = /(^|[^\p{L}\p{N}])?([-−–+±])?(\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/gu;

/** Words that make a number bigger, or say one in words: never in a summary. */
const SCALE_AFTER = /^\s*(?:k|m|mm|bn|b|thousand|million|billion|trillion|hundred|grand)\b/i;
const NUMBER_WORDS =
  /\b(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|dozen|grand)\b/i;
/** A small number in words for an amount ("seven per bushel", "CAD five"): never in a summary. */
const SMALL_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;
const WORD_AMOUNT = new RegExp(
  String.raw`(?:[$¢€£]|\b(?:cad|usd|us)\s*)\s*${SMALL_WORD}\b|\b${SMALL_WORD}\s+(?:(?:a|an|per)\s+)?(?:tonnes?|tons?|mt|st|bushels?|bu|cwt|dollars?|bucks|cents?|cad|usd|loads?|cars?|trucks?|percent|points?|%)`,
  'i',
);
/** What a small count may count ("2 calls", "3 open follow-ups") without the records holding it. */
const COUNTED =
  /^\s+(?:(?:open|new|more|other|recent|earlier|live|missed|unanswered|outstanding|pending|done)\s+)?(?:calls?|notes?|entries|entry|follow-?ups?|drafts?|bids?|offers?|contacts?|locations?|visits?|meetings?|emails?|messages?|voicemails?|times|changes?|people|persons?|sites?|elevators?|commodit(?:y|ies)|grains?)\b/i;
const SMALL_COUNT_MAX = 12;

interface NumbersOf {
  /** Numbers in dates and times. */
  dates: Set<string>;
  /** Every other number, signed when written with a sign; with the text right after it. */
  others: { value: string; after: string }[];
}

function numbersOf(text: string): NumbersOf {
  const dates = new Set<string>();
  const rest = text.replace(DATE_PARTS, (part) => {
    for (const digits of part.match(/\d+/g) ?? []) dates.add(canonicalNumber(digits));
    return ' '.repeat(part.length);
  });
  const others: NumbersOf['others'] = [];
  for (const match of rest.matchAll(NUMBER)) {
    const [whole, before = '', sign = '', digits = ''] = match;
    // A sign counts only at the start or after a space or symbol (−725, (−725), $-5).
    const signed = sign !== '' && (match.index === 0 ? before === '' : before !== '');
    const value = `${signed ? '-' : ''}${canonicalNumber(digits)}`;
    others.push({ value, after: rest.slice(match.index + whole.length) });
  }
  return { dates, others };
}

/** Every number in a text in canonical form, dates and times included ("1,500.00" → "1500"). */
export function numbersIn(text: string): string[] {
  const { dates, others } = numbersOf(text.normalize('NFKC'));
  return [...dates, ...others.map((number) => number.value)];
}

export type SummaryCheck =
  | { status: 'ok'; summary: string }
  | { status: 'empty' }
  /** A line longer than SUMMARY_LINE_MAX (nothing is cut, so no number or meaning is lost). */
  | { status: 'too_long' }
  /** A number in the summary that is not in the records (it is not kept). */
  | { status: 'unsupported_number' };

/**
 * Checks Claude's summary against the records it was given (`records`, the message sent): each
 * line plain text on one line, empty lines dropped, at most SUMMARY_MAX_LINES lines of at most
 * SUMMARY_LINE_MAX characters, and every number in it a whole value found in the records: a
 * date or time among the records' dates and times, any other number among their other numbers
 * with the same sign. A small whole count of calls, notes, follow-ups and the like is the only
 * number the records need not hold. Numbers in words beyond twelve, scale words (725 million,
 * 5k), small numbers in words for an amount, and digits other than 0 to 9 are refused.
 */
export function checkSummary(answer: CounterpartySummaryAnswer, records: string): SummaryCheck {
  const lines = answer.lines
    .map((line) =>
      line
        .normalize('NFKC')
        .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
        .replace(/^\s*(?:[-*•·]|\d+[.)])\s+/u, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line !== '')
    .slice(0, SUMMARY_MAX_LINES);
  if (lines.length === 0) return { status: 'empty' };
  if (lines.some((line) => line.length > SUMMARY_LINE_MAX)) return { status: 'too_long' };
  const summary = lines.join('\n');
  if (/[^\P{Nd}0-9]/u.test(summary) || NUMBER_WORDS.test(summary) || WORD_AMOUNT.test(summary)) {
    return { status: 'unsupported_number' };
  }
  const known = numbersOf(records.normalize('NFKC'));
  const knownOthers = new Set(known.others.map((number) => number.value));
  const said = numbersOf(summary);
  for (const date of said.dates) {
    if (!known.dates.has(date)) return { status: 'unsupported_number' };
  }
  for (const { value, after } of said.others) {
    if (SCALE_AFTER.test(after)) return { status: 'unsupported_number' };
    if (knownOthers.has(value)) continue;
    const count = /^\d+$/.test(value) && Number(value) <= SMALL_COUNT_MAX && COUNTED.test(after);
    if (!count) return { status: 'unsupported_number' };
  }
  return { status: 'ok', summary };
}

/** A company's summary as the API returns it. */
export interface CounterpartySummaryView {
  /** The lines, one per line; null when none has been written yet. */
  summary: string | null;
  /** UTC instant. */
  writtenAt: string | null;
  model: string | null;
  /** A person asked for a new one, not written yet. */
  requested: boolean;
  /** The job is writing one now. */
  writing: boolean;
  /** The job tried 5 times and stopped until something new happens or someone asks again. */
  failed: boolean;
}
