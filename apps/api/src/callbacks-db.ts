import {
  displayPhone,
  type CallbackReturnView,
  type CallbackSettingsView,
  type CallOutcome,
  type TranscriptLine,
} from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

// Callbacks to GSS's number in Postgres (20261107020000_callbacks.sql). Telnyx's events carry no
// signed-in user and nobody stands in for the caller of an incoming call (Codex's review of the
// design, finding 6): the Worker passes them, after checking Telnyx's signature, to the
// database's own functions, which find everything from the call itself. Requests from the web
// app (settings, returns, the call box) run as the signed-in person.

export type CallbackCommandKind =
  | 'dial_member'
  | 'confirm'
  | 'answer'
  | 'bridge'
  | 'record'
  | 'greet'
  | 'record_voicemail'
  | 'hang_up';

/** A command to Telnyx for a callback, kept until Telnyx has taken it. */
export interface CallbackCommand {
  id: string;
  kind: CallbackCommandKind;
  /** The leg it acts on (for dial_member, the caller's leg it rings someone for). */
  callControlId: string;
  /** The person rung it belongs to, if any. */
  attemptId: string | null;
}

/** A command claimed for sending, with what sending it needs. */
export interface ClaimedCallbackCommand extends CallbackCommand {
  /** Which claim this is; only this claim's completion counts. */
  claim: number;
  /** For dial_member: the cell to ring. */
  cell: string | null;
  /** For bridge: the caller's leg to join. */
  bridgeWith: string | null;
  /** The company, for the words on the cell; null for an unknown number. */
  companyName: string | null;
}

export type CallbackClaim =
  | { status: 'claimed'; command: ClaimedCallbackCommand }
  | { status: 'busy' }
  | { status: 'skipped' };

/** The first event of an incoming leg, as Telnyx sent it. */
export interface IncomingEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  leg: string;
  from: string;
  to: string;
}

export type ReceiveResult =
  | { status: 'created' | 'duplicate'; callId: string; commands: CallbackCommand[] }
  /** The number dialed takes no callbacks (none set up), or the caller's number is withheld. */
  | { status: 'not_ours' }
  | { status: 'ignored' };

/** An event of a known callback leg. */
export interface CallbackEvent {
  type: string;
  /** The leg to a team member's cell ('you', of an attempt) or the caller's ('them'). */
  side: 'you' | 'them';
  attemptId: string | null;
  occurredAt: string;
  leg: string | null;
  digits: string | null;
  gatherStatus: string | null;
  cause: string | null;
}

export type ApplyCallbackResult =
  { status: 'applied' | 'duplicate'; commands: CallbackCommand[] } | { status: 'not_found' };

export type SaveCallbackSettingsResult = 'saved' | 'forbidden' | 'not_a_member' | 'phone_taken';

export type SettleResult =
  'done' | 'not_found' | 'forbidden' | 'closed' | 'not_unknown' | 'company_not_found';

export type SettleAction =
  | { action: 'take' }
  | { action: 'dismiss' }
  | { action: 'link'; counterpartyId: string; contactId: string | null };

export interface CallbacksDatabase {
  receiveCallback: (event: IncomingEvent) => Promise<ReceiveResult>;
  /** The callback a leg belongs to, for events without client_state; null when none. */
  callbackByLeg: (
    leg: string,
  ) => Promise<{ callId: string; side: 'you' | 'them'; attemptId: string | null } | null>;
  applyCallbackEvent: (
    callId: string,
    eventId: string,
    event: CallbackEvent,
  ) => Promise<ApplyCallbackResult>;
  claimCallbackCommand: (callId: string, commandId: string) => Promise<CallbackClaim>;
  /**
   * Records how sending went, for that claim only; gives back what follows (hang-ups, the next
   * person rung, the recording once joined) and whether the command is still unresolved by
   * another claim.
   */
  finishCallbackCommand: (
    callId: string,
    commandId: string,
    claim: number,
    outcome: 'done' | 'failed' | 'retry',
    leg: string | null,
  ) => Promise<{ commands: CallbackCommand[]; unresolved: boolean }>;
  /** Every command of the callback not settled yet (pending, or being sent), oldest first. */
  callbackOpenCommands: (callId: string) => Promise<CallbackCommand[]>;
  /** Keeps a recording of a callback; true when it is a voicemail (made on the caller's leg). */
  keepCallbackRecording: (
    callId: string,
    recordingId: string,
    startedAt: string | null,
    endedAt: string | null,
    leg: string | null,
  ) => Promise<boolean>;
  /** The organization's settings, for a member; null when not one. */
  getCallbackSettings: (
    ctx: RequestContext,
    organizationId: string,
    configuredPhone: string | null,
  ) => Promise<CallbackSettingsView | null>;
  saveCallbackSettings: (
    ctx: RequestContext,
    organizationId: string,
    phone: string,
    callbacksPerson: string | null,
  ) => Promise<SaveCallbackSettingsResult>;
  /** The open returns of the organization, newest first. */
  listCallbackReturns: (
    ctx: RequestContext,
    organizationId: string,
  ) => Promise<CallbackReturnView[]>;
  /** Open returns for the signed-in person: theirs, and nobody's when they are an admin. */
  countCallbackReturns: (ctx: RequestContext, organizationId: string) => Promise<number>;
  settleCallbackReturn: (
    ctx: RequestContext,
    callId: string,
    action: SettleAction,
  ) => Promise<SettleResult>;
  /**
   * The callback the signed-in person is being rung for or is on, for the call box: their cell
   * ringing or waiting for 1, or a call they answered not ended yet.
   */
  myCallback: (ctx: RequestContext, organizationId: string) => Promise<string | null>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

const KINDS: readonly CallbackCommandKind[] = [
  'dial_member',
  'confirm',
  'answer',
  'bridge',
  'record',
  'greet',
  'record_voicemail',
  'hang_up',
];

function toCommand(value: unknown): CallbackCommand {
  const row = value as Record<string, unknown>;
  const kind = KINDS.find((k) => k === row.kind);
  if (
    kind === undefined ||
    typeof row.id !== 'string' ||
    typeof row.callControlId !== 'string' ||
    (row.attemptId !== null && typeof row.attemptId !== 'string')
  ) {
    throw new Error('Unexpected command from the database');
  }
  return {
    id: row.id,
    kind,
    callControlId: row.callControlId,
    attemptId: row.attemptId ?? null,
  };
}

const commandsOf = (value: unknown): CallbackCommand[] =>
  Array.isArray(value) ? value.map(toCommand) : [];

const SETTLE_RESULTS: readonly SettleResult[] = [
  'done',
  'not_found',
  'forbidden',
  'closed',
  'not_unknown',
  'company_not_found',
];
const SAVE_RESULTS: readonly SaveCallbackSettingsResult[] = [
  'saved',
  'forbidden',
  'not_a_member',
  'phone_taken',
];

export function callbackQueries(asUser: AsUser, sql: postgres.Sql): CallbacksDatabase {
  return {
    async receiveCallback(event) {
      const [row] = await sql<{ result: Record<string, unknown> }[]>`
        select app.receive_callback(${event.eventId}, ${event.type},
                                    ${event.occurredAt}::timestamptz, ${event.leg},
                                    ${event.from}, ${event.to}) as result`;
      const result = row?.result ?? {};
      if (
        (result.status === 'created' || result.status === 'duplicate') &&
        typeof result.callId === 'string'
      ) {
        return {
          status: result.status,
          callId: result.callId,
          commands: commandsOf(result.commands),
        };
      }
      return { status: result.status === 'not_ours' ? 'not_ours' : 'ignored' };
    },

    async callbackByLeg(leg) {
      const [row] = await sql<
        { call_id: string; side: 'you' | 'them'; attempt_id: string | null }[]
      >`
        select call_id, side, attempt_id from app.callback_by_leg(${leg})`;
      return row ? { callId: row.call_id, side: row.side, attemptId: row.attempt_id } : null;
    },

    async applyCallbackEvent(callId, eventId, event) {
      const [row] = await sql<{ result: Record<string, unknown> }[]>`
        select app.apply_callback_event(${callId}, ${eventId}, ${event.type}, ${event.side},
                                        ${event.attemptId}, ${event.occurredAt}::timestamptz,
                                        ${event.leg}, ${event.digits}, ${event.gatherStatus},
                                        ${event.cause}) as result`;
      const result = row?.result ?? {};
      if (result.status === 'applied' || result.status === 'duplicate') {
        return { status: result.status, commands: commandsOf(result.commands) };
      }
      return { status: 'not_found' };
    },

    async claimCallbackCommand(callId, commandId) {
      const [row] = await sql<{ result: Record<string, unknown> }[]>`
        select app.claim_callback_command(${callId}, ${commandId}) as result`;
      const result = row?.result ?? {};
      if (result.status === 'busy') return { status: 'busy' };
      if (result.status !== 'claimed') return { status: 'skipped' };
      const command = result.command as Record<string, unknown>;
      const text = (key: string) => (typeof command[key] === 'string' ? command[key] : null);
      return {
        status: 'claimed',
        command: {
          ...toCommand(command),
          claim: Number(command.claim),
          cell: text('cell'),
          bridgeWith: text('bridgeWith'),
          companyName: text('companyName'),
        },
      };
    },

    async finishCallbackCommand(callId, commandId, claim, outcome, leg) {
      const [row] = await sql<{ result: Record<string, unknown> }[]>`
        select app.finish_callback_command(${callId}, ${commandId}, ${claim}, ${outcome},
                                           ${leg}) as result`;
      const result = row?.result ?? {};
      return { commands: commandsOf(result.commands), unresolved: result.unresolved === true };
    },

    async callbackOpenCommands(callId) {
      const [row] = await sql<{ commands: unknown }[]>`
        select app.callback_open_commands(${callId}) as commands`;
      return commandsOf(row?.commands);
    },

    async keepCallbackRecording(callId, recordingId, startedAt, endedAt, leg) {
      const [row] = await sql<{ voicemail: boolean }[]>`
        select app.keep_callback_recording(${callId}, ${recordingId}, ${startedAt}::timestamptz,
                                           ${endedAt}::timestamptz, ${leg}) as voicemail`;
      return row?.voicemail === true;
    },

    getCallbackSettings(ctx, organizationId, configuredPhone) {
      return asUser(ctx, async (tx) => {
        const [member] = await tx<{ active: boolean }[]>`
          select app.is_active_member(${organizationId}) as active`;
        if (member?.active !== true) return null;
        const [row] = await tx<
          {
            phone: string;
            callbacks_person: string | null;
            callbacks_person_name: string | null;
            updated_by_name: string;
            updated_at: Date;
          }[]
        >`
          select phone, callbacks_person, callbacks_person_name, updated_by_name, updated_at
          from app.callback_settings where organization_id = ${organizationId}`;
        const candidates = await tx<{ id: string; name: string }[]>`
          select t.user_id as id, t.name from app.team_names(${organizationId}) t
          join app.organization_members m
            on m.organization_id = ${organizationId} and m.user_id = t.user_id
          where m.role in ('trader', 'operations', 'org_admin')
          order by lower(t.name), t.user_id`;
        return {
          phone: row ? displayPhone(row.phone) : null,
          configuredPhone: configuredPhone === null ? null : displayPhone(configuredPhone),
          callbacksPerson:
            row?.callbacks_person && row.callbacks_person_name
              ? { id: row.callbacks_person, name: row.callbacks_person_name }
              : null,
          updatedByName: row?.updated_by_name ?? null,
          updatedAt: row?.updated_at.toISOString() ?? null,
          candidates: candidates.map((candidate) => ({ id: candidate.id, name: candidate.name })),
        };
      });
    },

    saveCallbackSettings(ctx, organizationId, phone, callbacksPerson) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.save_callback_settings(${organizationId}, ${phone}, ${callbacksPerson}) as result`;
        const result = SAVE_RESULTS.find((value) => value === row?.result);
        if (result === undefined)
          throw new Error('Unexpected answer from app.save_callback_settings');
        return result;
      });
    },

    listCallbackReturns(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<
          {
            id: string;
            created_at: Date;
            counterparty_phone: string;
            counterparty_id: string | null;
            counterparty_name: string | null;
            contact_name: string;
            outcome: CallOutcome;
            talked_seconds: number | null;
            placed_by_name: string | null;
            meant_for_name: string | null;
            return_owner: string | null;
            return_owner_name: string | null;
            recording_id: string | null;
            voicemail_recording: boolean | null;
            transcript: string | null;
            transcript_lines: TranscriptLine[] | null;
            transcript_failed: boolean | null;
            audio_until: Date | null;
          }[]
        >`
          select c.id, c.created_at, c.counterparty_phone, c.counterparty_id,
                 p.legal_name as counterparty_name, c.contact_name, c.outcome::text as outcome,
                 case when c.connected_at is not null
                      then extract(epoch from c.ended_at - c.connected_at)::float8 end as talked_seconds,
                 c.placed_by_name, c.meant_for_name, c.return_owner, c.return_owner_name,
                 r.id as recording_id, r.voicemail_recording, r.transcript, r.transcript_lines,
                 r.transcript is null
                   and (r.transcribe_attempts >= 5 or r.audio_deleted_at is not null) as transcript_failed,
                 case when r.audio_deleted_at is null and app.recording_audio_until(r) > now()
                      then app.recording_audio_until(r) end as audio_until
          from app.calls c
          left join app.counterparties p
            on p.organization_id = c.organization_id and p.id = c.counterparty_id
          left join lateral (
            select * from app.call_recordings x where x.call_id = c.id
            order by x.created_at desc limit 1
          ) r on true
          where c.organization_id = ${organizationId} and c.direction = 'incoming'
            and c.return_status = 'open'
          order by c.created_at desc
          limit 200`;
        return rows.map((row) => ({
          callId: row.id,
          receivedAt: row.created_at.toISOString(),
          callerPhone: displayPhone(row.counterparty_phone),
          counterpartyId: row.counterparty_id,
          counterpartyName: row.counterparty_name,
          contactName: row.contact_name,
          outcome: row.outcome,
          talkedSeconds: row.talked_seconds,
          answeredByName: row.placed_by_name,
          meantForName: row.meant_for_name,
          ownerId: row.return_owner,
          ownerName: row.return_owner_name,
          recording:
            row.recording_id === null
              ? null
              : {
                  id: row.recording_id,
                  voicemail: row.voicemail_recording === true,
                  lines: row.transcript_lines,
                  transcript: row.transcript,
                  transcriptFailed: row.transcript_failed === true,
                  audioUntil: row.audio_until?.toISOString() ?? null,
                },
        }));
      });
    },

    countCallbackReturns(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ count: number }[]>`
          select count(*)::int as count from app.calls c
          where c.organization_id = ${organizationId} and c.direction = 'incoming'
            and c.return_status = 'open'
            and (c.return_owner = app.current_user_id()
                 or (c.return_owner is null
                     and app.has_role(${organizationId}, array['org_admin']::app.member_role[])))`;
        return row?.count ?? 0;
      });
    },

    settleCallbackReturn(ctx, callId, action) {
      return asUser(ctx, async (tx) => {
        const company = action.action === 'link' ? action.counterpartyId : null;
        const contact = action.action === 'link' ? action.contactId : null;
        const [row] = await tx<{ result: string }[]>`
          select app.settle_callback_return(${callId}, ${action.action}, ${company},
                                            ${contact}) as result`;
        const result = SETTLE_RESULTS.find((value) => value === row?.result);
        if (result === undefined)
          throw new Error('Unexpected answer from app.settle_callback_return');
        return result;
      });
    },

    myCallback(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ id: string }[]>`
          select c.id from app.callback_attempts a
          join app.calls c on c.id = a.call_id
          where a.organization_id = ${organizationId} and a.member_id = app.current_user_id()
            and c.status <> 'ended' and a.started_at > now() - interval '15 minutes'
            and (a.status in ('ringing', 'confirming')
                 or (a.status = 'accepted' and c.placed_by = app.current_user_id()))
          order by a.started_at desc
          limit 1`;
        return row?.id ?? null;
      });
    },
  };
}
