import type { MapColours, PinKind, PinTone } from './mapbox';

// The pictures of the map's pins (F-101, F-237): a round badge in the tone's colour with a white
// edge, a short point at the bottom and the symbol of the company's main type inside, filled for an
// exact location and light for an approximate one; drawn the same at every zoom, as Google Maps
// draws saved places. Drawn here on a canvas, so no picture files or outside services are
// needed; FacilityMap hands them to Mapbox.

export const PIN_KINDS: readonly PinKind[] = ['buyer', 'seller', 'carrier', 'broker'];
export const PIN_TONES: readonly PinTone[] = ['bid', 'offer', 'mixed'];

/** The picture's name in the map's style: pin-buyer-bid-f (filled) or -h (hollow). */
export function pinImageId(kind: PinKind, tone: PinTone, hollow: boolean): string {
  return `pin-${kind}-${tone}-${hollow ? 'h' : 'f'}`;
}

/** Every picture's name, for the layer's expression to build the same one. */
export const PIN_IMAGE_EXPRESSION = [
  'concat',
  'pin-',
  ['get', 'kind'],
  '-',
  ['get', 'tone'],
  '-',
  ['case', ['get', 'hollow'], 'h', 'f'],
] as const;

/** Logical size of a pin picture in pixels; drawn at twice this for sharp screens. */
export const PIN_WIDTH = 28;
export const PIN_HEIGHT = 29;
export const PIN_RATIO = 2;

/** A symbol drawer; `cut` is the badge's own colour, for holes in a filled symbol. */
type Path = (c: CanvasRenderingContext2D, cut: string) => void;

/**
 * The four symbols as bold filled shapes (F-237, as Google Maps draws its saved places), in a
 * box of about 16 by 16 centred on the badge.
 */
const SYMBOLS: Record<PinKind, Path> = {
  // A grain elevator: a tall bin with a peaked head house, on a base.
  buyer: (c) => {
    c.beginPath();
    c.moveTo(-2.5, -4);
    c.lineTo(0, -7);
    c.lineTo(2.5, -4);
    c.lineTo(2.5, -2);
    c.lineTo(4.5, -2);
    c.lineTo(4.5, 5);
    c.lineTo(6.5, 5);
    c.lineTo(6.5, 7);
    c.lineTo(-6.5, 7);
    c.lineTo(-6.5, 5);
    c.lineTo(-4.5, 5);
    c.lineTo(-4.5, -2);
    c.lineTo(-2.5, -2);
    c.closePath();
    c.fill();
  },
  // A wheat ear: a stem with three pairs of grains and one on top.
  seller: (c) => {
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(0, 8);
    c.lineTo(0, -3);
    c.stroke();
    const grain = (x: number, y: number, angle: number) => {
      c.beginPath();
      c.ellipse(x, y, 1.5, 2.8, angle, 0, Math.PI * 2);
      c.fill();
    };
    for (const y of [-2, 1.8, 5.6]) {
      grain(-2.6, y - 1.5, -0.7);
      grain(2.6, y - 1.5, 0.7);
    }
    grain(0, -5.8, 0);
  },
  // A truck: a box trailer, a cab with its window cut out, two wheels.
  carrier: (c, cut) => {
    c.fillRect(-8, -5.5, 10, 9);
    c.beginPath();
    c.moveTo(3, -2.5);
    c.lineTo(6, -2.5);
    c.lineTo(8, 0.5);
    c.lineTo(8, 3.5);
    c.lineTo(3, 3.5);
    c.closePath();
    c.fill();
    const ink = c.fillStyle;
    c.fillStyle = cut;
    c.beginPath();
    c.moveTo(4.2, -1.3);
    c.lineTo(5.5, -1.3);
    c.lineTo(6.6, 0.5);
    c.lineTo(4.2, 0.5);
    c.closePath();
    c.fill();
    for (const x of [-4.5, 4.5]) {
      c.beginPath();
      c.arc(x, 4.5, 2.6, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = ink;
    for (const x of [-4.5, 4.5]) {
      c.beginPath();
      c.arc(x, 4.5, 1.8, 0, Math.PI * 2);
      c.fill();
    }
  },
  // Two thick arrows, one each way: a broker between two sides.
  broker: (c) => {
    c.lineWidth = 2.2;
    const arrow = (from: number, to: number, y: number) => {
      const head = to > from ? -1 : 1;
      c.beginPath();
      c.moveTo(from, y);
      c.lineTo(to + head * 3, y);
      c.stroke();
      c.beginPath();
      c.moveTo(to, y);
      c.lineTo(to + head * 4, y - 3.5);
      c.lineTo(to + head * 4, y + 3.5);
      c.closePath();
      c.fill();
    };
    arrow(-7, 7.5, -3.5);
    arrow(7, -7.5, 3.5);
  },
};

/**
 * The badges' colours, close to Google Maps' own (the owner, 2026-11-16): a green for buyers,
 * the pink-red of Google's saved places for sellers, Google's blue for the rest. The same in
 * light and dark, as on Google Maps, so they stand out on either map.
 */
export const PIN_COLOURS: Record<PinTone, string> = {
  bid: '#1e8e3e',
  offer: '#e8436b',
  mixed: '#1a73e8',
};

/** The colour of a tone's badge. */
export function toneColour(tone: PinTone): string {
  return PIN_COLOURS[tone];
}

/**
 * One pin picture as pixels, or null where a canvas cannot be made (a test without one).
 * The badge's point is the bottom middle, where the map anchors it.
 */
export function drawPin(
  kind: PinKind,
  tone: PinTone,
  hollow: boolean,
  colours: MapColours,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): ImageData | null {
  const canvas = paintPin(kind, tone, hollow, colours, createCanvas());
  return canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height) ?? null;
}

/** A pin as a picture address, for the legend; null where a canvas cannot be made. */
export function pinDataUrl(
  kind: PinKind,
  tone: PinTone,
  hollow: boolean,
  colours: MapColours,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): string | null {
  return paintPin(kind, tone, hollow, colours, createCanvas())?.toDataURL() ?? null;
}

/** Draws a pin on a canvas of its own (the legend's); false where it cannot be drawn on. */
export function paintPinOn(
  canvas: HTMLCanvasElement,
  kind: PinKind,
  tone: PinTone,
  hollow: boolean,
  colours: MapColours,
): boolean {
  return paintPin(kind, tone, hollow, colours, canvas) !== null;
}

function paintPin(
  kind: PinKind,
  tone: PinTone,
  hollow: boolean,
  colours: MapColours,
  canvas: HTMLCanvasElement,
): HTMLCanvasElement | null {
  canvas.width = PIN_WIDTH * PIN_RATIO;
  canvas.height = PIN_HEIGHT * PIN_RATIO;
  const c = canvas.getContext('2d');
  if (!c) return null;
  const colour = toneColour(tone);
  c.scale(PIN_RATIO, PIN_RATIO);
  // A round badge with a short point at the bottom middle (F-237, as Google Maps' saved
  // places): a white edge with a soft shadow, then the badge in the tone's colour.
  const cx = PIN_WIDTH / 2;
  const cy = 13;
  badge(c, cx, cy, 12, PIN_HEIGHT - 1);
  c.save();
  c.shadowColor = 'rgba(0, 0, 0, 0.35)';
  c.shadowBlur = 2;
  c.shadowOffsetY = 0.5;
  c.fillStyle = '#ffffff';
  c.fill();
  c.restore();
  badge(c, cx, cy, 10.5, PIN_HEIGHT - 3);
  c.fillStyle = hollow ? colours.hollow : colour;
  c.fill();
  if (hollow) {
    // Approximate: a light badge with a ring and symbol in the tone's colour.
    c.strokeStyle = colour;
    c.lineWidth = 1.6;
    c.stroke();
  }
  // The symbol: white inside a filled pin, the tone's colour inside a hollow one.
  c.save();
  c.translate(cx, cy);
  const ink = hollow ? colour : '#ffffff';
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  SYMBOLS[kind](c, hollow ? colours.hollow : colour);
  c.restore();
  return canvas;
}

/** A circle of radius r around (cx, cy) with a point at (cx, tip) below it. */
function badge(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, tip: number) {
  // Where the point leaves the circle: about 25 degrees either side of straight down.
  const side = Math.PI / 2 - 0.45;
  c.beginPath();
  c.arc(cx, cy, r, Math.PI - side, side);
  c.lineTo(cx, tip);
  c.closePath();
}
