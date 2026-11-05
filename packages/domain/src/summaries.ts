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
 * What the summary may refer to: each record's label (Q1, F1, H1, D1, C1, P1, buys, sells,
 * drafts, tonnes, organic) with the text the Worker writes in its place, every number, date,
 * time and name in it exactly as in the records.
 */
export interface SummaryFacts {
  values: Readonly<Record<string, string>>;
}

/** A label in Claude's text: [Q1], [F2], [drafts]. */
const REFERENCE = /\[([A-Za-z]+\d*)\]/g;

/**
 * Every word Claude may write itself, exactly as listed (no other forms): everyday words with no
 * number, measure, money, unit, date, season, time or period among them, and no single letter
 * but "a". Names, amounts, dates and times come only from the labels (Codex's reviews of
 * 3a7617c and 2f23d4b: refused words, word forms and words borrowed from the records could
 * always be turned into one).
 */
const PLAIN_WORDS = new Set(
  [
    // Small words.
    'a an the this that these those it its they them their there here he him his she her we',
    'our you your who which what when where why how not no nothing something anything',
    'everything anyone someone everyone some any all each every other another such also',
    'either neither else only just still yet again already',
    // Prepositions and conjunctions.
    'of in on at by for from with without about to into through after before via as like',
    'between among within along across around and or but nor so because if though although',
    'whether then',
    // Verbs, each form listed.
    'is are was were be been being has have had do does did will would could should might must',
    'want wants wanted ask asks asked say says said tell tells told call calls called calling',
    'send sends sent agree agrees agreed wait waits waiting waited review reviews reviewed',
    'discuss discussed confirm confirms confirmed plan plans planned follow follows followed',
    'need needs needed note noted mention mentioned offer offered bid buy buys bought sell sells',
    'sold quote quoted talk talked speak spoke reach reached leave left return returned check',
    'checked expect expects expected hope hopes look looks looking keep kept give gave get gets',
    'got take took make made come came go goes went see saw hear heard reply replied respond',
    'responded answer answered request requested update updated change changed add added remove',
    'removed log logged enter entered withdraw withdrew withdrawn revise revised open opened',
    'close closed finish finished complete completed arrange arranged schedule scheduled ship',
    'shipped deliver delivered accept accepted decline declined refuse refused prefer prefers',
    'preferred think thinks know knows seem seems show shows find found try tried use used work',
    'works start started stop stopped',
    // Nouns.
    'company counterparty contact contacts follow-up follow-ups draft drafts review reviews bids',
    'offers price prices pricing quantity delivery deliveries record records detail details',
    'location locations site sites person people team gss trade trading deal deals grain grains',
    'sample samples contract contracts sheet sheets message messages voicemail voicemails email',
    'emails phone information question questions answers interest buyer buyers seller sellers',
    'broker brokers carrier carriers freight lane lanes market markets supply demand quality',
    'grade grades spec specs specification term terms condition conditions basis account order',
    'orders business history changes updates calls notes step steps action actions status',
    'response feedback summary',
    // Commodities (no season among them).
    'canola flaxseed flax peas lentils chickpeas faba beans wheat durum barley malt oats rye',
    'corn soybeans mustard seed canary sunflower feed yellow green red organic',
    // Adjectives and adverbs.
    'new latest live open pending waiting outstanding firm indicative possible interested keen ready',
    'available unavailable unclear clear good bad same main further very too quite sure unsure',
    'busy direct directly regarding concerning awaiting potential including',
  ]
    .join(' ')
    .split(' '),
);

/** The plain words, for Claude's instructions. */
export const SUMMARY_PLAIN_WORDS: readonly string[] = [...PLAIN_WORDS].sort();

/**
 * The only characters of Claude's own words: ASCII letters, spaces, plain punctuation and
 * curly quotes. No digit, symbol or sign of any kind; a hyphen only inside a word (follow-up).
 */
const PLAIN_CHARACTERS = /^[A-Za-z .,;:!?'"()&’“”-]*$/;
const LOOSE_HYPHEN = /(?<![A-Za-z])-|-(?![A-Za-z])/;
/** What may come right before a label (start of line, punctuation, and, or) and right after. */
const BEFORE_LABEL = /(?:^|[.,;:(]|\band|\bor)\s*$/i;
const AFTER_LABEL = /^\s*(?:$|[.,;:)!?]|and\b|or\b)/i;

export type SummaryCheck =
  | { status: 'ok'; summary: string }
  | { status: 'empty' }
  /** A line longer than SUMMARY_LINE_MAX once written out (nothing is cut). */
  | { status: 'too_long' }
  /** A label that is not one of the records'. */
  | { status: 'unknown_reference' }
  /** A label not standing on its own: a word, sign or symbol right before or after it. */
  | { status: 'label_not_alone' }
  /** A character other than ASCII letters, spaces and plain punctuation in Claude's own words. */
  | { status: 'number_in_text' }
  /** A word of Claude's own that is not, exactly, one of SUMMARY_PLAIN_WORDS. */
  | { status: 'unknown_word' };

/**
 * Checks Claude's summary and writes it out: each line plain text on one line, empty lines
 * dropped, at most SUMMARY_MAX_LINES. Claude's own words are ASCII letters, spaces and plain
 * punctuation only, a hyphen only inside a word, and each word exactly one of
 * SUMMARY_PLAIN_WORDS: no other form, no name, no word of the records. Each label stands on its
 * own (after the start of the line, punctuation, "and" or "or"; before punctuation, "and", "or"
 * or the end), so no word or sign changes what it says, and becomes its record's own text: every
 * number, date, time and name shown is a record's own, with its own record.
 */
export function checkSummary(answer: CounterpartySummaryAnswer, facts: SummaryFacts): SummaryCheck {
  const lines = answer.lines
    .map((line) =>
      line
        .replace(/[\t\n\r ]+/g, ' ')
        .replace(/^ ?(?:[*-]|\d{1,2}[.)]) /, '')
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
      if (!BEFORE_LABEL.test(before) || !AFTER_LABEL.test(after)) {
        return { status: 'label_not_alone' };
      }
    }
    const own = line.replace(REFERENCE, ' ');
    if (/[[\]]/.test(own)) return { status: 'unknown_reference' };
    if (!PLAIN_CHARACTERS.test(own) || LOOSE_HYPHEN.test(own)) return { status: 'number_in_text' };
    const words = own.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
    if (words.some((word) => !PLAIN_WORDS.has(word))) return { status: 'unknown_word' };
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
