import { describe, expect, it, vi } from 'vitest';

import {
  finerShapes,
  GridLoader,
  readSquare,
  squaresFor,
  townshipLines,
  type Square,
} from './TownshipGrid';

// The township grid in the browser (F-240, F-271): which squares a view asks for, how a square's
// answer is read, the township file's lines, the queue that asks for squares, and each shape
// drawn once.

const section = (sec: number, west: number) => ({
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [west, 54],
        [west + 0.02, 54],
        [west + 0.02, 54.01],
        [west, 54.01],
        [west, 54],
      ],
    ],
  },
  properties: { M: 5, RGE: 19, TWP: 63, SEC: sec },
});

const FOX_CREEK = { west: -117.0, south: 54.3, east: -116.6, north: 54.5 };

describe('squaresFor', () => {
  it('asks the province only for the finer levels, each from its zoom: the townships are kept with the app', () => {
    expect(squaresFor(FOX_CREEK, 8)).toEqual([]);
    const levels = (zoom: number) => [...new Set(squaresFor(FOX_CREEK, zoom).map((s) => s.level))];
    expect(levels(11.5)).toEqual(['section']);
    expect(levels(13.2)).toEqual(['section', 'quarter']);
    expect(levels(14)).toEqual(['section', 'quarter', 'lsd']);
  });

  it('asks for nothing outside Alberta', () => {
    expect(squaresFor({ west: -106, south: 50, east: -105, north: 51 }, 12)).toEqual([]);
  });
});

describe('readSquare', () => {
  it('keys each shape by its place on the grid', () => {
    const items = readSquare('section', { features: [section(6, -116.8)] });
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe('section:5-19-63-6--');
    expect(items[0]?.shape.properties).toEqual({ level: 'section' });
  });

  it('leaves out what is not a named area, and an answer that is not a list', () => {
    expect(
      readSquare('section', { features: [{ ...section(6, -116.8), properties: {} }] }),
    ).toEqual([]);
    expect(
      readSquare('section', {
        features: [{ ...section(6, -116.8), geometry: { type: 'Point', coordinates: [0, 0] } }],
      }),
    ).toEqual([]);
    expect(readSquare('section', { error: { code: 500 } })).toEqual([]);
    expect(readSquare('section', null)).toEqual([]);
  });
});

describe('finerShapes', () => {
  it('draws a shape that came in two squares once, and none of squares no longer needed', () => {
    const a: Square = { level: 'section', tile: { z: 11, x: 359, y: 652 } };
    const b: Square = { level: 'section', tile: { z: 11, x: 360, y: 652 } };
    const kept = new Map([
      ['section/11/359/652', readSquare('section', { features: [section(6, -116.8)] })],
      [
        'section/11/360/652',
        readSquare('section', { features: [section(6, -116.8), section(5, -116.78)] }),
      ],
    ]);
    expect(finerShapes([a, b], kept).features).toHaveLength(2);
    expect(finerShapes([a], kept).features).toHaveLength(1);
  });
});

describe('townshipLines', () => {
  it('turns the flat lines of the file into one shape of lines', () => {
    const lines = townshipLines([
      [-116, 54, -116, 54.1, -116.1, 54.1],
      [-115, 53],
    ]);
    expect(lines.features).toHaveLength(1);
    expect(lines.features[0]?.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [-116, 54],
          [-116, 54.1],
          [-116.1, 54.1],
        ],
      ],
    });
  });
});

describe('GridLoader', () => {
  const square = (x: number): Square => ({ level: 'section', tile: { z: 11, x, y: 652 } });

  it('asks a few at once, for the person signed in, and the rest as each answer comes', async () => {
    const answers: (() => void)[] = [];
    const ask = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          answers.push(() => {
            resolve({ features: [] });
          });
        }),
    );
    const loaded = vi.fn();
    const loader = new GridLoader(loaded, vi.fn(), ask);
    loader.signIn('org-a', 'token-a');
    loader.open();
    loader.want(
      [1, 2, 3, 4, 5, 6].map((x) => square(350 + x)),
      new Map(),
    );
    expect(ask).toHaveBeenCalledTimes(4);
    expect(ask.mock.calls[0]?.slice(0, 2)).toEqual([
      '/petroleum/grid/section/11/351/652?organization_id=org-a',
      'token-a',
    ]);
    answers[0]?.();
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(5);
    });
    expect(loaded).toHaveBeenCalledWith('section/11/351/652', []);
  });

  it('skips a waiting square the view no longer needs, and asks again for none kept', async () => {
    const ask = vi.fn(() => Promise.resolve<unknown>({ features: [] }));
    const loader = new GridLoader(vi.fn(), vi.fn(), ask);
    loader.open();
    loader.want([square(1)], new Map([['section/11/1/652', []]]));
    expect(ask).not.toHaveBeenCalled();
    loader.want([1, 2, 3, 4, 5, 6].map(square), new Map());
    loader.want([square(9)], new Map());
    await vi.waitFor(() => {
      expect(ask.mock.calls.map((call) => (call as unknown[])[0])).toContain(
        '/petroleum/grid/section/11/9/652?organization_id=',
      );
    });
    // The four on their way when the view moved, and the one it needs now: not 5 or 6.
    expect(ask).toHaveBeenCalledTimes(5);
  });

  it('says when a square fails, and nothing more once the page has closed', async () => {
    const failed = vi.fn();
    const loaded = vi.fn();
    let finish: () => void = () => undefined;
    const ask = vi
      .fn<(path: string, token: string, signal: AbortSignal) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => {
              resolve({ features: [] });
            };
          }),
      );
    const loader = new GridLoader(loaded, failed, ask);
    loader.open();
    loader.want([square(1)], new Map());
    await vi.waitFor(() => {
      expect(failed).toHaveBeenCalledTimes(1);
    });
    loader.want([square(2)], new Map());
    loader.close();
    finish();
    await Promise.resolve();
    expect(loaded).not.toHaveBeenCalled();
  });
});
