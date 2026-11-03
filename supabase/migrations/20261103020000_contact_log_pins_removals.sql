-- Pinning and removing contact history entries (the owner's request and answers of 2026-11-03,
-- docs/DECISIONS.md): each entry's "…" menu offers Pin to the top, Edit and, for admins,
-- Remove. The entries and their versions stay as they are (app.keep_contact_log): a pin and a
-- removal are rows of their own beside the entry.
--
-- - app.contact_log_pins: an entry pinned to the top of its counterparty's contact history,
--   by whom and when. Pinned and unpinned (the row deleted) by traders, operations and admins.
-- - app.contact_log_removals: an entry removed from every list, by whom and when; only an
--   admin of its organization removes one, in their own name; never changed or deleted, so a
--   removed entry is kept with its versions, call and transcript.
-- Times are the database's clock and names come from the person's login. Every change is
-- audited (each row has an id of its own for the audit trail).

create table app.contact_log_pins (
  -- Its own id, which the audit trail records; one per entry.
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique,
  organization_id uuid not null references app.organizations (id),
  pinned_at timestamptz not null default now(),
  pinned_by uuid not null references auth.users (id),
  pinned_by_name app.label not null,
  constraint contact_log_pins_entry_fkey foreign key (organization_id, entry_id)
    references app.contact_log_entries (organization_id, id)
);

create table app.contact_log_removals (
  -- Its own id, which the audit trail records; one per entry.
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique,
  organization_id uuid not null references app.organizations (id),
  removed_at timestamptz not null default now(),
  removed_by uuid not null references auth.users (id),
  removed_by_name app.label not null,
  constraint contact_log_removals_entry_fkey foreign key (organization_id, entry_id)
    references app.contact_log_entries (organization_id, id)
);

create index contact_log_pins_organization_idx on app.contact_log_pins (organization_id);
create index contact_log_removals_organization_idx on app.contact_log_removals (organization_id);

-- A pin: by someone who logs contacts, in their own name, of an entry not removed.
create function app.check_contact_log_pin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.can_log_contacts(new.organization_id)
     or new.pinned_by is distinct from app.current_user_id() then
    raise exception 'only traders, operations and admins pin an entry, in their own name'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from app.contact_log_removals r where r.entry_id = new.entry_id) then
    raise exception 'a removed entry is not pinned' using errcode = 'check_violation';
  end if;
  new.pinned_at := now();
  new.pinned_by_name := app.member_name(new.organization_id, new.pinned_by);
  if new.pinned_by_name is null then
    raise exception 'only an active member pins an entry' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

-- A removal: by an admin of the entry's organization, in their own name.
create function app.check_contact_log_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_org_admin(new.organization_id)
     or new.removed_by is distinct from app.current_user_id() then
    raise exception 'only an admin removes an entry, in their own name'
      using errcode = 'insufficient_privilege';
  end if;
  new.removed_at := now();
  new.removed_by_name := app.member_name(new.organization_id, new.removed_by);
  if new.removed_by_name is null then
    raise exception 'only an active member removes an entry' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

-- A removal is never changed or undone.
create function app.keep_contact_log_removals()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a removal from the contact history is never changed or undone'
    using errcode = 'insufficient_privilege';
end
$$;

create trigger contact_log_pins_check
  before insert on app.contact_log_pins
  for each row execute function app.check_contact_log_pin();
create trigger contact_log_removals_check
  before insert on app.contact_log_removals
  for each row execute function app.check_contact_log_removal();
create trigger contact_log_removals_immutable
  before update or delete on app.contact_log_removals
  for each row execute function app.keep_contact_log_removals();
create trigger contact_log_removals_no_truncate
  before truncate on app.contact_log_removals
  for each statement execute function app.keep_contact_log_removals();

create trigger contact_log_pins_audit
  after insert or update or delete on app.contact_log_pins
  for each row execute function app.record_audit_event();
create trigger contact_log_removals_audit
  after insert or update or delete on app.contact_log_removals
  for each row execute function app.record_audit_event();

alter table app.contact_log_pins enable row level security;
alter table app.contact_log_removals enable row level security;

create policy contact_log_pins_select_for_members on app.contact_log_pins
  for select to app_api using (app.is_active_member(organization_id));
create policy contact_log_pins_insert_for_loggers on app.contact_log_pins
  for insert to app_api
  with check (app.can_log_contacts(organization_id) and pinned_by = app.current_user_id());
create policy contact_log_pins_delete_for_loggers on app.contact_log_pins
  for delete to app_api using (app.can_log_contacts(organization_id));

create policy contact_log_removals_select_for_members on app.contact_log_removals
  for select to app_api using (app.is_active_member(organization_id));
create policy contact_log_removals_insert_for_admins on app.contact_log_removals
  for insert to app_api
  with check (app.is_org_admin(organization_id) and removed_by = app.current_user_id());

-- Privileges: nothing for public or the Supabase API roles. app_api reads both, pins and
-- unpins, and removes; the times and names are the database's.
revoke all on app.contact_log_pins, app.contact_log_removals
  from public, anon, authenticated, service_role, app_api;
revoke all on function app.check_contact_log_pin(), app.check_contact_log_removal(),
  app.keep_contact_log_removals()
  from public, anon, authenticated, service_role, app_api;
grant select, delete on app.contact_log_pins to app_api;
grant insert (entry_id, organization_id, pinned_by) on app.contact_log_pins to app_api;
grant select on app.contact_log_removals to app_api;
grant insert (entry_id, organization_id, removed_by) on app.contact_log_removals to app_api;
