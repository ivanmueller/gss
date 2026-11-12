/**
 * What Claude reads of a received email (F-114 step 5a): its subject and its own new text,
 * one numbered line each, without the earlier messages it quotes, so GSS's own words quoted
 * back are never taken for the other side's. Linear in the email's length; never splits a
 * character in two.
 */

/** At most this many lines of the email's text (the subject line not counted). */
export const EMAIL_READ_LINES_MAX = 400;
/** At most this many characters of the email's text in all. */
export const EMAIL_READ_CHARS_MAX = 20_000;
/** A longer line is split into lines of at most this many characters. */
export const EMAIL_READ_LINE_MAX = 1000;
/** The subject is cut to this many characters. */
const SUBJECT_MAX = 300;
/** Lines longer than this are never taken for a reply header. */
const HEADER_LINE_MAX = 300;
/** The last line when the email was cut. */
export const EMAIL_CUT_NOTE = '[the rest of the email was cut]';

export interface EmailLines {
  /** Line 0 is "Subject: …"; then the email's own lines, blank lines left out. */
  lines: string[];
  /** Whether the text was cut at EMAIL_READ_LINES_MAX or EMAIL_READ_CHARS_MAX. */
  cut: boolean;
  /** Whether nothing is left to read: no own text (empty, or only quoted mail) and no subject
   * beyond "Re:" or "Fwd:". */
  empty: boolean;
}

/** A cut at no more than `max` UTF-16 units that never leaves half of a surrogate pair. */
function cutAt(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

function squash(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

const ORIGINAL_MESSAGE = /^-{2,} ?original message ?-{2,}$/i;
const UNDERSCORES = /^_{10,}$/;
const FROM_HEADER = /^from: /i;
const SENT_OR_DATE_HEADER = /^(sent|date): /i;

/** Whether the email's earlier messages start at line `n` (the lines already squashed). */
function quoteStartsAt(lines: readonly string[], n: number): boolean {
  const line = lines[n] ?? '';
  if (line.length > HEADER_LINE_MAX) return false;
  if (ORIGINAL_MESSAGE.test(line)) return true;
  if (UNDERSCORES.test(line)) return FROM_HEADER.test(nextFilled(lines, n + 1) ?? '');
  if (FROM_HEADER.test(line)) {
    for (let k = n + 1; k <= n + 4 && k < lines.length; k += 1) {
      const next = lines[k] ?? '';
      if (next.length <= HEADER_LINE_MAX && SENT_OR_DATE_HEADER.test(next)) return true;
    }
    return false;
  }
  if (line.startsWith('On ')) {
    if (line.endsWith('wrote:')) return true;
    const next = lines[n + 1] ?? '';
    return (
      next.length <= HEADER_LINE_MAX &&
      line.length + next.length <= HEADER_LINE_MAX &&
      next.endsWith('wrote:')
    );
  }
  return false;
}

function nextFilled(lines: readonly string[], from: number): string | undefined {
  for (let k = from; k < lines.length && k < from + 3; k += 1) {
    if ((lines[k] ?? '') !== '') return lines[k];
  }
  return undefined;
}

/** The subject and own text of a received email, as Claude reads them. */
export function emailLines(subject: string | null, body: string | null): EmailLines {
  const lines = [`Subject: ${cutAt(squash(subject ?? ''), SUBJECT_MAX)}`];
  const raw = (body ?? '').split(/\r\n|\r|\n/).map(squash);
  let chars = 0;
  let cut = false;
  let own = 0;
  outer: for (let n = 0; n < raw.length; n += 1) {
    const line = raw[n] ?? '';
    if (line === '' || line.startsWith('>')) continue;
    if (quoteStartsAt(raw, n)) break;
    for (let rest = line; rest !== '';) {
      if (own >= EMAIL_READ_LINES_MAX || chars >= EMAIL_READ_CHARS_MAX) {
        cut = true;
        break outer;
      }
      const piece = cutAt(rest, Math.min(EMAIL_READ_LINE_MAX, EMAIL_READ_CHARS_MAX - chars));
      if (piece === '') {
        // One unit left and the next character is a pair: stop rather than loop.
        cut = true;
        break outer;
      }
      lines.push(piece);
      own += 1;
      chars += piece.length;
      rest = rest.slice(piece.length);
    }
  }
  if (cut) lines.push(EMAIL_CUT_NOTE);
  // A subject can carry the news itself (a bid in the subject, an empty or quoted-only body):
  // only an email with neither its own text nor a subject beyond "Re:" or "Fwd:" is empty
  // (Codex's final review of F-114-5a, finding R1-01).
  const topic = squash(subject ?? '').replace(/^((re|fw|fwd|aw|wg|tr)\s*:\s*)+/i, '');
  return { lines, cut, empty: own === 0 && topic === '' };
}

/** The lines as Claude reads them: `[n] text`, one per line. */
export function numberedEmail(lines: readonly string[]): string {
  return lines.map((line, n) => `[${String(n)}] ${line}`).join('\n');
}
