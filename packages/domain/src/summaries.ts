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
  /** The records as given to Claude: the words Claude may use besides PLAIN_WORDS. */
  records: string;
}

/** A label in Claude's text: [Q1], [F2], [drafts]. */
const REFERENCE = /\[([A-Za-z]+\d*)\]/g;

/**
 * Words that say a number, an amount, a measure, money, a sign, a date, a time or a period:
 * never in Claude's own words, even when the records hold them (the labels carry those).
 * Lower case; a word is refused when it or any of its plain forms (stems) is one.
 */
const REFUSED_WORDS = new Set(
  [
    // Numbers, fractions, multiples and scales.
    'zero nil one two three four five six seven eight nine ten eleven twelve thirteen fourteen',
    'fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty',
    'ninety hundred thousand million billion trillion lakh crore mn bn mm k m b grand dozen',
    'score gross couple pair single double triple quadruple twice thrice half halves quarter',
    'third percent per pct cent hundredth thousandth millionth billionth fraction',
    'first second fourth fifth sixth seventh eighth ninth tenth eleventh twelfth twentieth',
    'thirtieth once',
    // Signs and comparisons.
    'minus plus negative positive',
    // Money.
    'cad usd dollar buck loonie toonie euro pound yen peso penny pennies nickel dime fiver',
    'tenner quid',
    // Measures.
    'tonne ton mt st bushel bu cwt hundredweight lb lbs kg kilo kilogram gram litre liter',
    'gallon acre hectare load truckload carload railcar car',
    // Dates, times and periods.
    'today tonight tomorrow yesterday day daily week weekly weekend fortnight fortnightly month',
    'monthly year yearly annual annually quarterly hour hourly minute noon midday midnight',
    'morning afternoon evening night nightly dawn dusk am pm overdue expire expired expiring',
    'monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs',
    'fri sat sun january february march april may june july august september october november',
    'december jan feb mar apr jun jul aug sep sept oct nov dec',
  ]
    .join(' ')
    .split(' '),
);

/**
 * Plain everyday words Claude may use besides the words of the records: no number, measure,
 * money, date, time or period among them.
 */
const PLAIN_WORDS = new Set(
  [
    // Articles, pronouns and other small words.
    'a an the this that these those it its they them their there here he him his she her we us',
    'our you your who whom whose which what when where why how s t d ll re ve',
    'some any all both each every no not none more most less least few several many other',
    'another such same only also just still yet again already even either neither else',
    // Prepositions and conjunctions.
    'of in on at by for from with without about to into onto over under up down out off',
    'through after before since until near via as like than between among against within',
    'along across around and or but nor so because if while though although whether then',
    // Verbs.
    'is are was were be been being has have had do does did done will would can could should',
    'shall might must want ask say said tell told call send sent agree wait review discuss',
    'confirm plan follow need note mention offer bid buy bought sell sold quote talk speak',
    'spoke reach leave left return check expect hope look keep kept give gave get got take took',
    'make made come came go went see saw hear heard reply respond answer request share update',
    'change add remove log enter withdraw revise open close finish complete schedule arrange',
    'book ship deliver pick move hold held accept decline refuse prefer interest think know',
    'knew mean meant seem become became show find found let put set try use work start stop',
    // Nouns.
    'company counterparty contact call note draft review bid offer price quantity delivery',
    'record detail location site person people team gss trade trading deal grain crop sample',
    'contract sheet message voicemail email phone information info question answer interest',
    'buyer seller broker carrier freight rate lane truck rail market supply demand quality',
    'grade spec specification term condition basis account order business history change',
    'nothing something anything everything anyone someone everyone',
    // Adjectives and adverbs.
    'new latest last recent recently lately earlier later soon now currently live open pending',
    'waiting outstanding firm indicative possible interested keen ready available unavailable',
    'unclear clear little much well back yes good bad same main further very too quite',
    'sure unsure busy direct directly regarding concerning awaiting await potential including',
    'include next step action status response feedback summary pricing',
  ]
    .join(' ')
    .split(' '),
);

/** The plain words, for Claude's instructions. */
export const SUMMARY_PLAIN_WORDS: readonly string[] = [...PLAIN_WORDS]
  .filter((word) => word.length > 2)
  .sort();

/** A word's plain forms: wants → want, asked → ask, planned → plan, making → make, offers. */
function stems(word: string): string[] {
  const forms = [word];
  const add = (form: string) => {
    if (form.length > 0) forms.push(form);
  };
  if (word.endsWith('ies') || word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s')) add(word.slice(0, -1));
  if (word.endsWith('ly')) add(word.slice(0, -2));
  for (const ending of ['ed', 'ing', 'er', 'est']) {
    if (!word.endsWith(ending)) continue;
    const base = word.slice(0, -ending.length);
    add(base);
    add(`${base}e`);
    if (base.length > 1 && base.at(-1) === base.at(-2)) add(base.slice(0, -1));
  }
  if (word.endsWith('d')) add(word.slice(0, -1));
  return forms;
}

/** The words of a text, in lower case. */
function wordsOf(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/\p{L}+/gu) ?? []
  );
}

/**
 * The only characters of Claude's own words: letters, spaces and plain punctuation. No digit,
 * symbol or sign of any kind; a hyphen only inside a word (follow-up).
 */
const PLAIN_CHARACTERS = /^[\p{L} .,;:!?'’"“”()/&-]*$/u;
const LOOSE_HYPHEN = /(?<!\p{L})-|-(?!\p{L})/u;

export type SummaryCheck =
  | { status: 'ok'; summary: string }
  | { status: 'empty' }
  /** A line longer than SUMMARY_LINE_MAX once written out (nothing is cut). */
  | { status: 'too_long' }
  /** A label that is not one of the records'. */
  | { status: 'unknown_reference' }
  /** A number, date, time, period, amount, measure, money, sign or scale in Claude's own words. */
  | { status: 'number_in_text' }
  /** A word of Claude's own that is neither a plain everyday word nor one of the records'. */
  | { status: 'unknown_word' };

/**
 * Checks Claude's summary and writes it out: each line plain text on one line, empty lines
 * dropped, at most SUMMARY_MAX_LINES. Claude's own words are only letters, spaces and plain
 * punctuation (no digit, symbol or sign; a hyphen only inside a word), and each of them is a
 * plain everyday word (PLAIN_WORDS) or a word of the records, and never one of REFUSED_WORDS,
 * in any of its forms, even when the records hold it. Each label becomes its record's text, so
 * every number, date and time shown is a record's own, with its own record. A dash right before
 * a label, or a letter or digit glued to either side of one, is refused too.
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
  // The records' words, in each of their plain forms.
  const allowed = new Set(wordsOf(facts.records).flatMap(stems));
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
    if (!PLAIN_CHARACTERS.test(own) || LOOSE_HYPHEN.test(own)) return { status: 'number_in_text' };
    const words = wordsOf(own).map(stems);
    if (words.some((forms) => forms.some((form) => REFUSED_WORDS.has(form)))) {
      return { status: 'number_in_text' };
    }
    if (words.some((forms) => !forms.some((form) => PLAIN_WORDS.has(form) || allowed.has(form)))) {
      return { status: 'unknown_word' };
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
