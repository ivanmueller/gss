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
export const PIN_WIDTH = 26;
export const PIN_HEIGHT = 28;
export const PIN_RATIO = 2;

type Path = (c: CanvasRenderingContext2D) => void;

/** The four symbols, drawn in a 24 by 24 box centred on the badge (scaled to fit it). */
const SYMBOLS: Record<PinKind, Path> = {
  // A grain elevator: a tall bin with a small head house and a base.
  buyer: (c) => {
    c.strokeRect(-4, -3, 8, 9);
    c.strokeRect(-2, -7, 4, 4);
    c.beginPath();
    c.moveTo(-6, 6);
    c.lineTo(6, 6);
    c.stroke();
  },
  // A wheat ear: a stem with pairs of grains.
  seller: (c) => {
    c.beginPath();
    c.moveTo(0, 7);
    c.lineTo(0, -6);
    c.stroke();
    for (const y of [-4, -0.5, 3]) {
      c.beginPath();
      c.moveTo(0, y + 2);
      c.lineTo(-4, y - 1);
      c.moveTo(0, y + 2);
      c.lineTo(4, y - 1);
      c.stroke();
    }
  },
  // A truck: trailer, cab and two wheels.
  carrier: (c) => {
    c.strokeRect(-7, -5, 8, 8);
    c.beginPath();
    c.moveTo(1, -2);
    c.lineTo(5, -2);
    c.lineTo(7, 1);
    c.lineTo(7, 3);
    c.lineTo(1, 3);
    c.stroke();
    for (const x of [-4, 4]) {
      c.beginPath();
      c.arc(x, 5, 1.5, 0, Math.PI * 2);
      c.fill();
    }
  },
  // Two arrows, one each way: a broker between two sides.
  broker: (c) => {
    c.beginPath();
    c.moveTo(-6, -3);
    c.lineTo(6, -3);
    c.moveTo(3, -6);
    c.lineTo(6, -3);
    c.lineTo(3, 0);
    c.moveTo(6, 3);
    c.lineTo(-6, 3);
    c.moveTo(-3, 0);
    c.lineTo(-6, 3);
    c.lineTo(-3, 6);
    c.stroke();
  },
};

/** The colour of a tone, from the map colours. */
export function toneColour(colours: MapColours, tone: PinTone): string {
  return tone === 'bid' ? colours.bid : tone === 'offer' ? colours.offer : colours.mixed;
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
  const colour = toneColour(colours, tone);
  c.scale(PIN_RATIO, PIN_RATIO);
  // A round badge with a short point at the bottom middle (F-237, as Google Maps' saved
  // places): a white edge with a soft shadow, then the badge in the tone's colour.
  const cx = PIN_WIDTH / 2;
  const cy = 12;
  badge(c, cx, cy, 11, PIN_HEIGHT - 1);
  c.save();
  c.shadowColor = 'rgba(0, 0, 0, 0.35)';
  c.shadowBlur = 2;
  c.shadowOffsetY = 0.5;
  c.fillStyle = '#ffffff';
  c.fill();
  c.restore();
  badge(c, cx, cy, 9, PIN_HEIGHT - 3.5);
  c.fillStyle = hollow ? colours.hollow : colour;
  c.fill();
  if (hollow) {
    // Approximate: a light badge with a ring and symbol in the tone's colour.
    c.strokeStyle = colour;
    c.lineWidth = 2;
    c.stroke();
  }
  // The symbol: white inside a filled pin, the tone's colour inside a hollow one.
  c.save();
  c.translate(cx, cy);
  c.scale(0.8, 0.8);
  const ink = hollow ? colour : '#ffffff';
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineWidth = 2;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  SYMBOLS[kind](c);
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
