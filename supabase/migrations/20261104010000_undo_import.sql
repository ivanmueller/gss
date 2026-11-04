-- Undoing an import (the owner's request and answers of 2026-11-04, docs/DECISIONS.md): an
-- org_admin removes the companies one spreadsheet import created, and what it added to
-- companies already listed, to start that import again.
--
-- The API does the removal itself, under the organization's import lock and the admin's own
-- membership lock, with the existing policies: it archives each company the import created
-- and deletes it (counterparties_delete_archived_for_admins), and removes the locations and
-- grains the import added to companies already listed. What this migration adds:
--
-- 1. import_batches.undone_at and undone_by: when and by whom an import was undone, set once,
--    both together, only by an org_admin of its organization. The batch row is kept, so the
--    locations and companies still naming it (none, once undone) and the audit trail keep
--    their reference.
-- 2. app.import_changes(batch): which companies already listed and which of their locations
--    the import changed, and which fields, read from the audit trail (closed to app_api):
--    the update events of the import's own transaction (the same now() as the batch, by the
--    same person). Only an active org_admin of the batch's organization may ask; others get
--    an error and nothing. SECURITY DEFINER, reading only that organization's events.

alter table app.import_batches
  add column undone_at timestamptz,
  add column undone_by uuid references auth.users (id),
  add constraint import_batches_undone_check
    check ((undone_at is null) = (undone_by is null));

create policy import_batches_undo_for_admins on app.import_batches
  for update to app_api
  using (app.is_org_admin(organization_id) and undone_at is null)
  with check (app.is_org_admin(organization_id) and undone_by = app.current_user_id());

grant update (undone_at, undone_by) on app.import_batches to app_api;

create function app.import_changes(batch uuid)
returns table (entity text, entity_id uuid, changed_fields text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid;
  made_at timestamptz;
  made_by uuid;
begin
  select b.organization_id, b.created_at, b.created_by
    into org, made_at, made_by
    from app.import_batches b
   where b.id = batch;
  if org is null or not app.is_org_admin(org) then
    raise exception 'only an admin of its organization reads what an import changed'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select e.entity, e.entity_id, e.changed_fields
      from app.audit_events e
     where e.organization_id = org
       and e.action = 'update'
       and e.entity in ('counterparties', 'facilities')
       and e.occurred_at = made_at
       and e.actor_id = made_by
     order by e.id;
end
$$;

revoke all on function app.import_changes(uuid) from public, anon, authenticated, service_role;
grant execute on function app.import_changes(uuid) to app_api;

-- 3. app.import_retyped(batch): the companies the import created whose types were changed
--    afterwards (another import or Edit details made a seller a buyer too, say). Undoing the
--    import keeps them, as they are no longer only what the import made (the owner's worry,
--    2026-11-04). Same access as app.import_changes.
create function app.import_retyped(batch uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid;
  made_at timestamptz;
begin
  select b.organization_id, b.created_at into org, made_at
    from app.import_batches b
   where b.id = batch;
  if org is null or not app.is_org_admin(org) then
    raise exception 'only an admin of its organization reads what an import changed'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select distinct e.entity_id
      from app.audit_events e
      join app.counterparties c on c.id = e.entity_id and c.organization_id = org
     where e.organization_id = org
       and e.entity = 'counterparties'
       and e.action = 'update'
       and 'types' = any (e.changed_fields)
       and e.occurred_at > made_at
       and c.import_batch_id = batch;
end
$$;

revoke all on function app.import_retyped(uuid) from public, anon, authenticated, service_role;
grant execute on function app.import_retyped(uuid) to app_api;
