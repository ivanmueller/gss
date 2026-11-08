import { describe, expect, it } from 'vitest';

import { normalizeFeatureCollection } from './mapLayers';
import {
  buildOverview,
  joinLines,
  OVERVIEW_PART_BYTES,
  simplifyLine,
  splitOverview,
  utf8Length,
  type MercatorLine,
} from './mapOverview';

// The zoomed-out view (F-134). Synthetic lines in web Mercator metres.
describe('joinLines', () => {
  it('joins pieces that meet end to end, whichever way round they were drawn', () => {
    const pieces: MercatorLine[] = [
      [
        [1000, 0],
        [2000, 0],
      ],
      [
        [0, 0],
        [1000, 0],
      ],
      [
        [3000, 0],
        [2000, 0],
      ],
      [
        [9000, 9000],
        [9500, 9000],
      ],
    ];
    const joined = joinLines(pieces);
    expect(joined).toHaveLength(2);
    expect(joined[0]).toEqual([
      [0, 0],
      [1000, 0],
      [2000, 0],
      [3000, 0],
    ]);
  });

  it('keeps every piece once, even at a junction of three', () => {
    const joined = joinLines([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [2, 0],
      ],
      [
        [1, 0],
        [1, 1],
      ],
    ]);
    const points = joined.reduce((n, line) => n + line.length - 1, 0);
    expect(points).toBe(3);
  });
});

describe('joining a long chain (Codex’s review of 8e0fd95)', () => {
  it('joins 320,000 pieces given back to front quickly and in order', () => {
    const n = 320_000;
    // Piece i runs from i to i + 1; listed last first, so every join is backward.
    const pieces: MercatorLine[] = Array.from({ length: n }, (_, k) => {
      const i = n - 1 - k;
      return [
        [i, 0],
        [i + 1, 0],
      ];
    });
    const started = Date.now();
    const joined = joinLines(pieces);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(joined).toHaveLength(1);
    const line = joined[0] ?? [];
    expect(line).toHaveLength(n + 1);
    expect(line[0]).toEqual([0, 0]);
    expect(line[n]).toEqual([n, 0]);
    expect(line.every((p, i) => p[0] === i)).toBe(true);
  });

  it('joins pieces found both forward and backward from the first', () => {
    const joined = joinLines([
      [
        [2, 0],
        [3, 0],
      ],
      [
        [3, 0],
        [4, 0],
      ],
      [
        [1, 0],
        [2, 0],
      ],
      [
        [0, 0],
        [1, 0],
      ],
    ]);
    expect(joined).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
      ],
    ]);
  });
});

describe('splitOverview', () => {
  const line = (k: number): [number, number][] =>
    Array.from({ length: 50 }, (_, i) => [-100 - k / 1000 - i / 1000, 50 + i / 1000]);
  const feature = (owner: string, lines: number) => ({
    type: 'Feature' as const,
    id: 1,
    geometry: {
      type: 'MultiLineString' as const,
      coordinates: Array.from({ length: lines }, (_, k) => line(k)),
    },
    properties: { OWNER: owner },
  });

  it('keeps every line, in parts under the size limit, a big feature shared out under its value', () => {
    const collection = {
      type: 'FeatureCollection' as const,
      features: [feature('AAA', 3), feature('BIG', 400), feature('BBB', 2)],
    };
    const parts = splitOverview(collection);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts)
      expect(JSON.stringify(part).length).toBeLessThanOrEqual(OVERVIEW_PART_BYTES);
    const lines = (owner: string) =>
      parts
        .flat()
        .filter((f) => f.properties.OWNER === owner)
        .reduce((n, f) => n + (f.geometry.coordinates as unknown[]).length, 0);
    expect(lines('AAA')).toBe(3);
    expect(lines('BIG')).toBe(400);
    expect(lines('BBB')).toBe(2);
  });

  it('cuts a line too long for any part into pieces sharing their ends, every request in budget (Codex’s review of d35ac90)', () => {
    const long: [number, number][] = Array.from({ length: 20_000 }, (_, i) => [
      -100 - i / 10_000,
      50 + i / 10_000,
    ]);
    const collection = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          id: 1,
          geometry: { type: 'MultiLineString' as const, coordinates: [long] },
          // Accented names weigh more in UTF-8 than their characters.
          properties: { OWNER: 'Chemin de fer Québec–Gatineau é'.repeat(15) },
        },
      ],
    };
    const parts = splitOverview(collection);
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) {
      expect(utf8Length(JSON.stringify({ features: part }))).toBeLessThanOrEqual(
        OVERVIEW_PART_BYTES,
      );
    }
    const pieces = parts.flat().flatMap((f) => f.geometry.coordinates as [number, number][][]);
    for (let i = 1; i < pieces.length; i += 1) {
      expect(pieces[i]?.[0]).toEqual(pieces[i - 1]?.at(-1));
    }
    const points = pieces.reduce((n, piece) => n + piece.length, 0);
    expect(points).toBe(long.length + pieces.length - 1);
    expect(pieces[0]?.[0]).toEqual(long[0]);
    expect(pieces.at(-1)?.at(-1)).toEqual(long.at(-1));
  });

  it('measures text in UTF-8 bytes', () => {
    expect(utf8Length('CN')).toBe(2);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('–')).toBe(3);
    expect(utf8Length('𝄞')).toBe(4);
  });

  it('gives one part for a small view', () => {
    expect(
      splitOverview({ type: 'FeatureCollection', features: [feature('AAA', 1)] }),
    ).toHaveLength(1);
  });
});

describe('simplifyLine', () => {
  it('drops points closer than the tolerance and keeps the ends and real bends', () => {
    const line: MercatorLine = [
      [0, 0],
      [500, 10],
      [1000, 0],
      [1500, 2000],
      [2000, 0],
    ];
    expect(simplifyLine(line, 100)).toEqual([
      [0, 0],
      [1000, 0],
      [1500, 2000],
      [2000, 0],
    ]);
  });
});

describe('buildOverview', () => {
  it('gives one feature per value, in longitude and latitude to three decimals, that the Worker accepts', () => {
    const groups = new Map<string | null, MercatorLine[]>([
      [
        'AAA',
        [
          [
            [-11_000_000, 6_500_000],
            [-10_990_000, 6_500_000],
          ],
          [
            [-10_990_000, 6_500_000],
            [-10_980_000, 6_505_000],
          ],
        ],
      ],
      [
        null,
        [
          [
            [-11_100_000, 6_400_000],
            [-11_090_000, 6_400_000],
          ],
        ],
      ],
    ]);
    const overview = buildOverview(groups, 'OWNER');
    expect(overview.features).toHaveLength(2);
    expect(overview.features[0]?.properties).toEqual({ OWNER: 'AAA' });
    expect(overview.features[1]?.properties).toEqual({ OWNER: null });
    const geometry = overview.features[0]?.geometry;
    expect(geometry?.type).toBe('MultiLineString');
    const lines = geometry?.coordinates as [number, number][][];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[0]?.[0]).toBeCloseTo(-98.815, 3);
    expect(lines[0]?.[0]?.[1]).toBeCloseTo(50.309, 3);
    for (const [lon, lat] of lines.flat()) {
      expect(Math.round(lon * 1000) / 1000).toBe(lon);
      expect(Math.round(lat * 1000) / 1000).toBe(lat);
    }
    expect(normalizeFeatureCollection(overview).ok).toBe(true);
  });

  it('leaves out lines that shrink to a point', () => {
    const overview = buildOverview(
      new Map([
        [
          'A',
          [
            [
              [0, 0],
              [10, 10],
            ],
          ] as MercatorLine[],
        ],
      ]),
      null,
    );
    expect(overview.features).toEqual([]);
  });
});
