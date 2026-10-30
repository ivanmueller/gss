import { describe, expect, it } from 'vitest';

import {
  ALBERTA_FIXED_FROM,
  albertaDay,
  albertaToUtc,
  endOfAlbertaDay,
  formatAlberta,
  utcToAlberta,
} from './alberta';

// Alberta's clocks stay at UTC−6 from 8 March 2026: they no longer go back in November. The
// winter dates below would read UTC−7 with time zone rules older than 2026e (this test
// runner's may be), so they also show the fixed offset does not depend on them.

describe('albertaToUtc', () => {
  it('reads a wall-clock time at UTC−6 from March 2026, summer and winter alike', () => {
    expect(albertaToUtc('2026-10-30T14:00')).toBe('2026-10-30T20:00:00.000Z');
    expect(albertaToUtc('2026-12-15T09:30')).toBe('2026-12-15T15:30:00.000Z');
    expect(albertaToUtc('2027-01-04T00:00')).toBe('2027-01-04T06:00:00.000Z');
    expect(albertaToUtc('2027-07-01T12:00')).toBe('2027-07-01T18:00:00.000Z');
  });

  it('keeps 1 November 2026 an ordinary day: clocks do not go back', () => {
    expect(albertaToUtc('2026-11-01T01:30')).toBe('2026-11-01T07:30:00.000Z');
    expect(albertaToUtc('2026-11-01T02:30')).toBe('2026-11-01T08:30:00.000Z');
    expect(utcToAlberta('2026-11-01T08:30:00.000Z')).toBe('2026-11-01T02:30');
  });

  it('reads earlier times by the old rules: UTC−7 in winter, UTC−6 in summer', () => {
    expect(albertaToUtc('2025-12-15T09:30')).toBe('2025-12-15T16:30:00.000Z');
    expect(albertaToUtc('2025-07-15T09:30')).toBe('2025-07-15T15:30:00.000Z');
  });

  it('takes the first of the two 1:30 am when clocks fell back in 2025', () => {
    expect(albertaToUtc('2025-11-02T01:30')).toBe('2025-11-02T07:30:00.000Z');
    expect(albertaToUtc('2025-11-02T03:00')).toBe('2025-11-02T10:00:00.000Z');
  });

  it('reads the skipped 2:30 am when clocks sprang forward in 2026 as 3:30 am', () => {
    expect(albertaToUtc('2026-03-08T02:30')).toBe('2026-03-08T09:30:00.000Z');
    expect(utcToAlberta('2026-03-08T09:30:00.000Z')).toBe('2026-03-08T03:30');
    expect(utcToAlberta(new Date(ALBERTA_FIXED_FROM - 60_000).toISOString())).toBe(
      '2026-03-08T01:59',
    );
    expect(utcToAlberta(new Date(ALBERTA_FIXED_FROM).toISOString())).toBe('2026-03-08T03:00');
  });

  it('refuses what is not a wall-clock time', () => {
    for (const text of [
      '',
      '2026-10-30',
      '2026-10-30T25:00',
      '2026-02-30T10:00',
      '2026-10-30T14:00Z',
    ]) {
      expect(albertaToUtc(text)).toBeNull();
    }
  });
});

describe('utcToAlberta', () => {
  it('shows an instant as Alberta wall-clock time for a form', () => {
    expect(utcToAlberta('2026-10-30T20:00:00.000Z')).toBe('2026-10-30T14:00');
    expect(utcToAlberta('2026-12-15T15:30:00Z')).toBe('2026-12-15T09:30');
    expect(utcToAlberta('2025-12-15T16:30:00Z')).toBe('2025-12-15T09:30');
  });

  it('is six hours behind UTC at every instant from March 2026', () => {
    for (let day = 0; day < 1461; day += 7) {
      const time = ALBERTA_FIXED_FROM + day * 86_400_000 + 3_600_000 * (day % 24);
      const instant = new Date(time).toISOString();
      expect(utcToAlberta(instant)).toBe(new Date(time - 6 * 3_600_000).toISOString().slice(0, 16));
    }
  });

  it('round-trips with albertaToUtc across three years', () => {
    for (let day = 0; day < 1096; day += 5) {
      const instant = new Date(Date.UTC(2025, 0, 1, 17, 45) + day * 86_400_000).toISOString();
      expect(albertaToUtc(utcToAlberta(instant))).toBe(instant);
    }
  });

  it('is empty for a missing or malformed value', () => {
    expect(utcToAlberta(null)).toBe('');
    expect(utcToAlberta('not a time')).toBe('');
  });
});

describe('albertaDay and formatAlberta', () => {
  it('gives the Alberta day, which can differ from the UTC day', () => {
    expect(albertaDay('2026-10-31T05:00:00.000Z')).toBe('2026-10-30');
    expect(albertaDay(new Date('2026-12-16T05:59:00.000Z'))).toBe('2026-12-15');
    expect(albertaDay(new Date('2026-12-16T06:00:00.000Z'))).toBe('2026-12-16');
  });

  it('formats an instant in Alberta time with its label', () => {
    expect(formatAlberta('2026-10-30T20:00:00.000Z')).toBe('Fri 30 Oct 2026, 2:00 pm MT');
    expect(formatAlberta('2026-10-30T20:00:00.000Z', { weekday: false })).toBe(
      '30 Oct 2026, 2:00 pm MT',
    );
    expect(formatAlberta('2026-12-15T06:05:00.000Z')).toBe('Tue 15 Dec 2026, 12:05 am MT');
    expect(formatAlberta('2025-12-15T07:05:00.000Z')).toBe('Mon 15 Dec 2025, 12:05 am MT');
    // A timestamp with another offset is the same instant.
    expect(formatAlberta('2026-10-26T10:30:00-05:00')).toBe('Mon 26 Oct 2026, 9:30 am MT');
    expect(() => formatAlberta('soon')).toThrow();
  });
});

describe('endOfAlbertaDay', () => {
  it('is the next midnight in Alberta time, as a UTC instant', () => {
    expect(endOfAlbertaDay(new Date('2026-10-30T16:00:00.000Z'))).toBe('2026-10-31T06:00:00.000Z');
    // 10:30 pm on 30 October in Alberta is still 30 October there.
    expect(endOfAlbertaDay(new Date('2026-10-31T04:30:00.000Z'))).toBe('2026-10-31T06:00:00.000Z');
    expect(endOfAlbertaDay(new Date('2026-12-15T12:00:00.000Z'))).toBe('2026-12-16T06:00:00.000Z');
    expect(endOfAlbertaDay(new Date('2025-12-15T12:00:00.000Z'))).toBe('2025-12-16T07:00:00.000Z');
  });
});
