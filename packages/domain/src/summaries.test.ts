import { describe, expect, it } from 'vitest';

import { checkSummary, numbersIn, SUMMARY_LINE_MAX } from './summaries';

// Synthetic records only.
const RECORDS = [
  'Bid: Flaxseed, CAD 725.00 per MT, 1,500 MT, delivered Synthetic Town, valid until Fri 6 Nov 2026, 4:00 pm MT.',
  'Call with Pat Buyer, Thu 5 Nov 2026, 9:05 am MT: wants November delivery.',
].join('\n');

describe('numbersIn', () => {
  it('reads each number in one form, dates and times first', () => {
    expect(numbersIn('CAD 725.00, 1,500 MT, 9:05 am, 0.50, −3, .5')).toEqual([
      '9',
      '5',
      '725',
      '1500',
      '0.5',
      '-3',
      '0.5',
    ]);
  });
});

describe('checkSummary', () => {
  it('keeps plain lines whose numbers are in the records, however they are written', () => {
    expect(
      checkSummary(
        { lines: ['- Bids flaxseed at $725/MT for 1500 MT.', '', '• Called 5 Nov at 9:05 am.'] },
        RECORDS,
      ),
    ).toEqual({
      status: 'ok',
      summary: 'Bids flaxseed at $725/MT for 1500 MT.\nCalled 5 Nov at 9:05 am.',
    });
  });

  it('refuses a number not in the records', () => {
    expect(checkSummary({ lines: ['Bids flaxseed at $730/MT.'] }, RECORDS)).toEqual({
      status: 'unsupported_number',
    });
    expect(checkSummary({ lines: ['About 1,600 MT a year.'] }, RECORDS)).toEqual({
      status: 'unsupported_number',
    });
    expect(checkSummary({ lines: ['Bids at 725.5.'] }, RECORDS)).toEqual({
      status: 'unsupported_number',
    });
  });

  it('lets small counts through', () => {
    expect(checkSummary({ lines: ['3 calls this month, 2 follow-ups open.'] }, RECORDS)).toEqual({
      status: 'ok',
      summary: '3 calls this month, 2 follow-ups open.',
    });
  });

  it('keeps at most six one-line lines, and nothing with a line too long rather than cut it', () => {
    expect(
      checkSummary({ lines: ['a\nb', 'two', 'three', 'four', 'five', 'six', 'seven'] }, RECORDS),
    ).toEqual({ status: 'ok', summary: 'a b\ntwo\nthree\nfour\nfive\nsix' });
    expect(checkSummary({ lines: ['word '.repeat(SUMMARY_LINE_MAX / 4)] }, RECORDS)).toEqual({
      status: 'too_long',
    });
  });

  // Codex's review of f6d3296, findings 2 and 3.
  it.each([
    ['an invented price under the count limit', 'Live bid CAD 7 per bushel.', 'CAD 725 per tonne.'],
    ['an invented quantity under the count limit', 'Wants 12 tonnes.', 'Wants 1,500 tonnes.'],
    ['a leading decimal point', 'Offer at .50 a bushel.', 'Offer at 50.00 a bushel.'],
    ['a sign the records do not have', 'Bid at −725.', 'Bid at 725.'],
    ['a minus sign', 'Basis -725 under.', 'Bid at 725.'],
    ['digits other than 0 to 9', 'Bid at ٩٩٩٩.', 'Bid at 725.'],
    ['a number in words', 'Bid at nine hundred.', 'Bid at 725.'],
    ['a scale word', 'Bid at 725 million.', 'Bid at 725.'],
    ['a scale letter', 'Bid at 725k.', 'Bid at 725.'],
    ['a small number in words for an amount', 'Bid at seven per bushel.', 'Bid at 725.'],
    ['a currency before a small number in words', 'Bid at CAD five.', 'Bid at 725.'],
    ['a day not in the records', 'Called on 7 Nov.', 'Thu 5 Nov 2026, 9:05 am MT. 7 tonnes.'],
    ['a time not in the records', 'Called at 8:30 am.', 'Thu 5 Nov 2026, 9:05 am MT. 8 and 30 MT.'],
  ])('refuses %s', (_, summary, records) => {
    expect(checkSummary({ lines: [summary] }, records)).toEqual({ status: 'unsupported_number' });
  });

  it('reads a sign only where it is one: not in UTC-6 or a range', () => {
    expect(
      checkSummary({ lines: ['Bids 700-725 delivered, UTC-6.'] }, 'Bid 700 to 725 at UTC 6.'),
    ).toEqual({ status: 'ok', summary: 'Bids 700-725 delivered, UTC-6.' });
  });

  it('says when there is nothing to keep', () => {
    expect(checkSummary({ lines: ['  ', ''] }, RECORDS)).toEqual({ status: 'empty' });
  });
});
