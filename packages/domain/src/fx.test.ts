import { describe, expect, it } from 'vitest';

import { FX_STALE_AFTER_DAYS, fxRateAgeDays, isFxRateStale, ottawaDate } from './fx';

describe('ottawaDate', () => {
  it.each([
    ['2026-10-29T03:59:00Z', '2026-10-28', 'before midnight in Ottawa (EDT, UTC-4)'],
    ['2026-10-29T04:00:00Z', '2026-10-29', 'at midnight in Ottawa (EDT)'],
    ['2026-12-01T04:30:00Z', '2026-11-30', 'before midnight in Ottawa (EST, UTC-5)'],
    ['2026-12-01T05:00:00Z', '2026-12-01', 'at midnight in Ottawa (EST)'],
    ['2026-03-08T07:30:00Z', '2026-03-08', 'on the morning clocks go forward'],
  ])('%s is %s, %s', (instant, date) => {
    expect(ottawaDate(new Date(instant))).toBe(date);
  });
});

describe('fxRateAgeDays and isFxRateStale', () => {
  it('waits four calendar days, so a Friday rate lasts the weekend and Monday holiday', () => {
    expect(FX_STALE_AFTER_DAYS).toBe(4);
    // Friday 23 October 2026's rate, read in the evening in Ottawa (UTC-4).
    const friday = '2026-10-23';
    expect(fxRateAgeDays(friday, new Date('2026-10-23T22:00:00Z'))).toBe(0);
    expect(isFxRateStale(friday, new Date('2026-10-26T22:00:00Z'))).toBe(false); // Monday
    expect(isFxRateStale(friday, new Date('2026-10-27T22:00:00Z'))).toBe(false); // Tuesday
    expect(fxRateAgeDays(friday, new Date('2026-10-27T22:00:00Z'))).toBe(4);
    expect(isFxRateStale(friday, new Date('2026-10-28T04:00:00Z'))).toBe(true); // Wednesday 00:00
    expect(fxRateAgeDays(friday, new Date('2026-10-28T04:00:00Z'))).toBe(5);
  });

  it('counts days in Ottawa, not UTC', () => {
    // 03:30 UTC on Wednesday is still Tuesday evening in Ottawa: four days, not stale.
    expect(isFxRateStale('2026-10-23', new Date('2026-10-28T03:30:00Z'))).toBe(false);
  });

  it('counts across a change of month and of the clocks', () => {
    expect(fxRateAgeDays('2026-10-30', new Date('2026-11-03T17:00:00Z'))).toBe(4);
    expect(fxRateAgeDays('2026-10-30', new Date('2026-11-04T17:00:00Z'))).toBe(5);
  });

  it('refuses a malformed date rather than guessing', () => {
    expect(() => fxRateAgeDays('28/10/2026', new Date())).toThrow('Not a date');
    expect(() => fxRateAgeDays('2026-13-45', new Date())).toThrow('Not a date');
    expect(() => fxRateAgeDays('2026-02-30', new Date())).toThrow('Not a date');
  });
});
