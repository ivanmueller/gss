import { describe, expect, it } from 'vitest';

import { crc32, inspectPng, MAX_LOGO_BYTES } from './png';

// A valid 1x1 RGBA PNG (70 bytes), as produced by common tools.
const ONE_PIXEL =
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082';

function hex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function chunk(type: string, data: Uint8Array = new Uint8Array(), crc?: number): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  out.set(ascii(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.byteLength, crc ?? crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
}

function ihdr(width: number, height: number, bitDepth = 8, colorType = 6, interlace = 0) {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data.set([bitDepth, colorType, 0, 0, interlace], 8);
  return chunk('IHDR', data);
}

type Deflater = new (format: 'deflate') => {
  readable: ReadableStreamLike;
  writable: {
    getWriter: () => { write: (c: Uint8Array) => Promise<void>; close: () => Promise<void> };
  };
};
interface ReadableStreamLike {
  getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> };
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const Compression = (globalThis as unknown as { CompressionStream: Deflater }).CompressionStream;
  const stream = new Compression('deflate');
  const writer = stream.writable.getWriter();
  void writer.write(data).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  return concat(...parts);
}

const SIGNATURE = hex('89504e470d0a1a0a');
const IEND = chunk('IEND');

/** A width x height RGBA image of zero pixels, with optional chunks before IDAT. */
async function rgba(width: number, height: number, before: Uint8Array[] = []): Promise<Uint8Array> {
  const raw = new Uint8Array(height * (1 + width * 4));
  return concat(SIGNATURE, ihdr(width, height), ...before, chunk('IDAT', await deflate(raw)), IEND);
}

async function check(bytes: Uint8Array) {
  const result = await inspectPng(bytes);
  return result.ok ? { ok: true, width: result.width, height: result.height } : result;
}

describe('inspectPng', () => {
  it('accepts whole PNGs and reads their size', async () => {
    expect(await check(hex(ONE_PIXEL))).toEqual({ ok: true, width: 1, height: 1 });
    expect(await check(await rgba(300, 2))).toEqual({ ok: true, width: 300, height: 2 });
  });

  it('accepts a palette image with its PLTE and an interlaced image', async () => {
    const palette = concat(
      SIGNATURE,
      ihdr(2, 2, 8, 3),
      chunk('PLTE', hex('ff0000')),
      chunk('IDAT', await deflate(new Uint8Array(2 * 3))),
      IEND,
    );
    expect(await check(palette)).toEqual({ ok: true, width: 2, height: 2 });
    // 1x1 interlaced: only the first Adam7 pass has a pixel.
    const interlaced = concat(
      SIGNATURE,
      ihdr(1, 1, 8, 6, 1),
      chunk('IDAT', await deflate(new Uint8Array(5))),
      IEND,
    );
    expect(await check(interlaced)).toEqual({ ok: true, width: 1, height: 1 });
  });

  it('stores a copy without text chunks, keeping transparency and colour chunks', async () => {
    const png = await rgba(1, 1, [
      chunk('tEXt', ascii('Comment\u0000<html><script>alert(1)</script></html>')),
      chunk('gAMA', hex('0000b18f')),
    ]);
    const result = await inspectPng(png);
    if (!result.ok) throw new Error('expected ok');
    const stored = String.fromCharCode(...result.png);
    expect(stored).not.toContain('<script>');
    expect(stored).not.toContain('tEXt');
    expect(stored).toContain('gAMA');
    expect(await check(result.png)).toEqual({ ok: true, width: 1, height: 1 });
  });

  it('rejects an IHDR and IEND with no image data (45 bytes)', async () => {
    expect(await check(concat(SIGNATURE, ihdr(1, 1), IEND))).toEqual({
      ok: false,
      reason: 'NOT_PNG',
    });
  });

  it('rejects arbitrary bytes between the header and the end', async () => {
    const html = ascii('<html><body>not an image</body></html>');
    expect(await check(concat(SIGNATURE, ihdr(1, 1), html, IEND))).toEqual({
      ok: false,
      reason: 'NOT_PNG',
    });
  });

  it('rejects a chunk whose CRC does not match', async () => {
    const png = hex(ONE_PIXEL);
    png[45] = 0x00; // inside the IDAT data
    expect(await check(png)).toEqual({ ok: false, reason: 'NOT_PNG' });
    expect(await check(concat(SIGNATURE, ihdr(1, 1), chunk('IDAT', hex('00'), 1), IEND))).toEqual({
      ok: false,
      reason: 'NOT_PNG',
    });
  });

  it('rejects image data that does not inflate to the declared size', async () => {
    const tooShort = concat(
      SIGNATURE,
      ihdr(2, 2),
      chunk('IDAT', await deflate(new Uint8Array(3))),
      IEND,
    );
    expect(await check(tooShort)).toEqual({ ok: false, reason: 'NOT_PNG' });
    const notZlib = concat(SIGNATURE, ihdr(1, 1), chunk('IDAT', ascii('<script>x</script>')), IEND);
    expect(await check(notZlib)).toEqual({ ok: false, reason: 'NOT_PNG' });
  });

  it('stops inflating a small file that expands far beyond its declared size', async () => {
    // Declares 1x1 but carries 8 MiB of zeros, which deflate to a few kilobytes.
    const bomb = concat(
      SIGNATURE,
      ihdr(1, 1),
      chunk('IDAT', await deflate(new Uint8Array(8 * 1024 * 1024))),
      IEND,
    );
    expect(bomb.byteLength).toBeLessThan(MAX_LOGO_BYTES);
    expect(await check(bomb)).toEqual({ ok: false, reason: 'NOT_PNG' });
  });

  it('rejects structural mistakes', async () => {
    const idat = chunk('IDAT', await deflate(new Uint8Array(5)));
    const cases: Uint8Array[] = [
      concat(SIGNATURE, idat, ihdr(1, 1), IEND), // IHDR not first
      concat(SIGNATURE, ihdr(1, 1), idat), // no IEND
      concat(SIGNATURE, ihdr(1, 1), idat, IEND, ascii('trailing')), // data after IEND
      // palette image without PLTE (image data of the right size for 1x1 palette)
      concat(SIGNATURE, ihdr(1, 1, 8, 3), chunk('IDAT', await deflate(new Uint8Array(2))), IEND),
      concat(SIGNATURE, ihdr(1, 1, 7, 6), idat, IEND), // invalid bit depth
      concat(SIGNATURE, ihdr(1, 1), chunk('ZZZZ', hex('00')), idat, IEND), // unknown critical chunk
      concat(SIGNATURE, ihdr(1, 1), idat, chunk('tIME', hex('07ea0a1b000000')), idat, IEND), // split IDAT
    ];
    for (const png of cases) {
      expect(await check(png)).toEqual({ ok: false, reason: 'NOT_PNG' });
    }
  });

  it('rejects other formats, including SVG and a JPEG renamed .png', async () => {
    expect(await check(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual({
      ok: false,
      reason: 'NOT_PNG',
    });
    expect(await check(hex(`ffd8ffe0${'00'.repeat(60)}`))).toEqual({
      ok: false,
      reason: 'NOT_PNG',
    });
  });

  it('rejects zero or oversized dimensions and files over the size limit', async () => {
    expect(await check(concat(SIGNATURE, ihdr(0, 1), IEND))).toEqual({
      ok: false,
      reason: 'BAD_DIMENSIONS',
    });
    expect(await check(concat(SIGNATURE, ihdr(1, 2049), IEND))).toEqual({
      ok: false,
      reason: 'BAD_DIMENSIONS',
    });
    expect(await check(new Uint8Array(MAX_LOGO_BYTES + 1))).toEqual({
      ok: false,
      reason: 'TOO_LARGE',
    });
  });
});
