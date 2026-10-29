import { describe, expect, it } from 'vitest';

import { centralDay, centralToUtc, formatCentral, utcToCentral } from './central';

describe('centralToUtc', () => {
  it('reads a wall-clock time in Central daylight time (UTC−5)', () => {
    expect(centralToUtc('2026-10-30T14:00')).toBe('2026-10-30T19:00:00.000Z');
  });

  it('reads a wall-clock time in Central standard time (UTC−6)', () => {
    expect(centralToUtc('2026-12-15T09:30')).toBe('2026-12-15T15:30:00.000Z');
  });

  it('takes the first of the two 1:30 am when clocks fall back', () => {
    expect(centralToUtc('2026-11-01T01:30')).toBe('2026-11-01T06:30:00.000Z');
    expect(centralToUtc('2026-11-01T03:00')).toBe('2026-11-01T09:00:00.000Z');
  });

  it('reads the skipped 2:30 am when clocks spring forward as 3:30 am', () => {
    expect(centralToUtc('2026-03-08T02:30')).toBe('2026-03-08T08:30:00.000Z');
    expect(utcToCentral('2026-03-08T08:30:00.000Z')).toBe('2026-03-08T03:30');
  });

  it('refuses what is not a wall-clock time', () => {
    for (const text of [
      '',
      '2026-10-30',
      '2026-10-30T25:00',
      '2026-02-30T10:00',
      '2026-10-30T14:00Z',
    ]) {
      expect(centralToUtc(text)).toBeNull();
    }
  });
});

describe('utcToCentral', () => {
  it('shows an instant as Central wall-clock time for a form', () => {
    expect(utcToCentral('2026-10-30T19:00:00.000Z')).toBe('2026-10-30T14:00');
    expect(utcToCentral('2026-12-15T15:30:00Z')).toBe('2026-12-15T09:30');
  });

  it('round-trips with centralToUtc across a year', () => {
    for (let day = 0; day < 366; day += 5) {
      const instant = new Date(Date.UTC(2026, 0, 1, 17, 45) + day * 86_400_000).toISOString();
      expect(centralToUtc(utcToCentral(instant))).toBe(instant);
    }
  });

  it('is empty for a missing or malformed value', () => {
    expect(utcToCentral(null)).toBe('');
    expect(utcToCentral('not a time')).toBe('');
  });
});

describe('centralDay and formatCentral', () => {
  it('gives the Central day, which can differ from the UTC day', () => {
    expect(centralDay('2026-10-31T03:00:00.000Z')).toBe('2026-10-30');
    expect(centralDay(new Date('2026-10-31T05:00:00.000Z'))).toBe('2026-10-31');
  });

  it('formats an instant in Central time with its label', () => {
    expect(formatCentral('2026-10-30T19:00:00.000Z')).toBe('Fri 30 Oct 2026, 2:00 pm CT');
    expect(formatCentral('2026-12-15T06:05:00.000Z')).toBe('Tue 15 Dec 2026, 12:05 am CT');
    expect(() => formatCentral('soon')).toThrow();
  });
});
