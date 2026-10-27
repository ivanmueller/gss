import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Checks the colour tokens themselves: both themes define the same roles, every role points
// at a palette colour, and text stays readable (WCAG 2.2 AA) in the light and night themes.

// Vitest runs in apps/web.
const read = (name: string) => readFileSync(`src/styles/tokens/${name}`, 'utf8');
const palette = read('palette.css');
const themes = read('themes.css');

const STATUS_ROLES = ['info', 'success', 'caution', 'warning', 'danger', 'bid', 'offer'] as const;

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The custom properties declared in the rule for `selector`. */
function declarations(css: string, selector: string): Map<string, string> {
  const source = withoutComments(css);
  const start = source.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} rule`);
  const body = source.slice(start, source.indexOf('}', start));
  return new Map(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').trim(),
    ]),
  );
}

const PALETTE = declarations(palette, ':root');
const LIGHT = declarations(themes, ':root');
const DARK = declarations(themes, '.dark');

type Rgb = [number, number, number];

interface Paint {
  /** Linear-light sRGB. */
  rgb: Rgb;
  alpha: number;
}

const VAR = /^var\(--([\w-]+)\)$/;
/** A see-through wash of a palette colour, as the night theme's tints use. */
const WASH = /^color-mix\(in oklch, var\(--([\w-]+)\) ([\d.]+)%, transparent\)$/;

/** OKLCH to linear-light sRGB (Björn Ottosson's OKLab matrices), clipped to the sRGB gamut. */
function oklchToLinearRgb(l: number, c: number, h: number): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clip(4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2]),
    clip(-1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2]),
    clip(-0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2]),
  ];
}

/** A theme role's colour, following var() references and washes into the palette. */
function paint(theme: Map<string, string>, role: string): Paint {
  let value = theme.get(role) ?? PALETTE.get(role);
  let alpha = 1;
  for (let depth = 0; depth < 5; depth += 1) {
    const wash = WASH.exec(value ?? '');
    const name = wash?.[1] ?? VAR.exec(value ?? '')?.[1];
    if (name === undefined) break;
    if (wash) alpha *= Number(wash[2]) / 100;
    value = theme.get(name) ?? PALETTE.get(name);
  }
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value ?? '');
  if (!match) throw new Error(`--${role} is not built from an oklch() colour: ${String(value)}`);
  return { rgb: oklchToLinearRgb(Number(match[1]), Number(match[2]), Number(match[3])), alpha };
}

const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** A see-through colour laid over an opaque one, blended as browsers do (in gamma sRGB). */
function over(top: Paint, bottom: Rgb): Rgb {
  return top.rgb.map((v, i) =>
    decode(encode(v) * top.alpha + encode(bottom[i] ?? 0) * (1 - top.alpha)),
  ) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Contrast of text on a surface; a see-through surface is checked on the page and on a card. */
function contrast(theme: Map<string, string>, text: string, surface: string): number {
  const ink = paint(theme, text);
  if (ink.alpha !== 1) throw new Error(`--${text} must be opaque`);
  const fill = paint(theme, surface);
  const bases =
    fill.alpha === 1
      ? [fill.rgb]
      : ['background', 'card'].map((base) => over(fill, paint(theme, base).rgb));
  return Math.min(...bases.map((base) => ratio(ink.rgb, base)));
}

/** [text, surface] pairs that must reach 4.5:1, the AA level for body text. */
const TEXT_PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'popover'],
  ['muted-foreground', 'sidebar'],
  ['muted-foreground', 'sidebar-accent'],
  ['accent-foreground', 'accent'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
  ...STATUS_ROLES.flatMap((role): [string, string][] => [
    [role, 'background'],
    [role, 'card'],
    [role, `${role}-subtle`],
    ['foreground', `${role}-subtle`],
    [`${role}-solid-foreground`, `${role}-solid`],
  ]),
];

/** Pairs for non-text elements (focus ring), which need 3:1. */
const GRAPHIC_PAIRS: [string, string][] = [
  ['ring', 'background'],
  ['ring', 'card'],
];

describe('colour tokens', () => {
  it('defines the same roles in the light and night themes', () => {
    expect([...DARK.keys()].sort()).toEqual([...LIGHT.keys()].sort());
  });

  it('builds every colour role from the palette', () => {
    for (const theme of [LIGHT, DARK]) {
      for (const [role, value] of theme) {
        if (role.startsWith('shadow-opacity-') || role === 'overlay') continue;
        const name = (VAR.exec(value) ?? WASH.exec(value))?.[1];
        expect(name !== undefined && PALETTE.has(name), `--${role}: ${value}`).toBe(true);
      }
    }
  });

  for (const [name, theme] of [
    ['light', LIGHT],
    ['night', DARK],
  ] as const) {
    it(`keeps text readable in the ${name} theme (WCAG AA, 4.5:1)`, () => {
      for (const [text, surface] of TEXT_PAIRS) {
        expect(contrast(theme, text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`keeps the focus ring visible in the ${name} theme (3:1)`, () => {
      for (const [graphic, surface] of GRAPHIC_PAIRS) {
        expect(
          contrast(theme, graphic, surface),
          `${graphic} on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('computes contrast like the WCAG reference values', () => {
    // Black on white is 21:1; Tailwind's neutral-500 (#737373) on white is 4.74:1. Black at
    // 50% over white blends (in gamma sRGB) to #808080, 3.95:1 against white.
    const reference = new Map([
      ['ink', 'var(--black)'],
      ['paper', 'var(--white)'],
      ['grey', 'var(--gray-500)'],
      ['veil', 'color-mix(in oklch, var(--black) 50%, transparent)'],
      ['background', 'var(--white)'],
      ['card', 'var(--white)'],
    ]);
    expect(contrast(reference, 'ink', 'paper')).toBeCloseTo(21, 1);
    expect(contrast(reference, 'grey', 'paper')).toBeCloseTo(4.74, 1);
    expect(contrast(reference, 'paper', 'veil')).toBeCloseTo(3.95, 1);
  });
});
