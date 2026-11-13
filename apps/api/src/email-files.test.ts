import { describe, expect, it } from 'vitest';

import { base64Of, MAX_FORM_BYTES, prepareFiles, readSendForm } from './email-files';

// Files sent with an email (F-114 step 7). Synthetic bytes only.

const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

function pdf(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) % 256;
  bytes.set(PDF_HEAD.slice(0, size));
  return bytes;
}

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Byte-equal (a plain loop: comparing 10 MiB through expect is slow). */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** A multipart request as a browser sends it: the whole body with its length. */
async function formRequest(
  parts: [string, string | Blob, string?][],
  { length }: { length?: string | null } = {},
): Promise<Request> {
  const form = new FormData();
  for (const [name, value, fileName] of parts) {
    if (typeof value === 'string') form.append(name, value);
    else form.append(name, value, fileName);
  }
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = {
    'Content-Type': encoded.headers.get('content-type') ?? '',
  };
  if (length !== null) headers['Content-Length'] = length ?? String(body.byteLength);
  return new Request('https://api.example.test/api/v1/emails', { method: 'POST', headers, body });
}

describe('base64Of', () => {
  it('decodes to exactly the bytes across piece boundaries (D1-01)', () => {
    for (const size of [0, 1, 2, 3, 24_575, 24_576, 24_577, 32_769, 49_153, 10 * 1024 * 1024 - 1]) {
      const bytes = pdf(size);
      const encoded = base64Of(bytes);
      // Padding only at the very end, never inside.
      const padding = encoded.indexOf('=');
      expect(padding === -1 || padding >= encoded.length - 2).toBe(true);
      expect(sameBytes(decode(encoded), bytes)).toBe(true);
    }
  });
});

describe('readSendForm', () => {
  it('reads the JSON part and the files', async () => {
    const read = await readSendForm(
      await formRequest([
        ['email', JSON.stringify({ subject: 'Oats' })],
        ['file', new Blob([pdf(100)]), 'a.pdf'],
        ['file', new Blob([pdf(5)]), 'b.pdf'],
      ]),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.json).toEqual({ subject: 'Oats' });
    expect(read.files.map((f) => [f.name, f.bytes.byteLength])).toEqual([
      ['a.pdf', 100],
      ['b.pdf', 5],
    ]);
  });

  it('needs a length, and refuses a body over the cap or longer than it says', async () => {
    const parts: [string, string | Blob, string?][] = [
      ['email', '{}'],
      ['file', new Blob([pdf(100)]), 'a.pdf'],
    ];
    expect(await readSendForm(await formRequest(parts, { length: null }))).toMatchObject({
      ok: false,
      status: 411,
    });
    expect(await readSendForm(await formRequest(parts, { length: 'x' }))).toMatchObject({
      status: 411,
    });
    expect(
      await readSendForm(await formRequest(parts, { length: String(MAX_FORM_BYTES + 1) })),
    ).toMatchObject({ status: 413 });
    expect(await readSendForm(await formRequest(parts, { length: '50' }))).toMatchObject({
      status: 413,
    });
    expect(
      await readSendForm(
        await formRequest([
          ['email', '{}'],
          ['file', new Blob([new Uint8Array(MAX_FORM_BYTES)]), 'a.pdf'],
        ]),
      ),
    ).toMatchObject({ status: 413 });
  });

  it('refuses unknown, repeated or missing parts, and more than 10 files', async () => {
    const file: [string, Blob, string] = ['file', new Blob([pdf(10)]), 'a.pdf'];
    const refused = async (parts: [string, string | Blob, string?][]) =>
      readSendForm(await formRequest(parts));
    expect(await refused([['email', '{}'], file, ['other', 'x']])).toMatchObject({ status: 422 });
    expect(await refused([['email', '{}'], ['email', '{}'], file])).toMatchObject({ status: 422 });
    expect(await refused([['email', new Blob(['{}']), 'e.json'], file])).toMatchObject({
      status: 422,
    });
    expect(
      await refused([
        ['file', 'not a file'],
        ['email', '{}'],
      ]),
    ).toMatchObject({ status: 422 });
    expect(await refused([['email', '{}']])).toMatchObject({ status: 422 });
    expect(await refused([file])).toMatchObject({ status: 422 });
    expect(await refused([['email', 'not json'], file])).toMatchObject({ status: 422 });
    expect(
      await refused([['email', '{}'], ...Array.from({ length: 11 }, () => file)]),
    ).toMatchObject({ status: 422, code: 'ATTACHMENT_REFUSED' });
    const garbled = new Request('https://api.example.test/', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': '5' },
      body: 'hello',
    });
    expect(await readSendForm(garbled)).toMatchObject({ status: 422 });
  });
});

describe('prepareFiles', () => {
  it('keeps the kind the bytes show, a clean name and the checksum', async () => {
    const prepared = await prepareFiles([{ name: 'scan.heic', bytes: pdf(10) }]);
    expect(prepared).toEqual({
      ok: true,
      files: [
        {
          position: 0,
          fileName: 'scan.pdf',
          contentType: 'application/pdf',
          sizeBytes: 10,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
          bytes: pdf(10),
        },
      ],
    });
  });

  it('refuses a file that is not a PDF or photo, an empty one, or more than 10 MB', async () => {
    expect(
      await prepareFiles([{ name: 'page.html', bytes: new TextEncoder().encode('<html>') }]),
    ).toMatchObject({ ok: false });
    expect(await prepareFiles([{ name: 'a.pdf', bytes: new Uint8Array() }])).toMatchObject({
      ok: false,
    });
    expect(
      await prepareFiles([
        { name: 'a.pdf', bytes: pdf(10 * 1024 * 1024) },
        { name: 'b.pdf', bytes: pdf(10) },
      ]),
    ).toMatchObject({ ok: false });
  });
});
