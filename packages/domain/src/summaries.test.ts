import { describe, expect, it } from 'vitest';

import {
  checkSummary,
  SUMMARY_LINE_MAX,
  SUMMARY_PLAIN_WORDS,
  type SummaryFacts,
} from './summaries';

// Synthetic records only.
const FACTS: SummaryFacts = {
  values: {
    Q1: 'bid (they buy) Flaxseed at CAD 725.00/MT, up to 1,500 MT, Delivered Synthetic Town, AB, indicative, until Fri 6 Nov 2026, 4:00 pm MT',
    Q2: 'offer (they sell) Canola at CAD 690.00/MT, up to 200 MT, FOB Synthetic Town, AB, firm, until Fri 6 Nov 2026, 4:00 pm MT',
    F1: '"Send the bid sheet", due Thu 5 Nov 2026, 9:00 am MT (overdue), for Tess Trader',
    H1: 'Call with Pat Christmas, Thu 5 Nov 2026, 9:05 am MT, logged by Tess Trader',
    P1: 'Pat Christmas (contact, Merchandiser, main contact)',
    drafts: '2 drafts from calls to review',
    tonnes: 'about 1,500 tonnes a year',
  },
};

const check = (...lines: string[]) => checkSummary({ lines }, FACTS);

describe('checkSummary', () => {
  it("writes each record's own text in place of its label", () => {
    expect(
      check(
        '- Latest: [H1]. Contact: [P1], who wants flaxseed and asked for the bid sheet.',
        '',
        'Live: [Q1] and [Q2].',
        'Waiting on GSS: [F1]; [drafts].',
      ),
    ).toEqual({
      status: 'ok',
      summary: [
        `Latest: ${FACTS.values.H1 ?? ''}. Contact: ${FACTS.values.P1 ?? ''}, who wants flaxseed and asked for the bid sheet.`,
        `Live: ${FACTS.values.Q1 ?? ''} and ${FACTS.values.Q2 ?? ''}.`,
        `Waiting on GSS: ${FACTS.values.F1 ?? ''}; ${FACTS.values.drafts ?? ''}.`,
      ].join('\n'),
    });
  });

  it('refuses a label that is not a record', () => {
    expect(check('Live: [Q3].')).toEqual({ status: 'unknown_reference' });
    expect(check('Live: [Q1')).toEqual({ status: 'unknown_reference' });
  });

  // Codex's reviews of f6d3296, 3403497, 3a7617c and 2f23d4b.
  it.each([
    ['a word before a label', 'Capacity is [tonnes].'],
    ['a sign word before a label', 'Basis minus [Q1].'],
    ['a dash before a label', 'Basis -[Q1].'],
    ['a symbol before a label', 'Capacity: ➖[tonnes].'],
    ['another symbol before a label', 'Capacity: ∓[tonnes].'],
    ['a scale after a label', 'Live: [Q1] million.'],
    ['a letter glued to a label', 'Live: [Q1]k.'],
    ['a percent after a label', 'Live: [Q1]%.'],
    ['a preposition before a label', 'Delivery before [F1].'],
  ])('refuses %s', (_, line) => {
    expect(check(line)).toEqual({ status: 'label_not_alone' });
  });

  it.each([
    ['digits', 'Live bid CAD seven per bushel.', 'unknown_word'],
    ['digits', 'Wants 12 tonnes.', 'number_in_text'],
    ['a leading decimal point', 'Offer at .50 a bushel.', 'number_in_text'],
    ['a minus', 'Bid at −725.', 'number_in_text'],
    ['a dash and a parenthesis before a label', 'Capacity: - ([tonnes]).', 'number_in_text'],
    ['a plus', 'Bid at +725.', 'number_in_text'],
    ['digits of another script', 'Bid at ٩٩٩٩.', 'number_in_text'],
    ['a Roman numeral', 'Supply: Ⅾ t.', 'number_in_text'],
    ['a fraction', 'Wants ½ tonne.', 'number_in_text'],
    ['an em dash', 'Live — the company.', 'number_in_text'],
    ['a currency symbol', 'Bid at $ nothing.', 'number_in_text'],
    ['a contraction fragment for a tonne', 'Supply is a t.', 'unknown_word'],
    ['a contraction fragment for a second', 'Wait a s.', 'unknown_word'],
    ['a possessive', 'The company has the contact for Pat.', 'unknown_word'],
    ['a measure hidden in a word form', 'The site is a ha.', 'unknown_word'],
    ['another measure from a word form', 'Delivery is a meter from the site.', 'unknown_word'],
    ['a name turned into a deadline', 'Delivery before Christmas.', 'unknown_word'],
    ['a name turned into money', 'Price is a rand.', 'unknown_word'],
    ['a number word', 'Bid at nine hundred.', 'unknown_word'],
    ['a fraction word', 'Wants half a tonne.', 'unknown_word'],
    ['nought', 'Price is nought.', 'unknown_word'],
    ['a period', 'Deliveries are weekly.', 'unknown_word'],
    ['a time of day', 'Call at midday.', 'unknown_word'],
    ['a month', 'Delivery is due in may.', 'unknown_word'],
    ['a season', 'Delivery in spring.', 'unknown_word'],
    ['a relative day', 'Call back tomorrow.', 'unknown_word'],
    ['a coin', 'Price is a fiver.', 'unknown_word'],
    ['a currency name', 'Price is a euro.', 'unknown_word'],
    ['a fraction of a measure', 'Quantity is a millionth.', 'unknown_word'],
    ['a count', 'Several calls.', 'unknown_word'],
    ['a word form not listed', 'The company is wanting flaxseed.', 'unknown_word'],
    ['a century', 'Price for a century.', 'unknown_word'],
  ])('refuses %s in its own words', (_, line, status) => {
    expect(check(line)).toEqual({ status });
  });

  it('accepts every word Claude is offered, and only single letter a', () => {
    const refused = SUMMARY_PLAIN_WORDS.filter(
      (word) => check(`Contact: [P1]. The company ${word}.`).status !== 'ok',
    );
    expect(refused).toEqual([]);
    expect(SUMMARY_PLAIN_WORDS.filter((word) => word.length === 1)).toEqual(['a']);
  });

  it('keeps at most six lines, and nothing with a line too long once written out', () => {
    expect(check('The\ncompany', 'Live', 'Open', 'Waiting', 'Pending', 'New', 'Firm')).toEqual({
      status: 'ok',
      summary: 'The company\nLive\nOpen\nWaiting\nPending\nNew',
    });
    expect(check(`${'the '.repeat(Math.ceil(SUMMARY_LINE_MAX / 4) - 30)}company: [Q1]`)).toEqual({
      status: 'too_long',
    });
  });

  it('says when there is nothing to keep', () => {
    expect(check('  ', '')).toEqual({ status: 'empty' });
  });
});
