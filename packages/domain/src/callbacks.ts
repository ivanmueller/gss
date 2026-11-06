import { z } from 'zod';

import type { CallOutcome, TranscriptLine } from './calls';

// Callbacks to GSS's number (the owner's request and answers of 2026-11-06, docs/DECISIONS.md,
// F-132). Shared by the API and the web app: the settings an admin chooses, what the person
// whose cell rings sees, and the calls nobody could be given a follow-up for ("returns"), on the
// Follow-ups page. The database keeps them in 20261107020000_callbacks.sql.

/** How long each cell rings for a callback (the owner's answer of 2026-11-06). */
export const CALLBACK_RING_SECONDS = 20;

/** The callbacks settings of an organization, for the Team page. */
export interface CallbackSettingsView {
  /** GSS's number callbacks arrive on, as people read it; null while callbacks are off. */
  phone: string | null;
  /** The number the Worker is set up with: saving the settings takes callbacks on it. */
  configuredPhone: string | null;
  /** Rung when whom a callback was meant for does not take it; null: straight to voicemail. */
  callbacksPerson: { id: string; name: string } | null;
  updatedByName: string | null;
  /** UTC instant. */
  updatedAt: string | null;
  /** Who may be the callbacks person: active traders, operations and admins. */
  candidates: { id: string; name: string }[];
}

/** PUT /api/v1/callbacks/settings. */
export const saveCallbackSettingsSchema = z.strictObject({
  callbacksPerson: z.uuid().nullable(),
});
export type SaveCallbackSettings = z.infer<typeof saveCallbackSettingsSchema>;

/**
 * Where a callback stands for the person whose cell was rung: their cell ringing, waiting for 1,
 * answered by them, or passed on (they did not take it, or the caller hung up first).
 */
export type CallbackTurn = 'ringing' | 'confirming' | 'answered' | 'passed';

export const CALLBACK_TURN_LABELS: Record<CallbackTurn, string> = {
  ringing: 'Your cell is ringing…',
  confirming: 'Press 1 on your phone to take the call',
  answered: 'Connecting you…',
  passed: 'You did not take this call',
};

/** A callback as the person rung for it sees it in the call box. */
export interface CallbackView {
  /** The company, or null for a number that matches none. */
  companyName: string | null;
  /** The caller's number, as people read it. */
  callerPhone: string;
  /** Null for someone who was not rung for it. */
  you: CallbackTurn | null;
}

/** What happened to a call nobody could be given a follow-up for. */
export interface CallbackReturnView {
  callId: string;
  /** When the call came in (UTC instant). */
  receivedAt: string;
  /** The caller's number, as people read it. */
  callerPhone: string;
  /** Null for an unknown number. */
  counterpartyId: string | null;
  counterpartyName: string | null;
  /** The contact, the company, or the number when unknown. */
  contactName: string;
  outcome: CallOutcome;
  /** How long they talked, for a call someone took. */
  talkedSeconds: number | null;
  answeredByName: string | null;
  meantForName: string | null;
  /** Whose it is; null: nobody's (every admin sees it in the menu count). */
  ownerId: string | null;
  ownerName: string | null;
  /** Its recording: the conversation or voicemail, while transcribed or playable. */
  recording: {
    id: string;
    voicemail: boolean;
    lines: TranscriptLine[] | null;
    transcript: string | null;
    transcriptFailed: boolean;
    /** Until when the audio plays (UTC instant); null once deleted. */
    audioUntil: string | null;
  } | null;
}

/** POST /api/v1/callbacks/{id}/settle. */
export const settleCallbackSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('take') }),
  z.strictObject({ action: z.literal('dismiss') }),
  z.strictObject({
    action: z.literal('link'),
    counterpartyId: z.uuid(),
    contactId: z.uuid().nullable(),
  }),
]);
export type SettleCallback = z.infer<typeof settleCallbackSchema>;

/** The words on the cell of the person rung for a callback; the company named when known. */
export function callbackPrompt(companyName: string | null): string {
  const name =
    companyName
      ?.replace(/[^\p{L}\p{N} &'.,-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? '';
  return `Callback from ${name === '' ? 'an unknown number' : name.slice(0, 120)}. Press 1 to take it.`;
}

/** What the caller hears before leaving a voicemail (the owner's answer of 2026-11-06). */
export const VOICEMAIL_MESSAGE =
  "You've reached G S S. Please leave your name, number and message after the tone, and we'll call you back.";

/** The longest voicemail, in seconds (the owner's answer of 2026-11-06). */
export const VOICEMAIL_MAX_SECONDS = 180;
