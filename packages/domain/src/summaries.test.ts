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
    F1: '"Send the bid sheet", due Thu 5 Nov 2026, 9:00 am MT (overdue), for Tess Trader',
    H1: 'Call with Pat Buyer, Thu 5 Nov 2026, 9:05 am MT',
    drafts: '2 drafts from calls to review',
    tonnes: 'about 1,500 tonnes a year',
  },
  records: [
    '[H1] Call with Pat Buyer, Thu 5 Nov 2026, 9:05 am MT. Notes: Pat wants flaxseed delivered weekly.',
    '[Q1] bid (they buy) Flaxseed at CAD 725.00/MT. [tonnes] about 1,500 tonnes a year.',
  ].join('\n'),
};

const check = (...lines: string[]) => checkSummary({ lines }, FACTS);

describe('checkSummary', () => {
  it("writes each record's own text in place of its label", () => {
    expect(
      check(
        '- Latest: [H1]. Pat wants more flaxseed and will call back.',
        '',
        '• Live: [Q1].',
        'Waiting on GSS: [F1]; [drafts].',
      ),
    ).toEqual({
      status: 'ok',
      summary: [
        'Latest: Call with Pat Buyer, Thu 5 Nov 2026, 9:05 am MT. Pat wants more flaxseed and will call back.',
        'Live: bid (they buy) Flaxseed at CAD 725.00/MT, up to 1,500 MT, Delivered Synthetic Town, AB, indicative, until Fri 6 Nov 2026, 4:00 pm MT.',
        'Waiting on GSS: "Send the bid sheet", due Thu 5 Nov 2026, 9:00 am MT (overdue), for Tess Trader; 2 drafts from calls to review.',
      ].join('\n'),
    });
  });

  it('refuses a label that is not a record', () => {
    expect(check('Live: [Q2].')).toEqual({ status: 'unknown_reference' });
    expect(check('Live: [Q1')).toEqual({ status: 'unknown_reference' });
  });

  // Codex's reviews of f6d3296 and 3403497: no number of Claude's own, however written.
  it.each([
    ['digits', 'Live bid CAD 7 per bushel.'],
    ['a quantity', 'Wants 12 tonnes.'],
    ['a leading decimal point', 'Offer at .50 a bushel.'],
    ['a sign', 'Bid at −725.'],
    ['a plus sign', 'Bid at +725.'],
    ['digits of another script', 'Bid at ٩٩٩٩.'],
    ['a fraction', 'Wants ½ tonne.'],
    ['an exponent', 'Wants 1e3 tonnes.'],
    ['a number in words', 'Bid at nine hundred.'],
    ['a small number in words', 'Wants two metric tonnes.'],
    ['a fraction in words', 'Wants half a tonne.'],
    ['a scale', 'Wants [Q1] million.'],
    ['a scale word on its own', 'About mn tonnes.'],
    ['a count', '2 calls this week.'],
    ['a currency word', 'Wants it in CAD.'],
    ['a currency symbol', 'Bid at $ [Q1].'],
    ['a sign word before a label', 'Basis minus [Q1].'],
    ['a dash before a label', 'Basis -[Q1].'],
    ['a dash and a space before a label', 'Basis – [Q1].'],
    ['a letter glued to a label', 'Bid [Q1]k.'],
    ['a digit glued to a label', 'Bid 7[Q1].'],
    ['a percent', 'Up [Q1] %.'],
    ['a date', 'Due on 7 Nov.'],
    ['a month', 'Wants November delivery.'],
    ['a short month name', 'Wants Dec delivery.'],
    ['May as a month', 'Wants May delivery.'],
    ['a day', 'Call back Friday.'],
    ['a relative day', 'Call back tomorrow.'],
    ['a period', 'Call back next week.'],
    ['a time of day', 'Call back this afternoon.'],
    ['overdue of its own', 'The follow-up is overdue.'],
    ['an ordinal', 'The first call went well.'],
    ['a number word in a name', 'Spoke with Five Star Grain.'],
    // Codex's review of 3a7617c.
    ['a dash before a parenthesis and a label', 'Capacity: - ([tonnes]).'],
    ['a minus symbol before a label', 'Capacity: ➖[tonnes].'],
    ['a minus-or-plus symbol before a label', 'Capacity: ∓[tonnes].'],
    ['an em dash', 'Capacity — [tonnes].'],
    ['a fraction of a measure', 'Available quantity is a millionth of a tonne.'],
    ['a coin word', 'Price is a fiver per tonne.'],
    ['a currency name', 'Price is a euro per tonne.'],
    ['a month in lower case', 'Delivery is due in may.'],
    ['a time of day synonym', 'Call at midday.'],
    ['a period word, even one in the records', 'Deliveries are weekly.'],
    ['a measure with an article', 'Pat wants a tonne.'],
    ['once', 'Pat called once.'],
  ])('refuses %s in its own words', (_, line) => {
    expect(check(line)).toEqual({ status: 'number_in_text' });
  });

  it('keeps plain words and words of the records, in their plain forms', () => {
    expect(check('Pat might call back about [Q1]; someone at the company will confirm.')).toEqual({
      status: 'ok',
      summary: `Pat might call back about ${FACTS.values.Q1 ?? ''}; someone at the company will confirm.`,
    });
    expect(check('Pat asked about delivering flaxseed; a follow-up was planned.')).toMatchObject({
      status: 'ok',
    });
  });

  it('accepts every plain word Claude is offered', () => {
    const refused = SUMMARY_PLAIN_WORDS.filter((word) => check(`Pat ${word}.`).status !== 'ok');
    expect(refused).toEqual([]);
  });

  it('refuses a word that is neither plain nor in the records', () => {
    expect(check('Pat is ecstatic about [Q1].')).toEqual({ status: 'unknown_word' });
  });

  it('keeps at most six lines, and nothing with a line too long once written out', () => {
    expect(check('Pat\ncalled', 'Live', 'Open', 'Waiting', 'Pending', 'New', 'Firm')).toEqual({
      status: 'ok',
      summary: 'Pat called\nLive\nOpen\nWaiting\nPending\nNew',
    });
    expect(check(`${'Pat '.repeat(SUMMARY_LINE_MAX / 4 - 30)}[Q1]`)).toEqual({
      status: 'too_long',
    });
  });

  it('says when there is nothing to keep', () => {
    expect(check('  ', '')).toEqual({ status: 'empty' });
  });
});
