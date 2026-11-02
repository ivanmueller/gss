-- Calling counterparties through Telnyx (the owner's request and decisions of 2026-11-02,
-- docs/DECISIONS.md): a Call button beside a contact's or company's phone rings the team
-- member's own cell phone first; they press 1, and Telnyx dials the counterparty and joins the
-- two. A call that connects is written to the counterparty's contact log in the caller's name.
--
-- Three tables:
-- - member_phones: each team member's own cell phone, which only they read and change.
-- - calls: one row per call placed from the platform; who placed it, to which counterparty and
--   number, how far it got, when (UTC), how it ended, and the contact log entry it made.
-- - call_events: the Telnyx events received for a call, each kept once, so an event Telnyx
--   sends again is recognized and ignored.
--
-- Telnyx's messages to the Worker carry no signed-in user. The Worker checks each one's
-- Ed25519 signature, finds the call's organization and caller with app.call_placer, and then
-- writes as that caller, so row level security and the triggers below apply as for any request.
--
-- Access for app_api: every active member reads calls and call events. Traders, operations
-- and admins place calls, for a counterparty that is not archived, in their own name; only the
-- caller's requests and Telnyx's events for their call move a call forward. Nothing is deleted.

-- A phone number in E.164 form, as Telnyx dials it: + then 8 to 15 digits.
create domain app.e164_phone as text check (value ~ '^\+[1-9][0-9]{7,14}$');

create type app.call_status as enum ('calling_you', 'confirming', 'calling_them', 'connected', 'ended');
-- How a call ended: talked (connected), you_missed (the caller's cell was not answered),
-- not_confirmed (answered, but 1 was not pressed; a voicemail, for instance), no_answer and
-- busy (the counterparty), cancelled (the caller hung up while it rang), failed (anything else).
create type app.call_outcome as enum (
  'talked', 'you_missed', 'not_confirmed', 'no_answer', 'busy', 'cancelled', 'failed'
);

create table app.member_phones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  phone app.e164_phone not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  constraint member_phones_member_fkey foreign key (organization_id, user_id)
    references app.organization_members (organization_id, user_id)
);

create table app.calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  counterparty_id uuid not null,
  -- The contact called, or null for the company's own phone. Not a foreign key: a contact can
  -- be removed later, and the call keeps the name it was placed to.
  contact_id uuid,
  contact_name app.label not null,
  placed_by uuid not null references auth.users (id),
  -- Filled in by the database from the caller's login.
  placed_by_name app.label not null,
  -- GSS's Telnyx number the call came from, and the counterparty's number dialed.
  from_phone app.e164_phone not null,
  counterparty_phone app.e164_phone not null,
  status app.call_status not null default 'calling_you',
  outcome app.call_outcome,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- From Telnyx's events, in UTC; each is set once.
  staff_answered_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  -- Telnyx's hangup cause for the leg that ended the call, e.g. normal_clearing, user_busy.
  hangup_cause text check (hangup_cause ~ '^[a-z0-9_]{1,40}$'),
  -- Telnyx's ids for the two legs: to the caller's cell, then to the counterparty.
  staff_call_control_id text check (length(staff_call_control_id) between 1 and 200),
  counterparty_call_control_id text check (length(counterparty_call_control_id) between 1 and 200),
  -- The contact log entry written when the call connected and ended.
  contact_log_entry_id uuid unique,
  unique (organization_id, id),
  constraint calls_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id),
  constraint calls_entry_fkey foreign key (organization_id, counterparty_id, contact_log_entry_id)
    references app.contact_log_entries (organization_id, counterparty_id, id),
  check ((status = 'ended') = (outcome is not null)),
  check ((status = 'ended') = (ended_at is not null)),
  check ((connected_at is not null) = (status = 'connected' or outcome is not distinct from 'talked')),
  check (contact_log_entry_id is null or outcome is not distinct from 'talked'),
  check (ended_at is null or connected_at is null or ended_at >= connected_at)
);

create index calls_counterparty_idx on app.calls (counterparty_id, created_at desc);
create index calls_placed_by_idx on app.calls (placed_by, created_at desc);
create index calls_counterparty_phone_idx on app.calls (organization_id, counterparty_phone, created_at desc);

create table app.call_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  call_id uuid not null,
  -- Telnyx's id for the event; an event sent again has the same id.
  telnyx_event_id text not null unique check (length(telnyx_event_id) between 1 and 200),
  event_type text not null check (event_type ~ '^[a-z0-9_.]{1,100}$'),
  -- Which leg it is about: the caller's cell (you) or the counterparty (them).
  leg text not null check (leg in ('you', 'them')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint call_events_call_fkey foreign key (organization_id, call_id)
    references app.calls (organization_id, id)
);

create index call_events_call_idx on app.call_events (call_id, occurred_at);

-- The organization and caller of a call, for Telnyx's events, which carry no signed-in user.
-- SECURITY DEFINER because nobody is signed in yet; it reveals only who placed the call, to a
-- caller who already holds the call's id (which only Telnyx's signed events and the caller have).
create function app.call_placer(call uuid)
returns table (organization_id uuid, placed_by uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.organization_id, c.placed_by from app.calls c where c.id = call
$$;

-- A call's rules on every insert and update:
-- - placed in one's own name, by someone who may log contacts, to a contact of the same
--   counterparty when a contact is named; it starts by calling the caller's cell, with nothing
--   else filled in; the caller's name comes from their login;
-- - who placed it, to whom and from which numbers never changes;
-- - it only moves forward (calling you, confirming, calling them, connected, ended);
-- - what Telnyx reported is set once and kept;
-- - once ended, only the contact log entry it made is added, once.
create function app.check_call()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ranks constant app.call_status[] :=
    array['calling_you', 'confirming', 'calling_them', 'connected', 'ended']::app.call_status[];
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

create trigger calls_check
  before insert or update on app.calls
  for each row execute function app.check_call();
create trigger calls_touch_updated_at
  before update on app.calls
  for each row execute function app.touch_updated_at();
create trigger member_phones_touch_updated_at
  before update on app.member_phones
  for each row execute function app.touch_updated_at();

-- Calls and their events are history: nobody deletes them; events are never changed.
create function app.keep_calls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'calls and their events are kept' using errcode = 'insufficient_privilege';
end
$$;

create trigger calls_no_delete
  before delete on app.calls
  for each row execute function app.keep_calls();
create trigger calls_no_truncate
  before truncate on app.calls
  for each statement execute function app.keep_calls();
create trigger call_events_immutable
  before update or delete on app.call_events
  for each row execute function app.keep_calls();
create trigger call_events_no_truncate
  before truncate on app.call_events
  for each statement execute function app.keep_calls();

create trigger member_phones_audit
  after insert or update or delete on app.member_phones
  for each row execute function app.record_audit_event();
create trigger calls_audit
  after insert or update or delete on app.calls
  for each row execute function app.record_audit_event();

alter table app.member_phones enable row level security;
alter table app.calls enable row level security;
alter table app.call_events enable row level security;

-- A cell phone is its owner's alone: only they read, set, change and remove it.
create policy member_phones_own on app.member_phones
  for all to app_api
  using (user_id = app.current_user_id() and app.is_active_member(organization_id))
  with check (user_id = app.current_user_id() and app.is_active_member(organization_id));

create policy calls_select_for_members on app.calls
  for select to app_api using (app.is_active_member(organization_id));
-- New calls only to a counterparty that is not archived, in one's own name.
create policy calls_insert_for_loggers on app.calls
  for insert to app_api
  with check (
    app.can_log_contacts(organization_id)
    and placed_by = app.current_user_id()
    and exists (
      select 1 from app.counterparties c
       where c.id = counterparty_id and c.organization_id = calls.organization_id
         and c.archived_at is null
    )
  );
-- Only the caller's own requests (and Telnyx's events, written as the caller) move it on.
create policy calls_update_by_caller on app.calls
  for update to app_api
  using (placed_by = app.current_user_id() and app.is_active_member(organization_id))
  with check (placed_by = app.current_user_id() and app.is_active_member(organization_id));

create policy call_events_select_for_members on app.call_events
  for select to app_api using (app.is_active_member(organization_id));
create policy call_events_insert_by_caller on app.call_events
  for insert to app_api
  with check (
    app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.organization_id = call_events.organization_id
         and c.placed_by = app.current_user_id()
    )
  );

-- Privileges: nothing for public or the Supabase API roles. app_api reads, adds and changes
-- only what each table needs; it never deletes a call or an event, or changes an event.
revoke all on app.member_phones, app.calls, app.call_events
  from public, anon, authenticated, service_role;
revoke all on function app.call_placer(uuid), app.check_call(), app.keep_calls()
  from public, anon, authenticated, service_role;
revoke all on function app.check_call(), app.keep_calls() from app_api;
grant select, insert, delete on app.member_phones to app_api;
grant update (phone) on app.member_phones to app_api;
grant select, insert on app.calls, app.call_events to app_api;
grant update (status, outcome, staff_answered_at, connected_at, ended_at, hangup_cause,
              staff_call_control_id, counterparty_call_control_id, contact_log_entry_id)
  on app.calls to app_api;
grant execute on function app.call_placer(uuid) to app_api;
