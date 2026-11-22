import type { RockPattern } from '@grain/domain';

/**
 * The textures of the rock types in the block of ground (F-261; the owner, 2026-11-22: "the
 * texture is in the layers"): the marks customary for each rock in geological drawings, as
 * small tiles that repeat. Drawn in one dark ink, to lie over the layer's own colour. A way of
 * drawing the rock type the Table of Formations gives; nothing here says what a rock is.
 */

/** The side of a tile, in its own pixels. Every tile repeats cleanly at its edges. */
export const ROCK_TILE = 64;

const INK = 'rgba(15, 23, 42, 0.5)';

type Painter = (ctx: CanvasRenderingContext2D) => void;

/** Grains: scattered dots. */
const dots: Painter = (ctx) => {
  const at = [
    [6, 8],
    [22, 4],
    [40, 10],
    [56, 6],
    [14, 22],
    [32, 24],
    [50, 20],
    [4, 38],
    [24, 40],
    [44, 36],
    [60, 42],
    [12, 54],
    [34, 56],
    [52, 52],
  ];
  for (const [x, y] of at) {
    ctx.beginPath();
    ctx.arc(x ?? 0, y ?? 0, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Fine beds: short level dashes, each row shifted from the one above. */
const dashes: Painter = (ctx) => {
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let row = 0; row < 4; row += 1) {
    const y = 8 + row * 16;
    const shift = row % 2 === 0 ? 0 : 16;
    for (let x = shift - 32; x < ROCK_TILE; x += 32) {
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + 24, y);
    }
  }
  ctx.stroke();
};

/** Blocky beds: courses with upright joints, each course shifted. `courses`: which to draw. */
const bricksIn =
  (courses: readonly number[]): Painter =>
  (ctx) => {
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const course of courses) {
      const y = course * 16;
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(ROCK_TILE, y + 0.5);
      const shift = course % 2 === 0 ? 0 : 16;
      for (let x = shift; x < ROCK_TILE; x += 32) {
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + 16);
      }
    }
    ctx.stroke();
  };

/** Rounded stones: outlines of pebbles. */
const pebbles: Painter = (ctx) => {
  ctx.lineWidth = 1.6;
  const at = [
    [12, 12, 8, 5],
    [42, 10, 6, 4],
    [28, 30, 9, 6],
    [56, 34, 5, 4],
    [10, 46, 6, 4],
    [44, 52, 8, 5],
  ];
  for (const [x, y, rx, ry] of at) {
    ctx.beginPath();
    ctx.ellipse(x ?? 0, y ?? 0, rx ?? 0, ry ?? 0, 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
};

/** Loose ground: small stones among grains. */
const gravel: Painter = (ctx) => {
  ctx.lineWidth = 1.4;
  const stones = [
    [14, 14, 5, 3.5],
    [46, 20, 4, 3],
    [26, 44, 5, 3.5],
    [56, 52, 4, 3],
  ];
  for (const [x, y, rx, ry] of stones) {
    ctx.beginPath();
    ctx.ellipse(x ?? 0, y ?? 0, rx ?? 0, ry ?? 0, -0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  const grains = [
    [30, 8],
    [58, 6],
    [4, 30],
    [36, 28],
    [60, 34],
    [10, 54],
    [42, 58],
  ];
  for (const [x, y] of grains) {
    ctx.beginPath();
    ctx.arc(x ?? 0, y ?? 0, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Salt: small squares, as crystals. */
const crystals: Painter = (ctx) => {
  ctx.lineWidth = 1.4;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if ((row + column) % 2 === 1) continue;
      ctx.strokeRect(column * 16 + 4.5, row * 16 + 4.5, 7, 7);
    }
  }
};

/** Slanted lines one way across the tile. */
const slants =
  (down: boolean): Painter =>
  (ctx) => {
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = -ROCK_TILE; x < ROCK_TILE * 2; x += 16) {
      ctx.moveTo(x, down ? 0 : ROCK_TILE);
      ctx.lineTo(x + ROCK_TILE, down ? ROCK_TILE : 0);
    }
    ctx.stroke();
  };

/** Lava and ash: small chevrons. */
const chevrons: Painter = (ctx) => {
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let row = 0; row < 4; row += 1) {
    const shift = row % 2 === 0 ? 0 : 16;
    for (let x = shift; x < ROCK_TILE; x += 32) {
      const y = row * 16 + 4;
      ctx.moveTo(x + 2, y);
      ctx.lineTo(x + 8, y + 8);
      ctx.lineTo(x + 14, y);
    }
  }
  ctx.stroke();
};

/** Crystalline basement: small crosses, turned this way and that. */
const crosses: Painter = (ctx) => {
  ctx.lineWidth = 1.6;
  const at = [
    [10, 10, 0],
    [42, 14, 0.6],
    [24, 34, 0.3],
    [56, 40, 0],
    [8, 52, 0.7],
    [40, 56, 0.2],
  ];
  ctx.beginPath();
  for (const [x, y, turn] of at) {
    const [c, s] = [Math.cos(turn ?? 0) * 4.5, Math.sin(turn ?? 0) * 4.5];
    ctx.moveTo((x ?? 0) - c, (y ?? 0) - s);
    ctx.lineTo((x ?? 0) + c, (y ?? 0) + s);
    ctx.moveTo((x ?? 0) + s, (y ?? 0) - c);
    ctx.lineTo((x ?? 0) - s, (y ?? 0) + c);
  }
  ctx.stroke();
};

const PAINTERS: Record<RockPattern, Painter[]> = {
  dots: [dots],
  dashes: [dashes],
  bricks: [bricksIn([0, 1, 2, 3])],
  // Two courses of blocks, then two rows of dashes: the two rocks, bed over bed.
  bricks_dashes: [
    bricksIn([0, 1]),
    (ctx) => {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 32.5);
      ctx.lineTo(ROCK_TILE, 32.5);
      for (const [y, shift] of [
        [42, 0],
        [56, 16],
      ]) {
        for (let x = (shift ?? 0) - 32; x < ROCK_TILE; x += 32) {
          ctx.moveTo(x + 4, y ?? 0);
          ctx.lineTo(x + 24, y ?? 0);
        }
      }
      ctx.stroke();
    },
  ],
  pebbles: [pebbles],
  gravel: [gravel],
  crystals: [crystals],
  crosshatch: [slants(true), slants(false)],
  bricks_hatch: [bricksIn([0, 1, 2, 3]), slants(true)],
  chevrons: [chevrons],
  crosses: [crosses],
  plain: [],
};

const kept = new WeakMap<CanvasRenderingContext2D, Map<RockPattern, CanvasPattern | null>>();

/**
 * A rock texture as a repeating fill for a canvas, made once for it; null where there is no
 * texture or no canvas to make one on (a test's page).
 */
export function rockPattern(
  ctx: CanvasRenderingContext2D,
  pattern: RockPattern,
): CanvasPattern | null {
  let made = kept.get(ctx);
  if (!made) {
    made = new Map();
    kept.set(ctx, made);
  }
  if (made.has(pattern)) return made.get(pattern) ?? null;
  let fill: CanvasPattern | null = null;
  const painters = PAINTERS[pattern];
  if (painters.length > 0 && typeof document !== 'undefined') {
    const tile = document.createElement('canvas');
    tile.width = ROCK_TILE;
    tile.height = ROCK_TILE;
    const ink = tile.getContext('2d');
    if (ink) {
      ink.strokeStyle = INK;
      ink.fillStyle = INK;
      ink.lineCap = 'round';
      for (const paint of painters) paint(ink);
      fill = ctx.createPattern(tile, 'repeat');
    }
  }
  made.set(pattern, fill);
  return fill;
}
