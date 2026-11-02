import {
  callLogNotes,
  dialablePhone,
  type CallOutcome,
  type CallStatus,
  type CallView,
} from '@grain/domain';
import type postgres from 'postgres';

import { nextCallStep, secondsBetween, type CallEvent, type CallStep } from './call-steps';
import type { RequestContext } from './db';

// Calls placed through Telnyx, in Postgres (20261102010000_telnyx_calls.sql). Requests from the
// web app run as the signed-in user; Telnyx's events run as the person who placed the call,
// found with app.call_placer, so row level security and the triggers apply either way.

export type PlaceCallResult =
  | {
      status: 'created';
      callId: string;
      /** The caller's own cell and the counterparty's number, in E.164 form. */
      staffPhone: string;
      counterpartyPhone: string;
    }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'archived' }
  /** The contact or company has no phone number. */
  | { status: 'no_number' }
  /** The number has an extension or is not one the platform can dial. */
  | { status: 'not_dialable' }
  /** The caller has not saved their own cell phone. */
  | { status: 'no_cell' }
  /** The caller has a call under way already. */
  | { status: 'in_progress' };

export type CallEventResult =
  | { status: 'applied'; step: CallStep; organizationId: string }
  /** Telnyx sent this event before; nothing was done again. */
  | { status: 'duplicate' }
  | { status: 'not_found' };

export interface CallsDatabase {
  /** The signed-in person's own cell phone in E.164 form, or null. */
  getMemberPhone: (ctx: RequestContext, organizationId: string) => Promise<string | null>;
  /** Saves (or with null removes) the signed-in person's own cell phone. */
  saveMemberPhone: (
    ctx: RequestContext,
    organizationId: string,
    phone: string | null,
  ) => Promise<'saved' | 'forbidden'>;
  /** Records a new call to a contact (or the company's own phone when contactId is null). */
  placeCall: (
    ctx: RequestContext,
    counterpartyId: string,
    contactId: string | null,
    fromPhone: string,
  ) => Promise<PlaceCallResult>;
  getCall: (ctx: RequestContext, id: string) => Promise<CallView | null>;
  /** The counterparty's number a call dials, in E.164 form. */
  callNumber: (ctx: RequestContext, id: string) => Promise<string | null>;
  /** Telnyx's id for a leg, once known; an id already recorded is kept. */
  recordLeg: (
    ctx: RequestContext,
    callId: string,
    leg: 'you' | 'them',
    callControlId: string,
  ) => Promise<void>;
  /** Ends a call that went wrong before Telnyx reported its end (a command Telnyx refused). */
  failCall: (ctx: RequestContext, callId: string, outcome: CallOutcome) => Promise<void>;
  /** The organization and caller of a call, for Telnyx's events (no signed-in user). */
  callPlacer: (callId: string) => Promise<{ organizationId: string; placedBy: string } | null>;
  /**
   * Keeps a Telnyx event once and applies what follows from it, as the caller: the call's
   * new state and, for a call that connected and ended, its contact log entry.
   */
  applyCallEvent: (
    ctx: RequestContext,
    callId: string,
    telnyxEventId: string,
    event: CallEvent,
  ) => Promise<CallEventResult>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

interface CallRow {
  id: string;
  organization_id: string;
  counterparty_id: string;
  contact_name: string;
  status: CallStatus;
  outcome: CallOutcome | null;
  created_at: Date;
  connected_at: Date | null;
  ended_at: Date | null;
  contact_log_entry_id: string | null;
  staff_call_control_id: string | null;
  counterparty_call_control_id: string | null;
  placed_by_name: string;
}

const CALL_COLUMNS = (tx: postgres.TransactionSql) => tx`
  id, organization_id, counterparty_id, contact_name, status::text as status,
  outcome::text as outcome, created_at, connected_at, ended_at, contact_log_entry_id,
  staff_call_control_id, counterparty_call_control_id, placed_by_name`;

function toView(row: CallRow): CallView {
  return {
    id: row.id,
    counterpartyId: row.counterparty_id,
    contactName: row.contact_name,
    status: row.status,
    outcome: row.outcome,
    createdAt: row.created_at.toISOString(),
    connectedAt: row.connected_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    contactLogEntryId: row.contact_log_entry_id,
  };
}

/** A call under way this long ago is treated as over when the caller places another. */
const IN_PROGRESS_WINDOW = '15 minutes';

export function callQueries(asUser: AsUser, sql: postgres.Sql): CallsDatabase {
  return {
    getMemberPhone(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ phone: string }[]>`
          select phone from app.member_phones
          where organization_id = ${organizationId} and user_id = app.current_user_id()`;
        return row?.phone ?? null;
      });
    },

    saveMemberPhone(ctx, organizationId, phone) {
      return asUser(ctx, async (tx) => {
        const [member] = await tx<{ active: boolean }[]>`
          select app.is_active_member(${organizationId}) as active`;
        if (member?.active !== true) return 'forbidden';
        if (phone === null) {
          await tx`delete from app.member_phones
                   where organization_id = ${organizationId} and user_id = app.current_user_id()`;
        } else {
          await tx`
            insert into app.member_phones (organization_id, user_id, phone)
            values (${organizationId}, app.current_user_id(), ${phone})
            on conflict (organization_id, user_id) do update set phone = excluded.phone`;
        }
        return 'saved';
      });
    },

    placeCall(ctx, counterpartyId, contactId, fromPhone) {
      return asUser(ctx, async (tx): Promise<PlaceCallResult> => {
        const [target] = await tx<
          {
            organization_id: string;
            allowed: boolean;
            archived: boolean;
            legal_name: string;
            phone: string | null;
          }[]
        >`
          select organization_id, app.can_log_contacts(organization_id) as allowed,
                 archived_at is not null as archived, legal_name, phone
          from app.counterparties where id = ${counterpartyId}`;
        if (!target) return { status: 'not_found' };
        if (!target.allowed) return { status: 'forbidden' };
        if (target.archived) return { status: 'archived' };
        let name = target.legal_name;
        let number = target.phone;
        if (contactId !== null) {
          const [contact] = await tx<{ name: string; phone: string | null }[]>`
            select name, phone from app.counterparty_contacts
            where id = ${contactId} and counterparty_id = ${counterpartyId}`;
          if (!contact) return { status: 'not_found' };
          name = contact.name;
          number = contact.phone;
        }
        if (number === null || number.trim() === '') return { status: 'no_number' };
        const counterpartyPhone = dialablePhone(number);
        if (counterpartyPhone === null) return { status: 'not_dialable' };
        const org = target.organization_id;
        const [cell] = await tx<{ phone: string }[]>`
          select phone from app.member_phones
          where organization_id = ${org} and user_id = app.current_user_id()`;
        if (!cell) return { status: 'no_cell' };
        // One call at a time per person; a second click while one rings is refused. The lock
        // makes two clicks at the same moment wait for each other, so only one call is placed.
        await tx`select pg_catalog.pg_advisory_xact_lock(
                   pg_catalog.hashtextextended('app.calls:' || app.current_user_id()::text, 0))`;
        const [busy] = await tx<{ id: string }[]>`
          select id from app.calls
          where organization_id = ${org} and placed_by = app.current_user_id()
            and status <> 'ended'
            and created_at > now() - ${IN_PROGRESS_WINDOW}::interval
          limit 1`;
        if (busy) return { status: 'in_progress' };
        const [created] = await tx<{ id: string }[]>`
          insert into app.calls (organization_id, counterparty_id, contact_id, contact_name,
                                 placed_by, placed_by_name, from_phone, counterparty_phone)
          values (${org}, ${counterpartyId}, ${contactId}, ${name}, app.current_user_id(),
                  'set by the database', ${fromPhone}, ${counterpartyPhone})
          returning id`;
        if (!created) throw new Error('call was not created');
        return {
          status: 'created',
          callId: created.id,
          staffPhone: cell.phone,
          counterpartyPhone,
        };
      });
    },

    getCall(ctx, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<CallRow[]>`
          select ${CALL_COLUMNS(tx)} from app.calls where id = ${id}`;
        return row ? toView(row) : null;
      });
    },

    callNumber(ctx, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ counterparty_phone: string }[]>`
          select counterparty_phone from app.calls where id = ${id}`;
        return row?.counterparty_phone ?? null;
      });
    },

    recordLeg(ctx, callId, leg, callControlId) {
      return asUser(ctx, async (tx) => {
        if (leg === 'you') {
          await tx`update app.calls
                   set staff_call_control_id = ${callControlId}
                   where id = ${callId} and staff_call_control_id is null and status <> 'ended'`;
        } else {
          await tx`update app.calls
                   set counterparty_call_control_id = ${callControlId}
                   where id = ${callId} and counterparty_call_control_id is null
                     and status <> 'ended'`;
        }
      });
    },

    failCall(ctx, callId, outcome) {
      return asUser(ctx, async (tx) => {
        await tx`update app.calls
                 set status = 'ended', outcome = ${outcome}::app.call_outcome, ended_at = now()
                 where id = ${callId} and status <> 'ended' and status <> 'connected'`;
      });
    },

    async callPlacer(callId) {
      const [row] = await sql<{ organization_id: string; placed_by: string }[]>`
        select organization_id, placed_by from app.call_placer(${callId})`;
      return row ? { organizationId: row.organization_id, placedBy: row.placed_by } : null;
    },

    applyCallEvent(ctx, callId, telnyxEventId, event) {
      return asUser(ctx, async (tx): Promise<CallEventResult> => {
        // Locks the call, so two events of the same call are applied one after the other.
        const [call] = await tx<CallRow[]>`
          select ${CALL_COLUMNS(tx)} from app.calls where id = ${callId} for update`;
        if (!call) return { status: 'not_found' };
        const kept = await tx`
          insert into app.call_events
            (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at)
          values (${call.organization_id}, ${callId}, ${telnyxEventId}, ${event.type},
                  ${event.leg}, ${event.occurredAt}::timestamptz)
          on conflict (telnyx_event_id) do nothing
          returning id`;
        if (kept.length === 0) return { status: 'duplicate' };

        const step = nextCallStep(
          {
            status: call.status,
            staffCallControlId: call.staff_call_control_id,
            counterpartyCallControlId: call.counterparty_call_control_id,
            connectedAt: call.connected_at?.toISOString() ?? null,
          },
          event,
        );
        const c = step.changes;
        if (Object.keys(c).length > 0) {
          await tx`
            update app.calls set
              status = coalesce(${c.status ?? null}::app.call_status, status),
              outcome = coalesce(${c.outcome ?? null}::app.call_outcome, outcome),
              staff_answered_at = coalesce(staff_answered_at, ${c.staffAnsweredAt ?? null}::timestamptz),
              connected_at = coalesce(connected_at, ${c.connectedAt ?? null}::timestamptz),
              -- Never before it connected, whatever the order of Telnyx's clocks.
              ended_at = case when ${c.endedAt ?? null}::timestamptz is null then ended_at
                              else coalesce(ended_at,
                                            greatest(${c.endedAt ?? null}::timestamptz, connected_at))
                         end,
              hangup_cause = coalesce(hangup_cause, ${c.hangupCause ?? null}),
              staff_call_control_id = coalesce(staff_call_control_id, ${c.staffCallControlId ?? null}),
              counterparty_call_control_id = coalesce(counterparty_call_control_id,
                                                      ${c.counterpartyCallControlId ?? null})
            where id = ${callId}`;
        }
        if (c.outcome === 'talked') await logCall(tx, callId);
        return { status: 'applied', step, organizationId: call.organization_id };
      });
    },
  };
}

/**
 * Writes a call that connected to the counterparty's contact log, in the caller's name, and
 * links it to the call. Skipped when the caller may no longer log contacts or the
 * counterparty was archived meanwhile.
 */
async function logCall(tx: postgres.TransactionSql, callId: string) {
  const [call] = await tx<
    {
      organization_id: string;
      counterparty_id: string;
      contact_name: string;
      placed_by_name: string;
      connected_at: Date;
      ended_at: Date;
      contact_log_entry_id: string | null;
      allowed: boolean;
      archived: boolean;
    }[]
  >`
    select c.organization_id, c.counterparty_id, c.contact_name, c.placed_by_name,
           c.connected_at, c.ended_at, c.contact_log_entry_id,
           app.can_log_contacts(c.organization_id) as allowed,
           p.archived_at is not null as archived
    from app.calls c join app.counterparties p on p.id = c.counterparty_id
    where c.id = ${callId}`;
  if (call?.contact_log_entry_id !== null || !call.allowed || call.archived) return;
  const seconds = secondsBetween(call.connected_at.toISOString(), call.ended_at.toISOString());
  const [entry] = await tx<{ id: string }[]>`
    insert into app.contact_log_entries (organization_id, counterparty_id, created_by)
    values (${call.organization_id}, ${call.counterparty_id}, app.current_user_id())
    returning id`;
  if (!entry) throw new Error('contact log entry was not created');
  // revision_number is set by the database; 1 is a placeholder.
  await tx`
    insert into app.contact_log_revisions
      (organization_id, entry_id, revision_number, occurred_at, channel, contact_name, notes,
       recorded_by, recorded_by_name)
    values (${call.organization_id}, ${entry.id}, 1, ${call.connected_at}, 'call',
            ${call.contact_name}, ${callLogNotes(seconds)}, app.current_user_id(),
            ${call.placed_by_name})`;
  await tx`update app.calls set contact_log_entry_id = ${entry.id} where id = ${callId}`;
}
