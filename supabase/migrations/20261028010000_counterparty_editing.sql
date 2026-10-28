-- Counterparty editing (GT-020), MASTER_PROJECT_SPECIFICATION.md sections 2.1, 5.1 and 6;
-- the owner's request of 2026-10-28 (docs/DECISIONS.md).
--
-- Operations and org_admin members can now correct a counterparty's details, add, correct
-- and remove its contacts and locations, and archive or restore it. Counterparties are never
-- deleted: archiving hides one from the list and the map and keeps it and its history.
-- Contacts and locations can be removed; nothing references them yet (when quotes reference
-- locations, their foreign keys will refuse removing a location that has quotes). Every
-- change is audited by the existing trigger: who, when, which columns.
--
-- Records cannot be moved to another organization or counterparty: only the columns
-- granted below can be updated.

alter table app.counterparties add column archived_at timestamptz;

create policy counterparties_update_for_editors on app.counterparties
  for update to app_api
  using (app.can_edit_directory(organization_id))
  with check (app.can_edit_directory(organization_id));

create policy counterparty_contacts_update_for_editors on app.counterparty_contacts
  for update to app_api
  using (app.can_edit_directory(organization_id))
  with check (app.can_edit_directory(organization_id));
create policy counterparty_contacts_delete_for_editors on app.counterparty_contacts
  for delete to app_api
  using (app.can_edit_directory(organization_id));

-- Replaces the policy that only let editors fill in a missing location: a location's
-- address and coordinates can now be corrected. That a geocoding result never replaces
-- existing coordinates is kept by the trigger below instead.
drop policy facilities_update_missing_location_for_editors on app.facilities;
create policy facilities_update_for_editors on app.facilities
  for update to app_api
  using (app.can_edit_directory(organization_id))
  with check (app.can_edit_directory(organization_id));
create policy facilities_delete_for_editors on app.facilities
  for delete to app_api
  using (app.can_edit_directory(organization_id));

-- A geocoding result only fills in a missing location; it never replaces coordinates a
-- facility already has (20261027050000_facility_geocoding.sql). Coordinates corrected by
-- hand are saved with the source 'manual'.
create function app.keep_existing_coordinates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.latitude is not null
     and new.geocoding_source = 'geocodio'
     and (new.latitude, new.longitude) is distinct from (old.latitude, old.longitude) then
    raise exception 'a geocoding result cannot replace existing coordinates'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger facilities_keep_existing_coordinates
  before update of latitude, longitude, geocoding_source on app.facilities
  for each row execute function app.keep_existing_coordinates();

revoke all on function app.keep_existing_coordinates()
  from public, anon, authenticated, service_role, app_api;

-- Privileges: only the columns a person edits, and removing contacts and locations. The
-- location columns of app.facilities were granted by 20261027050000_facility_geocoding.sql.
grant update (
  legal_name, trading_name, types, primary_country, verification_status, notes, archived_at
) on app.counterparties to app_api;
grant update (name, role, email, phone), delete on app.counterparty_contacts to app_api;
grant update (name, facility_type, address_line, city, region, postal_code, country), delete
  on app.facilities to app_api;
