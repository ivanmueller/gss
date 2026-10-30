-- The owner's request and answers of 2026-10-30 (docs/DECISIONS.md): a company phone on each
-- counterparty, whether each location is served by rail, truck or both, and commodities that
-- are verified by someone on the team.

-- A counterparty's main phone number, apart from its contacts' own numbers. Optional; the
-- same rule as a contact's phone (packages/domain/src/directory.ts mirrors it). Operations
-- and org_admin members set it with the company's other details: inserts were already
-- granted on the whole table, and updates go through counterparties_update_for_editors.
alter table app.counterparties add column phone text
  constraint counterparties_phone_check
    check (length(phone) between 3 and 40 and phone ~ '^[0-9+(). /x-]+$');

grant update (phone) on app.counterparties to app_api;

-- How a location is served: by rail, by truck or by both; null when not known. Kept per
-- location (the owner's answer), since one company's sites can differ. Never imported from
-- a spreadsheet (the owner's answer); set by hand with the location's other details.
alter table app.facilities add column transport_access text
  constraint facilities_transport_access_check
    check (transport_access in ('rail', 'truck', 'rail_and_truck'));

grant update (transport_access) on app.facilities to app_api;

-- Verified commodities. A commodity from a spreadsheet's Commodities column is unverified
-- until someone on the team verifies it on the counterparty's page; one ticked by hand is
-- verified by whoever ticked it. Every commodity already listed starts unverified (the
-- owner's answer). Anyone on the team may verify (the owner's answer), as anyone may change
-- the list. A verified commodity stays verified: it is removed, not unverified.
--
-- verified_by is always the person acting (the policies below) and verified_at the
-- database's clock (the trigger below), so neither can be made up by a caller.
alter table app.counterparty_commodities
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users (id),
  add constraint counterparty_commodities_verified_check
    check ((verified_at is null) = (verified_by is null));

-- Stamps the time of a verification and refuses any other change to a row (SQLSTATE GS006):
-- only an unverified commodity is verified, once. SECURITY INVOKER; it reads nothing.
create function app.stamp_commodity_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.verified_at := case when new.verified_by is null then null else now() end;
    return new;
  end if;
  if old.verified_by is not null or new.verified_by is null
     or (new.organization_id, new.counterparty_id, new.commodity_code, new.direction,
         new.created_at, new.created_by)
        is distinct from
        (old.organization_id, old.counterparty_id, old.commodity_code, old.direction,
         old.created_at, old.created_by) then
    raise exception 'a commodity is only verified, once, and not otherwise changed'
      using errcode = 'GS006';
  end if;
  new.verified_at := now();
  return new;
end
$$;

create trigger counterparty_commodities_verification
  before insert or update on app.counterparty_commodities
  for each row execute function app.stamp_commodity_verification();

-- Verifying is a change to the list: refused on an archived counterparty (GS005), after
-- waiting for any archiving under way, like adding and removing.
drop trigger counterparty_commodities_check on app.counterparty_commodities;
create trigger counterparty_commodities_check
  before insert or update or delete on app.counterparty_commodities
  for each row execute function app.check_counterparty_commodity();

-- Adding: a commodity added as verified is verified by the person adding it.
drop policy counterparty_commodities_insert_for_members on app.counterparty_commodities;
create policy counterparty_commodities_insert_for_members on app.counterparty_commodities
  for insert to app_api
  with check (
    app.is_active_member(organization_id) and created_by = app.current_user_id()
    and (verified_by is null or verified_by = app.current_user_id())
  );

-- Verifying: any active member of the row's organization, in their own name.
create policy counterparty_commodities_verify_for_members on app.counterparty_commodities
  for update to app_api
  using (app.is_active_member(organization_id))
  with check (app.is_active_member(organization_id) and verified_by = app.current_user_id());

revoke all on function app.stamp_commodity_verification()
  from public, anon, authenticated, service_role, app_api;
grant insert (verified_by), update (verified_by) on app.counterparty_commodities to app_api;
