import PostalMime, { type Address, type Email, type Header } from 'postal-mime';

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
  const address = (value ?? '').trim().toLowerCase();
  return address.length <= 254 && ADDRESS.test(address) ? address : null;
}

/** The envelope recipient when it is on the configured domain, else null. */
export function envelopeOnDomain(to: string, config: InboundConfig): string | null {
  const address = cleanAddress(to);
  if (address === null) return null;
  return address.slice(address.lastIndexOf('@') + 1) === config.domain ? address : null;
}

/** One line of text: control characters (CR and LF among them) become spaces. */
function oneLine(value: string | null | undefined, max: number): string {
  return (value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function headerToken(value: string | null | undefined): string | null {
  const token = (value ?? '').trim();
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

/** Plain text from an HTML body, for mail sent without a text part. The HTML is never kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith('#x')) return safeCodePoint(Number.parseInt(lower.slice(2), 16), whole);
      if (lower.startsWith('#')) return safeCodePoint(Number.parseInt(lower.slice(1), 10), whole);
      return ENTITIES[lower] ?? whole;
    })
    .replace(/[ \t]+\n/g, '\n')
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
  const text = source.replaceAll(String.fromCharCode(0), '').trimEnd();
  return text.length > MAX_BODY_CHARS
    ? { text: text.slice(0, MAX_BODY_CHARS), truncated: true }
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
    email = await PostalMime.parse(raw, {
      attachmentEncoding: 'arraybuffer',
      maxNestingDepth: 50,
      maxPartCount: 1000,
    });
  } catch {
    return {
      envelopeTo,
      fromAddress: fallbackFrom,
      fromName: null,
      to: [],
      cc: [],
      replyTo: null,
      subject: '(could not be read)',
      body: '',
      bodyTruncated: false,
      messageId: syntheticId,
      inReplyTo: null,
      references: [],
      dmarc: 'missing',
      automatic: isAutomatic([], envelope.from),
      parseFailed: true,
      attachments: [],
      attachmentsNotListed: 0,
    };
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
