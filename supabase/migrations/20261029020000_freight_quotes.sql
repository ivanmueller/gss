-- Carrier freight rates by route with a full revision history (part of GT-050),
-- MASTER_PROJECT_SPECIFICATION.md sections 2.1, 5.2, 5.3, 6 and 8; the owner's request of
-- 2026-10-29 (docs/DECISIONS.md).
--
-- A freight quote is one carrier's rate for moving grain from one location in the directory
-- to another, by truck or rail. Its economic terms live in revisions, as for bids and offers:
-- each change of rate, unit, payload or timing appends a new revision, and revisions are
-- never changed or deleted, so the history a saved scenario points at stays as it was. A
-- freight quote can be withdrawn, once and for good; it is never deleted.
--
-- Carriers quote in different units (owner, 2026-10-29), so each revision keeps the rate and
-- unit as quoted. A rate per load records the load's payload, because converting it to a
-- rate per tonne needs the actual contract payload, never one inferred from the truck
-- (docs/TRADING_RULES.md section 5.3). Converting is the trading engine's job.
--
-- Access for app_api: every active member reads the organization's freight; traders,
-- operations and org admins enter, revise and withdraw it (section 2.1: operations create
-- freight, traders enter freight for scenarios). Every change is audited.

create type app.freight_mode as enum ('truck', 'rail');

-- Roles allowed to enter, revise and withdraw freight quotes.
create function app.can_enter_freight(org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_role(org, array['trader', 'operations', 'org_admin']::app.member_role[])
$$;

-- Lets the foreign keys below say that both locations are of the freight quote's organization.
alter table app.facilities
  add constraint facilities_organization_key unique (organization_id, id);

create table app.freight_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  -- The counterparty quoting the rate; a carrier when the quote was entered.
  carrier_id uuid not null,
  -- From one location to another, both in the directory (the owner: specific addresses).
  origin_facility_id uuid not null,
  destination_facility_id uuid not null,
  mode app.freight_mode not null,
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users (id),
  -- The name of who withdrew it, as it was then, from their login.
  withdrawn_by_name app.label,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  unique (organization_id, id),
  -- Tenant-matching keys: the carrier and both locations are of the quote's organization.
  -- A location with freight quotes cannot be removed.
  constraint freight_quotes_carrier_fkey foreign key (organization_id, carrier_id)
    references app.counterparties (organization_id, id),
  constraint freight_quotes_origin_fkey foreign key (organization_id, origin_facility_id)
    references app.facilities (organization_id, id),
  constraint freight_quotes_destination_fkey foreign key (organization_id, destination_facility_id)
    references app.facilities (organization_id, id),
  check (origin_facility_id <> destination_facility_id),
  check ((withdrawn_at is null) = (withdrawn_by is null)),
  check ((withdrawn_at is null) = (withdrawn_by_name is null))
);

create index freight_quotes_route_idx
  on app.freight_quotes (organization_id, origin_facility_id, destination_facility_id);
create index freight_quotes_carrier_idx on app.freight_quotes (carrier_id);
create index freight_quotes_destination_idx on app.freight_quotes (destination_facility_id);

-- The economic terms, one row per revision, never changed or deleted.
create table app.freight_quote_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  freight_quote_id uuid not null,
  -- 1 for the first terms, then 2, 3, ...; set by the trigger below, never by the caller.
  revision_number integer not null check (revision_number >= 1),
  firmness app.quote_firmness not null,
  -- As quoted, with the decimal places entered ("105.00"); above zero.
  rate numeric not null check (rate > 0 and rate < 1e18 and scale(rate) <= 12),
  currency text not null check (currency in ('CAD', 'USD')),
  -- Per metric tonne, short ton (2,000 lb), bushel, hundredweight (100 lb) or load, as quoted.
  rate_unit text not null check (rate_unit in ('MT', 'ST', 'BU', 'CWT', 'LOAD')),
  -- The contract payload of one load, in metric tonnes, short tons or pounds as quoted;
  -- required for a rate per load and only then.
  payload numeric(14, 3) check (payload > 0),
  payload_unit text check (payload_unit in ('MT', 'ST', 'LB')),
  -- What the rate includes, e.g. "Fuel surcharge included; border crossing extra".
  inclusions app.label,
  quoted_at timestamptz not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  source_type app.quote_source not null,
  -- E.g. "Email from dispatch" or a reference number.
  source_reference app.label,
  notes app.note,
  recorded_by uuid not null references auth.users (id),
  -- The recorder's name as it was when they recorded the revision, from their login.
  recorded_by_name app.label not null,
  created_at timestamptz not null default now(),
  unique (freight_quote_id, revision_number),
  constraint freight_quote_revisions_quote_fkey foreign key (organization_id, freight_quote_id)
    references app.freight_quotes (organization_id, id),
  check ((payload is null) = (payload_unit is null)),
  check ((rate_unit = 'LOAD') = (payload is not null)),
  check (valid_from < valid_until)
);

create index freight_quote_revisions_quote_idx
  on app.freight_quote_revisions (freight_quote_id, revision_number desc);
create index freight_quote_revisions_quoted_at_idx
  on app.freight_quote_revisions (organization_id, quoted_at desc);

-- Numbers each revision and refuses one for a withdrawn freight quote (SQLSTATE GS003).
-- Locking the freight quote makes revisions and withdrawing happen one after the other.
create function app.number_freight_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  withdrawn boolean;
begin
  if not app.can_enter_freight(new.organization_id) then
    raise exception 'only traders, operations and admins record freight revisions'
      using errcode = 'insufficient_privilege';
  end if;
  select q.withdrawn_at is not null into withdrawn
    from app.freight_quotes q
   where q.id = new.freight_quote_id and q.organization_id = new.organization_id
   for no key update;
  if withdrawn is null then
    raise exception 'no such freight quote' using errcode = 'foreign_key_violation';
  end if;
  if withdrawn then
    raise exception 'a withdrawn freight quote cannot be revised' using errcode = 'GS003';
  end if;
  select coalesce(max(r.revision_number), 0) + 1 into new.revision_number
    from app.freight_quote_revisions r
   where r.freight_quote_id = new.freight_quote_id;
  return new;
end
$$;

create trigger freight_quote_revisions_number
  before insert on app.freight_quote_revisions
  for each row execute function app.number_freight_revision();

-- Revisions are history: nobody changes or deletes one, whatever their grants.
create function app.keep_freight_revisions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'freight quote revisions are never changed or deleted'
    using errcode = 'insufficient_privilege';
end
$$;

create trigger freight_quote_revisions_immutable
  before update or delete on app.freight_quote_revisions
  for each row execute function app.keep_freight_revisions();
create trigger freight_quote_revisions_no_truncate
  before truncate on app.freight_quote_revisions
  for each statement execute function app.keep_freight_revisions();

-- A freight quote is withdrawn once and stays withdrawn; nothing else about it changes.
create function app.keep_freight_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.withdrawn_at is not null
     or (new.organization_id, new.carrier_id, new.origin_facility_id,
         new.destination_facility_id, new.mode, new.created_at, new.created_by)
        is distinct from
        (old.organization_id, old.carrier_id, old.origin_facility_id,
         old.destination_facility_id, old.mode, old.created_at, old.created_by) then
    raise exception 'only withdrawing changes a freight quote, and only once'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger freight_quotes_keep_identity
  before update on app.freight_quotes
  for each row execute function app.keep_freight_identity();
create trigger freight_quotes_touch_updated_at
  before update on app.freight_quotes
  for each row execute function app.touch_updated_at();

create trigger freight_quotes_audit
  after insert or update or delete on app.freight_quotes
  for each row execute function app.record_audit_event();
create trigger freight_quote_revisions_audit
  after insert or update or delete on app.freight_quote_revisions
  for each row execute function app.record_audit_event();

alter table app.freight_quotes enable row level security;
alter table app.freight_quote_revisions enable row level security;

create policy freight_quotes_select_for_members on app.freight_quotes
  for select to app_api using (app.is_active_member(organization_id));
-- New freight quotes only from a carrier that is not archived, between locations of
-- counterparties that are not archived.
create policy freight_quotes_insert_for_entrants on app.freight_quotes
  for insert to app_api
  with check (
    app.can_enter_freight(organization_id)
    and created_by = app.current_user_id()
    and withdrawn_at is null
    and exists (
      select 1 from app.counterparties c
       where c.id = carrier_id and c.organization_id = freight_quotes.organization_id
         and c.archived_at is null and 'carrier' = any (c.types)
    )
    and not exists (
      select 1 from app.facilities f
        join app.counterparties c on c.id = f.counterparty_id
       where f.id in (origin_facility_id, destination_facility_id)
         and c.archived_at is not null
    )
  );
create policy freight_quotes_update_for_entrants on app.freight_quotes
  for update to app_api
  using (app.can_enter_freight(organization_id))
  with check (
    app.can_enter_freight(organization_id) and withdrawn_by = app.current_user_id()
  );

create policy freight_quote_revisions_select_for_members on app.freight_quote_revisions
  for select to app_api using (app.is_active_member(organization_id));
create policy freight_quote_revisions_insert_for_entrants on app.freight_quote_revisions
  for insert to app_api
  with check (app.can_enter_freight(organization_id) and recorded_by = app.current_user_id());

-- Privileges: nothing for public or the Supabase API roles. app_api reads, enters freight
-- quotes and revisions, and withdraws freight quotes; it never updates or deletes a revision
-- or deletes a freight quote.
revoke all on app.freight_quotes, app.freight_quote_revisions
  from public, anon, authenticated, service_role;
revoke all on function app.can_enter_freight(uuid), app.number_freight_revision(),
  app.keep_freight_revisions(), app.keep_freight_identity()
  from public, anon, authenticated, service_role;
revoke all on function app.number_freight_revision(), app.keep_freight_revisions(),
  app.keep_freight_identity() from app_api;
grant select, insert on app.freight_quotes, app.freight_quote_revisions to app_api;
grant update (withdrawn_at, withdrawn_by, withdrawn_by_name) on app.freight_quotes to app_api;
grant execute on function app.can_enter_freight(uuid) to app_api;
