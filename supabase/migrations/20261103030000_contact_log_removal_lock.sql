-- A removal and a correction of the same entry, one after the other (Codex's review of
-- ac2d085, finding 2): a correction waiting on the entry's lock could add a version after a
-- removal committed, hidden but saved. Now
-- - a removal takes the entry's lock (app.lock_contact_log_entry), the one every new version
--   takes (app.number_contact_log_revision), so the two are serialized; and
-- - a new version of a removed entry is refused (SQLSTATE 23514), checked after that lock, so a
--   correction that waited behind a removal sees it.

create or replace function app.check_contact_log_removal()
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
  -- Held until the removal commits: a correction of the entry waits for it, then sees it.
  perform app.lock_contact_log_entry(new.entry_id);
  new.removed_at := now();
  new.removed_by_name := app.member_name(new.organization_id, new.removed_by);
  if new.removed_by_name is null then
    raise exception 'only an active member removes an entry' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create function app.refuse_revision_of_removed_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The entry's lock first (taken again by the numbering trigger; it is the same lock), so a
  -- removal committed while this waited is seen by the check below.
  perform app.lock_contact_log_entry(new.entry_id);
  if exists (select 1 from app.contact_log_removals r where r.entry_id = new.entry_id) then
    raise exception 'a removed entry is not corrected' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger contact_log_revisions_not_removed
  before insert on app.contact_log_revisions
  for each row execute function app.refuse_revision_of_removed_entry();

revoke all on function app.check_contact_log_removal(), app.refuse_revision_of_removed_entry()
  from public, anon, authenticated, service_role, app_api;
