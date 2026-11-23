/**
 * A small zip reader for the AER's monthly rig archives (F-282): the files a zip holds, by their
 * central directory, each stored or deflated, opened with the runtime's own DecompressionStream.
 * No encryption, no zip64, no multi-part archives: an archive with any of them is refused.
 */

export interface ZipEntry {
  /** The name as written in the zip, folders included. */
  name: string;
  bytes: Uint8Array;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

export class ZipError extends Error {}

async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new ZipError('a file in the zip is too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * The files in a zip (folders left out), each at most `maxEntryBytes` once opened, at most
 * `maxEntries` of them.
 */
export async function readZip(
  zip: Uint8Array,
  maxEntryBytes: number,
  maxEntries = 100,
): Promise<ZipEntry[]> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end of the central directory: in the last 22 bytes, or before a comment of up to 64 KB.
  let end = -1;
  for (let at = zip.byteLength - 22; at >= Math.max(0, zip.byteLength - 22 - 65_535); at -= 1) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError('not a zip');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryAt = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    throw new ZipError('a zip in several parts');
  }
  if (count > maxEntries) throw new ZipError('too many files in the zip');
  if (directoryAt + directorySize > end) throw new ZipError('a broken zip');
  const names = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let at = directoryAt;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== DIRECTORY_ENTRY) {
      throw new ZipError('a broken zip');
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = names.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if ((flags & 1) !== 0) throw new ZipError('an encrypted zip');
    if (compressed === 0xffffffff || size === 0xffffffff) throw new ZipError('a zip64 file');
    if (size > maxEntryBytes) throw new ZipError('a file in the zip is too large');
    if (localAt + 30 > zip.byteLength || view.getUint32(localAt, true) !== LOCAL_HEADER) {
      throw new ZipError('a broken zip');
    }
    const dataAt =
      localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    if (dataAt + compressed > zip.byteLength) throw new ZipError('a broken zip');
    const data = zip.subarray(dataAt, dataAt + compressed);
    let bytes: Uint8Array;
    if (method === 0) bytes = data.slice();
    else if (method === 8) bytes = await inflateRaw(data, maxEntryBytes);
    else throw new ZipError('a zip compressed in an unknown way');
    if (bytes.byteLength !== size) throw new ZipError('a broken zip');
    entries.push({ name, bytes });
  }
  return entries;
}
