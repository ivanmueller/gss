import { describe, expect, it } from 'vitest';

import { normalizeFeatureCollection } from './mapLayers';
import { buildOverview, joinLines, simplifyLine, type MercatorLine } from './mapOverview';

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
