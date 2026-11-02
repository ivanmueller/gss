import type { CallOutcome, CallStatus } from '@grain/domain';

// What happens next in a call placed from the platform, given what Telnyx reports (the owner's
// decisions of 2026-11-02, docs/DECISIONS.md). Pure, so every path is unit tested; the API
// applies the changes in the database and then sends the commands to Telnyx.
//
// 1. The caller's cell rings (calling_you). When it answers, Telnyx asks them to press 1
//    (confirming), so a voicemail that picks up never gets the counterparty on the line.
// 2. On 1, the counterparty is dialed, joined to the caller's leg when it answers
//    (calling_them, then connected).
// 3. When either side hangs up, the other leg is hung up and the call ends with its outcome;
//    a call that connected is written to the contact log.
// Events that do not fit the call's state change nothing. Telnyx's events can come out of order
// (Codex's review of ivanmueller/gss#107): for an ended call, the counterparty's "answered" that
// happened before the end makes it a call where they talked, and a leg still showing signs of
// life after the end is hung up.

/** The two legs: the caller's own cell (you) and the counterparty (them). */
export type CallLeg = 'you' | 'them';

export interface CallState {
  status: CallStatus;
  outcome: CallOutcome | null;
  staffCallControlId: string | null;
  counterpartyCallControlId: string | null;
  connectedAt: string | null;
  endedAt: string | null;
}

/** A Telnyx call event, reduced to what the steps need. */
export interface CallEvent {
  type: string;
  leg: CallLeg;
  occurredAt: string;
  callControlId: string | null;
  /** call.gather.ended: the digits pressed and how the gather ended. */
  digits: string | null;
  gatherStatus: string | null;
  /** call.hangup: Telnyx's hangup cause, e.g. normal_clearing, user_busy, timeout. */
  hangupCause: string | null;
}

export interface CallChanges {
  status?: CallStatus;
  outcome?: CallOutcome;
  staffAnsweredAt?: string;
  connectedAt?: string;
  endedAt?: string;
  hangupCause?: string;
  staffCallControlId?: string;
  counterpartyCallControlId?: string;
}

export type CallCommand =
  /** Ask the caller to press 1. */
  | { kind: 'confirm'; callControlId: string }
  /** Dial the counterparty and join them to the caller's leg when they answer. */
  | { kind: 'dial_them'; staffCallControlId: string }
  | { kind: 'hang_up'; callControlId: string }
  /** Record both sides of the connected call, with Telnyx's transcription (owner's request). */
  | { kind: 'record'; callControlId: string };

export interface CallStep {
  changes: CallChanges;
  commands: CallCommand[];
}

const NOTHING: CallStep = { changes: {}, commands: [] };

/** Telnyx's hangup causes when a phone was not answered, was declined or did not pick up. */
const NOT_ANSWERED = new Set(['timeout', 'no_answer', 'call_rejected', 'user_busy']);

/** A hangup cause safe to store: lower-case letters, digits and underscores only. */
function cause(event: CallEvent): string | undefined {
  const value = event.hangupCause ?? '';
  return /^[a-z0-9_]{1,40}$/.test(value) ? value : undefined;
}

function ended(event: CallEvent, outcome: CallOutcome, commands: CallCommand[] = []): CallStep {
  const hangupCause = cause(event);
  return {
    changes: {
      status: 'ended',
      outcome,
      endedAt: event.occurredAt,
      ...(hangupCause === undefined ? {} : { hangupCause }),
    },
    commands,
  };
}

function hangUp(callControlId: string | null): CallCommand[] {
  return callControlId === null ? [] : [{ kind: 'hang_up', callControlId }];
}

/** The changes and commands that follow an event, for a call in the given state. */
export function nextCallStep(call: CallState, event: CallEvent): CallStep {
  if (call.status === 'ended') return afterTheEnd(call, event);
  const staffId = call.staffCallControlId ?? (event.leg === 'you' ? event.callControlId : null);
  const theirId =
    call.counterpartyCallControlId ?? (event.leg === 'them' ? event.callControlId : null);
  const ids: CallChanges = {
    ...(call.staffCallControlId === null && staffId !== null
      ? { staffCallControlId: staffId }
      : {}),
    ...(call.counterpartyCallControlId === null && theirId !== null
      ? { counterpartyCallControlId: theirId }
      : {}),
  };
  const step = stepFor(call, event, staffId, theirId);
  return { changes: { ...ids, ...step.changes }, commands: step.commands };
}

/** How a call ended when its counterparty was dialed but, as far as was known, not reached. */
const DIALED_THEM = new Set<CallOutcome>(['no_answer', 'busy', 'cancelled', 'failed']);

/** A late event of an ended call. */
function afterTheEnd(call: CallState, event: CallEvent): CallStep {
  if (event.type !== 'call.initiated' && event.type !== 'call.answered') return NOTHING;
  const leg = event.callControlId;
  // Only a call whose counterparty was dialed, by the leg it knows (the database checks the
  // same; Codex's re-review of ivanmueller/gss#108, finding 6).
  const lateAnswer =
    event.type === 'call.answered' &&
    event.leg === 'them' &&
    call.outcome !== null &&
    DIALED_THEM.has(call.outcome) &&
    call.counterpartyCallControlId !== null &&
    leg === call.counterpartyCallControlId &&
    call.connectedAt === null &&
    call.endedAt !== null &&
    Date.parse(event.occurredAt) <= Date.parse(call.endedAt);
  if (lateAnswer) {
    return {
      changes: { outcome: 'talked', connectedAt: event.occurredAt },
      // Both legs should be gone already; hanging up one that is gone does no harm.
      commands: hangUp(leg),
    };
  }
  return { changes: {}, commands: hangUp(leg) };
}

function stepFor(
  call: CallState,
  event: CallEvent,
  staffId: string | null,
  theirId: string | null,
): CallStep {
  const { status } = call;
  if (event.leg === 'you') {
    switch (event.type) {
      case 'call.answered':
        if (status !== 'calling_you' || staffId === null) return NOTHING;
        return {
          changes: { status: 'confirming', staffAnsweredAt: event.occurredAt },
          commands: [{ kind: 'confirm', callControlId: staffId }],
        };
      case 'call.gather.ended':
        if (status !== 'confirming' || staffId === null) return NOTHING;
        if (event.gatherStatus === 'valid' && event.digits === '1') {
          return {
            changes: { status: 'calling_them' },
            commands: [{ kind: 'dial_them', staffCallControlId: staffId }],
          };
        }
        return ended(event, 'not_confirmed', hangUp(staffId));
      case 'call.hangup':
        switch (status) {
          case 'calling_you':
            return ended(
              event,
              NOT_ANSWERED.has(event.hangupCause ?? '') ? 'you_missed' : 'failed',
            );
          case 'confirming':
            return ended(event, 'not_confirmed');
          case 'calling_them':
            return ended(event, 'cancelled', hangUp(theirId));
          case 'connected':
            return ended(event, 'talked', hangUp(theirId));
        }
        return NOTHING;
      default:
        return NOTHING;
    }
  }
  switch (event.type) {
    case 'call.answered':
      if (status !== 'calling_them') return NOTHING;
      return {
        changes: { status: 'connected', connectedAt: event.occurredAt },
        // Recorded on the caller's leg, which carries both sides once they are joined.
        commands: staffId === null ? [] : [{ kind: 'record', callControlId: staffId }],
      };
    case 'call.hangup':
      if (status === 'connected') return ended(event, 'talked', hangUp(staffId));
      if (status !== 'calling_them') return NOTHING;
      if (event.hangupCause === 'user_busy') return ended(event, 'busy', hangUp(staffId));
      if (event.hangupCause === 'originator_cancel') {
        return ended(event, 'cancelled', hangUp(staffId));
      }
      return ended(
        event,
        NOT_ANSWERED.has(event.hangupCause ?? '') || event.hangupCause === 'normal_clearing'
          ? 'no_answer'
          : 'failed',
        hangUp(staffId),
      );
    default:
      return NOTHING;
  }
}

/** Seconds between two instants, never negative. */
export function secondsBetween(from: string, to: string): number {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000);
}
