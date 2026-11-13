import {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_HEAD_BYTES,
  ATTACHMENT_MAX_FILES,
  checkAttachments,
} from '@grain/domain';

import { sha256Hex } from './inbound-email';

// Files attached to an email sent from a company's page (F-114 step 7; docs/reviews/F-114-7.md).
// The form sends them as multipart/form-data: one part `email` (the JSON of a text-only send) and
// 1 to 10 parts `file`. The body is read whole, with a hard cap, before it is parsed, so the
// Worker's memory stays bounded; every rule of packages/domain/src/emailAttachments.ts is checked
// here again, and the database checks the list once more.

/** The largest JSON part: as a text-only send (emails.ts). */
export const MAX_SEND_BYTES = 640 * 1024;
/** The largest multipart body: 10 MiB of files, the JSON and the parts' own headers. */
export const MAX_FORM_BYTES = 11.5 * 1024 * 1024;

/** A file as the person chose it, read from the form. */
export interface ChosenFile {
  name: string;
  bytes: Uint8Array;
}

/** A file ready to be kept and sent: its kind decided by its bytes, its name cleaned. */
export interface SentFile {
  position: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
}

export type FormRead =
  | { ok: true; json: unknown; files: ChosenFile[] }
  | { ok: false; status: 411 | 413 | 422; code: string; message: string };

const malformed = (message: string): FormRead => ({
  ok: false,
  status: 422,
  code: 'VALIDATION_FAILED',
  message,
});
const tooLarge: FormRead = {
  ok: false,
  status: 413,
  code: 'PAYLOAD_TOO_LARGE',
  message: 'The email and its files are too large. Files come to at most 10 MB.',
};

/**
 * The body, at most `max` bytes and no longer than its declared length (a body longer than its
 * Content-Length is cut off as soon as it passes either): null when too large.
 */
async function cappedBody(
  body: ReadableStream<Uint8Array> | null,
  declared: number,
  max: number,
): Promise<Uint8Array | null> {
  const limit = Math.min(declared, max);
  const buffer = new Uint8Array(limit);
  let length = 0;
  if (body === null) return buffer.subarray(0, 0);
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.byteLength > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    buffer.set(value, length);
    length += value.byteLength;
  }
  return buffer.subarray(0, length);
}

/** A multipart send: its JSON part and its files, or why it is refused. */
export async function readSendForm(request: Request): Promise<FormRead> {
  const declared = request.headers.get('content-length');
  if (declared === null || !/^\d{1,9}$/.test(declared)) {
    return {
      ok: false,
      status: 411,
      code: 'LENGTH_REQUIRED',
      message: 'The request must state its length.',
    };
  }
  if (Number(declared) > MAX_FORM_BYTES) return tooLarge;
  const body = await cappedBody(request.body, Number(declared), MAX_FORM_BYTES);
  if (body === null) return tooLarge;

  let form: FormData;
  try {
    form = await new Request('https://form.invalid/', {
      method: 'POST',
      headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
      body,
    }).formData();
  } catch {
    return malformed('The request is malformed.');
  }

  let json: string | null = null;
  const files: ChosenFile[] = [];
  for (const [name, value] of form.entries()) {
    if (name === 'email' && typeof value === 'string' && json === null) {
      if (new TextEncoder().encode(value).byteLength > MAX_SEND_BYTES) return tooLarge;
      json = value;
    } else if (name === 'file' && typeof value !== 'string') {
      if (files.length >= ATTACHMENT_MAX_FILES) {
        return attachmentRefusal(`At most ${String(ATTACHMENT_MAX_FILES)} files on one email.`);
      }
      files.push({ name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
    } else {
      return malformed('The request is malformed.');
    }
  }
  if (json === null || files.length === 0) return malformed('The request is malformed.');
  try {
    return { ok: true, json: JSON.parse(json) as unknown, files };
  } catch {
    return malformed('The request body is not JSON.');
  }
}

function attachmentRefusal(message: string): FormRead {
  return { ok: false, status: 422, code: 'ATTACHMENT_REFUSED', message };
}

/**
 * The files as they are kept and sent, or the message naming the first one refused: at most 10,
 * none empty, PDFs and JPEG or PNG photos by their first bytes, 10 MiB in all.
 */
export async function prepareFiles(
  files: readonly ChosenFile[],
): Promise<{ ok: true; files: SentFile[] } | { ok: false; message: string }> {
  const check = checkAttachments(
    files.map((file) => ({
      name: file.name,
      size: file.bytes.byteLength,
      head: file.bytes.subarray(0, ATTACHMENT_HEAD_BYTES),
    })),
  );
  if (!check.ok) return check;
  const prepared: SentFile[] = [];
  for (const [position, file] of files.entries()) {
    const kind = check.kinds[position];
    const fileName = check.names[position];
    if (kind === undefined || fileName === undefined) throw new Error('Unchecked file');
    prepared.push({
      position,
      fileName,
      contentType: ATTACHMENT_CONTENT_TYPES[kind],
      sizeBytes: file.bytes.byteLength,
      sha256: await sha256Hex(file.bytes),
      bytes: file.bytes,
    });
  }
  return { ok: true, files: prepared };
}

/**
 * Base64 of the bytes, built in pieces of 24,576 bytes: a multiple of 3, so no piece but the last
 * ends in padding and the joined string decodes to exactly the bytes (Codex's design review,
 * F-114-7-D1-01). Linear time: each piece encoded once, the pieces joined once.
 */
export function base64Of(bytes: Uint8Array): string {
  const PIECE = 24_576;
  const pieces: string[] = [];
  for (let start = 0; start < bytes.byteLength; start += PIECE) {
    const piece = bytes.subarray(start, start + PIECE);
    let binary = '';
    for (let i = 0; i < piece.byteLength; i += 4096) {
      binary += String.fromCharCode(...piece.subarray(i, i + 4096));
    }
    pieces.push(btoa(binary));
  }
  return pieces.join('');
}
