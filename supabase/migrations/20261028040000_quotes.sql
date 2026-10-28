-- Bids and offers with a full revision history (GT-030, GT-031, GT-034),
-- MASTER_PROJECT_SPECIFICATION.md sections 2.1, 2.3, 5.2 and 6; the owner's request of
-- 2026-10-28 (docs/DECISIONS.md).
--
-- A quote is a buyer's bid or a seller's offer from one counterparty, optionally at one of
-- its locations, for one commodity. Its economic terms live in revisions: each change of
-- price, quantity, timing or terms appends a new revision, and revisions are never changed
-- or deleted, so the history a saved scenario points at stays as it was. A quote can be
-- withdrawn, once and for good; it is never deleted.
--
-- Access for app_api: every active member reads the organization's quotes; traders and
-- org admins enter, revise and withdraw them (section 2.1 "Create quotes"). Every change is
-- audited by app.record_audit_event().

-- Commodities: one shared reference list, the same for everyone (codes and names only, no
-- prices). New commodities are added by a migration.
create table app.commodities (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  display_name app.label not null unique,
  active boolean not null default true,
  sort_order integer not null
);

insert into app.commodities (code, display_name, sort_order) values
  ('canola', 'Canola', 10),
  ('flaxseed', 'Flaxseed', 20),
  ('yellow_peas', 'Yellow peas', 30),
  ('green_peas', 'Green peas', 40),
  ('red_lentils', 'Red lentils', 50),
  ('green_lentils', 'Green lentils', 60),
  ('chickpeas', 'Chickpeas', 70),
  ('faba_beans', 'Faba beans', 80),
  ('spring_wheat', 'Spring wheat', 90),
  ('durum_wheat', 'Durum wheat', 100),
  ('winter_wheat', 'Winter wheat', 110),
  ('feed_barley', 'Feed barley', 120),
  ('malt_barley', 'Malt barley', 130),
  ('oats', 'Oats', 140),
  ('rye', 'Rye', 150),
  ('corn', 'Corn', 160),
  ('soybeans', 'Soybeans', 170),
  ('mustard_seed', 'Mustard seed', 180),
  ('canary_seed', 'Canary seed', 190),
  ('sunflower_seed', 'Sunflower seed', 200);

create type app.quote_side as enum ('bid', 'offer');
-- Firm is asserted by a person, not verified by the platform (section 1.2).
create type app.quote_firmness as enum ('firm', 'indicative');
create type app.delivery_basis as enum ('delivered', 'fob', 'ex_farm', 'ex_elevator', 'other');
-- Section 2.3. Hand-entered quotes use phone, email, website or manual (in person, other).
create type app.quote_source as enum (
  'phone', 'email', 'website', 'manual', 'file_import', 'licensed_feed'
);

-- Roles allowed to enter, revise and withdraw quotes.
create function app.can_enter_quotes(org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_role(org, array['trader', 'org_admin']::app.member_role[])
$$;

-- A quote may name one of its own counterparty's locations; this key lets the foreign key
-- below say so.
alter table app.facilities
  add constraint facilities_counterparty_key unique (organization_id, counterparty_id, id);

create table app.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  counterparty_id uuid not null,
  facility_id uuid,
  side app.quote_side not null,
  commodity_code text not null references app.commodities (code),
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users (id),
  -- The name of who withdrew it, as it was then, from their login.
  withdrawn_by_name app.label,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  unique (organization_id, id),
  -- Tenant-matching keys: the counterparty is of the quote's organization, and the location
  -- (when there is one) belongs to that counterparty. A location with quotes cannot be removed.
  constraint quotes_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id),
  constraint quotes_facility_fkey foreign key (organization_id, counterparty_id, facility_id)
    references app.facilities (organization_id, counterparty_id, id),
  check ((withdrawn_at is null) = (withdrawn_by is null)),
  check ((withdrawn_at is null) = (withdrawn_by_name is null))
);

create index quotes_listing_idx on app.quotes (organization_id, side, commodity_code);
create index quotes_counterparty_idx on app.quotes (counterparty_id);
create index quotes_facility_idx on app.quotes (facility_id) where facility_id is not null;

-- The economic terms of section 5.2, one row per revision, never changed or deleted.
create table app.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  -- 1 for the first terms, then 2, 3, ...; set by the trigger below, never by the caller.
  revision_number integer not null check (revision_number >= 1),
  firmness app.quote_firmness not null,
  -- As quoted, with the decimal places entered ("725.00"); flat prices only, so above zero.
  price numeric not null check (price > 0 and price < 1e18 and scale(price) <= 12),
  currency text not null check (currency in ('CAD', 'USD')),
  -- Per metric tonne, short ton (2,000 lb), bushel or hundredweight (100 lb), as quoted.
  -- Converting is the trading engine's job, with a recorded factor (section 5.3).
  price_unit text not null check (price_unit in ('MT', 'ST', 'BU', 'CWT')),
  grade app.label,
  delivery_basis app.delivery_basis not null,
  -- Where the basis applies, e.g. "Minneapolis, MN" for delivered.
  basis_location app.label,
  -- Metric tonnes. No minimum is null; the maximum available is required and above zero.
  quantity_min_mt numeric(14, 3) check (quantity_min_mt >= 0),
  quantity_max_mt numeric(14, 3) not null check (quantity_max_mt > 0),
  delivery_start date,
  delivery_end date,
  quoted_at timestamptz not null,
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  source_type app.quote_source not null,
  -- E.g. "Call with the merchandiser" or a reference number.
  source_reference app.label,
  notes app.note,
  recorded_by uuid not null references auth.users (id),
  -- The recorder's name as it was when they recorded the revision, from their login.
  recorded_by_name app.label not null,
  created_at timestamptz not null default now(),
  unique (quote_id, revision_number),
  constraint quote_revisions_quote_fkey foreign key (organization_id, quote_id)
    references app.quotes (organization_id, id),
  check (quantity_min_mt is null or quantity_min_mt <= quantity_max_mt),
  check (delivery_start is null or delivery_end is null or delivery_start <= delivery_end),
  check (valid_from < valid_until)
);

create index quote_revisions_quote_idx on app.quote_revisions (quote_id, revision_number desc);
create index quote_revisions_quoted_at_idx on app.quote_revisions (organization_id, quoted_at desc);

-- Numbers each revision and refuses one for a withdrawn quote (SQLSTATE GS002). Locking the
-- quote makes revisions and withdrawing happen one after the other.
create function app.number_quote_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  withdrawn boolean;
begin
  if not app.can_enter_quotes(new.organization_id) then
    raise exception 'only traders and admins record quote revisions'
      using errcode = 'insufficient_privilege';
  end if;
  select q.withdrawn_at is not null into withdrawn
    from app.quotes q
   where q.id = new.quote_id and q.organization_id = new.organization_id
   for no key update;
  if withdrawn is null then
    raise exception 'no such quote' using errcode = 'foreign_key_violation';
  end if;
  if withdrawn then
    raise exception 'a withdrawn quote cannot be revised' using errcode = 'GS002';
  end if;
  select coalesce(max(r.revision_number), 0) + 1 into new.revision_number
    from app.quote_revisions r
   where r.quote_id = new.quote_id;
  return new;
end
$$;

create trigger quote_revisions_number
  before insert on app.quote_revisions
  for each row execute function app.number_quote_revision();

-- Revisions are history: nobody changes or deletes one, whatever their grants.
create function app.keep_quote_revisions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'quote revisions are never changed or deleted'
    using errcode = 'insufficient_privilege';
end
$$;

create trigger quote_revisions_immutable
  before update or delete on app.quote_revisions
  for each row execute function app.keep_quote_revisions();
create trigger quote_revisions_no_truncate
  before truncate on app.quote_revisions
  for each statement execute function app.keep_quote_revisions();

-- A quote is withdrawn once and stays withdrawn; nothing else about it changes.
create function app.keep_quote_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.withdrawn_at is not null
     or (new.organization_id, new.counterparty_id, new.facility_id, new.side,
         new.commodity_code, new.created_at, new.created_by)
        is distinct from
        (old.organization_id, old.counterparty_id, old.facility_id, old.side,
         old.commodity_code, old.created_at, old.created_by) then
    raise exception 'only withdrawing changes a quote, and only once'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger quotes_keep_identity
  before update on app.quotes
  for each row execute function app.keep_quote_identity();
create trigger quotes_touch_updated_at
  before update on app.quotes
  for each row execute function app.touch_updated_at();

create trigger quotes_audit
  after insert or update or delete on app.quotes
  for each row execute function app.record_audit_event();
create trigger quote_revisions_audit
  after insert or update or delete on app.quote_revisions
  for each row execute function app.record_audit_event();

alter table app.commodities enable row level security;
alter table app.quotes enable row level security;
alter table app.quote_revisions enable row level security;

create policy commodities_select_for_users on app.commodities
  for select to app_api using (app.current_user_id() is not null);

create policy quotes_select_for_members on app.quotes
  for select to app_api using (app.is_active_member(organization_id));
-- New quotes only for counterparties that are not archived.
create policy quotes_insert_for_traders on app.quotes
  for insert to app_api
  with check (
    app.can_enter_quotes(organization_id)
    and created_by = app.current_user_id()
    and withdrawn_at is null
    and exists (
      select 1 from app.counterparties c
       where c.id = counterparty_id and c.organization_id = quotes.organization_id
         and c.archived_at is null
    )
  );
create policy quotes_update_for_traders on app.quotes
  for update to app_api
  using (app.can_enter_quotes(organization_id))
  with check (app.can_enter_quotes(organization_id) and withdrawn_by = app.current_user_id());

create policy quote_revisions_select_for_members on app.quote_revisions
  for select to app_api using (app.is_active_member(organization_id));
create policy quote_revisions_insert_for_traders on app.quote_revisions
  for insert to app_api
  with check (app.can_enter_quotes(organization_id) and recorded_by = app.current_user_id());

-- Privileges: nothing for public or the Supabase API roles. app_api reads, enters quotes and
-- revisions, and withdraws quotes; it never updates or deletes a revision or deletes a quote.
revoke all on app.commodities, app.quotes, app.quote_revisions
  from public, anon, authenticated, service_role;
revoke all on function app.can_enter_quotes(uuid), app.number_quote_revision(),
  app.keep_quote_revisions(), app.keep_quote_identity()
  from public, anon, authenticated, service_role;
revoke all on function app.number_quote_revision(), app.keep_quote_revisions(),
  app.keep_quote_identity() from app_api;
grant select on app.commodities to app_api;
grant select, insert on app.quotes, app.quote_revisions to app_api;
grant update (withdrawn_at, withdrawn_by, withdrawn_by_name) on app.quotes to app_api;
grant execute on function app.can_enter_quotes(uuid) to app_api;
