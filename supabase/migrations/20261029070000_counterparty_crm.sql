-- A CRM for counterparties: a contact log and follow-ups, the owner's request and decisions
-- of 2026-10-29 (docs/DECISIONS.md); MASTER_PROJECT_SPECIFICATION.md sections 2.1, 6 and 10.1.
--
-- Contact log: each contact GSS has with a counterparty (when, how: call, email, meeting or
-- visit, who was spoken to, notes). Its content lives in revisions, as for bids and offers:
-- a correction appends a new revision and the earlier ones stay as they were. Entries are
-- never deleted.
--
-- Follow-ups: what to do next for a counterparty, by a due date and time, with the team
-- member responsible, optionally coming from a contact log entry. While open, a follow-up's
-- task, due time and responsible person can be changed (each change audited); once done it
-- stays done. Nothing is deleted.
--
-- Access for app_api: every active member reads both. Traders, operations and org admins log
-- contacts, correct entries and plan, change and finish follow-ups; the person responsible
-- for a follow-up may also mark it done, whatever their role. The responsible person is any
-- active member of the organization, and their name is filled in by the database from their
-- login. Nothing new is logged or planned for an archived counterparty, and its entries are
-- not corrected; its open follow-ups can still be marked done. Every change is audited.

create type app.contact_channel as enum ('call', 'email', 'meeting', 'visit');

-- Roles allowed to log contacts and plan follow-ups.
create function app.can_log_contacts(org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_role(org, array['trader', 'operations', 'org_admin']::app.member_role[])
$$;

-- The name the app shows for an active member of the organization: first and last name of
-- their login, or its email without a name; null when the user is not an active member.
-- SECURITY DEFINER to read auth.users, which app_api cannot. Answers only an active member
-- of the same organization.
create function app.member_name(org uuid, member_user_id uuid)
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
  where m.organization_id = org and m.user_id = member_user_id and m.status = 'active'
    and app.is_active_member(org)
$$;

-- The organization's active members and their names, to choose who is responsible for a
-- follow-up; no rows for anyone who is not an active member of it.
create function app.team_names(org uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, app.member_name(org, m.user_id) as name
  from app.organization_members m
  where m.organization_id = org and m.status = 'active' and app.is_active_member(org)
  order by lower(app.member_name(org, m.user_id)), m.user_id
$$;

create table app.contact_log_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  counterparty_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  unique (organization_id, id),
  -- Lets a follow-up name an entry of its own counterparty.
  unique (organization_id, counterparty_id, id),
  constraint contact_log_entries_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id)
);

create index contact_log_entries_counterparty_idx on app.contact_log_entries (counterparty_id);

-- What an entry says, one row per revision, never changed or deleted.
create table app.contact_log_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  entry_id uuid not null,
  -- 1 for the entry as first logged, then 2, 3, ... for corrections; set by the trigger below.
  revision_number integer not null check (revision_number >= 1),
  -- When the contact happened; never more than a few minutes after it was recorded.
  occurred_at timestamptz not null,
  channel app.contact_channel not null,
  -- Who at the counterparty was spoken to, as written (often one of its contacts).
  contact_name app.label not null,
  notes text check (notes = btrim(notes) and length(notes) between 1 and 5000),
  recorded_by uuid not null references auth.users (id),
  -- The recorder's name as it was when they recorded the revision, from their login.
  recorded_by_name app.label not null,
  created_at timestamptz not null default now(),
  unique (entry_id, revision_number),
  constraint contact_log_revisions_entry_fkey foreign key (organization_id, entry_id)
    references app.contact_log_entries (organization_id, id),
  check (occurred_at >= '2000-01-01T00:00:00Z' and occurred_at <= created_at + interval '5 minutes')
);

create index contact_log_revisions_entry_idx
  on app.contact_log_revisions (entry_id, revision_number desc);

create table app.follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  counterparty_id uuid not null,
  -- The contact log entry it came from, of the same counterparty; null when planned alone.
  contact_log_entry_id uuid,
  -- What to do, e.g. "Send the November bid sheet".
  task app.label not null,
  due_at timestamptz not null
    check (due_at >= '2000-01-01T00:00:00Z' and due_at < '2100-01-01T00:00:00Z'),
  -- The team member responsible; their name is filled in by the trigger below.
  assigned_to uuid not null references auth.users (id),
  assigned_to_name app.label not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  created_by_name app.label not null,
  done_at timestamptz,
  done_by uuid references auth.users (id),
  done_by_name app.label,
  unique (organization_id, id),
  constraint follow_ups_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id),
  constraint follow_ups_entry_fkey foreign key (organization_id, counterparty_id, contact_log_entry_id)
    references app.contact_log_entries (organization_id, counterparty_id, id),
  check ((done_at is null) = (done_by is null)),
  check ((done_at is null) = (done_by_name is null))
);

create index follow_ups_open_idx on app.follow_ups (organization_id, due_at) where done_at is null;
create index follow_ups_assigned_idx on app.follow_ups (assigned_to, due_at) where done_at is null;
create index follow_ups_counterparty_idx on app.follow_ups (counterparty_id, due_at);
create index follow_ups_entry_idx on app.follow_ups (contact_log_entry_id)
  where contact_log_entry_id is not null;

-- The transaction-level lock that makes an entry's corrections happen one after the other.
-- An advisory lock, because locking the entry's row would need an update grant on entries,
-- which app_api does not have. The API takes it too before checking which revision a
-- correction is based on.
create function app.lock_contact_log_entry(entry uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app.contact_log_entries:' || entry::text, 0))
$$;

-- Numbers each revision, after taking the entry's lock.
create function app.number_contact_log_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  found_entry boolean;
begin
  if not app.can_log_contacts(new.organization_id) then
    raise exception 'only traders, operations and admins log contacts'
      using errcode = 'insufficient_privilege';
  end if;
  perform app.lock_contact_log_entry(new.entry_id);
  select true into found_entry
    from app.contact_log_entries e
   where e.id = new.entry_id and e.organization_id = new.organization_id;
  if found_entry is null then
    raise exception 'no such contact log entry' using errcode = 'foreign_key_violation';
  end if;
  select coalesce(max(r.revision_number), 0) + 1 into new.revision_number
    from app.contact_log_revisions r
   where r.entry_id = new.entry_id;
  return new;
end
$$;

create trigger contact_log_revisions_number
  before insert on app.contact_log_revisions
  for each row execute function app.number_contact_log_revision();

-- Revisions are history: nobody changes or deletes one, whatever their grants.
create function app.keep_contact_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the contact log is never changed or deleted; a correction is a new revision'
    using errcode = 'insufficient_privilege';
end
$$;

create trigger contact_log_revisions_immutable
  before update or delete on app.contact_log_revisions
  for each row execute function app.keep_contact_log();
create trigger contact_log_revisions_no_truncate
  before truncate on app.contact_log_revisions
  for each statement execute function app.keep_contact_log();
create trigger contact_log_entries_immutable
  before update or delete on app.contact_log_entries
  for each row execute function app.keep_contact_log();
create trigger contact_log_entries_no_truncate
  before truncate on app.contact_log_entries
  for each statement execute function app.keep_contact_log();

-- A follow-up's rules on every insert and update:
-- - the responsible person is an active member of the organization (SQLSTATE GS004), and
--   their name is taken from their login;
-- - a follow-up stays with its organization, counterparty, entry and creator;
-- - once done, nothing about it changes;
-- - someone who may not plan follow-ups (the responsible person in another role) only marks
--   it done;
-- - the task, due time and responsible person of an archived counterparty's follow-up do
--   not change.
create function app.check_follow_up()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  planning_changed boolean;
begin
  if tg_op = 'UPDATE' then
    if old.done_at is not null then
      raise exception 'a follow-up that is done does not change' using errcode = 'check_violation';
    end if;
    if (new.organization_id, new.counterparty_id, new.contact_log_entry_id, new.created_at,
        new.created_by, new.created_by_name)
       is distinct from
       (old.organization_id, old.counterparty_id, old.contact_log_entry_id, old.created_at,
        old.created_by, old.created_by_name) then
      raise exception 'a follow-up stays with its counterparty and creator'
        using errcode = 'check_violation';
    end if;
    planning_changed := (new.task, new.due_at, new.assigned_to)
                        is distinct from (old.task, old.due_at, old.assigned_to);
    if not app.can_log_contacts(new.organization_id)
       and (planning_changed or new.done_at is null) then
      raise exception 'only traders, operations and admins change a follow-up; the person responsible marks it done'
        using errcode = 'insufficient_privilege';
    end if;
    if planning_changed and exists (
         select 1 from app.counterparties c
          where c.id = new.counterparty_id and c.archived_at is not null) then
      raise exception 'an archived counterparty''s follow-ups are not changed'
        using errcode = 'check_violation';
    end if;
    if new.assigned_to is not distinct from old.assigned_to then
      new.assigned_to_name := old.assigned_to_name;
      return new;
    end if;
  end if;
  new.assigned_to_name := app.member_name(new.organization_id, new.assigned_to);
  if new.assigned_to_name is null then
    raise exception 'the person responsible is an active member of the organization'
      using errcode = 'GS004';
  end if;
  return new;
end
$$;

create trigger follow_ups_check
  before insert or update on app.follow_ups
  for each row execute function app.check_follow_up();
create trigger follow_ups_touch_updated_at
  before update on app.follow_ups
  for each row execute function app.touch_updated_at();
create function app.keep_follow_ups()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'follow-ups are never deleted' using errcode = 'insufficient_privilege';
end
$$;
create trigger follow_ups_no_delete
  before delete on app.follow_ups
  for each row execute function app.keep_follow_ups();
create trigger follow_ups_no_truncate
  before truncate on app.follow_ups
  for each statement execute function app.keep_follow_ups();

create trigger contact_log_entries_audit
  after insert or update or delete on app.contact_log_entries
  for each row execute function app.record_audit_event();
create trigger contact_log_revisions_audit
  after insert or update or delete on app.contact_log_revisions
  for each row execute function app.record_audit_event();
create trigger follow_ups_audit
  after insert or update or delete on app.follow_ups
  for each row execute function app.record_audit_event();

alter table app.contact_log_entries enable row level security;
alter table app.contact_log_revisions enable row level security;
alter table app.follow_ups enable row level security;

create policy contact_log_entries_select_for_members on app.contact_log_entries
  for select to app_api using (app.is_active_member(organization_id));
-- New entries only for a counterparty that is not archived.
create policy contact_log_entries_insert_for_loggers on app.contact_log_entries
  for insert to app_api
  with check (
    app.can_log_contacts(organization_id)
    and created_by = app.current_user_id()
    and exists (
      select 1 from app.counterparties c
       where c.id = counterparty_id and c.organization_id = contact_log_entries.organization_id
         and c.archived_at is null
    )
  );

create policy contact_log_revisions_select_for_members on app.contact_log_revisions
  for select to app_api using (app.is_active_member(organization_id));
-- First versions and corrections, only while the counterparty is not archived.
create policy contact_log_revisions_insert_for_loggers on app.contact_log_revisions
  for insert to app_api
  with check (
    app.can_log_contacts(organization_id)
    and recorded_by = app.current_user_id()
    and exists (
      select 1 from app.contact_log_entries e
        join app.counterparties c on c.id = e.counterparty_id
       where e.id = entry_id and c.archived_at is null
    )
  );

create policy follow_ups_select_for_members on app.follow_ups
  for select to app_api using (app.is_active_member(organization_id));
-- New follow-ups only for a counterparty that is not archived, open, created as oneself.
create policy follow_ups_insert_for_loggers on app.follow_ups
  for insert to app_api
  with check (
    app.can_log_contacts(organization_id)
    and created_by = app.current_user_id()
    and done_at is null
    and exists (
      select 1 from app.counterparties c
       where c.id = counterparty_id and c.organization_id = follow_ups.organization_id
         and c.archived_at is null
    )
  );
-- Those who plan follow-ups change and finish them; the person responsible finishes theirs.
-- Marking done is always in one's own name (check_follow_up limits what else changes).
create policy follow_ups_update_for_loggers_and_assignee on app.follow_ups
  for update to app_api
  using (
    app.can_log_contacts(organization_id)
    or (assigned_to = app.current_user_id() and app.is_active_member(organization_id))
  )
  with check (
    (app.can_log_contacts(organization_id)
     or (assigned_to = app.current_user_id() and app.is_active_member(organization_id)))
    and (done_by is null or done_by = app.current_user_id())
  );

-- Privileges: nothing for public or the Supabase API roles. app_api reads, logs entries and
-- revisions, plans follow-ups and changes the columns of planning and finishing; it never
-- changes or deletes the log or deletes a follow-up.
revoke all on app.contact_log_entries, app.contact_log_revisions, app.follow_ups
  from public, anon, authenticated, service_role;
revoke all on function app.can_log_contacts(uuid), app.member_name(uuid, uuid),
  app.team_names(uuid), app.lock_contact_log_entry(uuid), app.number_contact_log_revision(), app.keep_contact_log(),
  app.check_follow_up(), app.keep_follow_ups()
  from public, anon, authenticated, service_role;
revoke all on function app.number_contact_log_revision(), app.keep_contact_log(),
  app.check_follow_up(), app.keep_follow_ups() from app_api;
grant select, insert on app.contact_log_entries, app.contact_log_revisions, app.follow_ups
  to app_api;
grant update (task, due_at, assigned_to, assigned_to_name, done_at, done_by, done_by_name)
  on app.follow_ups to app_api;
grant execute on function app.can_log_contacts(uuid), app.member_name(uuid, uuid),
  app.team_names(uuid), app.lock_contact_log_entry(uuid) to app_api;
