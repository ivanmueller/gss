import PostalMime, { addressParser, type Address, type Email, type Header } from 'postal-mime';

// Email received by the Worker (F-114 step 4a; the owner's answers 13 to 15 of 2026-11-11 in
// docs/FEATURES.md). Cloudflare Email Routing hands each message for the business's domain to the
// Worker's `email()` handler. This module reads one message into what `app.receive_email` keeps.
// Nothing here sends, forwards or answers mail (AGENTS.md rule 8).

/** Cloudflare Email Routing refuses larger messages; the Worker checks again. */
export const MAX_RAW_BYTES = 25 * 1024 * 1024;
/** app.emails.body_text's limit. */
export const MAX_BODY_CHARS = 500_000;
/** app.emails.reference_ids' limit. */
export const MAX_REFERENCES = 50;
/** Kept per To and Cc list (app.emails' incoming shape). */
export const MAX_ADDRESSES = 500;
/** Attachment rows kept per email (app.email_attachments.position 0..99). */
export const MAX_ATTACHMENTS = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DOMAIN =
  /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
// As app.email_address: lowercase, one @, no spaces or control characters, at most 254.
const ADDRESS = /^[^@\s\p{Cc}]+@[^@\s\p{Cc}]+$/u;
// As app.email_header_token: no spaces or control characters, 1 to 998.
const TOKEN = /^[^\s\p{Cc}]{1,998}$/u;
const CONTROL = /\p{Cc}/gu;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

export interface InboundBindings {
  EMAIL_DOMAIN?: string | undefined;
  EMAIL_ORGANIZATION_ID?: string | undefined;
}

export interface InboundConfig {
  domain: string;
  organizationId: string;
}

/**
 * The domain the Worker receives for and the one organization that owns its mail (Worker
 * secrets, as for sending), or null. Receiving does not need the sending binding.
 */
export function inboundConfig(env: InboundBindings): InboundConfig | null {
  const domain = env.EMAIL_DOMAIN?.trim().toLowerCase() ?? '';
  const organizationId = env.EMAIL_ORGANIZATION_ID?.trim().toLowerCase() ?? '';
  if (!DOMAIN.test(domain) || !UUID.test(organizationId)) return null;
  return { domain, organizationId };
}

/** An address as kept, or null. */
export function cleanAddress(value: string | null | undefined): string | null {
  const address = wellFormed(value ?? '')
    .trim()
    .toLowerCase();
  return address.length <= 254 && ADDRESS.test(address) ? address : null;
}

/** The envelope recipient when it is on the configured domain, else null. */
export function envelopeOnDomain(to: string, config: InboundConfig): string | null {
  const address = cleanAddress(to);
  if (address === null) return null;
  return address.slice(address.lastIndexOf('@') + 1) === config.domain ? address : null;
}

// A UTF-16 half of a character with no other half (a malformed name, or a cut in the middle of an
// emoji): JSON keeps it as \ud83d, which PostgreSQL's jsonb refuses (Codex's final review, R3-02).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Text the database accepts: lone surrogate halves replaced by U+FFFD. */
export function wellFormed(value: string): string {
  return value.replace(LONE_SURROGATE, '�');
}

/** At most `max` UTF-16 units, never ending in half a character. */
export function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** One line of text: control characters (CR and LF among them) become spaces. */
function oneLine(value: string | null | undefined, max: number): string {
  const line = wellFormed(value ?? '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cut(line, max).trim();
}

function headerToken(value: string | null | undefined): string | null {
  const token = wellFormed(value ?? '').trim();
  return TOKEN.test(token) ? token : null;
}

/** Message-ID-like tokens in a header (In-Reply-To, References), in order. */
export function headerTokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((part) => headerToken(part))
    .filter((part): part is string => part !== null);
}

function mailboxes(list: Address[] | Address | undefined): { name: string; address: string }[] {
  const items = list === undefined ? [] : Array.isArray(list) ? list : [list];
  return items.flatMap((item) => item.group ?? [{ name: item.name, address: item.address }]);
}

function addressList(list: Address[] | undefined): string[] {
  const seen = new Set<string>();
  for (const box of mailboxes(list)) {
    const address = cleanAddress(box.address);
    if (address !== null) seen.add(address);
    if (seen.size >= MAX_ADDRESSES) break;
  }
  return [...seen];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// Tags that start a new line where they open or end (Codex's final review, R3-03).
const LINE_TAGS = new Set([
  'p',
  'div',
  'tr',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'table',
  'ul',
  'ol',
]);
const CELL_TAGS = new Set(['td', 'th']);
const SKIPPED_TAGS = new Set(['script', 'style', 'head', 'title']);
const TAG_NAME = /^<\/?\s*([a-z][a-z0-9]*)/i;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) return safeCodePoint(Number.parseInt(lower.slice(2), 16), whole);
    if (lower.startsWith('#')) return safeCodePoint(Number.parseInt(lower.slice(1), 10), whole);
    return ENTITIES[lower] ?? whole;
  });
}

/** Where the end tag `</name` starts at or after `from`, in any case, or -1. Linear. */
function endTagAt(html: string, name: string, from: number): number {
  let at = from;
  for (;;) {
    const found = html.indexOf('</', at);
    if (found === -1) return -1;
    if (html.slice(found + 2, found + 2 + name.length).toLowerCase() === name) return found;
    at = found + 2;
  }
}

/**
 * Plain text from an HTML body, for mail sent without a text part. The HTML is never kept.
 * - One pass from left to right, each search starting where the last one ended, so its time grows
 *   only with the length of the HTML (Codex's final review, R3-01).
 * - It stops once it holds more than `limit` characters and keeps no copy of the HTML, so its
 *   memory stays small whatever the message holds (round 4, R4-01).
 * - A cell after another of its row starts with a tab, a row on a new line, whether or not the
 *   sender closed them (R3-03, R4-02: "<td>250<td>100" reads as 250, a tab, 100).
 * - The text is gathered in pieces of at most CHUNK characters, joined once at the end, and the
 *   last character is remembered rather than read back, so a growing string is never re-read
 *   (round 5, R5-01: reading it back made many short paragraphs take seconds).
 */
export function htmlToText(html: string, limit = MAX_BODY_CHARS + 1): string {
  const CHUNK = 4096;
  const chunks: string[] = [];
  let current = '';
  let length = 0;
  let last = '';
  let cellInRow = false;
  const emit = (value: string) => {
    if (value === '' || length >= limit) return;
    current += value;
    length += value.length;
    last = value.charAt(value.length - 1);
    if (current.length >= CHUNK) {
      chunks.push(current);
      current = '';
    }
  };
  // Inside a <blockquote> (an earlier email quoted), each line starts with "> ", as in plain
  // text mail, so the quotation stays marked once the HTML is gone (Codex's final review of
  // F-114-5a, finding R2-01: Claude must not read GSS's quoted price as a new one).
  let quoteDepth = 0;
  const text = (value: string) => {
    if (length >= limit) return;
    let decoded = decodeEntities(value.slice(0, (limit - length) * 10 + 16));
    if (quoteDepth > 0) {
      decoded = decoded.replace(/[\r\n]+/g, ' ');
      if (decoded.trim() === '') return;
      if (length === 0 || last === '\n') {
        emit('> '.repeat(Math.min(quoteDepth, 5)));
        decoded = decoded.trimStart();
      }
    }
    emit(decoded);
  };
  const newLine = () => {
    cellInRow = false;
    if (length > 0 && last !== '\n') emit('\n');
  };
  let at = 0;
  while (at < html.length && length < limit) {
    const open = html.indexOf('<', at);
    if (open === -1) {
      text(html.slice(at));
      break;
    }
    text(html.slice(at, open));
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      if (end === -1) break;
      at = end + 3;
      continue;
    }
    const close = html.indexOf('>', open + 1);
    // No > anywhere after it: the rest is text, not a tag.
    if (close === -1) {
      text(html.slice(open));
      break;
    }
    const name = TAG_NAME.exec(html.slice(open, Math.min(close, open + 40)))?.[1]?.toLowerCase();
    const ending = html.charAt(open + 1) === '/';
    at = close + 1;
    if (name === undefined) continue;
    if (!ending && SKIPPED_TAGS.has(name)) {
      const end = endTagAt(html, name, at);
      if (end === -1) break;
      const endClose = html.indexOf('>', end);
      if (endClose === -1) break;
      at = endClose + 1;
      continue;
    }
    if (name === 'blockquote') {
      newLine();
      quoteDepth = ending ? Math.max(quoteDepth - 1, 0) : quoteDepth + 1;
    } else if (CELL_TAGS.has(name)) {
      if (!ending) {
        if (cellInRow) emit('\t');
        cellInRow = true;
      }
    } else if (name === 'br' || LINE_TAGS.has(name)) {
      newLine();
    }
  }
  chunks.push(current);
  return cut(chunks.join(''), limit)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
    ? String.fromCodePoint(code)
    : fallback;
}

/** The body as kept: text (or text from the HTML), NUL removed, cut to the limit. */
function bodyText(email: Email): { text: string; truncated: boolean } {
  const source = email.text ?? (email.html === undefined ? '' : htmlToText(email.html));
  const text = wellFormed(source.replaceAll(String.fromCharCode(0), '')).trimEnd();
  return text.length > MAX_BODY_CHARS
    ? { text: cut(text, MAX_BODY_CHARS), truncated: true }
    : { text, truncated: false };
}

export type DmarcResult = 'pass' | 'fail' | 'none' | 'other' | 'missing';

/**
 * DMARC as Cloudflare Email Routing found it: only the first Authentication-Results header, and
 * only when its authserv-id is mx.cloudflare.net (Cloudflare prepends it; later ones may come
 * from the sender and are never trusted).
 */
export function dmarcResult(headers: readonly Header[]): DmarcResult {
  const first = headers.find((header) => header.key === 'authentication-results');
  if (first === undefined) return 'missing';
  const [authservId = '', ...results] = first.value.split(';');
  if (authservId.trim().toLowerCase() !== 'mx.cloudflare.net') return 'missing';
  for (const part of results) {
    const match = /^\s*dmarc\s*=\s*([a-z]+)/i.exec(part);
    if (match?.[1] !== undefined) {
      const value = match[1].toLowerCase();
      return value === 'pass' || value === 'fail' || value === 'none' ? value : 'other';
    }
  }
  return 'missing';
}

function headerValue(headers: readonly Header[], key: string): string | null {
  return headers.find((header) => header.key === key)?.value ?? null;
}

/**
 * An automatic message (an out-of-office reply, a delivery report, a mailing): kept and marked,
 * never answered.
 */
export function isAutomatic(headers: readonly Header[], envelopeFrom: string): boolean {
  const autoSubmitted = headerValue(headers, 'auto-submitted')?.trim().toLowerCase();
  if (autoSubmitted !== undefined && autoSubmitted !== '' && !autoSubmitted.startsWith('no'))
    return true;
  if (headers.some((h) => h.key === 'x-autoreply' || h.key === 'x-autorespond')) return true;
  const precedence = headerValue(headers, 'precedence')?.trim().toLowerCase() ?? '';
  if (['auto_reply', 'bulk', 'junk', 'list'].includes(precedence)) return true;
  const sender = envelopeFrom.trim().toLowerCase();
  if (sender === '' || sender === '<>') return true;
  const local = sender.slice(0, sender.indexOf('@'));
  if (local === 'mailer-daemon' || local === 'postmaster') return true;
  const contentType = headerValue(headers, 'content-type')?.toLowerCase() ?? '';
  return contentType.startsWith('multipart/report');
}

export interface InboundAttachment {
  position: number;
  fileName: string | null;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  disposition: 'attachment' | 'inline';
  contentId: string | null;
}

export interface InboundEmail {
  envelopeTo: string;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  body: string;
  bodyTruncated: boolean;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  dmarc: DmarcResult;
  automatic: boolean;
  parseFailed: boolean;
  attachments: InboundAttachment[];
  /** Attachments beyond MAX_ATTACHMENTS (kept in the raw message, not listed). */
  attachmentsNotListed: number;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function attachmentBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/** How a received message is parsed, on receipt and again for a download (the same positions). */
const PARSE_OPTIONS = {
  attachmentEncoding: 'arraybuffer',
  maxNestingDepth: 50,
  maxPartCount: 1000,
} as const;

/**
 * One listed attachment's bytes, read again from the stored original (F-114 step 4b): the
 * attachment at its listed position when its SHA-256 is the one kept, else the first listed
 * attachment with that hash (should a parser update move positions). 'unreadable' when the
 * original cannot be parsed or no attachment has that hash.
 */
export async function attachmentFromOriginal(
  raw: Uint8Array,
  position: number,
  sha256: string,
): Promise<Uint8Array | 'unreadable'> {
  let email: Email;
  try {
    email = await PostalMime.parse(raw, PARSE_OPTIONS);
  } catch {
    return 'unreadable';
  }
  const listed = email.attachments.slice(0, MAX_ATTACHMENTS);
  const order = [position, ...[...listed.keys()].filter((i) => i !== position)].filter(
    (i) => i >= 0 && i < listed.length,
  );
  for (const index of order) {
    const content = listed[index]?.content;
    if (content === undefined) continue;
    const bytes = attachmentBytes(content);
    if ((await sha256Hex(bytes)) === sha256) return bytes;
  }
  return 'unreadable';
}

/**
 * The sender and Message-ID from the headers alone, for admission before the message is read
 * and stored (Codex's final review, R4-01: nothing heavy runs before the raw copy is safe). The
 * same rules as readInbound; where they differ on a malformed header, the database's own
 * duplicate and own-copy checks still apply when the message is kept.
 */
export function admissionIdentity(
  headers: { get(name: string): string | null },
  rawSha256: string,
  envelopeFrom: string,
): { sender: string; messageId: string } {
  let from: string | null;
  try {
    from = cleanAddress(mailboxes(addressParser(headers.get('from') ?? ''))[0]?.address);
  } catch {
    from = null;
  }
  return {
    sender: from ?? cleanAddress(envelopeFrom) ?? 'unknown@invalid',
    messageId: headerTokens(headers.get('message-id'))[0] ?? `<${rawSha256}@missing.invalid>`,
  };
}

/**
 * The message kept as unreadable: its sender from the envelope, its time, and its raw copy, which
 * is stored whatever happens. Also what the Worker keeps when the database refuses the message as
 * read (so it never waits forever: Codex's final review, R3-02).
 */
export function unreadableEmail(
  rawSha256: string,
  envelope: { from: string; to: string },
  messageId = `<${rawSha256}@missing.invalid>`,
): InboundEmail {
  return {
    envelopeTo: cleanAddress(envelope.to) ?? 'unknown@invalid',
    fromAddress: cleanAddress(envelope.from) ?? 'unknown@invalid',
    fromName: null,
    to: [],
    cc: [],
    replyTo: null,
    subject: '(could not be read)',
    body: '',
    bodyTruncated: false,
    messageId,
    inReplyTo: null,
    references: [],
    dmarc: 'missing',
    automatic: isAutomatic([], envelope.from),
    parseFailed: true,
    attachments: [],
    attachmentsNotListed: 0,
  };
}

/**
 * One received message read for keeping. `rawSha256` is the hash of the raw bytes (the stored
 * object's key and the Message-ID used when the message has none). A message that cannot be
 * parsed is still kept, marked, with its sender from the envelope (nothing is lost: the raw
 * message is stored).
 */
export async function readInbound(
  raw: Uint8Array,
  rawSha256: string,
  envelope: { from: string; to: string },
): Promise<InboundEmail> {
  const envelopeTo = cleanAddress(envelope.to) ?? 'unknown@invalid';
  const fallbackFrom = cleanAddress(envelope.from) ?? 'unknown@invalid';
  const syntheticId = `<${rawSha256}@missing.invalid>`;
  let email: Email;
  try {
    email = await PostalMime.parse(raw, PARSE_OPTIONS);
  } catch {
    return unreadableEmail(rawSha256, envelope);
  }

  const from = mailboxes(email.from)[0];
  const body = bodyText(email);
  const references = headerTokens(email.references).slice(-MAX_REFERENCES);
  const listed = email.attachments.slice(0, MAX_ATTACHMENTS);
  const attachments: InboundAttachment[] = [];
  for (const [position, attachment] of listed.entries()) {
    const bytes = attachmentBytes(attachment.content);
    const type = attachment.mimeType.trim().toLowerCase();
    const name = oneLine(attachment.filename, 255);
    const contentId = headerToken(attachment.contentId);
    attachments.push({
      position,
      fileName: name === '' ? null : name,
      contentType: MEDIA_TYPE.test(type) ? type : 'application/octet-stream',
      sizeBytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      disposition: attachment.disposition === 'inline' ? 'inline' : 'attachment',
      contentId: contentId !== null && contentId.length <= 255 ? contentId : null,
    });
  }
  const name = oneLine(from?.name, 200);
  return {
    envelopeTo,
    fromAddress: cleanAddress(from?.address) ?? fallbackFrom,
    fromName: name === '' ? null : name,
    to: addressList(email.to),
    cc: addressList(email.cc),
    replyTo: addressList(email.replyTo)[0] ?? null,
    subject: oneLine(email.subject, 998),
    body: body.text,
    bodyTruncated: body.truncated,
    messageId: headerToken(email.messageId) ?? syntheticId,
    inReplyTo: headerTokens(email.inReplyTo)[0] ?? null,
    references,
    dmarc: dmarcResult(email.headers),
    automatic: isAutomatic(email.headers, envelope.from),
    parseFailed: false,
    attachments,
    attachmentsNotListed: email.attachments.length - listed.length,
  };
}
