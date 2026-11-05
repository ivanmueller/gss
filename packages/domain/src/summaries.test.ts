import { describe, expect, it } from 'vitest';

import { checkSummary, numbersIn, SUMMARY_LINE_MAX } from './summaries';

// Synthetic records only.
const RECORDS = [
  'Bid: Flaxseed, CAD 725.00 per MT, 1,500 MT, delivered Synthetic Town, valid until Fri 6 Nov 2026, 4:00 pm MT.',
  'Call with Pat Buyer, Thu 5 Nov 2026, 9:05 am MT: wants November delivery.',
].join('\n');

describe('numbersIn', () => {
  it('reads each number in one form', () => {
    expect(numbersIn('CAD 725.00, 1,500 MT, 9:05 am, 0.50')).toEqual([
      '725',
      '1500',
      '9',
      '5',
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

  it('keeps at most six one-line lines, cut at a word when long', () => {
    const result = checkSummary(
      { lines: ['a\nb', 'two', 'three', 'four', 'five', 'six', 'seven', 'word '.repeat(80)] },
      RECORDS,
    );
    expect(result).toEqual({ status: 'ok', summary: 'a b\ntwo\nthree\nfour\nfive\nsix' });
    const long = checkSummary({ lines: ['word '.repeat(80)] }, RECORDS);
    expect(long.status === 'ok' && long.summary.length <= SUMMARY_LINE_MAX).toBe(true);
    expect(long.status === 'ok' && long.summary.endsWith('word…')).toBe(true);
  });

  it('says when there is nothing to keep', () => {
    expect(checkSummary({ lines: ['  ', ''] }, RECORDS)).toEqual({ status: 'empty' });
  });
});
