import { describe, expect, it } from 'vitest';

import { cssColourToHex } from './colour';

describe('cssColourToHex', () => {
  it.each([
    // Tailwind's published hex values for the same OKLCH steps.
    ['oklch(1 0 0)', '#ffffff'],
    ['oklch(0 0 0)', '#000000'],
    ['oklch(0.922 0 0)', '#e5e5e5'],
    ['oklch(0.511 0.262 276.966)', '#4f39f6'],
    ['oklch(0.511 0.096 186.391)', '#00786f'],
    ['oklch(92.2% 0 0)', '#e5e5e5'],
    // slate-700, within rounding of the owner's reference map water (#3c4652).
    ['oklch(0.39 0.024 257.3)', '#3d4652'],
    ['#3C4652', '#3c4652'],
    [' oklch(0.922 0 0) ', '#e5e5e5'],
  ])('%s is %s', (css, hex) => {
    expect(cssColourToHex(css)).toBe(hex);
  });

  it.each(['', 'red', 'rgb(0 0 0)', 'oklch(0 0 0 / 0.5)', 'var(--white)', '#fff'])(
    'gives null for %j',
    (css) => {
      expect(cssColourToHex(css)).toBeNull();
    },
  );
});
