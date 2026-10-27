import { describe, expect, it } from 'vitest';

import { inspectPng, MAX_LOGO_BYTES } from './png';

// A valid 1x1 RGBA PNG (70 bytes).
const ONE_PIXEL =
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082';

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function withSize(width: number, height: number): Uint8Array {
  const png = bytes(ONE_PIXEL);
  const view = new DataView(png.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return png;
}

describe('inspectPng', () => {
  it('accepts a whole PNG and reads its size', () => {
    expect(inspectPng(bytes(ONE_PIXEL))).toEqual({ ok: true, width: 1, height: 1 });
    expect(inspectPng(withSize(4096, 300))).toEqual({ ok: true, width: 4096, height: 300 });
  });

  it('rejects other formats, including SVG and a JPEG renamed .png', () => {
    expect(
      inspectPng(
        Uint8Array.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.repeat(2), (char) =>
          char.charCodeAt(0),
        ),
      ),
    ).toEqual({
      ok: false,
      reason: 'NOT_PNG',
    });
    expect(inspectPng(bytes(`ffd8ffe0${'00'.repeat(60)}`))).toEqual({
      ok: false,
      reason: 'NOT_PNG',
    });
  });

  it('rejects a truncated PNG and one with trailing data after IEND', () => {
    expect(inspectPng(bytes(ONE_PIXEL).slice(0, 60))).toEqual({ ok: false, reason: 'NOT_PNG' });
    expect(inspectPng(bytes(`${ONE_PIXEL}3c736372697074`))).toEqual({
      ok: false,
      reason: 'NOT_PNG',
    });
  });

  it('rejects a PNG whose first chunk is not IHDR', () => {
    const png = bytes(ONE_PIXEL);
    png[12] = 0x74; // "tHDR"
    expect(inspectPng(png)).toEqual({ ok: false, reason: 'NOT_PNG' });
  });

  it('rejects zero or oversized dimensions and files over the size limit', () => {
    expect(inspectPng(withSize(0, 1))).toEqual({ ok: false, reason: 'BAD_DIMENSIONS' });
    expect(inspectPng(withSize(1, 4097))).toEqual({ ok: false, reason: 'BAD_DIMENSIONS' });
    expect(inspectPng(new Uint8Array(MAX_LOGO_BYTES + 1))).toEqual({
      ok: false,
      reason: 'TOO_LARGE',
    });
  });
});
