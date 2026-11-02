-- Codex's review of the Telnyx calls (ivanmueller/gss#107 at a7dbf99, four P2), the fixes that
-- need the database:
--
-- 1. A command to Telnyx that follows from an event (ask for 1, dial them, hang up a leg) is
--    kept as pending in the same transaction as the event, and marked done only once Telnyx has
--    taken it. If sending fails, Telnyx sends the event again and the pending command is sent
--    again (Telnyx ignores a command whose id it has seen), instead of being lost because the
--    event is already kept.
-- 2. A command is claimed under the call's lock and checked against the call's state before it
--    is sent; ending a call cancels its pending commands, so a dial queued before the caller hung
--    up is never sent.
-- 3. An ended call that did not connect becomes "talked" when the counterparty's "answered"
--    event arrives late but happened before the call ended (Telnyx's events can come out of
--    order); check_call allows that one correction and nothing else.

create table app.call_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  call_id uuid not null,
  -- The Telnyx event it follows from.
  telnyx_event_id text not null references app.call_events (telnyx_event_id),
  kind text not null check (kind in ('confirm', 'dial_them', 'hang_up')),
  -- The leg it acts on (for dial_them, the caller's leg to join).
  call_control_id text not null check (length(call_control_id) between 1 and 200),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  -- When it was last claimed for sending; a claim older than a minute can be taken again.
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_commands_call_fkey foreign key (organization_id, call_id)
    references app.calls (organization_id, id),
  -- Claimed at least once exactly when it has a claim time.
  check ((attempts = 0) = (claimed_at is null))
);

create index call_commands_event_idx on app.call_commands (telnyx_event_id);
create index call_commands_open_idx on app.call_commands (call_id) where status in ('pending', 'sending');

-- A command's rules: it starts pending; what it is and acts on never changes; once done, failed
-- or cancelled it stays so.
create function app.check_call_command()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.attempts <> 0 or new.claimed_at is not null then
      raise exception 'a command starts pending' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.organization_id, new.call_id, new.telnyx_event_id, new.kind, new.call_control_id,
      new.created_at)
     is distinct from
     (old.organization_id, old.call_id, old.telnyx_event_id, old.kind, old.call_control_id,
      old.created_at) then
    raise exception 'a command stays what it is' using errcode = 'check_violation';
  end if;
  if old.status in ('done', 'failed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'a finished command stays finished' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts then
    raise exception 'attempts only go up' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger call_commands_check
  before insert or update on app.call_commands
  for each row execute function app.check_call_command();
create trigger call_commands_touch_updated_at
  before update on app.call_commands
  for each row execute function app.touch_updated_at();
create trigger call_commands_no_delete
  before delete on app.call_commands
  for each row execute function app.keep_calls();
create trigger call_commands_no_truncate
  before truncate on app.call_commands
  for each statement execute function app.keep_calls();

alter table app.call_commands enable row level security;

create policy call_commands_select_for_members on app.call_commands
  for select to app_api using (app.is_active_member(organization_id));
-- Only as the caller, as for the call's events.
create policy call_commands_insert_by_caller on app.call_commands
  for insert to app_api
  with check (
    app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.organization_id = call_commands.organization_id
         and c.placed_by = app.current_user_id()
    )
  );
create policy call_commands_update_by_caller on app.call_commands
  for update to app_api
  using (
    app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.placed_by = app.current_user_id()
    )
  )
  with check (
    app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.placed_by = app.current_user_id()
    )
  );

revoke all on app.call_commands from public, anon, authenticated, service_role;
revoke all on function app.check_call_command() from public, anon, authenticated, service_role, app_api;
grant select, insert on app.call_commands to app_api;
grant update (status, attempts, claimed_at) on app.call_commands to app_api;

-- check_call as before, with one correction allowed on an ended call: a call that did not
-- connect becomes talked, with the time it connected (never after it ended) and the
-- counterparty's leg id if it was not known. Nothing else about an ended call changes but its
-- contact log entry.
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
  late_answer := old.status = 'ended' and new.status = 'ended'
    and old.outcome is distinct from 'talked' and new.outcome = 'talked'
    and old.connected_at is null and new.connected_at is not null
    and new.connected_at <= old.ended_at
    and old.contact_log_entry_id is null;
  if late_answer then
    if (new.ended_at, new.staff_answered_at, new.hangup_cause, new.staff_call_control_id,
        new.contact_log_entry_id)
       is distinct from
       (old.ended_at, old.staff_answered_at, old.hangup_cause, old.staff_call_control_id, null::uuid)
       or (old.counterparty_call_control_id is not null
           and new.counterparty_call_control_id is distinct from old.counterparty_call_control_id) then
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
