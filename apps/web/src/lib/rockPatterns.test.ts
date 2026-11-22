import { FORMATION_ROCKS, type RockPattern } from '@grain/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ROCK_TILE, rockPattern } from './rockPatterns';

// The rock types' textures (F-261). jsdom has no canvas: a stand-in records what is drawn.

/** A 2D context that takes any call and counts the strokes and fills. */
function fakeInk() {
  const drawn = { marks: 0 };
  const ink = new Proxy(
    {},
    {
      get: (_, name) =>
        name === 'stroke' || name === 'fill' || name === 'strokeRect'
          ? () => {
              drawn.marks += 1;
            }
          : () => undefined,
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ink, drawn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rockPattern', () => {
  it('makes each texture once for a canvas, on a tile of its own', () => {
    const { ink, drawn } = fakeInk();
    const tiles: HTMLCanvasElement[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      tiles.push(this);
      return ink;
    });
    const made = { as: 'pattern' } as unknown as CanvasPattern;
    const createPattern = vi.fn(() => made);
    const ctx = { createPattern } as unknown as CanvasRenderingContext2D;

    const patterns = [...new Set(Object.values(FORMATION_ROCKS).map((rock) => rock.pattern))];
    for (const pattern of patterns) {
      const before = drawn.marks;
      const fill = rockPattern(ctx, pattern);
      if (pattern === 'plain') {
        // A rock the table does not show has no texture.
        expect(fill).toBeNull();
        continue;
      }
      expect(fill).toBe(made);
      // Something was drawn on its tile.
      expect(drawn.marks).toBeGreaterThan(before);
      // Asked again: the same fill, nothing made anew.
      const calls = createPattern.mock.calls.length;
      expect(rockPattern(ctx, pattern)).toBe(made);
      expect(createPattern).toHaveBeenCalledTimes(calls);
    }
    expect(createPattern).toHaveBeenCalledTimes(patterns.filter((p) => p !== 'plain').length);
    expect(tiles.every((tile) => tile.width === ROCK_TILE && tile.height === ROCK_TILE)).toBe(true);
    expect(createPattern.mock.calls.every((call) => (call as unknown[])[1] === 'repeat')).toBe(
      true,
    );
  });

  it('gives none where there is no canvas to draw a tile on', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const createPattern = vi.fn();
    const ctx = { createPattern } as unknown as CanvasRenderingContext2D;
    const pattern: RockPattern = 'bricks';
    expect(rockPattern(ctx, pattern)).toBeNull();
    expect(createPattern).not.toHaveBeenCalled();
  });
});
