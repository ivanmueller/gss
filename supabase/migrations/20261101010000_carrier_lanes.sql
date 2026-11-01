-- A carrier's lanes and equipment (the owner's request and answers of 2026-11-01,
-- docs/DECISIONS.md): where each freight company runs, so the team knows which carrier to
-- call for which trade. A carrier based in Alberta may run only to Montana and North Dakota;
-- one from Manitoba may run to many states.
--
-- A lane is one province or state the carrier loads in (origin) and one it delivers to
-- (destination), by truck, rail or both, as ISO 3166-2 codes ('CA-AB', 'US-MT'), kept to
-- Canada's provinces and territories and the U.S. states and DC. A carrier has each pair of
-- places at most once; the origin and destination may be the same (hauling within Alberta).
-- Lanes are added, their transport changed, and removed; every change is audited.
--
-- Who: traders, operations and admins, the people who enter freight rates
-- (app.can_enter_freight); every active member reads them. Only a counterparty that is a
-- carrier gets a lane, and nothing changes on an archived one (SQLSTATE GS005), except that
-- an admin deleting the archived carrier deletes its lanes first. The check share-locks the
-- carrier, so a change and archiving it happen one after the other.
--
-- equipment: what a carrier hauls with, any of the list below (several allowed; none by
-- default), set with its other details by operations and admins (Edit details).

create domain app.lane_region as text check (value in (
  'CA-AB', 'CA-BC', 'CA-MB', 'CA-NB', 'CA-NL', 'CA-NS', 'CA-NT', 'CA-NU', 'CA-ON', 'CA-PE',
  'CA-QC', 'CA-SK', 'CA-YT',
  'US-AL', 'US-AK', 'US-AZ', 'US-AR', 'US-CA', 'US-CO', 'US-CT', 'US-DE', 'US-DC', 'US-FL',
  'US-GA', 'US-HI', 'US-ID', 'US-IL', 'US-IN', 'US-IA', 'US-KS', 'US-KY', 'US-LA', 'US-ME',
  'US-MD', 'US-MA', 'US-MI', 'US-MN', 'US-MS', 'US-MO', 'US-MT', 'US-NE', 'US-NV', 'US-NH',
  'US-NJ', 'US-NM', 'US-NY', 'US-NC', 'US-ND', 'US-OH', 'US-OK', 'US-OR', 'US-PA', 'US-RI',
  'US-SC', 'US-SD', 'US-TN', 'US-TX', 'US-UT', 'US-VT', 'US-VA', 'US-WA', 'US-WV', 'US-WI',
  'US-WY'
));

create table app.carrier_lanes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  carrier_id uuid not null,
  origin app.lane_region not null,
  destination app.lane_region not null,
  -- The same values as a location's rail or truck access (facilities.transport_access).
  transport text not null check (transport in ('rail', 'truck', 'rail_and_truck')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  -- Keyed by organization too, so another organization's attempt never meets this row
  -- (as counterparty_commodities, Codex's review of ivanmueller/gss#78).
  unique (organization_id, carrier_id, origin, destination),
  -- The tenant-matching key: a lane belongs to a counterparty of its own organization.
  constraint carrier_lanes_carrier_fkey foreign key (organization_id, carrier_id)
    references app.counterparties (organization_id, id)
);

create index carrier_lanes_carrier_idx on app.carrier_lanes (carrier_id);
create index carrier_lanes_organization_idx
  on app.carrier_lanes (organization_id, origin, destination);

-- Refuses a lane for a counterparty that is not a carrier, and any change to an archived
-- carrier's lanes (GS005), after waiting for any archiving or restoring of it under way (the
-- share lock). An admin of its organization may delete an archived carrier's lanes, which
-- deleting the carrier does first. SECURITY DEFINER: traders cannot lock a counterparty
-- themselves, as its update policy is for operations and admins.
--
-- It runs before row level security checks the row, so it first makes sure the caller is an
-- active member of the row's organization and reads only that organization's counterparty;
-- anyone else's row is left to the policies and the tenant-matching key to refuse, without
-- this function reading or locking another organization's counterparty.
create function app.check_carrier_lane()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.carrier_id else new.carrier_id end;
  organization uuid :=
    case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  archived boolean;
  carrier boolean;
begin
  if tg_op = 'UPDATE' and (new.organization_id, new.carrier_id, new.origin, new.destination)
       is distinct from (old.organization_id, old.carrier_id, old.origin, old.destination) then
    raise exception 'only a lane''s transport changes; its places are removed and added again'
      using errcode = 'check_violation';
  end if;
  if not app.is_active_member(organization) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select c.archived_at is not null, 'carrier' = any (c.types) into archived, carrier
    from app.counterparties c where c.id = target and c.organization_id = organization
    for share;
  if archived and not (tg_op = 'DELETE' and app.is_org_admin(organization)) then
    raise exception 'an archived carrier''s lanes cannot be changed' using errcode = 'GS005';
  end if;
  if tg_op = 'INSERT' and carrier is false then
    raise exception 'only a carrier has lanes' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger carrier_lanes_check
  before insert or update or delete on app.carrier_lanes
  for each row execute function app.check_carrier_lane();
create trigger carrier_lanes_touch_updated_at
  before update on app.carrier_lanes
  for each row execute function app.touch_updated_at();
create trigger carrier_lanes_audit
  after insert or update or delete on app.carrier_lanes
  for each row execute function app.record_audit_event();

-- Starts a change of a carrier's lanes (Codex's review of ba68201): locks the caller's own
-- membership, then the carrier, for the rest of the transaction, and says whether the change
-- may go ahead. A role or status change, and archiving the carrier, then wait until the
-- change is done, or were made first and are seen here; so a change is never half done by
-- someone demoted midway, and never lands on a carrier archived while it waited (whatever
-- the trigger lets an admin delete for deleting an archived carrier).
--
-- Answers 'carrier' or 'not_carrier' (go ahead), 'forbidden' (not a trader, operations or
-- admin), 'archived', or 'not_found' (no such counterparty, or not in an organization the
-- caller is an active member of: nothing about another organization is read or locked).
-- SECURITY DEFINER: traders cannot lock memberships or counterparties themselves.
create function app.begin_lane_change(carrier uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid;
  member_role app.member_role;
  archived boolean;
  is_carrier boolean;
begin
  select c.organization_id into organization
    from app.counterparties c
   where c.id = carrier and app.is_active_member(c.organization_id);
  if organization is null then
    return 'not_found';
  end if;
  select m.role into member_role
    from app.organization_members m
   where m.organization_id = organization and m.user_id = app.current_user_id()
     and m.status = 'active'
   for share;
  if member_role is null then
    return 'not_found';
  end if;
  if member_role not in ('trader', 'operations', 'org_admin') then
    return 'forbidden';
  end if;
  select c.archived_at is not null, 'carrier' = any (c.types) into archived, is_carrier
    from app.counterparties c
   where c.id = carrier and c.organization_id = organization
   for share;
  if archived is null then
    return 'not_found';
  end if;
  if archived then
    return 'archived';
  end if;
  return case when is_carrier then 'carrier' else 'not_carrier' end;
end
$$;

alter table app.carrier_lanes enable row level security;

create policy carrier_lanes_select_for_members on app.carrier_lanes
  for select to app_api using (app.is_active_member(organization_id));
create policy carrier_lanes_insert_for_entrants on app.carrier_lanes
  for insert to app_api
  with check (app.can_enter_freight(organization_id) and created_by = app.current_user_id());
create policy carrier_lanes_update_for_entrants on app.carrier_lanes
  for update to app_api
  using (app.can_enter_freight(organization_id))
  with check (app.can_enter_freight(organization_id));
-- Traders, operations and admins remove lanes; an admin also deletes an archived carrier's
-- (the trigger refuses everyone else on an archived carrier).
create policy carrier_lanes_delete_for_entrants on app.carrier_lanes
  for delete to app_api using (app.can_enter_freight(organization_id));

-- Privileges: reading, adding (only the columns a caller sets, so the times are always the
-- database's clock), changing a lane's transport and removing a lane.
revoke all on table app.carrier_lanes from public, anon, authenticated, service_role;
revoke all on function app.check_carrier_lane()
  from public, anon, authenticated, service_role, app_api;
revoke all on function app.begin_lane_change(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.begin_lane_change(uuid) to app_api;
grant select, delete on app.carrier_lanes to app_api;
grant insert (organization_id, carrier_id, origin, destination, transport, created_by)
  on app.carrier_lanes to app_api;
grant update (transport) on app.carrier_lanes to app_api;

-- A carrier's equipment. Inserts were already granted on the whole table; updates go through
-- counterparties_update_for_editors (operations and admins). The audit trigger records it like
-- every other column.
alter table app.counterparties
  add column equipment text[] not null default '{}'
    constraint counterparties_equipment_check check (
      equipment <@ array['super_b', 'tridem', 'van', 'flatdeck', 'walking_floor',
                         'container', 'hopper_car']::text[]
      and array_position(equipment, null) is null
    );

grant update (equipment) on app.counterparties to app_api;
