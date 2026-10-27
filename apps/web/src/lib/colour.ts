// Colour conversion for places that cannot read CSS colours directly, such as Mapbox GL JS,
// which understands hex and rgb() but not the oklch() values the design tokens use.

export type Rgb = [number, number, number];

/** OKLCH to linear-light sRGB (Björn Ottosson's OKLab matrices), clipped to the sRGB gamut. */
export function oklchToLinearRgb(l: number, c: number, h: number): Rgb {
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

/** Linear-light to gamma-encoded sRGB, 0–1. */
export function encodeSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/;
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * "#rrggbb" for an opaque oklch() or hex colour as CSS writes it (e.g. a design token read
 * with getComputedStyle); null for anything else.
 */
export function cssColourToHex(value: string): string | null {
  const text = value.trim();
  if (HEX.test(text)) return text.toLowerCase();
  const match = OKLCH.exec(text);
  if (!match) return null;
  const lightness = Number(match[1]) / (match[2] === '%' ? 100 : 1);
  const rgb = oklchToLinearRgb(lightness, Number(match[3]), Number(match[4]));
  return `#${rgb
    .map((v) =>
      Math.round(encodeSrgb(v) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
