import { z } from 'zod';

import type { CallReadingView } from './readings';

// Calling counterparties through Telnyx (the owner's request and decisions of 2026-11-02,
// docs/DECISIONS.md). Shared by the API, which places calls and follows Telnyx's events, and
// the web app, which shows a call's progress. The database keeps the same states
// (20261102010000_telnyx_calls.sql).

/** How far a call has got: the caller's cell rings, they press 1, the counterparty rings, they talk. */
export const CALL_STATUSES = [
  'calling_you',
  'confirming',
  'calling_them',
  'connected',
  'ended',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** How a call ended. */
export const CALL_OUTCOMES = [
  'talked',
  'you_missed',
  'not_confirmed',
  'no_answer',
  'busy',
  'cancelled',
  'failed',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** What the caller sees while the call is under way. */
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  calling_you: 'Calling your cell…',
  confirming: 'Press 1 on your phone to connect',
  calling_them: 'Ringing them…',
  connected: 'Connected',
  ended: 'Call ended',
};

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  talked: 'Call ended',
  you_missed: 'Your cell did not answer',
  not_confirmed: '1 was not pressed, so they were not called',
  no_answer: 'They did not answer',
  busy: 'Their line was busy',
  cancelled: 'You hung up before they answered',
  failed: 'The call could not be placed',
};

/** A call as the API returns it; times are UTC instants. */
export interface CallView {
  id: string;
  counterpartyId: string;
  contactName: string;
  status: CallStatus;
  outcome: CallOutcome | null;
  createdAt: string;
  connectedAt: string | null;
  endedAt: string | null;
  /** The contact log entry written for a call that connected, once it ended. */
  contactLogEntryId: string | null;
}

/**
 * A recording of a call placed from the platform, with its transcript (the owner's request of
 * 2026-11-02): everyone on the team reads it; its audio plays for 24 hours, then is deleted.
 */
export interface CallRecordingView {
  id: string;
  callId: string;
  /** The contact log entry of the call, under which the transcript is shown. */
  contactLogEntryId: string | null;
  /** Null until the transcript arrives. */
  transcript: string | null;
  /** The transcript by side, oldest first; null for transcripts kept before it was split. */
  lines: TranscriptLine[] | null;
  /** Who placed the call, and the contact called: the names the lines are shown with. */
  callerName: string;
  contactName: string;
  /** No transcript will come (the attempts ran out, or the audio was deleted first). */
  transcriptFailed: boolean;
  /** Until when the audio can be played (UTC instant); null once deleted. */
  audioUntil: string | null;
  /** Claude's notes, voicemail answer and drafts; null until it has read the transcript. */
  reading: CallReadingView | null;
  /** Claude will not read it (the attempts ran out). */
  readingFailed: boolean;
}

/** Which side of a call said a line: the caller (GSS) or the counterparty; null when unknown. */
export type TranscriptSide = 'caller' | 'counterparty';

export interface TranscriptLine {
  side: TranscriptSide | null;
  /** Seconds from the start of the recording. */
  start: number;
  text: string;
}

/**
 * Speech-to-text segments of a two-channel recording as the transcript's lines: the first
 * channel is the caller's leg, the second the counterparty's; consecutive segments of the same
 * side make one line; empty ones are left out; oldest first.
 */
export function transcriptLines(
  segments: readonly { start: number; text: string; channel?: number | null }[],
): TranscriptLine[] {
  const sorted = segments
    .filter((segment) => Number.isFinite(segment.start) && segment.text.trim() !== '')
    .map((segment) => ({
      side:
        segment.channel === 0
          ? ('caller' as const)
          : segment.channel === 1
            ? ('counterparty' as const)
            : null,
      start: Math.max(0, segment.start),
      text: segment.text.trim().replace(/\s+/g, ' '),
    }))
    .sort((a, b) => a.start - b.start);
  const lines: TranscriptLine[] = [];
  for (const segment of sorted) {
    const last = lines.at(-1);
    // A side is never undefined, so there is no last line to join when there is none.
    if (last?.side === segment.side) last.text = `${last.text} ${segment.text}`;
    else lines.push({ ...segment });
  }
  return lines;
}

/** The label of a side in the plain transcript. */
function sideLabel(side: TranscriptSide | null): string {
  return side === 'caller' ? 'Caller' : side === 'counterparty' ? 'Counterparty' : 'Unknown';
}

/** The plain transcript of the lines, one per turn: "Caller: …" and "Counterparty: …". */
export function transcriptText(lines: readonly TranscriptLine[]): string {
  return lines.map((line) => `${sideLabel(line.side)}: ${line.text}`).join('\n');
}

/** What the database keeps of a transcript (app.call_recordings): characters and lines. */
export const TRANSCRIPT_MAX_CHARS = 200_000;
export const TRANSCRIPT_MAX_LINES = 20_000;

/**
 * The lines cut to what the database keeps (Codex's review of 3571e62, finding 3): their plain
 * transcript at most TRANSCRIPT_MAX_CHARS characters and at most TRANSCRIPT_MAX_LINES lines,
 * the first ones kept and the last one kept cut short, never splitting a character in two.
 */
export function fitTranscript(
  lines: readonly TranscriptLine[],
  maxChars = TRANSCRIPT_MAX_CHARS,
  maxLines = TRANSCRIPT_MAX_LINES,
): TranscriptLine[] {
  const kept: TranscriptLine[] = [];
  let length = 0;
  for (const line of lines) {
    if (kept.length >= maxLines) break;
    // The newline between lines, then "Caller: ".
    const prefix = (kept.length === 0 ? 0 : 1) + sideLabel(line.side).length + 2;
    const room = maxChars - length - prefix;
    if (room <= 0) break;
    let text = line.text.length <= room ? line.text : line.text.slice(0, room);
    // A high surrogate left alone at the end would be refused by the database.
    if (text.length < line.text.length && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    if (text === '') break;
    kept.push({ ...line, text });
    length += prefix + text.length;
    if (text.length < line.text.length) break;
  }
  return kept;
}

/** POST /api/v1/calls: the counterparty, and the contact called or null for its company phone. */
export const placeCallSchema = z.strictObject({
  counterpartyId: z.uuid(),
  contactId: z.uuid().nullable(),
});
export type PlaceCall = z.infer<typeof placeCallSchema>;

/** PUT /api/v1/me/phone: the person's own cell phone, as typed. */
export const savePhoneSchema = z.strictObject({ phone: z.string().max(40) });

/**
 * A saved phone number as Telnyx dials it (E.164), or null when it cannot be dialed from the
 * platform: a North American number of 10 digits (11 with a leading 1), however it is
 * punctuated, becomes +1 and its 10 digits; a number written with + and a country code keeps
 * its digits. A number with an extension, or anything else, is null: an extension cannot be
 * dialed automatically, so the person dials it themselves.
 */
export function dialablePhone(text: string): string | null {
  const phone = text.trim();
  if (phone === '' || /x|ext/i.test(phone)) return null;
  if (/[^0-9+(). /-]/.test(phone)) return null;
  if (phone.indexOf('+') > 0 || (phone.match(/\+/g)?.length ?? 0) > 1) return null;
  const digits = phone.replace(/\D/g, '');
  if (!phone.startsWith('+')) {
    if (digits.length === 10) return northAmerican(digits);
    if (digits.length === 11 && digits.startsWith('1')) return northAmerican(digits.slice(1));
    return null;
  }
  if (digits.startsWith('1')) {
    return digits.length === 11 ? northAmerican(digits.slice(1)) : null;
  }
  return /^[2-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** +1 and a North American number: area code and exchange each start with 2 to 9. */
function northAmerican(digits: string): string | null {
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? `+1${digits}` : null;
}

/** An E.164 number as people read it: +14035550100 as (403) 555-0100. */
export function displayPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1] ?? ''}) ${match[2] ?? ''}-${match[3] ?? ''}` : e164;
}

/** How long a call lasted: "45 s", "6 min 12 s", "1 h 2 min". */
export function formatCallLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${String(hours)} h ${String(minutes)} min`;
  if (minutes > 0) return `${String(minutes)} min ${String(rest)} s`;
  return `${String(rest)} s`;
}

/** The notes of the contact log entry written for a call that connected. */
export function callLogNotes(seconds: number): string {
  return `Phone call placed from the platform; talked ${formatCallLength(seconds)}.`;
}
