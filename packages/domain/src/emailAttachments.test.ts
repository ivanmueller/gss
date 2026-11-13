import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_MAX_TOTAL_BYTES,
  ATTACHMENT_NAME_MAX,
  attachmentKind,
  attachmentNames,
  checkAttachments,
  type AttachmentCandidate,
} from './emailAttachments';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const file = (name: string, head: Uint8Array, size = 1000): AttachmentCandidate => ({
  name,
  size,
  head,
});

describe('attachmentKind', () => {
  it('reads the kind from the first bytes only', () => {
    expect(attachmentKind(PDF)).toBe('pdf');
    expect(attachmentKind(JPEG)).toBe('jpeg');
    expect(attachmentKind(PNG)).toBe('png');
    expect(attachmentKind(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]))).toBeNull();
    expect(attachmentKind(new Uint8Array([0x25, 0x50, 0x44]))).toBeNull();
    expect(attachmentKind(new Uint8Array([]))).toBeNull();
    // HEIC (an ISO box "ftypheic") is refused.
    expect(
      attachmentKind(
        new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
      ),
    ).toBeNull();
  });
});

describe('attachmentNames', () => {
  it('keeps the last path segment, without control, bidirectional or forbidden characters', () => {
    expect(
      attachmentNames([
        { name: 'C:\\fakepath\\Contract.pdf', kind: 'pdf' },
        { name: 'photos/load 1.JPG', kind: 'jpeg' },
        { name: 'a\u0000b\u202ec<>:"|?*.png', kind: 'png' },
        { name: '  ..scale ticket.pdf.. ', kind: 'pdf' },
      ]),
    ).toEqual(['Contract.pdf', 'load 1.JPG', 'abc.png', 'scale ticket.pdf']);
  });

  it('gives the extension of the kind the bytes show', () => {
    expect(
      attachmentNames([
        { name: 'photo.heic', kind: 'jpeg' },
        { name: 'invoice', kind: 'pdf' },
        { name: 'report.2026', kind: 'pdf' },
        { name: 'trick.exe', kind: 'png' },
        { name: 'shot.jpeg', kind: 'jpeg' },
      ]),
    ).toEqual(['photo.jpg', 'invoice.pdf', 'report.2026.pdf', 'trick.png', 'shot.jpeg']);
  });

  it('names an empty name by its place, and numbers a name used twice', () => {
    expect(
      attachmentNames([
        { name: '', kind: 'pdf' },
        { name: '...', kind: 'png' },
        { name: 'Ticket.pdf', kind: 'pdf' },
        { name: 'ticket.PDF', kind: 'pdf' },
        { name: 'Ticket.pdf', kind: 'pdf' },
      ]),
    ).toEqual([
      'attachment-1.pdf',
      'attachment-2.png',
      'Ticket.pdf',
      'ticket (2).PDF',
      'Ticket (3).pdf',
    ]);
  });

  it('cuts a long name on whole characters, keeping the extension, in NFC', () => {
    const [long] = attachmentNames([{ name: `${'😀'.repeat(300)}.png`, kind: 'png' }]);
    expect(Array.from(long ?? '').length).toBe(ATTACHMENT_NAME_MAX);
    expect(long?.endsWith('😀.png')).toBe(true);
    const [composed] = attachmentNames([{ name: 'cafe\u0301.pdf', kind: 'pdf' }]);
    expect(composed).toBe('caf\u00e9.pdf');
  });
});

describe('checkAttachments', () => {
  it('accepts up to 10 PDFs and photos within 10 MB, with kinds and names', () => {
    const check = checkAttachments([file('a.pdf', PDF), file('b.png', PNG), file('c.jpg', JPEG)]);
    expect(check).toEqual({
      ok: true,
      kinds: ['pdf', 'png', 'jpeg'],
      names: ['a.pdf', 'b.png', 'c.jpg'],
    });
    expect(checkAttachments([]).ok).toBe(true);
    expect(
      checkAttachments([file('a.pdf', PDF, ATTACHMENT_MAX_TOTAL_BYTES - 1), file('b.pdf', PDF, 1)])
        .ok,
    ).toBe(true);
  });

  it('refuses more than 10, an empty file, another kind or more than 10 MB, naming the file', () => {
    expect(checkAttachments(Array.from({ length: 11 }, () => file('a.pdf', PDF)))).toEqual({
      ok: false,
      message: 'At most 10 files on one email.',
    });
    expect(checkAttachments([file('C:\\x\\empty.pdf', PDF, 0)])).toEqual({
      ok: false,
      message: '“empty.pdf” is empty.',
    });
    const other = checkAttachments([
      file('a.pdf', PDF),
      file('notes.docx', new Uint8Array([0x50, 0x4b, 3, 4])),
    ]);
    expect(other.ok).toBe(false);
    expect(!other.ok && other.message).toContain('“notes.docx” cannot be attached');
    expect(
      checkAttachments([file('a.pdf', PDF, ATTACHMENT_MAX_TOTAL_BYTES), file('b.pdf', PDF, 1)]),
    ).toEqual({
      ok: false,
      message: 'The files come to more than 10 MB. Send fewer or smaller ones.',
    });
  });
});
