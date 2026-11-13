/**
 * Forwarded email (F-233): a team member forwards, from their own confirmed personal address, an
 * email they received elsewhere (for example a carrier's answer in their Gmail) to GSS's domain.
 * This module finds the forwarded message's block in the received body text: Gmail's
 * "---------- Forwarded message ---------", Apple Mail's "Begin forwarded message:", Outlook's
 * underscores or "-----Original Message-----", or a bare "From: … Sent:/Date: …" header block,
 * at any one quote depth (an HTML forward inside a <blockquote> reaches here with "> " on each
 * line: Codex's design review of F-233, finding D1-02).
 *
 * Offsets are counted in Unicode code points, PostgreSQL's unit for `length` and `substr`, never
 * in JavaScript's UTF-16 units (D1-01). Every function is linear in the body's length.
 */

/** A forwarded message found in a body. Offsets in code points. */
export interface ForwardedPart {
  /** Where the forwarded block starts (its marker line, or its first header line). */
  start: number;
  /** Where the forwarded message's own text starts (after its header lines). */
  textStart: number;
  /** The quote depth of the forwarded block's header lines (0 to FORWARD_DEPTH_MAX). */
  depth: number;
  /** The original sender's address, lowercase. */
  fromAddress: string;
  fromName: string | null;
  /** The original subject, one line (may be empty). */
  subject: string;
  /** The original date as the forward writes it, one line; never parsed into a time. */
  dateText: string | null;
}

/** Deepest quote depth taken for a forwarded block. */
export const FORWARD_DEPTH_MAX = 5;
/** Lines after a marker searched for the header block's first line. */
const MARKER_WINDOW = 4;
/** Header lines (blank lines included) read at most. */
const HEADER_WINDOW = 14;
/** Longer lines are never taken for a marker or a header. */
const HEADER_LINE_MAX = 2000;
/** Kept lengths, as app.emails' columns. */
const FROM_NAME_MAX = 200;
const SUBJECT_MAX = 998;
const DATE_MAX = 200;
/** The forwarding person's note given to Claude as context, at most. */
export const FORWARD_NOTE_MAX = 2000;

const MARKERS = [
  /^-{2,} ?forwarded message ?-{2,}$/i,
  /^begin forwarded message:?$/i,
  /^-{2,} ?original message ?-{2,}$/i,
  /^_{10,}$/,
];
const HEADER = /^(from|date|sent|subject|to|cc|bcc|reply-to)\s*:\s?(.*)$/i;
const ADDRESS = /^[^@\s<>()[\],;:"]{1,64}@[^@\s<>()[\],;:"]{1,252}\.[^@\s<>()[\],;:".]{2,63}$/;
const CONTROL = /\p{Cc}/gu;

interface Line {
  /** UTF-16 index where the line starts in the body. */
  at: number;
  /** Quote depth: the number of leading ">" markers (spaces between them allowed). */
  depth: number;
  /** The text after the markers, spaces squashed and trimmed. */
  text: string;
  /** Whether the raw line is longer than HEADER_LINE_MAX. */
  long: boolean;
}

/** The body's lines with their UTF-16 start, quote depth and text. One pass. */
function splitLines(body: string): Line[] {
  const lines: Line[] = [];
  const pattern = /\r\n|\r|\n/g;
  let at = 0;
  for (;;) {
    const match = pattern.exec(body);
    const end = match === null ? body.length : match.index;
    lines.push(lineAt(body, at, end));
    if (match === null) break;
    at = match.index + match[0].length;
  }
  return lines;
}

function lineAt(body: string, at: number, end: number): Line {
  let k = at;
  let depth = 0;
  for (;;) {
    while (k < end && (body[k] === ' ' || body[k] === '\t')) k += 1;
    if (k < end && body[k] === '>') {
      depth += 1;
      k += 1;
      continue;
    }
    break;
  }
  const long = end - at > HEADER_LINE_MAX;
  const text = long ? '' : body.slice(k, end).replace(/\s+/g, ' ').trim();
  return { at, depth, text, long };
}

/** One line of text for a kept column: control characters out, cut on a character boundary. */
function oneLine(value: string, max: number): string {
  const line = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return cutCodeUnits(line, max).trim();
}

/** At most `max` UTF-16 units, never ending in half a character. */
function cutCodeUnits(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** The address and name in a forwarded From line's value, or null without an address. */
export function forwardedSender(value: string): { address: string; name: string | null } | null {
  const bracket = /<\s*(?:mailto:)?([^<>\s]+)\s*>|\[\s*mailto:([^[\]\s]+)\s*\]/i.exec(value);
  let address: string | undefined;
  let name = '';
  if (bracket !== null) {
    address = bracket[1] ?? bracket[2];
    name = value.slice(0, bracket.index);
  } else {
    const bare = value.trim().replace(/^mailto:/i, '');
    if (!/\s/.test(bare)) address = bare;
  }
  const clean = address?.trim().toLowerCase() ?? '';
  if (clean.length > 254 || !ADDRESS.test(clean)) return null;
  const shownName = oneLine(name.replace(/^["'\s]+|["'\s]+$/g, ''), FROM_NAME_MAX);
  return { address: clean, name: shownName === '' || shownName === clean ? null : shownName };
}

function isMarker(line: Line): boolean {
  return !line.long && line.depth <= FORWARD_DEPTH_MAX && MARKERS.some((m) => m.test(line.text));
}

/** "On … wrote:" on one line or two: a reply's quotation, not a forward. */
function isReplyQuote(lines: readonly Line[], n: number): boolean {
  const line = lines[n];
  if (line === undefined || line.long || !line.text.startsWith('On ')) return false;
  if (line.text.endsWith('wrote:')) return true;
  const next = lines[n + 1];
  return next !== undefined && !next.long && next.text.endsWith('wrote:');
}

interface Headers {
  from: { address: string; name: string | null } | null;
  subject: string | null;
  date: string | null;
  /** Index of the first line after the header block. */
  next: number;
}

/**
 * The header block starting at line `n`, all at quote depth `depth`: header lines and blank
 * lines, ending at the first other line (or a line at another depth). Null when line `n` is not
 * a header line.
 */
function headerBlock(lines: readonly Line[], n: number, depth: number): Headers | null {
  const first = lines[n];
  if (first === undefined || first.long || first.depth !== depth || !HEADER.test(first.text))
    return null;
  const found: Headers = { from: null, subject: null, date: null, next: n };
  let k = n;
  for (; k < lines.length && k < n + HEADER_WINDOW; k += 1) {
    const line = lines[k];
    if (line === undefined) break;
    if (line.text === '' && !line.long && line.depth <= depth) {
      // A blank line: the header block may go on (HTML forwards put headers in separate blocks),
      // but a blank line right after the block's last header ends it when no header follows.
      const after = lines[k + 1];
      if (after?.depth !== depth || !HEADER.test(after.text)) break;
      continue;
    }
    if (line.long || line.depth !== depth) break;
    const match = HEADER.exec(line.text);
    if (match === null) break;
    const name = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? '';
    if (name === 'from' && found.from === null) found.from = forwardedSender(value);
    else if (name === 'subject' && found.subject === null)
      found.subject = oneLine(value, SUBJECT_MAX);
    else if ((name === 'date' || name === 'sent') && found.date === null)
      found.date = oneLine(value, DATE_MAX) || null;
  }
  found.next = k;
  return found;
}

/** Converts UTF-16 indexes, in increasing order, to code point offsets in one pass. */
function codePointOffsets(text: string, indexes: readonly number[]): number[] {
  const result: number[] = [];
  let unit = 0;
  let points = 0;
  for (const target of indexes) {
    while (unit < target && unit < text.length) {
      const code = text.charCodeAt(unit);
      const pair =
        code >= 0xd800 &&
        code <= 0xdbff &&
        unit + 1 < text.length &&
        text.charCodeAt(unit + 1) >= 0xdc00 &&
        text.charCodeAt(unit + 1) <= 0xdfff;
      unit += pair ? 2 : 1;
      points += 1;
    }
    result.push(points);
  }
  return result;
}

/** The UTF-16 index of code point offset `points` (the text's end when beyond it). */
function unitIndex(text: string, points: number): number {
  let unit = 0;
  for (let p = 0; p < points && unit < text.length; p += 1) {
    const code = text.charCodeAt(unit);
    const pair =
      code >= 0xd800 &&
      code <= 0xdbff &&
      unit + 1 < text.length &&
      text.charCodeAt(unit + 1) >= 0xdc00 &&
      text.charCodeAt(unit + 1) <= 0xdfff;
    unit += pair ? 2 : 1;
  }
  return unit;
}

/** The text from code point `from` to code point `to` (the end when omitted). */
export function sliceCodePoints(text: string, from: number, to?: number): string {
  const start = unitIndex(text, Math.max(0, from));
  if (to === undefined) return text.slice(start);
  return text.slice(start, start + unitIndex(text.slice(start), Math.max(0, to - from)));
}

/** The number of code points in the text (PostgreSQL's `length`). */
export function codePointLength(text: string): number {
  return codePointOffsets(text, [text.length])[0] ?? 0;
}

/**
 * The first forwarded message in a body, or null. Only the first quotation-like boundary of the
 * body is considered: when it is a reply's quotation ("On … wrote:", or quoted lines with no
 * forward header) the email is not a forward, so a forward quoted deep inside a reply is never
 * taken for one.
 */
export function findForward(body: string): ForwardedPart | null {
  const lines = splitLines(body);
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    if (line === undefined) break;
    if (line.text === '' && !line.long) continue;
    if (isReplyQuote(lines, n)) return null;
    if (isMarker(line)) {
      // The header block's first line, within a few lines after the marker, at its own depth.
      for (let k = n + 1; k < lines.length && k <= n + MARKER_WINDOW; k += 1) {
        const candidate = lines[k];
        if (candidate === undefined) break;
        if (candidate.text === '' && !candidate.long) continue;
        if (candidate.depth > FORWARD_DEPTH_MAX) return null;
        return forwardAt(body, lines, n, k, candidate.depth);
      }
      return null;
    }
    if (line.depth > 0) {
      // The first quoted line: a forward's header block at that depth, or a reply's quotation.
      if (line.depth > FORWARD_DEPTH_MAX) return null;
      return forwardAt(body, lines, n, n, line.depth);
    }
    if (HEADER.test(line.text)) {
      // A bare header block (Outlook without a marker); a note line that only looks like a
      // header ("To: the desk") is passed over. Each try reads at most HEADER_WINDOW lines.
      const found = forwardAt(body, lines, n, n, 0);
      if (found !== null) return found;
    }
  }
  return null;
}

function forwardAt(
  body: string,
  lines: readonly Line[],
  start: number,
  headerStart: number,
  depth: number,
): ForwardedPart | null {
  const headers = headerBlock(lines, headerStart, depth);
  if (headers?.from == null || headers.date === null) return null;
  const startLine = lines[start];
  if (startLine === undefined) return null;
  const textLine = lines[headers.next];
  const textUnit = textLine === undefined ? body.length : textLine.at;
  const [startAt = 0, textAt = 0] = codePointOffsets(body, [startLine.at, textUnit]);
  return {
    start: startAt,
    textStart: textAt,
    depth,
    fromAddress: headers.from.address,
    fromName: headers.from.name,
    subject: headers.subject ?? '',
    dateText: headers.date,
  };
}

/**
 * The forwarded message's own text: the lines from `textStart` (code points) while they keep at
 * least `depth` quote markers, with exactly `depth` markers removed, so the original's own quoted
 * earlier mail stays marked and is still left out when Claude reads it.
 */
export function forwardedText(body: string, textStart: number, depth: number): string {
  const rest = sliceCodePoints(body, textStart);
  const out: string[] = [];
  for (const raw of rest.split(/\r\n|\r|\n/)) {
    let k = 0;
    let removed = 0;
    while (removed < depth) {
      while (k < raw.length && (raw[k] === ' ' || raw[k] === '\t')) k += 1;
      if (raw[k] !== '>') break;
      k += 1;
      removed += 1;
    }
    if (removed < depth) {
      // A blank line inside an HTML blockquote may come out unmarked; any other line with fewer
      // markers is past the forwarded block.
      if (raw.trim() === '') {
        out.push('');
        continue;
      }
      break;
    }
    out.push(raw.slice(k).replace(/^ /, ''));
  }
  return out.join('\n');
}

/** The forwarding person's own note above the block, at most FORWARD_NOTE_MAX characters. */
export function forwardNote(body: string, start: number): string {
  return cutCodeUnits(sliceCodePoints(body, 0, start).trim(), FORWARD_NOTE_MAX).trim();
}
