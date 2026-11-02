import { z } from 'zod';

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
  /** Null until Telnyx's transcription arrives. */
  transcript: string | null;
  /** Until when the audio can be played (UTC instant); null once deleted. */
  audioUntil: string | null;
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
