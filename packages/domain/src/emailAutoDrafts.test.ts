import { describe, expect, it } from 'vitest';

import { draftAge } from './emailAutoDrafts';

describe("draftAge (the owner's answer 30)", () => {
  const now = new Date('2026-11-12T18:00:00.000Z');

  it('says today, yesterday, then the days', () => {
    expect(draftAge('2026-11-12T10:00:00.000Z', now)).toBe('today');
    expect(draftAge('2026-11-11T12:00:00.000Z', now)).toBe('yesterday');
    expect(draftAge('2026-11-09T12:00:00.000Z', now)).toBe('3 days old');
  });

  it('says today for a date it cannot read or one ahead of the clock', () => {
    expect(draftAge('not a date', now)).toBe('today');
    expect(draftAge('2026-11-13T12:00:00.000Z', now)).toBe('today');
  });
});
