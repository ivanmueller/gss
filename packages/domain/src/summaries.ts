import { z } from 'zod';

// Claude's summary of a company at the top of its page (the owner's request and answers of
// 2026-11-05, docs/DECISIONS.md): a few short lines from GSS's own records, for reading only.
// Claude writes no number, date, time, amount or period of its own: it refers to the records by
// label ([Q1] for a bid or offer, [F1] for a follow-up…) and the Worker writes each record's own
// text in its place, so every price, quantity and date shown is exactly a record's, with its
// own record (Codex's reviews of f6d3296 and 3403497: matching numbers in free text could
// always be fooled).

/** Lines in a summary, at most. */
export const SUMMARY_MAX_LINES = 6;
/** Characters in a line, at most. */
export const SUMMARY_LINE_MAX = 400;
/** Characters in a summary, at most (the database keeps up to 2,000). */
export const SUMMARY_MAX_LENGTH = 2000;

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

/**
 * What the summary may refer to: each record's label (Q1, F1, H1, D1, C1, drafts, tonnes,
 * organic) with the text the Worker writes in its place, every number, date and time in it
 * exactly as in the records.
 */
export interface SummaryFacts {
  values: Readonly<Record<string, string>>;
}

/** A label in Claude's text: [Q1], [F2], [drafts]. */
const REFERENCE = /\[([A-Za-z]+\d*)\]/g;

/**
 * Words that say a number, an amount, a date, a time or a period: Claude's own words never do;
 * the records' labels carry them. Case-insensitive, whole words.
 */
const REFUSED_WORDS = new RegExp(
  String.raw`\b(?:${[
    // Numbers, fractions and multiples.
    'zero|nil|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve',
    'thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen',
    'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?',
    'billions?|trillions?|mn|bn|mm|k|grand|dozens?|score|couple|pairs?|single|double|triple',
    'twice|thrice|half|halves|quarters?|thirds?|percent|cent|cents|pct',
    'first|second|seconds|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth',
    'twentieth|thirtieth',
    // Signs.
    'minus|plus|negative',
    // Money.
    'cad|usd|dollars?|bucks?|loonies?',
    // Dates, times and periods.
    'today|tonight|tomorrow|yesterday|days?|weeks?|weekends?|fortnights?|months?|years?',
    'annual|annually|hours?|minutes?|noon|midnight|morning|afternoon|evening|am|pm',
    'overdue|expired|expires|expiring',
    'monday|tuesday|wednesday|thursday|friday|saturday|sunday',
    'january|february|april|june|july|august|september|october|november|december',
  ].join('|')})\b`,
  'i',
);
/** Short names of months and days, and May and March, only as names (capitalized). */
const REFUSED_NAMES =
  /\b(?:May|March|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|Mon|Tues?|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/;
/** Money, sign and comparison symbols. */
const REFUSED_SYMBOLS = /[$¢€£¥%‰±+−~≈<>×]/u;

export type SummaryCheck =
  | { status: 'ok'; summary: string }
  | { status: 'empty' }
  /** A line longer than SUMMARY_LINE_MAX once written out (nothing is cut). */
  | { status: 'too_long' }
  /** A label that is not one of the records'. */
  | { status: 'unknown_reference' }
  /** A number, date, time, amount, sign or scale in Claude's own words (it is not kept). */
  | { status: 'number_in_text' };

/**
 * Checks Claude's summary and writes it out: each line plain text on one line, empty lines
 * dropped, at most SUMMARY_MAX_LINES. Claude's own words hold no number, date, time, period,
 * amount, currency, sign or scale (no digit of any script, no such word, no such symbol, in a
 * name too); each label becomes its record's text, so every number shown is a
 * record's own, with its own record. A dash right before a label is refused too (it could read
 * as a minus), and so is a letter or digit glued to either side of one.
 */
export function checkSummary(answer: CounterpartySummaryAnswer, facts: SummaryFacts): SummaryCheck {
  const lines = answer.lines
    .map((line) =>
      line
        .normalize('NFKC')
        .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
        .replace(/^\s*(?:[*•·-]|\d{1,2}[.)])\s+/u, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line !== '')
    .slice(0, SUMMARY_MAX_LINES);
  if (lines.length === 0) return { status: 'empty' };
  const written: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(REFERENCE)) {
      if (!Object.hasOwn(facts.values, match[1] ?? '')) return { status: 'unknown_reference' };
      const before = line.slice(0, match.index);
      const after = line.slice(match.index + match[0].length);
      if (/[\p{L}\p{N}]$|[-‐‑‒–—]\s*$/u.test(before) || /^[\p{L}\p{N}]/u.test(after)) {
        return { status: 'number_in_text' };
      }
    }
    // Claude's own words: the line without its labels. No name is exempt: a name holding such
    // a word is left out or referred to by its record's label.
    const own = line.replace(REFERENCE, ' ');
    if (/[[\]]/.test(own)) return { status: 'unknown_reference' };
    if (
      /\p{N}/u.test(own) ||
      REFUSED_WORDS.test(own) ||
      REFUSED_NAMES.test(own) ||
      REFUSED_SYMBOLS.test(own)
    ) {
      return { status: 'number_in_text' };
    }
    const out = line.replace(REFERENCE, (_, label: string) => facts.values[label] ?? '');
    if (out.length > SUMMARY_LINE_MAX) return { status: 'too_long' };
    written.push(out);
  }
  const summary = written.join('\n');
  if (summary.length > SUMMARY_MAX_LENGTH) return { status: 'too_long' };
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
