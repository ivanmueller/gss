/** Largest logo accepted, matching the database check on app.counterparty_logos. */
export const MAX_LOGO_BYTES = 512 * 1024;
/** Largest width or height accepted for a logo, in pixels. */
export const MAX_LOGO_DIMENSION = 2048;
// Largest decoded image accepted (2048 x 2048 RGBA at 8 bits is 16 MiB); bounds the work a
// small, highly compressed file can cause.
const MAX_PIXEL_BYTES = 32 * 1024 * 1024;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Ancillary chunks kept in the stored copy: small, fixed-format colour and transparency
// information. Everything else optional (text, metadata, profiles) is dropped.
const KEPT_ANCILLARY = new Set(['tRNS', 'gAMA', 'sRGB', 'cHRM', 'pHYs']);
const ANCILLARY_LENGTHS: Record<string, number> = { gAMA: 4, sRGB: 1, cHRM: 32, pHYs: 9 };

// Valid bit depths per colour type (PNG specification, table 11.1).
const BIT_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export type PngReason = 'TOO_LARGE' | 'NOT_PNG' | 'BAD_DIMENSIONS';

export type PngCheck =
  | {
      ok: true;
      width: number;
      height: number;
      /** The image rebuilt from its validated chunks only: what should be stored. */
      png: Uint8Array;
    }
  | { ok: false; reason: PngReason };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Chunk {
  type: string;
  data: Uint8Array;
}

class NotPng extends Error {
  constructor(readonly reason: PngReason = 'NOT_PNG') {
    super(reason);
  }
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Every chunk, checked for length, type letters and CRC; nothing may follow IEND. */
function readChunks(bytes: Uint8Array): Chunk[] {
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte)) throw new NotPng();
  const chunks: Chunk[] = [];
  let offset = SIGNATURE.length;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new NotPng();
    const length = view(bytes).getUint32(offset);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > bytes.byteLength) throw new NotPng();
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new NotPng();
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view(bytes).getUint32(end - 4)) {
      throw new NotPng();
    }
    chunks.push({ type, data });
    offset = end;
    if (type === 'IEND') break;
  }
  if (offset !== bytes.byteLength || chunks.at(-1)?.type !== 'IEND') throw new NotPng();
  return chunks;
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

function readHeader(chunk: Chunk | undefined): Header {
  if (chunk?.type !== 'IHDR' || chunk.data.byteLength !== 13) throw new NotPng();
  const data = view(chunk.data);
  const header = {
    width: data.getUint32(0),
    height: data.getUint32(4),
    bitDepth: chunk.data[8] ?? 0,
    colorType: chunk.data[9] ?? 0,
    interlace: chunk.data[12] ?? 0,
  };
  const compression = chunk.data[10];
  const filter = chunk.data[11];
  if (!(BIT_DEPTHS[header.colorType] ?? []).includes(header.bitDepth)) throw new NotPng();
  if (compression !== 0 || filter !== 0 || header.interlace > 1) throw new NotPng();
  if (
    header.width < 1 ||
    header.height < 1 ||
    header.width > MAX_LOGO_DIMENSION ||
    header.height > MAX_LOGO_DIMENSION
  ) {
    throw new NotPng('BAD_DIMENSIONS');
  }
  return header;
}

/** Bytes of decoded scanlines (each with its filter byte), per the PNG specification. */
function expectedPixelBytes(header: Header): number {
  const bitsPerPixel = (CHANNELS[header.colorType] ?? 0) * header.bitDepth;
  const lineBytes = (width: number) =>
    width === 0 ? 0 : 1 + Math.ceil((width * bitsPerPixel) / 8);
  if (header.interlace === 0) return header.height * lineBytes(header.width);
  // Adam7: start and step of each of the seven passes, as [x0, y0, dx, dy].
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ] as const;
  return passes.reduce((total, [x0, y0, dx, dy]) => {
    const columns = Math.ceil(Math.max(0, header.width - x0) / dx);
    const rows = Math.ceil(Math.max(0, header.height - y0) / dy);
    return total + (columns === 0 ? 0 : rows * lineBytes(columns));
  }, 0);
}

// Structural types for the platform's DecompressionStream (Workers, browsers, Node 22),
// so this package needs neither DOM nor Node type definitions.
interface ByteReader {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  cancel: () => Promise<void>;
}
interface ByteWriter {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}
interface StreamPair {
  readable: { getReader: () => ByteReader };
  writable: { getWriter: () => ByteWriter };
}
type StreamConstructor = new (format: 'deflate') => StreamPair;

/** Inflates the zlib stream, stopping as soon as it would exceed `limit` bytes. */
async function inflatedLength(data: Uint8Array, limit: number): Promise<number> {
  const Decompression = (globalThis as unknown as { DecompressionStream: StreamConstructor })
    .DecompressionStream;
  const stream = new Decompression('deflate');
  const writer = stream.writable.getWriter();
  const writing = writer
    .write(data)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > limit) {
        await reader.cancel();
        throw new NotPng();
      }
    }
  } catch (error) {
    if (error instanceof NotPng) throw error;
    throw new NotPng();
  }
  await writing;
  return total;
}

function chunkBytes({ type, data }: Chunk): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  const out32 = view(out);
  out32.setUint32(0, data.byteLength);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  out32.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
}

/**
 * Checks that bytes are one complete, decodable PNG and returns a clean copy to store.
 *
 * Every chunk's CRC is verified; IHDR must come first with valid fields and dimensions;
 * a palette image needs PLTE; the IDAT chunks must be consecutive and inflate to exactly
 * the image's scanline size; IEND must end the file. The copy keeps only the critical
 * chunks and a few fixed-format colour chunks, so text or other data hidden in optional
 * chunks is not stored. Logos are also always served as image/png with nosniff.
 */
export async function inspectPng(bytes: Uint8Array): Promise<PngCheck> {
  if (bytes.byteLength > MAX_LOGO_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  try {
    const chunks = readChunks(bytes);
    const header = readHeader(chunks[0]);
    const expected = expectedPixelBytes(header);
    if (expected > MAX_PIXEL_BYTES) throw new NotPng('BAD_DIMENSIONS');

    const kept: Chunk[] = [];
    let palette = false;
    let idatSeen = false;
    let idatDone = false;
    const idat: Uint8Array[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const { type, data } = chunk;
      if (type === 'IHDR') {
        if (index !== 0) throw new NotPng();
        kept.push(chunk);
      } else if (type === 'PLTE') {
        if (palette || idatSeen || data.byteLength % 3 !== 0 || data.byteLength === 0) {
          throw new NotPng();
        }
        if (header.colorType === 0 || header.colorType === 4) throw new NotPng();
        palette = true;
        kept.push(chunk);
      } else if (type === 'IDAT') {
        if (idatDone) throw new NotPng();
        idatSeen = true;
        idat.push(data);
        kept.push(chunk);
      } else if (type === 'IEND') {
        if (data.byteLength !== 0) throw new NotPng();
        kept.push(chunk);
      } else {
        if (idatSeen) idatDone = true;
        // An unknown critical chunk (upper-case first letter) cannot be skipped safely.
        if (type.charCodeAt(0) < 0x61) throw new NotPng();
        const fixed = ANCILLARY_LENGTHS[type];
        if (
          KEPT_ANCILLARY.has(type) &&
          !idatSeen &&
          (fixed === undefined || fixed === data.byteLength)
        ) {
          if (type !== 'tRNS' || data.byteLength <= 256) kept.push(chunk);
        }
      }
    }
    if (!idatSeen || (header.colorType === 3 && !palette)) throw new NotPng();

    const compressed = new Uint8Array(idat.reduce((sum, part) => sum + part.byteLength, 0));
    let at = 0;
    for (const part of idat) {
      compressed.set(part, at);
      at += part.byteLength;
    }
    if ((await inflatedLength(compressed, expected)) !== expected) throw new NotPng();

    const parts = [Uint8Array.from(SIGNATURE), ...kept.map(chunkBytes)];
    const png = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    at = 0;
    for (const part of parts) {
      png.set(part, at);
      at += part.byteLength;
    }
    return { ok: true, width: header.width, height: header.height, png };
  } catch (error) {
    return { ok: false, reason: error instanceof NotPng ? error.reason : 'NOT_PNG' };
  }
}
