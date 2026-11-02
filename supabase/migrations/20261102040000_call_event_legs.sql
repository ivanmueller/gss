-- Codex's third review of the Telnyx calls (ivanmueller/gss#109 at d64168a), finding 3: the
-- late-answer correction of an ended call needs an answer from the call's own leg to them.
-- Each kept event now also keeps Telnyx's id for the leg it is about (call_control_id; null for
-- events kept before, which therefore never satisfy the correction), and app.check_call()
-- matches it to the call's known counterparty leg.
--
-- Findings 1 and 2 (an unfinished cleanup hang-up given back to the delivery; an older claim's
-- success finishing the command) are in the API (apps/api/src/calls-db.ts).

alter table app.call_events
  add column call_control_id text check (length(call_control_id) between 1 and 200);

create or replace function app.check_call()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ranks constant app.call_status[] :=
    array['calling_you', 'confirming', 'calling_them', 'connected', 'ended']::app.call_status[];
  late_answer boolean;
begin
  if tg_op = 'INSERT' then
    if not app.can_log_contacts(new.organization_id) or new.placed_by is distinct from app.current_user_id() then
      raise exception 'only traders, operations and admins place calls, in their own name'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'calling_you' or new.outcome is not null or new.staff_answered_at is not null
       or new.connected_at is not null or new.ended_at is not null or new.hangup_cause is not null
       or new.counterparty_call_control_id is not null or new.contact_log_entry_id is not null then
      raise exception 'a call starts by calling the caller''s cell' using errcode = 'check_violation';
    end if;
    if new.contact_id is not null and not exists (
         select 1 from app.counterparty_contacts k
          where k.id = new.contact_id and k.counterparty_id = new.counterparty_id
            and k.organization_id = new.organization_id) then
      raise exception 'the contact called belongs to the counterparty' using errcode = 'foreign_key_violation';
    end if;
    new.placed_by_name := app.member_name(new.organization_id, new.placed_by);
    if new.placed_by_name is null then
      raise exception 'the caller is an active member of the organization'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if (new.organization_id, new.counterparty_id, new.contact_id, new.contact_name, new.placed_by,
      new.placed_by_name, new.from_phone, new.counterparty_phone, new.created_at)
     is distinct from
     (old.organization_id, old.counterparty_id, old.contact_id, old.contact_name, old.placed_by,
      old.placed_by_name, old.from_phone, old.counterparty_phone, old.created_at) then
    raise exception 'a call stays with its caller, counterparty and numbers'
      using errcode = 'check_violation';
  end if;
  if array_position(ranks, new.status) < array_position(ranks, old.status) then
    raise exception 'a call only moves forward' using errcode = 'check_violation';
  end if;

  -- The one correction of an ended call: the counterparty's late "answered".
  -- Only for a call whose counterparty was dialed and whose leg to them is known, and only
  -- with the time of a "call.answered" received from that very leg (Codex's re-review, 6, and
  -- third review, 3).
  late_answer := old.status = 'ended' and new.status = 'ended'
    and old.outcome in ('no_answer', 'busy', 'cancelled', 'failed') and new.outcome = 'talked'
    and old.counterparty_call_control_id is not null
    and old.connected_at is null and new.connected_at is not null
    and new.connected_at <= old.ended_at
    and old.contact_log_entry_id is null
    and exists (
      select 1 from app.call_events e
       where e.call_id = new.id and e.organization_id = new.organization_id
         and e.leg = 'them' and e.event_type = 'call.answered'
         and e.occurred_at = new.connected_at
         and e.call_control_id = old.counterparty_call_control_id
    );
  if late_answer then
    if (new.ended_at, new.staff_answered_at, new.hangup_cause, new.staff_call_control_id,
        new.contact_log_entry_id)
       is distinct from
       (old.ended_at, old.staff_answered_at, old.hangup_cause, old.staff_call_control_id, null::uuid)
       or new.counterparty_call_control_id is distinct from old.counterparty_call_control_id then
      raise exception 'a late answer only marks the call talked' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (old.staff_answered_at is not null and new.staff_answered_at is distinct from old.staff_answered_at)
     or (old.connected_at is not null and new.connected_at is distinct from old.connected_at)
     or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
     or (old.outcome is not null and new.outcome is distinct from old.outcome)
     or (old.hangup_cause is not null and new.hangup_cause is distinct from old.hangup_cause)
     or (old.staff_call_control_id is not null
         and new.staff_call_control_id is distinct from old.staff_call_control_id)
     or (old.counterparty_call_control_id is not null
         and new.counterparty_call_control_id is distinct from old.counterparty_call_control_id)
     or (old.contact_log_entry_id is not null
         and new.contact_log_entry_id is distinct from old.contact_log_entry_id) then
    raise exception 'what Telnyx reported about a call is kept' using errcode = 'check_violation';
  end if;
  if old.status = 'ended'
     and (new.staff_answered_at, new.connected_at, new.hangup_cause, new.staff_call_control_id,
          new.counterparty_call_control_id)
         is distinct from
         (old.staff_answered_at, old.connected_at, old.hangup_cause, old.staff_call_control_id,
          old.counterparty_call_control_id) then
    raise exception 'an ended call only gets its contact log entry' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function app.check_call() from public, anon, authenticated, service_role, app_api;
