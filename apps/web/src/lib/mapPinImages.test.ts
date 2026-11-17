import { describe, expect, it, vi } from 'vitest';

import { drawPin, PIN_KINDS, PIN_TONES, pinDataUrl, pinImageId } from './mapPinImages';
import type { MapColours } from './mapbox';

const COLOURS: MapColours = {
  land: '#ffffff',
  water: '#e5e5e5',
  border: '#d4d4d4',
  road: '#f5f5f5',
  label: '#525252',
  labelHalo: '#ffffff',
  bid: '#008236',
  offer: '#c10007',
  mixed: '#155dfc',
  hollow: '#fafafa',
  selected: '#0a0a0a',
};

/** A canvas that records what is set and drawn, as jsdom has none. */
function fakeCanvas() {
  const fills: string[] = [];
  const strokes: string[] = [];
  const context = new Proxy(
    {
      fillStyle: '',
      strokeStyle: '',
      fill() {
        fills.push(String(this.fillStyle));
      },
      stroke() {
        strokes.push(String(this.strokeStyle));
      },
      getImageData: () => ({ width: 48, height: 64 }),
    },
    {
      get: (target: Record<string, unknown>, key: string) => target[key] ?? (() => undefined),
      set: (target, key: string, value: unknown) => {
        target[key] = value;
        return true;
      },
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => 'data:image/png;base64,AAAA',
  } as unknown as HTMLCanvasElement;
  return { canvas, fills, strokes };
}

describe('pin pictures (F-101, F-237)', () => {
  it('names one picture for each kind, tone and fill, as the map layer builds the name', () => {
    expect(pinImageId('buyer', 'bid', false)).toBe('pin-buyer-bid-f');
    expect(pinImageId('carrier', 'mixed', true)).toBe('pin-carrier-mixed-h');
    const names = PIN_KINDS.flatMap((kind) =>
      PIN_TONES.flatMap((tone) => [false, true].map((hollow) => pinImageId(kind, tone, hollow))),
    );
    expect(new Set(names).size).toBe(24);
  });

  it('draws a white edge, then a filled badge in the tone’s colour or a light one ringed in it (F-237)', () => {
    const filled = fakeCanvas();
    expect(drawPin('seller', 'offer', false, COLOURS, () => filled.canvas)).not.toBeNull();
    expect(filled.fills.slice(0, 2)).toEqual(['#ffffff', '#c10007']);
    expect(filled.strokes[0]).toBe('#ffffff');
    const hollow = fakeCanvas();
    drawPin('seller', 'offer', true, COLOURS, () => hollow.canvas);
    expect(hollow.fills.slice(0, 2)).toEqual(['#ffffff', '#fafafa']);
    expect(hollow.strokes[0]).toBe('#c10007');
  });

  it('draws every symbol without failing, at twice the size for sharp screens', () => {
    for (const kind of PIN_KINDS) {
      const { canvas } = fakeCanvas();
      expect(drawPin(kind, 'mixed', false, COLOURS, () => canvas)).not.toBeNull();
      expect([canvas.width, canvas.height]).toEqual([52, 56]);
    }
  });

  it('gives nothing where a canvas cannot be drawn on', () => {
    const none = { getContext: vi.fn(() => null) } as unknown as HTMLCanvasElement;
    expect(drawPin('buyer', 'bid', false, COLOURS, () => none)).toBeNull();
    expect(pinDataUrl('buyer', 'bid', false, COLOURS, () => none)).toBeNull();
  });

  it('gives a picture address for the legend', () => {
    const { canvas } = fakeCanvas();
    expect(pinDataUrl('broker', 'mixed', false, COLOURS, () => canvas)).toBe(
      'data:image/png;base64,AAAA',
    );
  });
});
