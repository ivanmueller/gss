/** Largest logo accepted, matching the database check on app.counterparty_logos. */
export const MAX_LOGO_BYTES = 512 * 1024;
/** Largest width or height accepted for a logo, in pixels. */
export const MAX_LOGO_DIMENSION = 4096;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// The IEND chunk: length 0, type "IEND", CRC ae426082.
const IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

export type PngCheck =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: 'TOO_LARGE' | 'NOT_PNG' | 'BAD_DIMENSIONS' };

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset);
}

/**
 * Checks that bytes form a whole PNG file: the signature, an IHDR chunk first and an
 * IEND chunk last, within the size and dimension limits. It does not decode pixels;
 * logos are always served as image/png with nosniff.
 */
export function inspectPng(bytes: Uint8Array): PngCheck {
  if (bytes.byteLength > MAX_LOGO_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  // Signature (8) + IHDR chunk (4 length + 4 type + 13 data + 4 CRC) + IEND chunk (12).
  if (bytes.byteLength < 8 + 25 + 12) return { ok: false, reason: 'NOT_PNG' };
  if (!startsWith(bytes, SIGNATURE)) return { ok: false, reason: 'NOT_PNG' };
  if (readUint32(bytes, 8) !== 13 || !startsWith(bytes, [0x49, 0x48, 0x44, 0x52], 12)) {
    return { ok: false, reason: 'NOT_PNG' };
  }
  if (!startsWith(bytes, IEND, bytes.byteLength - IEND.length)) {
    return { ok: false, reason: 'NOT_PNG' };
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (width < 1 || height < 1 || width > MAX_LOGO_DIMENSION || height > MAX_LOGO_DIMENSION) {
    return { ok: false, reason: 'BAD_DIMENSIONS' };
  }
  return { ok: true, width, height };
}
