import { describe, expect, it } from 'vitest';

import { draftAge } from './emailAutoDrafts';

describe("draftAge (the owner's answer 30)", () => {
  const now = new Date('2026-11-12T18:00:00.000Z');

  it('says today, yesterday, then the days', () => {
    expect(draftAge('2026-11-12T10:00:00.000Z', now)).toBe('today');
    expect(draftAge('2026-11-11T12:00:00.000Z', now)).toBe('yesterday');
    expect(draftAge('2026-11-09T12:00:00.000Z', now)).toBe('3 days old');
  });

  it('counts Alberta calendar days across Alberta midnight (F-114-5c-R1-01)', () => {
    // 23:00 Alberta on the 11th is 05:00 UTC on the 12th; 01:00 Alberta on the 12th is 07:00 UTC.
    const afterMidnight = new Date('2026-11-12T07:00:00.000Z');
    expect(draftAge('2026-11-12T05:00:00.000Z', afterMidnight)).toBe('yesterday');
    // 00:30 and 23:30 Alberta on the same day: today, though 23 hours apart.
    expect(draftAge('2026-11-12T06:30:00.000Z', new Date('2026-11-13T05:30:00.000Z'))).toBe(
      'today',
    );
    // UTC midnight is not Alberta midnight: 17:00 and 19:00 Alberta on one day.
    expect(draftAge('2026-11-11T23:00:00.000Z', new Date('2026-11-12T01:00:00.000Z'))).toBe(
      'today',
    );
  });

  it('says today for a date it cannot read or one ahead of the clock', () => {
    expect(draftAge('not a date', now)).toBe('today');
    expect(draftAge('2026-11-13T12:00:00.000Z', now)).toBe('today');
  });
});
