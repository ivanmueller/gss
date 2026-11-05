import { z } from 'zod';

// Claude's summary of a company at the top of its page (the owner's request and answers of
// 2026-11-05, docs/DECISIONS.md): a few short lines from GSS's own records, for reading only.
// The Worker checks the answer before keeping it: plain lines, a few of them, and every number
// in them found in the records Claude was given, so a summary never shows a price, quantity or
// date that is not in the records.

/** Lines in a summary, at most. */
export const SUMMARY_MAX_LINES = 6;
/** Characters in a line, at most. */
export const SUMMARY_LINE_MAX = 240;

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

/** Small whole numbers a summary may use without the records holding them (counts, "2 calls"). */
const SMALL_COUNT_MAX = 12;

/** A number as written, in one form: digit-group commas dropped, trailing decimal zeros too. */
function canonicalNumber(text: string): string {
  const plain = text.replace(/,/g, '');
  if (!plain.includes('.')) return plain.replace(/^0+(?=\d)/, '');
  const [whole = '', fraction = ''] = plain.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const wholePart = whole.replace(/^0+(?=\d)/, '') || '0';
  return trimmed === '' ? wholePart : `${wholePart}.${trimmed}`;
}

/** Every number in a text, in canonical form ("1,500.00" → "1500", "9:05" → "9", "05"→"5"). */
export function numbersIn(text: string): string[] {
  const found = text.normalize('NFKC').match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];
  return found.map(canonicalNumber);
}

export type SummaryCheck =
  | { status: 'ok'; summary: string }
  | { status: 'empty' }
  /** A number in the summary that is not in the records (it is not kept). */
  | { status: 'unsupported_number' };

/**
 * Checks Claude's summary against the records it was given (`records`, the message sent): each
 * line plain text on one line, empty lines dropped, at most SUMMARY_MAX_LINES lines of at most
 * SUMMARY_LINE_MAX characters (longer ones cut at a word), and every number in it found in the
 * records, except small whole counts.
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
    .slice(0, SUMMARY_MAX_LINES)
    .map((line) => {
      if (line.length <= SUMMARY_LINE_MAX) return line;
      const cut = line.slice(0, SUMMARY_LINE_MAX - 1);
      const space = cut.lastIndexOf(' ');
      return `${(space > SUMMARY_LINE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
    });
  if (lines.length === 0) return { status: 'empty' };
  const known = new Set(numbersIn(records));
  const summary = lines.join('\n');
  for (const number of numbersIn(summary)) {
    const small = /^\d+$/.test(number) && Number(number) <= SMALL_COUNT_MAX;
    if (!small && !known.has(number)) return { status: 'unsupported_number' };
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
