-- Undoing an import (the owner's request and answers of 2026-11-04, docs/DECISIONS.md): an
-- org_admin removes the companies one spreadsheet import created, and what it added to
-- companies already listed, to start that import again.
--
-- The API does the removal itself, under the organization's import lock and the admin's own
-- membership lock, with the existing policies: it archives each company the import created
-- and deletes it (counterparties_delete_archived_for_admins), and removes what the import
-- added to companies already listed. What an import did is recorded, never guessed from
-- timestamps (Codex's review of a62e00a: separate transactions can share one):
--
-- 1. import_batches.undone_at and undone_by: when and by whom an import was undone, set once,
--    both together, only by an org_admin of its organization in their own name. The batch row
--    is kept for the audit trail.
-- 2. counterparty_commodities.import_batch_id: the import that added a grain, as locations
--    already have (facilities.import_batch_id).
-- 3. app.import_additions: per company already listed, the types an import added to it and
--    whether it filled in seller details the company had none of, and what else it replaced
--    (to check by hand). Written by the import in
--    its own transaction; read and removed only to undo it. Imports made before this table
--    have no rows: undoing one removes only what is recorded (its companies, locations).
-- 4. app.import_retyped(batch): the companies the import created whose types were changed by
--    any update at all (audit events of the counterparty naming types; the import itself only
--    inserts its companies). Undoing keeps them, as they are no longer only what it made (the
--    owner's worry, 2026-11-04). SECURITY DEFINER, for an active org_admin of the batch's
--    organization only.

alter table app.import_batches
  -- Whether the import recorded what it added to companies already listed (all made from now
  -- on); an older one did not, so undoing it leaves those additions to check by hand.
  add column records_additions boolean not null default false,
  add column undone_at timestamptz,
  add column undone_by uuid references auth.users (id),
  add constraint import_batches_undone_check
    check ((undone_at is null) = (undone_by is null));

create policy import_batches_undo_for_admins on app.import_batches
  for update to app_api
  using (app.is_org_admin(organization_id) and undone_at is null)
  with check (app.is_org_admin(organization_id) and undone_by = app.current_user_id());

grant update (undone_at, undone_by) on app.import_batches to app_api;

alter table app.counterparty_commodities
  add column import_batch_id uuid,
  add constraint counterparty_commodities_import_batch_fkey
    foreign key (organization_id, import_batch_id)
    references app.import_batches (organization_id, id);

grant insert (import_batch_id) on app.counterparty_commodities to app_api;

create table app.import_additions (
  organization_id uuid not null,
  import_batch_id uuid not null,
  counterparty_id uuid not null,
  -- The types it added (types are only ever added by an import); empty when none.
  added_types app.counterparty_type[] not null default '{}'
    check (array_position(added_types, null) is null),
  -- Whether it filled in seller details the company had none of.
  seller_details boolean not null default false,
  -- What else it replaced, which cannot be put back ("tier", "notes", "a location's address"),
  -- for the admin to check by hand.
  replaced text[] not null default '{}' check (array_position(replaced, null) is null),
  primary key (import_batch_id, counterparty_id),
  foreign key (organization_id, import_batch_id) references app.import_batches (organization_id, id),
  foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id) on delete cascade
);

create index import_additions_counterparty_idx
  on app.import_additions (organization_id, counterparty_id);

alter table app.import_additions enable row level security;

-- Written by the person importing, in the import's transaction; read by admins to undo it.
create policy import_additions_insert_for_editors on app.import_additions
  for insert to app_api
  with check (
    app.can_edit_directory(organization_id)
    and exists (select from app.import_batches b
                where b.id = import_batch_id and b.organization_id = import_additions.organization_id
                  and b.created_by = app.current_user_id())
  );
create policy import_additions_select_for_admins on app.import_additions
  for select to app_api using (app.is_org_admin(organization_id));

revoke all on table app.import_additions from public, anon, authenticated, service_role;
grant select,
  insert (organization_id, import_batch_id, counterparty_id, added_types, seller_details, replaced)
  on app.import_additions to app_api;

create function app.import_retyped(batch uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  select b.organization_id into org from app.import_batches b where b.id = batch;
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
       and c.import_batch_id = batch;
end
$$;

revoke all on function app.import_retyped(uuid) from public, anon, authenticated, service_role;
grant execute on function app.import_retyped(uuid) to app_api;
