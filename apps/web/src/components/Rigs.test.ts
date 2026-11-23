import { describe, expect, it } from 'vitest';

import { triangleImage } from '../lib/rigsMap';
import { daysAgo, missingRuns, rigMoves, rigsShown, topBy } from './Rigs';

// Rigs on the oil and gas map (F-282): which rig is where now, the periods and filters, the days
// with no list. Made-up rigs only.

const NOW = new Date('2026-11-23T18:00:00Z');

function served(over: Partial<Record<string, string | null>> & { activityAt: string }) {
  return {
    wellId: '00/01-02-055-05W5/0',
    wellName: 'EXAMPLE HZ 1-2-55-5',
    licenceNumber: '0500001',
    licenseeBaId: 'A1XX',
    licenseeName: 'Example Energy Ltd.',
    contractorBaId: 'C1XX',
    contractorName: 'Example Drilling Inc.',
    rigNumber: '7',
    activityType: 'Drill To LD',
    listDate: over.activityAt.slice(0, 10),
    surfaceLocation: '01-02-055-05W5',
    place: 'well' as const,
    ...over,
  };
}

function answer(rows: ReturnType<typeof served>[], unlocated: ReturnType<typeof served>[] = []) {
  return {
    source: { latestListDate: '2026-11-23', lastSeenAt: null },
    days: 90,
    listDates: [],
    located: {
      features: rows.map((properties, i) => ({
        geometry: { coordinates: [-116 + i * 0.01, 54] as [number, number] },
        properties: properties as never,
      })),
    },
    unlocated: unlocated as never[],
    truncated: false,
  };
}

describe('rigs now', () => {
  it('puts each rig at its latest well, if it started there in the last 30 days', () => {
    const moves = rigMoves(
      answer([
        served({ activityAt: '2026-11-20T10:00:00Z', wellName: 'LATEST' }),
        served({ activityAt: '2026-11-05T10:00:00Z', wellName: 'EARLIER' }),
        // Another rig, last seen 40 days ago: not on a well now.
        served({ activityAt: '2026-10-14T10:00:00Z', rigNumber: '12', wellName: 'OLD' }),
        // The same number with another contractor is another rig.
        served({ activityAt: '2026-11-01T10:00:00Z', contractorBaId: 'C2XX', wellName: 'OTHER' }),
      ]),
      NOW,
    );
    expect(moves.filter((m) => m.now).map((m) => m.wellName)).toEqual(['LATEST', 'OTHER']);
    expect(new Set(moves.map((m) => m.key)).size).toBe(4);
  });

  it('takes a rig with no number as its own rig on each well', () => {
    const moves = rigMoves(
      answer([
        served({ activityAt: '2026-11-20T10:00:00Z', rigNumber: ' ', wellId: 'A' }),
        served({ activityAt: '2026-11-21T10:00:00Z', rigNumber: '', wellId: 'B' }),
      ]),
      NOW,
    );
    expect(moves.every((m) => m.now)).toBe(true);
  });

  it('keeps a rig not placed yet, with no point', () => {
    const moves = rigMoves(answer([], [served({ activityAt: '2026-11-22T10:00:00Z' })]), NOW);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ now: true, longitude: null, latitude: null });
  });
});

describe('the periods and filters', () => {
  const moves = rigMoves(
    answer([
      served({ activityAt: '2026-11-20T10:00:00Z' }),
      served({ activityAt: '2026-11-01T10:00:00Z' }),
      served({ activityAt: '2026-09-10T10:00:00Z' }),
      served({
        activityAt: '2026-11-22T10:00:00Z',
        rigNumber: '3',
        contractorName: 'Other Rigs Ltd.',
        licenseeName: 'Another Oil Corp.',
        activityType: 'Set Surface',
      }),
    ]),
    NOW,
  );
  const none = { contractor: '', operator: '', hidden: new Set<string>() };

  it('shows the rigs now, then every move in 30 or 90 days', () => {
    expect(rigsShown(moves, 'now', NOW, none)).toHaveLength(2);
    expect(rigsShown(moves, '30', NOW, none)).toHaveLength(3);
    expect(rigsShown(moves, '90', NOW, none)).toHaveLength(4);
  });

  it('filters by contractor, operator and activity', () => {
    expect(rigsShown(moves, '90', NOW, { ...none, contractor: 'other' })).toHaveLength(1);
    expect(rigsShown(moves, '90', NOW, { ...none, operator: 'EXAMPLE' })).toHaveLength(3);
    expect(rigsShown(moves, '90', NOW, { ...none, hidden: new Set(['Set Surface']) })).toHaveLength(
      3,
    );
  });

  it('ranks the contractors and operators by rigs now', () => {
    expect(topBy(moves, (m) => m.contractorName)).toEqual([
      { name: 'Example Drilling Inc.', rigs: 1 },
      { name: 'Other Rigs Ltd.', rigs: 1 },
    ]);
  });

  it('counts whole days ago', () => {
    expect(daysAgo('2026-11-22T17:00:00Z', NOW)).toBe(1);
    expect(daysAgo('2026-11-24T17:00:00Z', NOW)).toBe(0);
  });
});

describe('the days with no rig list', () => {
  it('names runs of three days or more, and leaves out a weekend', () => {
    const held = ['2026-09-01', '2026-09-02', '2026-09-05', '2026-09-06', '2026-09-10'];
    // Missing: 3–4 (two days), 7–9 (three days) and 11–12 (two days).
    expect(missingRuns(held, '2026-09-01', '2026-09-12')).toEqual([
      { from: '2026-09-07', to: '2026-09-09' },
    ]);
  });

  it('names the whole period when nothing is held', () => {
    expect(missingRuns([], '2026-10-01', '2026-10-31')).toEqual([
      { from: '2026-10-01', to: '2026-10-31' },
    ]);
  });
});

describe('the rig triangle', () => {
  it('is solid at its centre and empty at its corners', () => {
    const { width, data } = triangleImage();
    const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3] ?? 0;
    expect(alpha(14, 15)).toBeGreaterThan(191);
    expect(alpha(1, 1)).toBeLessThan(191);
    expect(alpha(26, 1)).toBeLessThan(191);
  });
});
