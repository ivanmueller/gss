import { z } from 'zod';

// Claude's summary of a company at the top of its page (the owner's request and answers of
// 2026-11-05, docs/DECISIONS.md): a few lines from GSS's own records, for reading only.
//
// Claude writes no words of its own (Codex's reviews of f6d3296, 3403497, 3a7617c, 2f23d4b and
// fdb08ce: any free text, however its words were checked, could be turned into a number, a
// unit, money, a date or a name). Claude chooses what matters: for each line a topic from a
// fixed list and the labels of the records that belong under it. The Worker writes every word:
// the topic's fixed title, then each record's own text (a bid or offer whole, a follow-up with
// when it is due, a contact with when it happened and its own notes, whole), so everything shown
// is a record's own, with its own record.

/** Lines in a summary, at most. */
export const SUMMARY_MAX_LINES = 6;
/** Records under one line, at most. */
export const SUMMARY_MAX_LABELS = 4;
/** Characters in a summary, at most (the database keeps up to 2,000). */
export const SUMMARY_MAX_LENGTH = 2000;

/**
 * The topics a line may have, its fixed title, and the kinds of record that may go under it
 * (a label's kind is its letters: Q1 → Q).
 */
export const SUMMARY_TOPICS = {
  latest: { title: 'Latest contact', kinds: ['H'] },
  live: { title: 'Live bids and offers', kinds: ['Q'] },
  follow_ups: { title: 'Open follow-ups', kinds: ['F'] },
  waiting: { title: 'Waiting on GSS', kinds: ['F', 'drafts'] },
  earlier: { title: 'Earlier contact', kinds: ['H'] },
  done: { title: 'Follow-ups done', kinds: ['D'] },
  changes: { title: 'Recent changes', kinds: ['C'] },
  contacts: { title: 'Contacts', kinds: ['P'] },
  trade: { title: 'Buys and sells', kinds: ['buys', 'sells'] },
  company: { title: 'The company', kinds: ['tonnes', 'organic'] },
} as const satisfies Record<string, { title: string; kinds: readonly string[] }>;
export type SummaryTopic = keyof typeof SUMMARY_TOPICS;
const TOPIC_KEYS = Object.keys(SUMMARY_TOPICS) as [SummaryTopic, ...SummaryTopic[]];

/** The JSON shape Claude answers in (structured outputs): no optional or either-or fields. */
export const COUNTERPARTY_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string', enum: TOPIC_KEYS },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['topic', 'labels'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const;

export const counterpartySummaryAnswerSchema = z.object({
  lines: z
    .array(z.object({ topic: z.enum(TOPIC_KEYS), labels: z.array(z.string()).max(20) }))
    .max(20),
});
export type CounterpartySummaryAnswer = z.infer<typeof counterpartySummaryAnswerSchema>;

/**
 * What the summary may refer to: each record's label (Q1, F1, H1, D1, C1, P1, buys, sells,
 * drafts, tonnes, organic) with the record's own text, written by the Worker from the records.
 * H1 is the latest contact (the history is latest first); each contact's text holds its own
 * notes, so notes are never shown with another contact.
 */
export interface SummaryFacts {
  values: Readonly<Record<string, string>>;
}

export type SummaryCheck =
  | { status: 'ok'; summary: string }
  | { status: 'empty' }
  /** The summary is longer than SUMMARY_MAX_LENGTH once written out (nothing is cut). */
  | { status: 'too_long' }
  /** A label that is not one of the records', or of a kind its topic does not take. */
  | { status: 'unknown_reference' };

/** A label's kind: its letters (Q1 → Q, drafts → drafts). */
function kindOf(label: string): string {
  return label.replace(/\d+$/, '');
}

/**
 * Checks Claude's choice and writes the summary out: at most SUMMARY_MAX_LINES lines, each its
 * topic's fixed title and the own text of up to SUMMARY_MAX_LABELS records, each a record of
 * the records given and of a kind the topic takes, none twice. Claude writes no word of it.
 */
export function checkSummary(answer: CounterpartySummaryAnswer, facts: SummaryFacts): SummaryCheck {
  const lines = answer.lines.filter((line) => line.labels.length > 0).slice(0, SUMMARY_MAX_LINES);
  if (lines.length === 0) return { status: 'empty' };
  const used = new Set<string>();
  const written: string[] = [];
  for (const line of lines) {
    const topic = SUMMARY_TOPICS[line.topic];
    if (line.labels.length > SUMMARY_MAX_LABELS) return { status: 'unknown_reference' };
    const texts: string[] = [];
    // The latest contact is H1 (the history is latest first) and only H1; earlier ones are the
    // rest (Codex's review of 0a0d815, finding 1).
    if (line.topic === 'latest' && (line.labels.length !== 1 || line.labels[0] !== 'H1')) {
      return { status: 'unknown_reference' };
    }
    for (const label of line.labels) {
      const kinds: readonly string[] = topic.kinds;
      if (
        !Object.hasOwn(facts.values, label) ||
        !kinds.includes(kindOf(label)) ||
        (line.topic === 'earlier' && label === 'H1') ||
        used.has(label)
      ) {
        return { status: 'unknown_reference' };
      }
      used.add(label);
      texts.push(facts.values[label] ?? '');
    }
    written.push(`${topic.title}: ${texts.join('; ')}.`);
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
