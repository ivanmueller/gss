import { describe, expect, it, vi } from 'vitest';

import { pipeSize } from './PipelinePanel';
import {
  PipelineLoader,
  pipelineEntries,
  pipelineFeatures,
  pipelineSquaresFor,
  pipelinesInSquares,
  pipelinesShown,
  type PipelineSquareAnswer,
} from './Pipelines';

// Pipelines on the oil and gas map (F-249): squares asked for by zoom, each segment once,
// filtered in the page. Made-up segments only.

const ANSWER: PipelineSquareAnswer = {
  load: {
    loadedAt: '2026-11-23T04:00:00.000Z',
    fileDate: '2026-11-22',
    area: { west: -119.86, south: 51.32, east: -110.97, north: 56.23 },
    segments: 3,
  },
  level: 'all',
  truncated: false,
  statuses: ['Operating', 'Abandoned', 'Permitted'],
  substances: ['Natural Gas', 'Salt Water', 'Crude Oil'],
  companies: [{ code: 'A0X1', name: 'Example Pipelines Ltd.' }],
  lines: [
    [1, '11130-1', 0, 0, 0, 323.9, [-11650000, 5410000, -11640000, 5420000], []],
    [
      2,
      '3115-52',
      1,
      1,
      -1,
      88.9,
      [-11590000, 5360000, -11585000, 5365000, -11585000, 5365000, -11580000, 5370000],
      [2],
    ],
    [3, '60184-8', 2, 2, 0, null, [-11600000, 5400000, -11610000, 5410000], []],
  ],
};

describe('pipelineEntries', () => {
  it('looks up each segment’s status, substance and licensee, and its line', () => {
    const [gas, water, crude] = pipelineEntries(ANSWER);
    expect(gas).toEqual({
      id: 1,
      key: 'pipeline:1',
      line: '11130-1',
      status: 'Operating',
      substance: 'Natural Gas',
      group: 'gas',
      licensee: { code: 'A0X1', name: 'Example Pipelines Ltd.' },
      diameterMm: 323.9,
      parts: [
        [
          [-116.5, 54.1],
          [-116.4, 54.2],
        ],
      ],
    });
    expect(water).toMatchObject({ group: 'water', licensee: null, status: 'Abandoned' });
    expect(water?.parts).toHaveLength(2);
    expect(crude).toMatchObject({ group: 'crude', diameterMm: null, status: 'Permitted' });
  });
});

describe('pipelinesShown', () => {
  const entries = pipelineEntries(ANSWER);
  const all = {
    statuses: new Set(['Operating', 'Abandoned', 'Permitted', '']),
    groups: new Set(['gas', 'water', 'crude'] as const),
    licensee: '',
    minMm: 0,
  };
  const ids = (filter: typeof all) => pipelinesShown(entries, filter).map((p) => p.id);

  it('filters by status, substance, licensee and size', () => {
    expect(ids(all)).toEqual([1, 2, 3]);
    expect(ids({ ...all, statuses: new Set(['Operating']) })).toEqual([1]);
    expect(ids({ ...all, groups: new Set(['water'] as const) })).toEqual([2]);
    expect(ids({ ...all, licensee: 'example' })).toEqual([1, 3]);
    // A segment with no size given is left out once a size is chosen.
    expect(ids({ ...all, minMm: 114.3 })).toEqual([1]);
  });
});

describe('pipelineSquaresFor', () => {
  const FOX_CREEK = { west: -117.2, south: 54.3, east: -116.6, north: 54.5 };

  it('asks for nothing far out, the large lines farther out and every line close in', () => {
    expect(pipelineSquaresFor(FOX_CREEK, 7, null)).toEqual([]);
    // The view straddles the edge between two large squares, at 116.72° west.
    expect(pipelineSquaresFor(FOX_CREEK, 8, null)).toEqual([
      { level: 'main', tile: { z: 8, x: 44, y: 81 } },
      { level: 'main', tile: { z: 8, x: 45, y: 81 } },
    ]);
    const close = pipelineSquaresFor(FOX_CREEK, 10.5, null);
    expect(close.every((s) => s.level === 'all' && s.tile.z === 10)).toBe(true);
    expect(close.length).toBeGreaterThan(1);
  });

  it('asks only within the area loaded, once it is known', () => {
    const area = ANSWER.load?.area ?? null;
    expect(pipelineSquaresFor({ west: -125, south: 49, east: -121, north: 50 }, 8, area)).toEqual(
      [],
    );
    expect(pipelineSquaresFor(FOX_CREEK, 10.5, area)).toEqual(
      pipelineSquaresFor(FOX_CREEK, 10.5, null),
    );
  });
});

describe('pipelinesInSquares and pipelineFeatures', () => {
  it('keeps a segment once, whichever square held it, and draws it by its status and size', () => {
    const entries = pipelineEntries(ANSWER);
    const read = { load: ANSWER.load, truncated: false, entries };
    const squares = new Map([
      ['10/178/327', read],
      ['10/179/327', read],
    ]);
    const needed = [
      { level: 'all' as const, tile: { z: 10, x: 178, y: 327 } },
      { level: 'all' as const, tile: { z: 10, x: 179, y: 327 } },
      { level: 'all' as const, tile: { z: 10, x: 180, y: 327 } },
    ];
    const once = pipelinesInSquares(needed, squares);
    expect(once.map((p) => p.id)).toEqual([1, 2, 3]);

    const { features } = pipelineFeatures(once);
    expect(features.map((f) => f.geometry.type)).toEqual([
      'LineString',
      'MultiLineString',
      'LineString',
    ]);
    expect(features.map((f) => f.properties)).toEqual([
      { key: 'pipeline:1', colour: '#e8590c', strength: 1, diameter: 323.9, permitted: false },
      { key: 'pipeline:2', colour: '#1c7ed6', strength: 0.25, diameter: 88.9, permitted: false },
      { key: 'pipeline:3', colour: '#5c3d2e', strength: 1, diameter: 0, permitted: true },
    ]);
  });
});

describe('PipelineLoader', () => {
  it('asks for each square needed once, a few at a time, with the member named', async () => {
    const asked: string[] = [];
    const loaded = vi.fn();
    const loader = new PipelineLoader(loaded, vi.fn(), (path) => {
      asked.push(path);
      return Promise.resolve(ANSWER);
    });
    loader.signIn('org-a', 'token');
    loader.open();
    const needed = Array.from({ length: 8 }, (_, i) => ({
      level: 'all' as const,
      tile: { z: 10, x: 178 + i, y: 327 },
    }));
    loader.want(needed, new Map());
    // Six at once; the others once those have answered.
    expect(asked).toHaveLength(6);
    expect(asked[0]).toBe('/petroleum/pipelines/10/178/327?organization_id=org-a');
    await vi.waitFor(() => {
      expect(loaded).toHaveBeenCalledTimes(8);
    });
    expect(loaded.mock.calls[0]?.[0]).toBe('10/178/327');
    expect(new Set(asked).size).toBe(8);
    loader.close();
  });

  it('skips a square kept already or no longer needed', () => {
    const asked: string[] = [];
    const loader = new PipelineLoader(vi.fn(), vi.fn(), (path) => {
      asked.push(path);
      return new Promise(() => undefined);
    });
    loader.open();
    const square = { level: 'all' as const, tile: { z: 10, x: 178, y: 327 } };
    const kept = new Map([['10/178/327', { load: null, truncated: false, entries: [] }]]);
    loader.want([square], kept);
    expect(asked).toEqual([]);
    loader.close();
  });
});

describe('pipeSize', () => {
  it('gives the outside diameter with the nominal size the trade calls it by', () => {
    expect(pipeSize(508)).toBe('508 mm (20-inch)');
    expect(pipeSize('219.1')).toBe('219.1 mm (8-inch)');
    expect(pipeSize('73.0')).toBe('73 mm (2½-inch)');
    // Not a size of the standard schedule: millimetres only.
    expect(pipeSize(76.2)).toBe('76.2 mm');
    expect(pipeSize(null)).toBe('—');
    expect(pipeSize('0')).toBe('—');
  });
});
