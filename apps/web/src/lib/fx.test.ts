import type { FxQuote } from '@grain/domain';
import { describe, expect, it } from 'vitest';

import { ApiError } from './api';
import { bankOfCanadaRate, NO_RATE } from './fx';

// Synthetic rates only.
const rate = (overrides: Partial<FxQuote> = {}): FxQuote => ({
  base: 'USD',
  quote: 'CAD',
  rate: '1.3912',
  rateDate: '2026-10-23',
  source: 'bank_of_canada',
  series: 'FXUSDCAD',
  fetchedAt: '2026-10-23T22:15:03.000Z',
  ...overrides,
});
const ok = (rates: FxQuote[]) => ({ status: 'ok' as const, data: { rates } });
// Tuesday 27 October 2026, 18:00 in Ottawa.
const TUESDAY = new Date('2026-10-27T22:00:00Z');

describe('bankOfCanadaRate', () => {
  it("uses the latest day's rate exactly, labelled with its source and day", () => {
    const older = rate({ rate: '1.3800', rateDate: '2026-10-22' });
    expect(bankOfCanadaRate(ok([rate(), older]), TUESDAY)).toEqual({
      fx: { cadPerUsd: '1.3912', source: 'Bank of Canada, 23 Oct 2026' },
      noRate: NO_RATE,
    });
  });

  it('stops converting once the latest rate is more than four days old', () => {
    // Friday's rate is still used on Tuesday, and out of date from Wednesday in Ottawa.
    expect(bankOfCanadaRate(ok([rate()]), TUESDAY).fx).not.toBeNull();
    expect(bankOfCanadaRate(ok([rate()]), new Date('2026-10-28T04:00:00Z'))).toEqual({
      fx: null,
      noRate: {
        short: 'CAD/USD rate out of date',
        long: 'the latest CAD/USD rate (Bank of Canada, 23 Oct 2026) is out of date.',
      },
    });
  });

  it.each([
    ['no rate stored yet', ok([])],
    ['an answer without a list', { status: 'ok' as const, data: {} as { rates: FxQuote[] } }],
    ['a rate that is not plain decimal text', ok([rate({ rate: '1.39e0' })])],
    ['a malformed day', ok([rate({ rateDate: '2026-02-30' })])],
  ])('converts nothing with %s', (_, resource) => {
    const result = bankOfCanadaRate(resource, TUESDAY);
    expect(result.fx).toBeNull();
    expect(result.noRate.short).toBe('no CAD/USD rate');
  });

  it('says when the rate is loading or could not be loaded', () => {
    expect(bankOfCanadaRate({ status: 'loading' }, TUESDAY)).toEqual({
      fx: null,
      noRate: { short: 'CAD/USD rate loading', long: 'the CAD/USD rate is loading.' },
    });
    const error = new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.', null);
    expect(bankOfCanadaRate({ status: 'error', error }, TUESDAY).noRate.long).toBe(
      'the CAD/USD rate could not be loaded (The database is unavailable).',
    );
  });
});
