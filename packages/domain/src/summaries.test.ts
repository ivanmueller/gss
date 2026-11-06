import { describe, expect, it } from 'vitest';

import {
  checkSummary,
  COUNTERPARTY_SUMMARY_JSON_SCHEMA,
  counterpartySummaryAnswerSchema,
  SUMMARY_MAX_LENGTH,
  type CounterpartySummaryAnswer,
  type SummaryFacts,
} from './summaries';

// Synthetic records only.
const FACTS: SummaryFacts = {
  values: {
    Q1: 'bid (they buy) Flaxseed at CAD 725.00/MT, up to 1,500 MT, Delivered Synthetic Town, AB, indicative, until Fri 6 Nov 2026, 4:00 pm MT',
    Q2: 'offer (they sell) Canola at CAD 690.00/MT, up to 200 MT, FOB Synthetic Town, AB, firm, until Fri 6 Nov 2026, 4:00 pm MT',
    F1: '"Send the bid sheet", due Thu 5 Nov 2026, 9:00 am MT (overdue), for Tess Trader',
    H1: 'Call with Pat Buyer, Thu 5 Nov 2026, 9:05 am MT, logged by Tess Trader',
    N1: 'notes: "Wants more flaxseed."',
    P1: 'Pat Buyer (contact, Merchandiser, main contact)',
    drafts: '2 drafts from calls to review',
    tonnes: 'about 1,500 tonnes a year',
  },
};

const check = (...lines: CounterpartySummaryAnswer['lines']) => checkSummary({ lines }, FACTS);

describe('checkSummary', () => {
  it("writes each line as its topic's title and each record's own text: no word of Claude's", () => {
    expect(
      check(
        { topic: 'latest', labels: ['H1', 'N1'] },
        { topic: 'live', labels: ['Q1', 'Q2'] },
        { topic: 'waiting', labels: ['F1', 'drafts'] },
      ),
    ).toEqual({
      status: 'ok',
      summary: [
        `Latest contact: ${FACTS.values.H1 ?? ''}; ${FACTS.values.N1 ?? ''}.`,
        `Live bids and offers: ${FACTS.values.Q1 ?? ''}; ${FACTS.values.Q2 ?? ''}.`,
        `Waiting on GSS: ${FACTS.values.F1 ?? ''}; ${FACTS.values.drafts ?? ''}.`,
      ].join('\n'),
    });
  });

  it.each([
    ['a label that is not a record', [{ topic: 'live', labels: ['Q3'] }]],
    ['a label of a kind the topic does not take', [{ topic: 'live', labels: ['F1'] }]],
    ['a person under the wrong topic', [{ topic: 'latest', labels: ['P1'] }]],
    [
      'a record twice',
      [
        { topic: 'live', labels: ['Q1'] },
        { topic: 'live', labels: ['Q1'] },
      ],
    ],
    ['a label written with brackets', [{ topic: 'live', labels: ['[Q1]'] }]],
    ['a label with text around it', [{ topic: 'live', labels: ['Q1 million'] }]],
    ['a label with a sign', [{ topic: 'company', labels: ['-tonnes'] }]],
    ['a label with a decimal point', [{ topic: 'waiting', labels: ['.drafts'] }]],
    [
      'too many records under one line',
      [{ topic: 'live', labels: ['Q1', 'Q2', 'Q1', 'Q2', 'Q1'] }],
    ],
  ] satisfies [string, CounterpartySummaryAnswer['lines']][])('refuses %s', (_, lines) => {
    expect(check(...lines)).toEqual({ status: 'unknown_reference' });
  });

  it('keeps at most six lines, and nothing too long once written out', () => {
    const many = checkSummary(
      {
        lines: ['H1', 'N1', 'Q1', 'Q2', 'F1', 'drafts', 'P1'].map((label) => ({
          topic:
            label === 'P1'
              ? 'contacts'
              : label.startsWith('Q')
                ? 'live'
                : label === 'H1' || label === 'N1'
                  ? 'latest'
                  : 'waiting',
          labels: [label],
        })),
      },
      FACTS,
    );
    expect(many.status === 'ok' && many.summary.split('\n')).toHaveLength(6);
    const long = { values: { Q1: 'x'.repeat(SUMMARY_MAX_LENGTH) } };
    expect(checkSummary({ lines: [{ topic: 'live', labels: ['Q1'] }] }, long)).toEqual({
      status: 'too_long',
    });
  });

  it('says when there is nothing to keep', () => {
    expect(check()).toEqual({ status: 'empty' });
    expect(check({ topic: 'live', labels: [] })).toEqual({ status: 'empty' });
  });

  it('takes only the topics listed, and no free text anywhere in the answer', () => {
    expect(
      counterpartySummaryAnswerSchema.safeParse({ lines: [{ topic: 'notes', labels: ['N1'] }] })
        .success,
    ).toBe(false);
    expect(
      counterpartySummaryAnswerSchema.safeParse({
        lines: [{ topic: 'live', labels: ['Q1'], text: 'Price is a TRY.' }],
      }),
    ).toMatchObject({ success: true, data: { lines: [{ topic: 'live', labels: ['Q1'] }] } });
    expect(JSON.stringify(COUNTERPARTY_SUMMARY_JSON_SCHEMA)).not.toMatch(/anyOf|"text"/);
  });
});
