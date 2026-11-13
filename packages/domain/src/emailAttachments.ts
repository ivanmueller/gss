// Files attached to an email sent from a company's page (F-114 step 7; the owner's answers 4,
// 2026-11-10 and 2026-11-12): files from the computer only, PDFs and JPEG or PNG photos, at most
// 10 files and 10 MB in all. The kind is decided by the file's first bytes, never by its name or
// the type the browser declares. The browser checks these for a quick message; the Worker checks
// them again, and the database once more.

/** At most this many files on one email. */
export const ATTACHMENT_MAX_FILES = 10;
/** At most this many bytes of files on one email, all files together (10 MiB). */
export const ATTACHMENT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
/** How many first bytes the kind is read from. */
export const ATTACHMENT_HEAD_BYTES = 8;
/** At most this many characters in a file's name, its extension included. */
export const ATTACHMENT_NAME_MAX = 200;

export type AttachmentKind = 'pdf' | 'jpeg' | 'png';

/** The type sent and kept for each kind. */
export const ATTACHMENT_CONTENT_TYPES: Record<AttachmentKind, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** What the file chooser offers (the kind is still read from the bytes). */
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

export const ATTACHMENT_RULE = 'Up to 10 files, 10 MB in all. PDFs and JPEG or PNG photos.';

const SIGNATURES: [AttachmentKind, number[]][] = [
  ['pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  ['jpeg', [0xff, 0xd8, 0xff]],
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
];

/** The file's kind from its first bytes, or null when it is none of the three. */
export function attachmentKind(head: Uint8Array): AttachmentKind | null {
  for (const [kind, signature] of SIGNATURES) {
    if (signature.every((byte, i) => head[i] === byte)) return kind;
  }
  return null;
}

/** The extensions each kind may keep; the first is the one added. */
const EXTENSIONS: Record<AttachmentKind, string[]> = {
  pdf: ['pdf'],
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
};

// Control characters, bidirectional controls (which can make "gpj.exe" read as "exe.jpg"), and
// what Windows refuses in a file name.
// eslint-disable-next-line no-control-regex
const REMOVED = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069:*?"<>|]/g;

/** Cut to at most `most` whole characters (code points), never half of one. */
function cut(text: string, most: number): string {
  const chars = Array.from(text);
  return chars.length <= most ? text : chars.slice(0, most).join('');
}

function trimEnds(text: string): string {
  return text.replace(/^[\s.]+|[\s.]+$/gu, '');
}

/** A name split into its base and its extension (without the dot), as the kind wants it. */
function parts(name: string, kind: AttachmentKind, position: number): [string, string] {
  // The last path segment only: a browser may hand over "C:\fakepath\…" or a folder's path.
  const segment = name.split(/[/\\]/).pop() ?? '';
  const cleaned = trimEnds(segment.normalize('NFC').replace(REMOVED, ''));
  const dot = cleaned.lastIndexOf('.');
  let base = cleaned;
  let extension = EXTENSIONS[kind][0] ?? kind;
  if (dot > 0) {
    const own = cleaned.slice(dot + 1);
    if (EXTENSIONS[kind].includes(own.toLowerCase())) {
      base = cleaned.slice(0, dot);
      extension = own;
    } else if (/^[A-Za-z]{1,5}$/.test(own)) {
      // Another kind's extension ("photo.heic" that is really a JPEG): replaced.
      base = cleaned.slice(0, dot);
    }
  }
  base = trimEnds(base);
  return [base === '' ? `attachment-${String(position + 1)}` : base, extension];
}

function joined(base: string, extension: string, suffix: string): string {
  const room = ATTACHMENT_NAME_MAX - extension.length - 1 - Array.from(suffix).length;
  const kept = trimEnds(cut(base, room));
  return `${kept === '' ? 'attachment' : kept}${suffix}.${extension}`;
}

/**
 * The names the files are sent and kept under, in order: each cleaned (last path segment; no
 * control or bidirectional characters nor `: * ? " < > |`; NFC; no dots or spaces at either end),
 * with the extension of its kind, at most ATTACHMENT_NAME_MAX characters, and a name used twice
 * (letter case aside) given " (2)", " (3)" before its extension.
 */
export function attachmentNames(
  files: readonly { name: string; kind: AttachmentKind }[],
): string[] {
  const used = new Set<string>();
  return files.map((file, position) => {
    const [base, extension] = parts(file.name, file.kind, position);
    let name = joined(base, extension, '');
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      name = joined(base, extension, ` (${String(n)})`);
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** One chosen file as the checks see it. */
export interface AttachmentCandidate {
  name: string;
  size: number;
  /** Its first bytes (at least ATTACHMENT_HEAD_BYTES when it is that long). */
  head: Uint8Array;
}

export type AttachmentCheck =
  { ok: true; kinds: AttachmentKind[]; names: string[] } | { ok: false; message: string };

/** Whether the files may be sent together, and their kinds and names if so. */
export function checkAttachments(files: readonly AttachmentCandidate[]): AttachmentCheck {
  if (files.length > ATTACHMENT_MAX_FILES) {
    return {
      ok: false,
      message: `At most ${String(ATTACHMENT_MAX_FILES)} files on one email.`,
    };
  }
  const kinds: AttachmentKind[] = [];
  let total = 0;
  for (const file of files) {
    const label = file.name.split(/[/\\]/).pop() ?? file.name;
    if (file.size < 1) return { ok: false, message: `“${label}” is empty.` };
    const kind = attachmentKind(file.head);
    if (kind === null) {
      return {
        ok: false,
        message: `“${label}” cannot be attached. Only PDFs and JPEG or PNG photos can be attached. Save it as one of those first.`,
      };
    }
    kinds.push(kind);
    total += file.size;
  }
  if (total > ATTACHMENT_MAX_TOTAL_BYTES) {
    return { ok: false, message: 'The files come to more than 10 MB. Send fewer or smaller ones.' };
  }
  return {
    ok: true,
    kinds,
    names: attachmentNames(files.map((file, i) => ({ name: file.name, kind: kinds[i] ?? 'pdf' }))),
  };
}
