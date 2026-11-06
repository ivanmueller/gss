-- Callbacks to GSS's number (the owner's request and answers of 2026-11-06, Codex's review of the
-- design the same day; docs/DECISIONS.md, F-132). A counterparty calling GSS's Telnyx number
-- back reaches whoever on the team last called that number: their own cell rings (20 seconds),
-- a voice names the company and asks them to press 1, and the caller is then answered and joined
-- to them, recorded and transcribed by side like a call placed from the platform. If they do not
-- take it (or cannot: no cell saved, suspended, on another call), the organization's callbacks
-- person is rung next; if nobody takes it, the caller leaves a voicemail. The caller hears
-- ringing, no greeting, until someone takes the call.
--
-- What is kept:
-- - callback_settings: per organization, GSS's number the callbacks arrive on (one organization
--   per number; the organization of a call is found from the number dialed, never from anything
--   else in Telnyx's event) and the callbacks person, chosen by an admin.
-- - calls: a call to GSS's number is a call with direction 'incoming'. Its counterparty is the
--   one of the last call placed to that number, or the one company whose listed phone it is;
--   none for an unknown number. It keeps whom it was meant for (who last called the number),
--   who answered (placed_by, once someone pressed 1), the contact log entry and follow-up it
--   made, and, when nobody could be given a follow-up, an open "return" for the Follow-ups page:
--   taken by someone, linked to a company, or dismissed.
-- - callback_attempts: each person whose cell was rung, in order, with the cell dialed and Telnyx's
--   id for that leg; read only by that person.
-- - call_commands: the commands to Telnyx (ring a cell, ask for 1, answer and join the caller,
--   record, the voicemail message and recording, hang up), kept and claimed as for calls placed
--   from the platform, each tied to its attempt.
-- - call_recordings.voicemail_recording: a voicemail (one channel, the caller's) rather than a call by side.
--
-- Telnyx's events carry no signed-in user, and nobody may stand in for the caller of an incoming
-- call (Codex's review, finding 6), so an incoming call is written only by the SECURITY DEFINER
-- functions below, which the Worker calls after Telnyx's signature is checked; app_api cannot
-- insert or change one directly. Each function finds the call's organization from the call
-- itself and looks at nothing outside it.

-- Settings ---------------------------------------------------------------------------------

create table app.callback_settings (
  -- Named in the audit trail.
  id uuid not null default gen_random_uuid() unique,
  organization_id uuid primary key references app.organizations (id),
  -- GSS's Telnyx number the callbacks arrive on: from the Worker's settings, never from a person.
  phone app.e164_phone not null unique,
  -- Rung when the person who last called the number does not take the call, and given the
  -- follow-up for an unknown number; null: nobody (straight to voicemail).
  callbacks_person uuid,
  callbacks_person_name app.label,
  updated_by uuid not null references auth.users (id),
  updated_by_name app.label not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint callback_settings_person_fkey foreign key (organization_id, callbacks_person)
    references app.organization_members (organization_id, user_id),
  check ((callbacks_person is null) = (callbacks_person_name is null))
);

create trigger callback_settings_touch_updated_at
  before update on app.callback_settings
  for each row execute function app.touch_updated_at();
create trigger callback_settings_audit
  after insert or update or delete on app.callback_settings
  for each row execute function app.record_audit_event();

alter table app.callback_settings enable row level security;
create policy callback_settings_select_for_members on app.callback_settings
  for select to app_api using (app.is_active_member(organization_id));

-- Calls to GSS's number ----------------------------------------------------------------------

alter table app.calls
  add column direction text not null default 'outgoing'
    check (direction in ('outgoing', 'incoming')),
  -- Whom an incoming call was meant for: who last placed a call to the number.
  add column meant_for uuid references auth.users (id),
  add column meant_for_name app.label,
  -- The follow-up made for a callback nobody took, or a voicemail.
  add column follow_up_id uuid,
  -- An incoming call nobody could be given a follow-up for (an unknown number, or nobody to
  -- give it to): open on the Follow-ups page until someone takes it, links it to a company or
  -- dismisses it.
  add column return_status text check (return_status in ('open', 'done', 'dismissed')),
  add column return_owner uuid references auth.users (id),
  add column return_owner_name app.label,
  add column return_closed_by uuid references auth.users (id),
  add column return_closed_by_name app.label,
  add column return_closed_at timestamptz,
  add constraint calls_follow_up_fkey foreign key (organization_id, follow_up_id)
    references app.follow_ups (organization_id, id),
  add constraint calls_follow_up_key unique (follow_up_id),
  add constraint calls_meant_for_name check ((meant_for is null) = (meant_for_name is null)),
  add constraint calls_return_owner_name check ((return_owner is null) = (return_owner_name is null)),
  add constraint calls_return_closed check (
    (return_status in ('done', 'dismissed')) = (return_closed_at is not null)
    and (return_closed_at is null) = (return_closed_by is null)
    and (return_closed_at is null) = (return_closed_by_name is null)
  ),
  add constraint calls_return_after_end check (
    (return_status is null and return_owner is null) or status = 'ended'
  ),
  -- A call placed from the platform has its caller and counterparty and none of the above.
  add constraint calls_outgoing_shape check (
    direction = 'incoming'
    or (placed_by is not null and placed_by_name is not null and counterparty_id is not null
        and meant_for is null and follow_up_id is null and return_status is null
        and return_owner is null)
  ),
  -- An incoming call keeps the caller's leg from the start.
  add constraint calls_incoming_leg check (
    direction = 'outgoing' or counterparty_call_control_id is not null
  );

alter table app.calls alter column placed_by drop not null;
alter table app.calls alter column placed_by_name drop not null;
alter table app.calls alter column counterparty_id drop not null;
alter table app.calls
  add constraint calls_placed_by_name check ((placed_by is null) = (placed_by_name is null));

-- A callback that nobody took, or a voicemail, is logged too.
alter table app.calls drop constraint calls_check3;
alter table app.calls
  add constraint calls_entry_outcome check (
    contact_log_entry_id is null or outcome is not distinct from 'talked'
    or (direction = 'incoming' and outcome is not null)
  );

-- One call per incoming Telnyx leg, however often its events arrive (Codex's review, finding 2).
create unique index calls_incoming_leg_idx on app.calls (counterparty_call_control_id)
  where direction = 'incoming';
create index calls_return_open_idx on app.calls (organization_id, created_at desc)
  where return_status = 'open';
create index calls_incoming_phone_idx on app.calls (organization_id, counterparty_phone, created_at desc)
  where direction = 'outgoing';

-- Each person rung for an incoming call ------------------------------------------------------

create table app.callback_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  call_id uuid not null,
  -- 1 for whom the call was meant, 2 for the callbacks person.
  position integer not null check (position between 1 and 2),
  member_id uuid not null,
  member_name app.label not null,
  -- The cell dialed, as it was when the attempt began.
  cell app.e164_phone not null,
  -- Telnyx's id for the leg to their cell, once known.
  leg text check (length(leg) between 1 and 200),
  status text not null default 'ringing'
    check (status in ('ringing', 'confirming', 'accepted', 'no_answer', 'declined', 'cancelled', 'failed')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  unique (organization_id, id),
  unique (call_id, position),
  constraint callback_attempts_call_fkey foreign key (organization_id, call_id)
    references app.calls (organization_id, id),
  constraint callback_attempts_member_fkey foreign key (organization_id, member_id)
    references app.organization_members (organization_id, user_id)
);

create unique index callback_attempts_leg_idx on app.callback_attempts (leg) where leg is not null;
create index callback_attempts_member_idx on app.callback_attempts (member_id, started_at desc)
  where status in ('ringing', 'confirming', 'accepted');

create trigger callback_attempts_no_delete
  before delete on app.callback_attempts
  for each row execute function app.keep_calls();
create trigger callback_attempts_no_truncate
  before truncate on app.callback_attempts
  for each statement execute function app.keep_calls();

alter table app.callback_attempts enable row level security;
-- Each person reads only their own attempts (their cell and leg ids stay theirs).
create policy callback_attempts_select_own on app.callback_attempts
  for select to app_api
  using (member_id = app.current_user_id() and app.is_active_member(organization_id));

-- Commands of incoming calls ------------------------------------------------------------------

alter table app.call_commands drop constraint call_commands_kind_check;
alter table app.call_commands
  add constraint call_commands_kind_check check (kind in (
    'confirm', 'dial_them', 'hang_up', 'record',
    -- Incoming calls: ring a team member's cell, answer the caller, join the two, say the
    -- voicemail message, record the voicemail.
    'dial_member', 'answer', 'bridge', 'greet', 'record_voicemail'
  )),
  add column attempt_id uuid,
  add constraint call_commands_attempt_fkey foreign key (organization_id, attempt_id)
    references app.callback_attempts (organization_id, id);

-- check_call_command as before, with the attempt fixed too.
create or replace function app.check_call_command()
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
      new.created_at, new.attempt_id)
     is distinct from
     (old.organization_id, old.call_id, old.telnyx_event_id, old.kind, old.call_control_id,
      old.created_at, old.attempt_id) then
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

-- Voicemail recordings -----------------------------------------------------------------------

alter table app.call_recordings
  add column voicemail_recording boolean not null default false;

-- Requests from the web app touch only calls placed from the platform ---------------------------

drop policy calls_insert_for_loggers on app.calls;
create policy calls_insert_for_loggers on app.calls
  for insert to app_api
  with check (
    direction = 'outgoing'
    and app.can_log_contacts(organization_id)
    and placed_by = app.current_user_id()
    and exists (
      select 1 from app.counterparties c
       where c.id = counterparty_id and c.organization_id = calls.organization_id
         and c.archived_at is null
    )
  );
drop policy calls_update_by_caller on app.calls;
create policy calls_update_by_caller on app.calls
  for update to app_api
  using (direction = 'outgoing' and placed_by = app.current_user_id()
         and app.is_active_member(organization_id))
  with check (direction = 'outgoing' and placed_by = app.current_user_id()
              and app.is_active_member(organization_id));

drop policy call_events_insert_by_caller on app.call_events;
create policy call_events_insert_by_caller on app.call_events
  for insert to app_api
  with check (
    app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.organization_id = call_events.organization_id
         and c.direction = 'outgoing' and c.placed_by = app.current_user_id()
    )
  );

drop policy call_commands_select_by_caller on app.call_commands;
create policy call_commands_select_by_caller on app.call_commands
  for select to app_api
  using (
    app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.direction = 'outgoing' and c.placed_by = app.current_user_id()
    )
  );
drop policy call_commands_insert_by_caller on app.call_commands;
create policy call_commands_insert_by_caller on app.call_commands
  for insert to app_api
  with check (
    attempt_id is null
    and app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.organization_id = call_commands.organization_id
         and c.direction = 'outgoing' and c.placed_by = app.current_user_id()
    )
  );
drop policy call_commands_update_by_caller on app.call_commands;
create policy call_commands_update_by_caller on app.call_commands
  for update to app_api
  using (
    app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.direction = 'outgoing' and c.placed_by = app.current_user_id()
    )
  )
  with check (
    app.is_active_member(organization_id)
    and exists (
      select 1 from app.calls c
       where c.id = call_id and c.direction = 'outgoing' and c.placed_by = app.current_user_id()
    )
  );

-- Telnyx's events for a call placed from the platform are applied as its caller; an incoming
-- call has no such caller, so it is never found here.
create or replace function app.call_placer(call uuid)
returns table (organization_id uuid, placed_by uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.organization_id, c.placed_by from app.calls c
   where c.id = call and c.direction = 'outgoing'
$$;

-- A call's rules ------------------------------------------------------------------------------
-- Calls placed from the platform keep their rules (20261102040000_call_event_legs.sql). An
-- incoming call:
-- - starts ringing someone (calling_you) with its caller's leg, nothing else reported, no
--   caller, follow-up or return; its contact, if any, belongs to its counterparty;
-- - keeps its organization, numbers, leg, whom it was meant for and when it came in;
-- - gets a counterparty only once, when it had none (linked from the Follow-ups page);
-- - gets who answered, their leg and when they answered once, never changed;
-- - moves only along calling_you ⇄ confirming → joining → connected → ended, or to voicemail
--   then ended; once ended it stays ended;
-- - keeps what Telnyx reported, its contact log entry and follow-up once set;
-- - has a return only once ended: open, then done or dismissed, never back.
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
  if tg_op = 'UPDATE' and new.direction is distinct from old.direction then
    raise exception 'a call keeps its direction' using errcode = 'check_violation';
  end if;

  if new.direction = 'incoming' then
    if tg_op = 'INSERT' then
      if new.status <> 'calling_you' or new.outcome is not null or new.staff_answered_at is not null
         or new.connected_at is not null or new.ended_at is not null or new.hangup_cause is not null
         or new.placed_by is not null or new.placed_by_name is not null
         or new.staff_call_control_id is not null or new.contact_log_entry_id is not null
         or new.follow_up_id is not null or new.return_status is not null
         or new.return_owner is not null then
        raise exception 'an incoming call starts ringing someone' using errcode = 'check_violation';
      end if;
      if new.contact_id is not null and not exists (
           select 1 from app.counterparty_contacts k
            where k.id = new.contact_id and k.counterparty_id = new.counterparty_id
              and k.organization_id = new.organization_id) then
        raise exception 'the contact belongs to the counterparty' using errcode = 'foreign_key_violation';
      end if;
      return new;
    end if;

    if (new.organization_id, new.from_phone, new.counterparty_phone, new.created_at,
        new.counterparty_call_control_id, new.meant_for, new.meant_for_name)
       is distinct from
       (old.organization_id, old.from_phone, old.counterparty_phone, old.created_at,
        old.counterparty_call_control_id, old.meant_for, old.meant_for_name) then
      raise exception 'an incoming call keeps its numbers, leg and whom it was meant for'
        using errcode = 'check_violation';
    end if;
    -- The one correction of an ended incoming call: missed, then talked once the join is known
    -- to have worked (app.callback_joined_late), before anything was logged.
    if old.status = 'ended' and new.status = 'ended' and old.outcome = 'missed'
       and new.outcome = 'talked' and old.connected_at is null and new.connected_at is not null
       and new.connected_at <= old.ended_at and new.connected_at >= old.created_at
       and old.placed_by is not null and old.contact_log_entry_id is null
       and old.follow_up_id is null and old.return_status is null
       and (new.counterparty_id, new.contact_id, new.contact_name, new.placed_by, new.placed_by_name,
            new.staff_call_control_id, new.staff_answered_at, new.ended_at, new.hangup_cause,
            new.contact_log_entry_id, new.follow_up_id, new.return_status, new.return_owner)
           is not distinct from
           (old.counterparty_id, old.contact_id, old.contact_name, old.placed_by, old.placed_by_name,
            old.staff_call_control_id, old.staff_answered_at, old.ended_at, old.hangup_cause,
            null::uuid, null::uuid, null::text, null::uuid) then
      return new;
    end if;
    if old.counterparty_id is not null
       and (new.counterparty_id, new.contact_id, new.contact_name)
           is distinct from (old.counterparty_id, old.contact_id, old.contact_name) then
      raise exception 'an incoming call keeps its counterparty' using errcode = 'check_violation';
    end if;
    if old.counterparty_id is null and new.counterparty_id is null
       and (new.contact_id, new.contact_name) is distinct from (old.contact_id, old.contact_name) then
      raise exception 'an incoming call keeps its caller''s name until it is linked'
        using errcode = 'check_violation';
    end if;
    if new.contact_id is not null and new.contact_id is distinct from old.contact_id and not exists (
         select 1 from app.counterparty_contacts k
          where k.id = new.contact_id and k.counterparty_id = new.counterparty_id
            and k.organization_id = new.organization_id) then
      raise exception 'the contact belongs to the counterparty' using errcode = 'foreign_key_violation';
    end if;
    if (old.placed_by is not null and (new.placed_by, new.placed_by_name)
                                      is distinct from (old.placed_by, old.placed_by_name))
       or (old.staff_call_control_id is not null
           and new.staff_call_control_id is distinct from old.staff_call_control_id)
       or (old.staff_answered_at is not null and new.staff_answered_at is distinct from old.staff_answered_at)
       or (old.connected_at is not null and new.connected_at is distinct from old.connected_at)
       or (old.ended_at is not null and new.ended_at is distinct from old.ended_at)
       or (old.outcome is not null and new.outcome is distinct from old.outcome)
       or (old.hangup_cause is not null and new.hangup_cause is distinct from old.hangup_cause)
       or (old.contact_log_entry_id is not null
           and new.contact_log_entry_id is distinct from old.contact_log_entry_id)
       or (old.follow_up_id is not null and new.follow_up_id is distinct from old.follow_up_id) then
      raise exception 'what an incoming call reported is kept' using errcode = 'check_violation';
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'calling_you' and new.status in ('confirming', 'voicemail', 'ended'))
         or (old.status = 'confirming' and new.status in ('calling_you', 'joining', 'voicemail', 'ended'))
         or (old.status = 'joining' and new.status in ('connected', 'ended'))
         or (old.status = 'connected' and new.status = 'ended')
         or (old.status = 'voicemail' and new.status = 'ended')) then
      raise exception 'an incoming call does not go from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;
    if old.status = 'ended' and (new.placed_by, new.staff_call_control_id, new.connected_at)
                                is distinct from (old.placed_by, old.staff_call_control_id, old.connected_at) then
      raise exception 'an ended call keeps who answered it' using errcode = 'check_violation';
    end if;
    if old.return_status in ('done', 'dismissed')
       and (new.return_status, new.return_owner, new.return_closed_at)
           is distinct from (old.return_status, old.return_owner, old.return_closed_at) then
      raise exception 'a closed return stays closed' using errcode = 'check_violation';
    end if;
    if old.return_status = 'open' and new.return_status is null then
      raise exception 'an open return is closed, not removed' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Calls placed from the platform, as in 20261102040000_call_event_legs.sql.
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
  if new.status in ('joining', 'voicemail') then
    raise exception 'a call placed from the platform does not go to %', new.status
      using errcode = 'check_violation';
  end if;
  if array_position(ranks, new.status) < array_position(ranks, old.status) then
    raise exception 'a call only moves forward' using errcode = 'check_violation';
  end if;

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

-- Helpers -------------------------------------------------------------------------------------

-- A saved phone number as Telnyx dials it (E.164), or null: the same rules as dialablePhone in
-- packages/domain/src/calls.ts (North American numbers of 10 digits, or 11 with a leading 1,
-- however punctuated; + and a country code otherwise; nothing with an extension).
create function app.dialable_phone(phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  p text := btrim(coalesce(phone, ''));
  d text;
begin
  if p = '' or p ~* 'x' then
    return null;
  end if;
  if p ~ '[^0-9+(). /-]' then
    return null;
  end if;
  if strpos(p, '+') > 1 or length(p) - length(replace(p, '+', '')) > 1 then
    return null;
  end if;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  if left(p, 1) <> '+' then
    if length(d) = 11 and left(d, 1) = '1' then
      d := substr(d, 2);
    end if;
    return case when d ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || d end;
  end if;
  if left(d, 1) = '1' then
    return case when length(d) = 11 and substr(d, 2) ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
                then '+' || d end;
  end if;
  return case when d ~ '^[2-9][0-9]{7,14}$' then '+' || d end;
end
$$;

-- An E.164 number as people read it: +14035550100 as (403) 555-0100.
create function app.display_phone(e164 text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when e164 ~ '^\+1[0-9]{10}$'
              then '(' || substr(e164, 3, 3) || ') ' || substr(e164, 6, 3) || '-' || substr(e164, 9, 4)
              else e164 end
$$;

-- How long a call lasted, as the app writes it: "45 s", "6 min 12 s", "1 h 2 min".
create function app.call_length_text(seconds numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when t >= 3600 then (t / 3600)::text || ' h ' || ((t % 3600) / 60)::text || ' min'
           when t >= 60 then (t / 60)::text || ' min ' || (t % 60)::text || ' s'
           else t::text || ' s'
         end
  from (select greatest(round(coalesce(seconds, 0)), 0)::integer as t) s
$$;

-- An active member's name, as app.member_name gives it, without a signed-in user: for the
-- functions below, which run for Telnyx's events. Not granted to app_api.
create function app.callback_member_name(org uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select btrim(left(coalesce(
           nullif(btrim(concat_ws(' ',
             nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
             nullif(btrim(u.raw_user_meta_data ->> 'last_name'), ''))), ''),
           nullif(btrim(u.email::text), ''),
           'GSS staff member'), 200))
  from app.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = org and m.user_id = member and m.status = 'active'
$$;

-- Whether a member may take and follow up calls: active, and a trader, operations or admin.
create function app.callback_member_can_take(org uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.organization_members m
     where m.organization_id = org and m.user_id = member and m.status = 'active'
       and m.role in ('trader', 'operations', 'org_admin')
  )
$$;

-- Whether a member has a call under way: one they placed or answered, ringing or waiting for 1
-- (15 minutes at most) or connected (4 hours 15 minutes at most), or a callback ringing their
-- cell. Placing a call and being rung for a callback both check it under the member's lock
-- ('app.calls:<user id>'; Codex's review, finding 3).
create function app.member_busy(org uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from app.calls c
            where c.organization_id = org and c.placed_by = member and c.status <> 'ended'
              and c.created_at > now() - case when c.status = 'connected'
                                              then interval '4 hours 15 minutes'
                                              else interval '15 minutes' end)
      or exists (
           select 1 from app.callback_attempts a
             join app.calls c on c.id = a.call_id
            where a.organization_id = org and a.member_id = member
              and a.status in ('ringing', 'confirming', 'accepted') and c.status <> 'ended'
              and a.started_at > now() - interval '15 minutes')
$$;

-- For placing a call: whether the signed-in person has one under way, either way.
create function app.my_call_in_progress(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_user_id() is not null and app.is_active_member(org)
     and app.member_busy(org, app.current_user_id())
$$;

-- The cell to ring for a callback, or null when the member cannot take one now.
create function app.callback_member_cell(org uuid, member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.phone::text from app.member_phones p
   where p.organization_id = org and p.user_id = member
     and app.callback_member_can_take(org, member)
     and not app.member_busy(org, member)
$$;

-- The commands of an incoming call not settled yet (pending or being sent), oldest first.
create function app.callback_open_commands(call uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind,
                                               'callControlId', m.call_control_id,
                                               'attemptId', m.attempt_id)
                            order by m.created_at, m.id), '[]'::jsonb)
    from app.call_commands m
    join app.calls c on c.id = m.call_id and c.direction = 'incoming'
   where m.call_id = call and m.status in ('pending', 'sending')
$$;

-- Keeps a command of an incoming call, pending; a hang-up of a leg already kept is not added
-- again. Returns the command's id, or null when nothing was added.
create function app.callback_command(call uuid, event text, what text, leg text, attempt uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  made uuid;
begin
  if leg is null then
    return null;
  end if;
  if what = 'hang_up' and exists (
       select 1 from app.call_commands h
        where h.call_id = call and h.kind = 'hang_up' and h.call_control_id = leg
          and h.status <> 'failed') then
    return null;
  end if;
  insert into app.call_commands (organization_id, call_id, telnyx_event_id, kind, call_control_id,
                                 attempt_id)
  select c.organization_id, c.id, event, what, leg, attempt from app.calls c where c.id = call
  returning id into made;
  return made;
end
$$;

-- The commands with these ids, in the order they were made, as the Worker sends them.
create function app.callback_commands_json(ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind,
                                               'callControlId', m.call_control_id,
                                               'attemptId', m.attempt_id)
                            order by pg_catalog.array_position(ids, m.id)), '[]'::jsonb)
    from app.call_commands m where m.id = any (ids)
$$;

-- Rings the next person for an incoming call (whom it was meant for, then the callbacks
-- person), skipping anyone already rung for it or who cannot take a call now; when nobody can,
-- the caller is answered for the voicemail. Each person is checked under their own lock, the
-- one placing a call takes (Codex's review, finding 3). The call must be locked by the caller.
create function app.callback_next(call uuid, event text)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  person uuid;
  cell text;
  attempt uuid;
  made uuid;
begin
  select * into c from app.calls where id = call;
  for person in
    select x.member from unnest(array[
      c.meant_for,
      (select s.callbacks_person from app.callback_settings s where s.organization_id = c.organization_id)
    ]) with ordinality as x(member, n)
    where x.member is not null
    order by x.n
  loop
    continue when exists (select 1 from app.callback_attempts a where a.call_id = c.id and a.member_id = person);
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('app.calls:' || person::text, 0));
    cell := app.callback_member_cell(c.organization_id, person);
    continue when cell is null;
    insert into app.callback_attempts (organization_id, call_id, position, member_id, member_name, cell)
    values (c.organization_id, c.id,
            (select coalesce(max(a.position), 0) + 1 from app.callback_attempts a where a.call_id = c.id),
            person, app.callback_member_name(c.organization_id, person), cell)
    returning id into attempt;
    update app.calls set status = 'calling_you' where id = c.id and status <> 'calling_you';
    made := app.callback_command(c.id, event, 'dial_member', c.counterparty_call_control_id, attempt);
    return array[made];
  end loop;
  update app.calls set status = 'voicemail' where id = c.id;
  made := app.callback_command(c.id, event, 'answer', c.counterparty_call_control_id, null);
  return array[made];
end
$$;

-- Logs an ended incoming call (Codex's review, findings 6 and 8):
-- - one someone took: in the contact history of its counterparty, in the name of who answered;
-- - one nobody took, or a voicemail: in the contact history, with a follow-up due now ("Return
--   call from …"), both in the name of the person it was meant for, or the callbacks person when
--   they cannot have it;
-- - without a counterparty (an unknown number) or nobody to give it to: an open return on the
--   Follow-ups page, for the callbacks person (unknown numbers), who answered (an unknown
--   number someone took), or nobody (every admin sees it).
-- Written as that member (app.user_id set for this transaction and given back after), so the
-- contact log's and follow-ups' own rules apply. Once per call.
create function app.callback_record(call uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  actor uuid;
  actor_name text;
  owner uuid;
  archived boolean;
  entry uuid;
  task uuid;
  notes text;
  before text := current_setting('app.user_id', true);
begin
  select * into c from app.calls where id = call and direction = 'incoming' and status = 'ended';
  if not found or c.contact_log_entry_id is not null or c.follow_up_id is not null
     or c.return_status is not null then
    return;
  end if;
  select cp.archived_at is not null into archived
    from app.counterparties cp where cp.organization_id = c.organization_id and cp.id = c.counterparty_id;

  if c.outcome = 'talked' then
    actor := case when app.callback_member_can_take(c.organization_id, c.placed_by) then c.placed_by end;
  else
    actor := case
      when c.meant_for is not null and app.callback_member_can_take(c.organization_id, c.meant_for)
        then c.meant_for
      else (select s.callbacks_person from app.callback_settings s
             where s.organization_id = c.organization_id
               and app.callback_member_can_take(s.organization_id, s.callbacks_person))
    end;
  end if;

  if c.counterparty_id is null or archived or actor is null then
    owner := case
      when c.outcome = 'talked' and app.callback_member_can_take(c.organization_id, c.placed_by)
        then c.placed_by
      when c.outcome <> 'talked' and c.counterparty_id is null then
        (select s.callbacks_person from app.callback_settings s
          where s.organization_id = c.organization_id
            and app.callback_member_can_take(s.organization_id, s.callbacks_person))
      else actor
    end;
    update app.calls
       set return_status = 'open', return_owner = owner,
           return_owner_name = app.callback_member_name(c.organization_id, owner)
     where id = c.id;
    return;
  end if;

  actor_name := app.callback_member_name(c.organization_id, actor);
  notes := case c.outcome
    when 'talked' then 'Called GSS''s number back; talked '
                       || app.call_length_text(extract(epoch from c.ended_at - c.connected_at)) || '.'
    when 'voicemail' then 'Called GSS''s number back and left a voicemail.'
    else 'Called GSS''s number back; nobody took the call.'
  end;
  perform set_config('app.user_id', actor::text, true);
  insert into app.contact_log_entries (organization_id, counterparty_id, created_by)
  values (c.organization_id, c.counterparty_id, actor)
  returning id into entry;
  insert into app.contact_log_revisions
    (organization_id, entry_id, revision_number, occurred_at, channel, contact_name, notes,
     recorded_by, recorded_by_name)
  values (c.organization_id, entry, 1, coalesce(c.connected_at, c.created_at), 'call',
          c.contact_name, notes, actor, actor_name);
  if c.outcome <> 'talked' then
    insert into app.follow_ups (organization_id, counterparty_id, contact_log_entry_id, task,
                                due_at, assigned_to, assigned_to_name, created_by, created_by_name)
    values (c.organization_id, c.counterparty_id, entry,
            left('Return call from ' || c.contact_name, 200), now(), actor, actor_name, actor,
            actor_name)
    returning id into task;
  end if;
  update app.calls set contact_log_entry_id = entry, follow_up_id = task where id = c.id;
  perform set_config('app.user_id', coalesce(before, ''), true);
end
$$;

-- Ends an incoming call (locked by the caller): its outcome and when, nothing more queued but
-- hang-ups, every leg still up hung up but the one that ended it, then logged.
create function app.callback_end(call uuid, event text, how text, at timestamptz, cause text,
                                 gone text)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  a app.callback_attempts;
  made uuid[] := '{}';
  deferred boolean;
begin
  select * into c from app.calls where id = call;
  if c.status = 'ended' then
    return made;
  end if;
  -- Ended while the join was on its way to Telnyx: whether they talked is known only once it
  -- comes back (or Telnyx's call.bridged arrives), so the call is logged then (Codex's review of
  -- f7a0d73, finding 2).
  deferred := how = 'missed' and c.status = 'joining' and exists (
    select 1 from app.call_commands m
     where m.call_id = c.id and m.kind = 'bridge' and m.status = 'sending');
  update app.calls
     set status = 'ended', outcome = how::app.call_outcome,
         ended_at = greatest(at, coalesce(connected_at, at)),
         hangup_cause = case when cause ~ '^[a-z0-9_]{1,40}$' then cause end
   where id = c.id;
  update app.call_commands set status = 'cancelled'
   where call_id = c.id and kind <> 'hang_up' and status = 'pending';
  for a in select * from app.callback_attempts
            where call_id = c.id and status in ('ringing', 'confirming', 'accepted')
  loop
    if a.status in ('ringing', 'confirming') then
      update app.callback_attempts set status = 'cancelled', ended_at = at where id = a.id;
    end if;
    if a.leg is distinct from gone then
      made := made || app.callback_command(c.id, event, 'hang_up', a.leg, a.id);
    end if;
  end loop;
  if c.counterparty_call_control_id is distinct from gone then
    made := made || app.callback_command(c.id, event, 'hang_up', c.counterparty_call_control_id, null);
  end if;
  if not deferred then
    perform app.callback_record(c.id);
  end if;
  return array_remove(made, null);
end
$$;

-- A callback that ended while its join was on its way to Telnyx, once the join is known to have
-- worked (the join came back done, or Telnyx's call.bridged happened before the end): it was
-- talked, connected from the time given (never after it ended), and is logged as such (Codex's
-- review of f7a0d73, finding 2). Only a call ended missed that someone took and nothing logged
-- yet; anything else is left as it is.
create function app.callback_joined_late(call uuid, at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
begin
  select * into c from app.calls where id = call and direction = 'incoming';
  if not found or c.status <> 'ended' or c.outcome is distinct from 'missed'
     or c.connected_at is not null or c.placed_by is null or c.contact_log_entry_id is not null
     or c.follow_up_id is not null or c.return_status is not null then
    return;
  end if;
  update app.calls
     set outcome = 'talked', connected_at = least(greatest(coalesce(at, c.ended_at), c.created_at), c.ended_at)
   where id = c.id;
  perform app.callback_record(c.id);
end
$$;

-- A call to GSS's number -----------------------------------------------------------------------

-- The first event of an incoming Telnyx leg the platform has not seen: call.initiated rings the
-- first person who can take it (or answers for the voicemail); a call.hangup arriving first
-- keeps the call as missed. The organization is the one whose callbacks arrive on the number
-- dialed (Codex's review, finding 1); the caller's number only finds the counterparty and whom
-- it was meant for in that organization, and nothing about them is given back. Once per leg and
-- per event: a repeated delivery gets back the commands not settled yet (finding 2).
-- Answers {status: 'created' | 'duplicate' | 'not_ours' | 'ignored', callId, commands}.
create function app.receive_callback(event_id text, event_type text, occurred timestamptz,
                                     leg text, from_number text, to_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  caller text := app.dialable_phone(from_number);
  existing uuid;
  last_call app.calls;
  company uuid;
  contact uuid;
  name text;
  call uuid;
  made uuid[] := '{}';
begin
  if event_id is null or length(event_id) not between 1 and 200
     or leg is null or length(leg) not between 1 and 200 then
    return jsonb_build_object('status', 'ignored');
  end if;
  select s.organization_id into org from app.callback_settings s
   where s.phone = app.dialable_phone(to_number);
  if org is null or caller is null then
    return jsonb_build_object('status', 'not_ours');
  end if;
  if event_type not in ('call.initiated', 'call.hangup') then
    return jsonb_build_object('status', 'ignored');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app.callbacks:' || leg, 0));
  select c.id into existing from app.calls c
   where c.direction = 'incoming' and c.counterparty_call_control_id = leg;
  if existing is null then
    select e.call_id into existing from app.call_events e where e.telnyx_event_id = event_id;
  end if;
  if existing is not null then
    -- A new event of a leg already kept (a hang-up that crossed the first delivery, looked up
    -- before that delivery committed; Codex's review of f7a0d73, finding 1) is applied to its
    -- call; the same event again changes nothing.
    if not exists (select 1 from app.call_events e where e.telnyx_event_id = event_id) then
      perform app.apply_callback_event(existing, event_id, event_type, 'them', null, occurred, leg,
                                       null, null, null);
    end if;
    return jsonb_build_object('status', 'duplicate', 'callId', existing,
                              'commands', app.callback_open_commands(existing));
  end if;

  -- Whom it was meant for, and the company: the last call placed to this number.
  select * into last_call from app.calls c
   where c.organization_id = org and c.direction = 'outgoing' and c.counterparty_phone = caller
   order by c.created_at desc limit 1;
  if last_call.id is not null and exists (
       select 1 from app.counterparties cp
        where cp.organization_id = org and cp.id = last_call.counterparty_id
          and cp.archived_at is null) then
    company := last_call.counterparty_id;
    contact := (select k.id from app.counterparty_contacts k
                 where k.organization_id = org and k.id = last_call.contact_id
                   and k.counterparty_id = company);
    name := last_call.contact_name;
  elsif last_call.id is null then
    -- Nobody called it: the one company (not archived) whose own or contacts' phone it is.
    select min(x.counterparty_id::text)::uuid into company
      from (
        select cp.id as counterparty_id from app.counterparties cp
         where cp.organization_id = org and cp.archived_at is null
           and app.dialable_phone(cp.phone) = caller
        union
        select k.counterparty_id from app.counterparty_contacts k
          join app.counterparties cp on cp.organization_id = k.organization_id and cp.id = k.counterparty_id
         where k.organization_id = org and cp.archived_at is null
           and app.dialable_phone(k.phone) = caller
      ) x
     having count(*) = 1;
    if company is not null then
      select min(k.id::text)::uuid into contact from app.counterparty_contacts k
       where k.organization_id = org and k.counterparty_id = company
         and app.dialable_phone(k.phone) = caller
      having count(*) = 1;
      name := coalesce((select k.name from app.counterparty_contacts k where k.id = contact),
                       (select cp.legal_name from app.counterparties cp where cp.id = company));
    end if;
  end if;

  insert into app.calls (organization_id, direction, counterparty_id, contact_id, contact_name,
                         from_phone, counterparty_phone, counterparty_call_control_id,
                         meant_for, meant_for_name)
  values (org, 'incoming', company, contact, coalesce(name, app.display_phone(caller)),
          app.dialable_phone(to_number), caller, leg,
          last_call.placed_by,
          case when last_call.placed_by is not null
               then coalesce(app.callback_member_name(org, last_call.placed_by), last_call.placed_by_name) end)
  returning id into call;
  insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg,
                               occurred_at, call_control_id)
  values (org, call, event_id, event_type, 'them', occurred, leg);
  perform 1 from app.calls where id = call for update;
  if event_type = 'call.hangup' then
    made := app.callback_end(call, event_id, 'missed', occurred, null, leg);
  else
    made := app.callback_next(call, event_id);
  end if;
  return jsonb_build_object('status', 'created', 'callId', call,
                            'commands', app.callback_commands_json(array_remove(made, null)));
end
$$;

-- Which incoming call a Telnyx leg belongs to, for events that carry no client_state yet (the
-- caller's leg before it is answered; Codex's review, finding 5): the caller's leg ('them') or a
-- leg to a team member's cell ('you', with its attempt). Nothing but ids.
create function app.callback_by_leg(leg_id text)
returns table (call_id uuid, side text, attempt_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, 'them', null::uuid from app.calls c
   where c.direction = 'incoming' and c.counterparty_call_control_id = leg_id
  union all
  select a.call_id, 'you', a.id from app.callback_attempts a where a.leg = leg_id
  limit 1
$$;

-- Applies one of Telnyx's events to an incoming call, once (by the event's id), under the call's
-- lock: what follows on the leg to a team member's cell ('you', of an attempt) or on the
-- caller's leg ('them'). An event of an attempt no longer wanted (an earlier person's, or after
-- the call moved on) changes nothing but hanging up its leg (Codex's review, finding 4).
-- Answers {status: 'applied' | 'duplicate' | 'not_found', commands}.
create function app.apply_callback_event(call uuid, event_id text, event_type text, side text,
                                         attempt uuid, occurred timestamptz, leg_id text,
                                         digits text, gather_status text, cause text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  a app.callback_attempts;
  cur app.callback_attempts;
  kept uuid;
  made uuid[] := '{}';
  not_answered constant text[] := array['timeout', 'no_answer', 'call_rejected', 'user_busy'];
begin
  if side not in ('you', 'them') or event_type !~ '^[a-z0-9_.]{1,100}$'
     or event_id is null or length(event_id) not between 1 and 200
     or (leg_id is not null and length(leg_id) not between 1 and 200) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into c from app.calls where id = call and direction = 'incoming' for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg,
                               occurred_at, call_control_id)
  values (c.organization_id, c.id, event_id, event_type, side, occurred, leg_id)
  on conflict (telnyx_event_id) do nothing
  returning id into kept;
  if kept is null then
    return jsonb_build_object('status', 'duplicate', 'commands', app.callback_open_commands(c.id));
  end if;
  select * into cur from app.callback_attempts where call_id = c.id order by position desc limit 1;

  -- Telnyx joined the caller to who answered: connected (and recorded) now, or, for a call that
  -- ended while the join was on its way, talked after all (Codex's review of f7a0d73, finding 2).
  if event_type = 'call.bridged' then
    if c.status = 'joining' then
      update app.calls set status = 'connected', connected_at = occurred where id = c.id;
      made := made || app.callback_command(c.id, event_id, 'record', c.staff_call_control_id, cur.id);
    elsif c.status = 'ended' and occurred <= c.ended_at then
      perform app.callback_joined_late(c.id, occurred);
    end if;
    return jsonb_build_object('status', 'applied',
                              'commands', app.callback_commands_json(array_remove(made, null)));
  end if;

  if side = 'you' then
    if attempt is not null then
      select * into a from app.callback_attempts where id = attempt and call_id = c.id;
    end if;
    if a.id is null then
      if leg_id is not null and event_type in ('call.initiated', 'call.answered') then
        made := made || app.callback_command(c.id, event_id, 'hang_up', leg_id, null);
      end if;
      return jsonb_build_object('status', 'applied',
                                'commands', app.callback_commands_json(array_remove(made, null)));
    end if;
    if a.leg is null and leg_id is not null and c.status <> 'ended' and a.id = cur.id
       and a.status in ('ringing', 'confirming') then
      update app.callback_attempts set leg = leg_id where id = a.id;
      a.leg := leg_id;
    end if;
    if c.status = 'ended' or a.id <> cur.id or a.status not in ('ringing', 'confirming', 'accepted')
       or (leg_id is not null and a.leg is distinct from leg_id) then
      -- A leg not (or no longer) wanted is hung up.
      if leg_id is not null and event_type in ('call.initiated', 'call.answered')
         and (a.leg is distinct from leg_id or a.status not in ('accepted')) then
        made := made || app.callback_command(c.id, event_id, 'hang_up', leg_id, a.id);
      end if;
      return jsonb_build_object('status', 'applied',
                                'commands', app.callback_commands_json(array_remove(made, null)));
    end if;

    if event_type = 'call.answered' then
      if a.status = 'ringing' and c.status = 'calling_you' then
        update app.callback_attempts set status = 'confirming', answered_at = occurred where id = a.id;
        update app.calls set status = 'confirming' where id = c.id;
        made := made || app.callback_command(c.id, event_id, 'confirm', a.leg, a.id);
      end if;
    elsif event_type = 'call.gather.ended' then
      if a.status = 'confirming' and c.status = 'confirming' then
        if gather_status = 'valid' and digits = '1'
           and app.callback_member_can_take(c.organization_id, a.member_id) then
          update app.callback_attempts set status = 'accepted' where id = a.id;
          update app.calls
             set status = 'joining', placed_by = a.member_id, placed_by_name = a.member_name,
                 staff_call_control_id = a.leg, staff_answered_at = a.answered_at
           where id = c.id;
          made := made || app.callback_command(c.id, event_id, 'answer', c.counterparty_call_control_id, a.id);
        else
          update app.callback_attempts set status = 'declined', ended_at = occurred where id = a.id;
          made := made || app.callback_command(c.id, event_id, 'hang_up', a.leg, a.id);
          made := made || app.callback_next(c.id, event_id);
        end if;
      end if;
    elsif event_type = 'call.hangup' then
      if a.status = 'ringing' then
        update app.callback_attempts
           set status = case when cause is null or cause = any (not_answered) or cause = 'normal_clearing'
                             then 'no_answer' else 'failed' end,
               ended_at = occurred
         where id = a.id;
        made := made || app.callback_next(c.id, event_id);
      elsif a.status = 'confirming' then
        update app.callback_attempts set status = 'declined', ended_at = occurred where id = a.id;
        made := made || app.callback_next(c.id, event_id);
      elsif a.status = 'accepted' then
        made := made || app.callback_end(c.id, event_id,
                                         case when c.status = 'connected' then 'talked' else 'missed' end,
                                         occurred, cause, a.leg);
      end if;
    end if;
    return jsonb_build_object('status', 'applied',
                              'commands', app.callback_commands_json(array_remove(made, null)));
  end if;

  -- The caller's leg.
  if c.status = 'ended' then
    return jsonb_build_object('status', 'applied', 'commands', '[]'::jsonb);
  end if;
  if event_type = 'call.answered' then
    if c.status = 'joining' then
      -- Joined on the leg of who answered; connected, and recorded, once the join is done.
      made := made || app.callback_command(c.id, event_id, 'bridge', c.staff_call_control_id, cur.id);
    elsif c.status = 'voicemail' then
      made := made || app.callback_command(c.id, event_id, 'greet', c.counterparty_call_control_id, null);
    end if;
  elsif event_type = 'call.speak.ended' then
    if c.status = 'voicemail' and not exists (
         select 1 from app.call_commands m where m.call_id = c.id and m.kind = 'record_voicemail') then
      made := made || app.callback_command(c.id, event_id, 'record_voicemail',
                                           c.counterparty_call_control_id, null);
    end if;
  elsif event_type = 'call.hangup' then
    made := made || app.callback_end(
      c.id, event_id,
      case
        when c.status = 'connected' then 'talked'
        when c.status = 'voicemail' and exists (
               select 1 from app.call_commands m
                where m.call_id = c.id and m.kind = 'record_voicemail'
                  and m.status in ('sending', 'done')) then 'voicemail'
        else 'missed'
      end,
      occurred, cause, c.counterparty_call_control_id);
  end if;
  return jsonb_build_object('status', 'applied',
                            'commands', app.callback_commands_json(array_remove(made, null)));
end
$$;

-- Claims a pending command of an incoming call (or one whose claim has lapsed, 30 seconds) for
-- sending, under the call's lock, if the call still wants it; one it no longer wants is
-- cancelled. Answers {status: 'claimed', command} | {status: 'busy'} | {status: 'skipped'};
-- a claimed command carries the claim's number, the cell to dial, the leg to join and the
-- company's name for the prompt.
create function app.claim_callback_command(call uuid, command uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  m app.call_commands;
  cur app.callback_attempts;
  wanted boolean;
  claim integer;
begin
  select * into c from app.calls where id = call and direction = 'incoming' for update;
  if not found then
    return jsonb_build_object('status', 'skipped');
  end if;
  select * into m from app.call_commands where id = command and call_id = c.id;
  if not found then
    return jsonb_build_object('status', 'skipped');
  end if;
  if m.status = 'sending' and m.claimed_at >= pg_catalog.clock_timestamp() - interval '30 seconds' then
    return jsonb_build_object('status', 'busy');
  end if;
  if m.status not in ('pending', 'sending') then
    return jsonb_build_object('status', 'skipped');
  end if;
  select * into cur from app.callback_attempts where call_id = c.id order by position desc limit 1;
  wanted := case m.kind
    when 'hang_up' then true
    when 'dial_member' then c.status = 'calling_you' and m.attempt_id = cur.id
                            and cur.status = 'ringing' and cur.leg is null
    when 'confirm' then c.status = 'confirming' and m.attempt_id = cur.id and cur.status = 'confirming'
    when 'answer' then (c.status = 'joining' and m.attempt_id = cur.id and cur.status = 'accepted')
                       or (c.status = 'voicemail' and m.attempt_id is null)
    when 'bridge' then c.status = 'joining'
    when 'record' then c.status = 'connected'
    when 'greet' then c.status = 'voicemail'
    when 'record_voicemail' then c.status = 'voicemail'
    else false
  end;
  if not coalesce(wanted, false) then
    update app.call_commands set status = 'cancelled' where id = m.id;
    -- A join whose call ended meanwhile never went through: the call is logged as it ended.
    if m.kind = 'bridge' then
      perform app.callback_record(c.id);
    end if;
    return jsonb_build_object('status', 'skipped');
  end if;
  claim := m.attempts + 1;
  update app.call_commands
     set status = 'sending', attempts = claim, claimed_at = pg_catalog.clock_timestamp()
   where id = m.id;
  return jsonb_build_object('status', 'claimed', 'command', jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'callControlId', m.call_control_id, 'attemptId', m.attempt_id,
    'claim', claim,
    'cell', case when m.kind = 'dial_member' then cur.cell::text end,
    'bridgeWith', case when m.kind = 'bridge' then c.counterparty_call_control_id end,
    'companyName', (select cp.legal_name from app.counterparties cp
                     where cp.organization_id = c.organization_id and cp.id = c.counterparty_id)));
end
$$;

-- Records how sending a command of an incoming call went, for the given claim only (a
-- completion of an older claim never changes it). A leg a dial returned is kept on its attempt
-- while that attempt is still wanted, and hung up otherwise. A refused command moves the call
-- on: a cell that could not be rung or asked for 1 to the next person, an answer or join that
-- failed ends the call. Answers {commands: [hang-ups and next steps to send], unresolved}.
create function app.finish_callback_command(call uuid, command uuid, claim integer, outcome text,
                                            leg_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  m app.call_commands;
  a app.callback_attempts;
  cur app.callback_attempts;
  ours boolean;
  made uuid[] := '{}';
begin
  if outcome not in ('done', 'failed', 'retry') or (leg_id is not null and length(leg_id) not between 1 and 200) then
    raise exception 'an outcome is done, failed or retry' using errcode = 'invalid_parameter_value';
  end if;
  select * into c from app.calls where id = call and direction = 'incoming' for update;
  if not found then
    return jsonb_build_object('commands', '[]'::jsonb);
  end if;
  select * into m from app.call_commands where id = command and call_id = c.id;
  if not found then
    return jsonb_build_object('commands', '[]'::jsonb);
  end if;
  select * into cur from app.callback_attempts where call_id = c.id order by position desc limit 1;
  if m.attempt_id is not null then
    select * into a from app.callback_attempts where id = m.attempt_id;
  end if;
  ours := m.status = 'sending' and m.attempts = claim;

  if not ours then
    if outcome <> 'done' then
      return jsonb_build_object('commands', '[]'::jsonb,
                                'unresolved', m.status in ('pending', 'sending'));
    end if;
    if m.status in ('pending', 'sending') then
      update app.call_commands set status = 'done' where id = m.id;
    end if;
  elsif outcome = 'retry' then
    update app.call_commands set status = 'pending' where id = m.id;
    return jsonb_build_object('commands', '[]'::jsonb);
  elsif outcome = 'failed' then
    update app.call_commands set status = 'failed' where id = m.id;
    if m.kind in ('dial_member', 'confirm') then
      if c.status in ('calling_you', 'confirming') and a.id = cur.id
         and a.status in ('ringing', 'confirming') then
        update app.callback_attempts set status = 'failed', ended_at = now() where id = a.id;
        made := made || app.callback_command(c.id, m.telnyx_event_id, 'hang_up', a.leg, a.id);
        made := made || app.callback_next(c.id, m.telnyx_event_id);
      end if;
    elsif m.kind in ('answer', 'bridge', 'greet', 'record_voicemail') then
      made := made || app.callback_end(c.id, m.telnyx_event_id,
                                       case when m.kind = 'bridge' then 'failed' else 'missed' end,
                                       now(), null, null);
      -- A join that failed after the call ended: logged as it ended.
      if m.kind = 'bridge' and c.status = 'ended' then
        perform app.callback_record(c.id);
      end if;
    end if;
    return jsonb_build_object('commands', app.callback_commands_json(array_remove(made, null)));
  else
    update app.call_commands set status = 'done' where id = m.id;
  end if;

  -- The caller joined to who answered: connected now, and recorded on their leg, both sides, as
  -- calls placed from the platform are (the first channel theirs, the second the caller's).
  if m.kind = 'bridge' and c.status = 'joining' then
    update app.calls set status = 'connected', connected_at = now() where id = c.id;
    made := made || app.callback_command(c.id, m.telnyx_event_id, 'record', c.staff_call_control_id,
                                         m.attempt_id);
  elsif m.kind = 'bridge' and c.status = 'ended' then
    -- The join worked, but its answer came back after a hang-up ended the call: talked, from
    -- when the caller was answered (Codex's review of f7a0d73, finding 2).
    perform app.callback_joined_late(c.id, (
      select max(e.occurred_at) from app.call_events e
       where e.call_id = c.id and e.leg = 'them' and e.event_type = 'call.answered'));
  end if;

  -- A leg a dial returned: kept on its attempt while wanted, hung up otherwise.
  if m.kind = 'dial_member' and leg_id is not null then
    select * into c from app.calls where id = c.id;
    select * into a from app.callback_attempts where id = m.attempt_id;
    if c.status <> 'ended' and a.id = cur.id and a.status in ('ringing', 'confirming')
       and (a.leg is null or a.leg = leg_id) then
      update app.callback_attempts set leg = leg_id where id = a.id and leg is null;
    elsif a.leg is distinct from leg_id or c.status = 'ended'
          or a.status not in ('ringing', 'confirming', 'accepted') then
      made := made || app.callback_command(c.id, m.telnyx_event_id, 'hang_up', leg_id, a.id);
    end if;
  end if;
  return jsonb_build_object('commands', app.callback_commands_json(array_remove(made, null)));
end
$$;

-- Keeps a recording of an incoming call (call.recording.saved): a voicemail when it was made on
-- the caller's own leg, otherwise the call by side. Answers whether it was a voicemail.
create function app.keep_callback_recording(call uuid, recording text, started timestamptz,
                                            ended timestamptz, leg_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  is_voicemail boolean;
begin
  select * into c from app.calls where id = call and direction = 'incoming';
  if not found then
    return false;
  end if;
  is_voicemail := leg_id is not null and leg_id = c.counterparty_call_control_id;
  insert into app.call_recordings (organization_id, call_id, telnyx_recording_id,
                                   recording_started_at, recording_ended_at, voicemail_recording)
  values (c.organization_id, c.id, recording, started, ended, is_voicemail)
  on conflict (telnyx_recording_id) do update
    set recording_started_at = coalesce(app.call_recordings.recording_started_at, excluded.recording_started_at),
        recording_ended_at = coalesce(app.call_recordings.recording_ended_at, excluded.recording_ended_at)
    where app.call_recordings.call_id = excluded.call_id;
  return is_voicemail;
end
$$;

-- Recordings to transcribe now, as before (20261102080000_transcript_lines.sql), with whether
-- each is a voicemail: one channel, all the caller's (Codex's review, finding 7).
drop function app.claim_recordings_to_transcribe(integer);
create function app.claim_recordings_to_transcribe(most integer)
returns table (telnyx_recording_id text, voicemail boolean)
language sql
security definer
set search_path = ''
as $$
  update app.call_recordings r
     set transcribe_attempts = r.transcribe_attempts + 1,
         transcribe_claimed_at = pg_catalog.clock_timestamp()
   where r.id in (
     select q.id from app.call_recordings q
      where q.transcript is null and q.audio_deleted_at is null and q.transcribe_attempts < 5
        and (q.transcribe_claimed_at is null
             or q.transcribe_claimed_at < pg_catalog.clock_timestamp() - interval '10 minutes')
      order by q.created_at
      limit greatest(least(most, 50), 0)
      for update skip locked
   )
  returning r.telnyx_recording_id, r.voicemail_recording
$$;

-- Settings, and returns on the Follow-ups page (requests from the web app) ----------------------

-- An admin chooses the callbacks person (or nobody) for their organization; the number is the
-- Worker's own. Answers 'saved', 'forbidden' (not an admin), 'not_a_member' (the person cannot
-- take calls: not an active trader, operations or admin) or 'phone_taken' (another
-- organization's callbacks arrive on it).
create function app.save_callback_settings(org uuid, phone text, person uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  number text := app.dialable_phone(phone);
begin
  if uid is null or not app.has_role(org, array['org_admin']::app.member_role[]) then
    return 'forbidden';
  end if;
  if number is null then
    raise exception 'GSS''s number is not one Telnyx dials' using errcode = 'invalid_parameter_value';
  end if;
  if person is not null and not app.callback_member_can_take(org, person) then
    return 'not_a_member';
  end if;
  if exists (select 1 from app.callback_settings s where s.phone = number and s.organization_id <> org) then
    return 'phone_taken';
  end if;
  insert into app.callback_settings (organization_id, phone, callbacks_person, callbacks_person_name,
                                     updated_by, updated_by_name)
  values (org, number, person, app.callback_member_name(org, person), uid,
          app.callback_member_name(org, uid))
  on conflict (organization_id) do update
    set phone = excluded.phone, callbacks_person = excluded.callbacks_person,
        callbacks_person_name = excluded.callbacks_person_name,
        updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name;
  return 'saved';
end
$$;

-- What a person does with an open return (traders, operations and admins, of the call's
-- organization, as themselves):
-- - take: an unknown number's return becomes theirs; a company's call nobody could be given
--   gets its contact log entry and follow-up, in their name, and the return is done;
-- - link: an unknown number's call goes to a company (and optionally one of its contacts): its
--   contact log entry in their name (a call someone took says who), a follow-up for a call
--   nobody took (to the return's owner, or them), and the return is done;
-- - dismiss: closed without a follow-up (a wrong number, say).
-- Answers 'done', 'not_found', 'forbidden', 'closed' (not open any more), 'not_unknown' (link
-- or take of a company's call where it does not apply) or 'company_not_found'.
create function app.settle_callback_return(call uuid, action text, company uuid, contact uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  c app.calls;
  me text;
  name text;
  entry uuid;
  task uuid;
  assignee uuid;
  notes text;
begin
  if uid is null or action not in ('take', 'link', 'dismiss') then
    return 'not_found';
  end if;
  select * into c from app.calls where id = call and direction = 'incoming' for update;
  if not found or not app.is_active_member(c.organization_id) then
    return 'not_found';
  end if;
  if not app.can_log_contacts(c.organization_id) then
    return 'forbidden';
  end if;
  if c.return_status is distinct from 'open' then
    return 'closed';
  end if;
  me := app.member_name(c.organization_id, uid);

  if action = 'dismiss' then
    update app.calls
       set return_status = 'dismissed', return_closed_by = uid, return_closed_by_name = me,
           return_closed_at = now()
     where id = c.id;
    return 'done';
  end if;

  if action = 'take' and c.counterparty_id is null then
    update app.calls set return_owner = uid, return_owner_name = me where id = c.id;
    return 'done';
  end if;

  if action = 'link' then
    if c.counterparty_id is not null then
      return 'not_unknown';
    end if;
    if company is null or not exists (
         select 1 from app.counterparties cp
          where cp.organization_id = c.organization_id and cp.id = company and cp.archived_at is null) then
      return 'company_not_found';
    end if;
    if contact is not null and not exists (
         select 1 from app.counterparty_contacts k
          where k.organization_id = c.organization_id and k.counterparty_id = company and k.id = contact) then
      return 'company_not_found';
    end if;
    name := coalesce((select k.name from app.counterparty_contacts k where k.id = contact),
                     (select cp.legal_name from app.counterparties cp where cp.id = company));
    update app.calls set counterparty_id = company, contact_id = contact, contact_name = name
     where id = c.id;
    c.counterparty_id := company;
    c.contact_name := name;
    assignee := case when c.return_owner is not null
                          and app.callback_member_can_take(c.organization_id, c.return_owner)
                     then c.return_owner else uid end;
  else
    -- take, of a company's call: it becomes theirs.
    if exists (select 1 from app.counterparties cp
                where cp.id = c.counterparty_id and cp.archived_at is not null) then
      return 'company_not_found';
    end if;
    assignee := uid;
  end if;

  notes := case c.outcome
    when 'talked' then 'Called GSS''s number back; talked '
                       || app.call_length_text(extract(epoch from c.ended_at - c.connected_at))
                       || coalesce(' with ' || c.placed_by_name, '') || '.'
    when 'voicemail' then 'Called GSS''s number back and left a voicemail.'
    else 'Called GSS''s number back; nobody took the call.'
  end;
  insert into app.contact_log_entries (organization_id, counterparty_id, created_by)
  values (c.organization_id, c.counterparty_id, uid)
  returning id into entry;
  insert into app.contact_log_revisions
    (organization_id, entry_id, revision_number, occurred_at, channel, contact_name, notes,
     recorded_by, recorded_by_name)
  values (c.organization_id, entry, 1, coalesce(c.connected_at, c.created_at), 'call',
          c.contact_name, notes, uid, me);
  if c.outcome is distinct from 'talked' then
    insert into app.follow_ups (organization_id, counterparty_id, contact_log_entry_id, task,
                                due_at, assigned_to, assigned_to_name, created_by, created_by_name)
    values (c.organization_id, c.counterparty_id, entry,
            left('Return call from ' || c.contact_name, 200), now(), assignee,
            'set by the database', uid, me)
    returning id into task;
  end if;
  update app.calls
     set contact_log_entry_id = entry, follow_up_id = task, return_status = 'done',
         return_closed_by = uid, return_closed_by_name = me, return_closed_at = now()
   where id = c.id;
  return 'done';
end
$$;

-- Claude's readings of incoming calls ------------------------------------------------------------
-- A call to GSS's number is read like one placed from the platform once it has a company and a
-- person on GSS's side (who answered, or whom a voicemail's follow-up went to); an unknown
-- number's call waits until it is linked to a company. The context says which way the call went.

create function app.call_gss_person(c app.calls)
returns table (person uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(c.placed_by, f.assigned_to, c.meant_for),
         coalesce(c.placed_by_name, f.assigned_to_name, c.meant_for_name)
    from (select 1) one
    left join app.follow_ups f on f.id = c.follow_up_id and f.organization_id = c.organization_id
$$;

create or replace function app.claim_call_readings(most integer)
returns table (recording_id uuid, claim_token uuid)
language sql
security definer
set search_path = ''
as $$
  update app.call_recordings r
     set reading_attempts = r.reading_attempts + 1,
         reading_claimed_at = pg_catalog.clock_timestamp(),
         reading_claim_token = gen_random_uuid()
   where r.id in (
     select q.id from app.call_recordings q
       join app.calls c on c.id = q.call_id and c.organization_id = q.organization_id
      where q.read_at is null and q.transcript is not null and pg_catalog.btrim(q.transcript) <> ''
        and q.reading_attempts < 5
        and (q.reading_claimed_at is null
             or q.reading_claimed_at < pg_catalog.clock_timestamp() - interval '10 minutes')
        and c.counterparty_id is not null
        and (c.direction = 'outgoing'
             or (select g.person from app.call_gss_person(c) g) is not null)
      order by q.created_at desc
      limit greatest(least(most, 10), 0)
      for update of q skip locked
   )
  returning r.id, r.reading_claim_token
$$;

create or replace function app.call_reading_context(recording uuid, claim uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recordingId', r.id,
    'callId', c.id,
    'counterpartyId', c.counterparty_id,
    'counterpartyName', cp.legal_name,
    'counterpartyTypes', to_jsonb(cp.types::text[]),
    'contactName', c.contact_name,
    'callerId', g.person,
    'callerName', g.name,
    'calledAt', coalesce(c.connected_at, c.created_at),
    'direction', c.direction,
    'voicemail', r.voicemail_recording,
    'lines', r.transcript_lines,
    'transcript', r.transcript,
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'role', k.role,
                                          'email', k.email, 'phone', k.phone)
                       order by k.name, k.id)
        from app.counterparty_contacts k
       where k.organization_id = c.organization_id and k.counterparty_id = c.counterparty_id
    ), '[]'::jsonb)
  )
  from app.call_recordings r
  join app.calls c on c.id = r.call_id and c.organization_id = r.organization_id
  join app.counterparties cp on cp.organization_id = c.organization_id and cp.id = c.counterparty_id
  cross join lateral app.call_gss_person(c) g
  where r.id = recording and r.read_at is null and r.reading_claim_token = claim
    and r.transcript is not null and g.person is not null
$$;

-- Privileges ------------------------------------------------------------------------------------
-- Nothing for public or the Supabase API roles. app_api reads the settings and its own attempts;
-- it never writes an incoming call, an attempt or the settings directly, only through the
-- functions granted below.

revoke all on app.callback_settings, app.callback_attempts
  from public, anon, authenticated, service_role;
grant select on app.callback_settings, app.callback_attempts to app_api;

revoke all on function
  app.check_call_command(), app.check_call(),
  app.call_placer(uuid),
  app.dialable_phone(text), app.display_phone(text), app.call_length_text(numeric),
  app.callback_member_name(uuid, uuid), app.callback_member_can_take(uuid, uuid),
  app.member_busy(uuid, uuid), app.my_call_in_progress(uuid), app.callback_member_cell(uuid, uuid),
  app.callback_open_commands(uuid), app.callback_command(uuid, text, text, text, uuid),
  app.callback_commands_json(uuid[]), app.callback_next(uuid, text), app.callback_record(uuid),
  app.callback_end(uuid, text, text, timestamptz, text, text),
  app.callback_joined_late(uuid, timestamptz),
  app.receive_callback(text, text, timestamptz, text, text, text),
  app.callback_by_leg(text),
  app.apply_callback_event(uuid, text, text, text, uuid, timestamptz, text, text, text, text),
  app.claim_callback_command(uuid, uuid),
  app.finish_callback_command(uuid, uuid, integer, text, text),
  app.keep_callback_recording(uuid, text, timestamptz, timestamptz, text),
  app.claim_recordings_to_transcribe(integer),
  app.save_callback_settings(uuid, text, uuid),
  app.settle_callback_return(uuid, text, uuid, uuid),
  app.call_gss_person(app.calls),
  app.claim_call_readings(integer), app.call_reading_context(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app.check_call_command(), app.check_call() from app_api;

-- The Worker's entry points for Telnyx's events and its scheduled job, and the web app's.
grant execute on function
  app.call_placer(uuid),
  app.my_call_in_progress(uuid),
  app.callback_open_commands(uuid),
  app.receive_callback(text, text, timestamptz, text, text, text),
  app.callback_by_leg(text),
  app.apply_callback_event(uuid, text, text, text, uuid, timestamptz, text, text, text, text),
  app.claim_callback_command(uuid, uuid),
  app.finish_callback_command(uuid, uuid, integer, text, text),
  app.keep_callback_recording(uuid, text, timestamptz, timestamptz, text),
  app.claim_recordings_to_transcribe(integer),
  app.save_callback_settings(uuid, text, uuid),
  app.settle_callback_return(uuid, text, uuid, uuid),
  app.claim_call_readings(integer), app.call_reading_context(uuid, uuid)
  to app_api;
