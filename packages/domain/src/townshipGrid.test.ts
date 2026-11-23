import { describe, expect, it } from 'vitest';

import {
  gridSquareOf,
  legalLand,
  gridKey,
  gridLabel,
  gridSquares,
  gridSquareZoom,
  gridSquareZooms,
  squareInAlberta,
} from './townshipGrid';

describe('the township grid (F-240)', () => {
  it('draws each level from its own zoom, with squares the service can answer whole', () => {
    expect(gridSquareZoom('township', 6.9)).toBeNull();
    expect(gridSquareZoom('township', 7)).toBe(7);
    expect(gridSquareZoom('township', 8.99)).toBe(7);
    expect(gridSquareZoom('township', 9)).toBe(9);
    expect(gridSquareZoom('township', 16)).toBe(9);
    expect(gridSquareZoom('section', 10.9)).toBeNull();
    expect(gridSquareZoom('section', 12.5)).toBe(11);
    expect(gridSquareZoom('quarter', 13)).toBe(12);
    expect(gridSquareZoom('lsd', 13.9)).toBeNull();
    expect(gridSquareZoom('lsd', 15)).toBe(13);
    expect(gridSquareZooms('township')).toEqual([9, 7]);
  });

  it('asks only for the squares of the view inside Alberta', () => {
    // Around Fox Creek at zoom 9: a handful of squares.
    const near = gridSquares({ west: -117.2, south: 54.2, east: -116.4, north: 54.6 }, 9);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThanOrEqual(4);
    expect(near.every((t) => t.z === 9 && squareInAlberta(t))).toBe(true);
    // Saskatchewan alone: nothing.
    expect(gridSquares({ west: -108, south: 50, east: -106, north: 52 }, 9)).toEqual([]);
    // Never more than the cap, however wide the view.
    expect(gridSquares({ west: -125, south: 45, east: -100, north: 65 }, 13, 20)).toHaveLength(20);
  });

  it('knows a square outside Alberta', () => {
    expect(squareInAlberta({ z: 9, x: 89, y: 162 })).toBe(true);
    // The Pacific off Vancouver Island.
    expect(squareInAlberta({ z: 9, x: 70, y: 170 })).toBe(false);
  });

  it('names a shape as land is written in Alberta', () => {
    expect(gridLabel('township', { M: 5, RGE: 18, TWP: 64 })).toBe('T64 R18 W5');
    expect(gridLabel('section', { M: 5, RGE: 19, TWP: 63, SEC: 6 })).toBe('6');
    expect(gridLabel('quarter', { QS: 'SE' })).toBe('SE');
    expect(gridLabel('lsd', { LS: 16 })).toBe('16');
    expect(gridLabel('township', { M: 5, RGE: '18', TWP: 64 })).toBeNull();
    expect(gridLabel('section', { SEC: 37 })).toBeNull();
    expect(gridLabel('quarter', { QS: 'N' })).toBeNull();
    expect(gridLabel('lsd', { LS: 0 })).toBeNull();
  });

  it('keys a shape by its place, so one crossing squares is drawn once', () => {
    const f = { M: 5, RGE: 19, TWP: 63, SEC: 6 };
    expect(gridKey('section', f)).toBe('section:5-19-63-6--');
    expect(gridKey('section', { ...f })).toBe(gridKey('section', f));
    expect(gridKey('section', { M: 5 })).toBeNull();
  });

  it('reads a clicked square and writes it as land is written in Alberta', () => {
    const square = gridSquareOf({ M: 5, RGE: 19, TWP: 62, SEC: 33, QS: 'SW', LS: 4 });
    expect(square).toEqual({
      meridian: 5,
      range: 19,
      township: 62,
      section: 33,
      quarter: 'SW',
      lsd: 4,
    });
    expect(square && legalLand(square)).toBe('04-33-062-19W5');
    expect(
      legalLand({ meridian: 4, range: 1, township: 1, section: 1, quarter: null, lsd: 16 }),
    ).toBe('16-01-001-01W4');
    expect(gridSquareOf({ M: 5, RGE: 19, TWP: 62, SEC: 33, QS: 'X', LS: 4 })?.quarter).toBeNull();
    expect(gridSquareOf({ M: 5, RGE: 19, TWP: 62, SEC: 37, LS: 4 })).toBeNull();
    expect(gridSquareOf({ M: 5, RGE: 19, TWP: 62, SEC: 33 })).toBeNull();
  });
});
