-- Counterparty directory (GT-015 schema, GT-020 create), MASTER_PROJECT_SPECIFICATION.md
-- sections 2.1, 5.1, 6 and 9: counterparties with an optional PNG logo, their contacts
-- and facilities, and the import batches that created them.
--
-- Access for app_api: every active member of an organization reads its directory;
-- operations and org_admin members create records (section 2.1 "Edit counterparties").
-- Records are not updated or deleted through the API yet, except that a logo can be
-- replaced. Every change is audited (20261027030000_audit_events.sql).

create extension if not exists postgis with schema extensions;

-- Shared value rules. Text is trimmed, non-empty and free of control characters.
create domain app.label as text
  check (value = btrim(value) and length(value) between 1 and 200 and value !~ '[[:cntrl:]]');
create domain app.note as text
  check (value = btrim(value) and length(value) between 1 and 2000);
-- ISO 3166-1 alpha-2, e.g. CA, US.
create domain app.country_code as text check (value ~ '^[A-Z]{2}$');
-- Province, state or territory code, e.g. SK, MN.
create domain app.region_code as text check (value ~ '^[A-Z0-9]{1,3}$');

create type app.counterparty_type as enum ('buyer', 'seller', 'broker', 'carrier');
create type app.verification_status as enum ('unverified', 'pending', 'verified');
create type app.facility_type as enum (
  'elevator', 'terminal', 'processor', 'feed_mill', 'port', 'farm', 'warehouse', 'office', 'other'
);
create type app.location_precision as enum ('exact', 'approximate');
create type app.record_source as enum ('manual', 'file_import');

-- True when the current user is an active member of an active organization with one
-- of the given roles. SECURITY DEFINER for the same reason as app.is_active_member.
create function app.has_role(org uuid, roles app.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.organization_members m
    join app.organizations o on o.id = m.organization_id
    where m.organization_id = org
      and m.user_id = app.current_user_id()
      and m.status = 'active'
      and m.role = any (roles)
      and o.active
  )
$$;

-- Roles allowed to create directory records.
create function app.can_edit_directory(org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_role(org, array['operations', 'org_admin']::app.member_role[])
$$;

create table app.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  kind text not null check (kind = 'counterparties'),
  file_name app.label not null,
  -- SHA-256 of the validated rows, so the same content cannot be imported twice.
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count >= 0),
  created_count integer not null check (created_count >= 0),
  skipped_count integer not null check (skipped_count >= 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  unique (organization_id, id),
  unique (organization_id, kind, content_sha256)
);

create table app.counterparties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  legal_name app.label not null,
  trading_name app.label,
  types app.counterparty_type[] not null default array['buyer']::app.counterparty_type[]
    check (cardinality(types) between 1 and 4 and array_position(types, null) is null),
  primary_country app.country_code not null,
  verification_status app.verification_status not null default 'unverified',
  notes app.note,
  source app.record_source not null,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  unique (organization_id, id),
  foreign key (organization_id, import_batch_id) references app.import_batches (organization_id, id),
  check ((source = 'file_import') = (import_batch_id is not null))
);

-- One counterparty per legal name and country in an organization, ignoring case.
create unique index counterparties_name_unique
  on app.counterparties (organization_id, primary_country, lower(legal_name));

create table app.counterparty_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  counterparty_id uuid not null,
  name app.label not null,
  -- Job title or function, e.g. "Grain merchandiser".
  role app.label,
  email text check (
    length(email) <= 254 and email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
  ),
  phone text check (length(phone) between 3 and 40 and phone ~ '^[0-9+(). /x-]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  -- The tenant-matching key: a contact belongs to a counterparty of its own organization.
  foreign key (organization_id, counterparty_id) references app.counterparties (organization_id, id)
);

create index counterparty_contacts_counterparty_idx on app.counterparty_contacts (counterparty_id);

create table app.facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  counterparty_id uuid not null,
  name app.label,
  facility_type app.facility_type,
  address_line text check (address_line = btrim(address_line) and length(address_line) between 1 and 300),
  city app.label,
  region app.region_code,
  postal_code text check (postal_code ~ '^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$'),
  country app.country_code not null,
  -- WGS84. Entered as latitude and longitude; location is derived for spatial queries.
  latitude numeric(8, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  location extensions.geography(Point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(longitude::float8, latitude::float8), 4326)::extensions.geography
  ) stored,
  -- Exact site, or an approximate point such as the town centre (section 6, location governance).
  location_precision app.location_precision,
  geocoding_source app.label,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  foreign key (organization_id, counterparty_id) references app.counterparties (organization_id, id),
  check ((latitude is null) = (longitude is null)),
  check ((latitude is null) = (location_precision is null)),
  check (latitude is not null or geocoding_source is null)
);

create index facilities_counterparty_idx on app.facilities (counterparty_id);
create index facilities_location_idx on app.facilities using gist (location);

-- PNG only, at most 512 KB, checked by the PNG file signature. The API also checks the
-- image header and serves logos as image/png with nosniff.
create table app.counterparty_logos (
  counterparty_id uuid primary key,
  organization_id uuid not null,
  data bytea not null check (
    octet_length(data) between 33 and 524288
    and substring(data from 1 for 8) = '\x89504e470d0a1a0a'::bytea
  ),
  sha256 text generated always as (encode(sha256(data), 'hex')) stored,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users (id),
  foreign key (organization_id, counterparty_id) references app.counterparties (organization_id, id)
);

create trigger counterparties_touch_updated_at
  before update on app.counterparties
  for each row execute function app.touch_updated_at();
create trigger counterparty_contacts_touch_updated_at
  before update on app.counterparty_contacts
  for each row execute function app.touch_updated_at();
create trigger facilities_touch_updated_at
  before update on app.facilities
  for each row execute function app.touch_updated_at();
create trigger counterparty_logos_touch_updated_at
  before update on app.counterparty_logos
  for each row execute function app.touch_updated_at();

create trigger import_batches_audit
  after insert or update or delete on app.import_batches
  for each row execute function app.record_audit_event();
create trigger counterparties_audit
  after insert or update or delete on app.counterparties
  for each row execute function app.record_audit_event();
create trigger counterparty_contacts_audit
  after insert or update or delete on app.counterparty_contacts
  for each row execute function app.record_audit_event();
create trigger facilities_audit
  after insert or update or delete on app.facilities
  for each row execute function app.record_audit_event();
create trigger counterparty_logos_audit
  after insert or update or delete on app.counterparty_logos
  for each row execute function app.record_audit_event();

alter table app.import_batches enable row level security;
alter table app.counterparties enable row level security;
alter table app.counterparty_contacts enable row level security;
alter table app.facilities enable row level security;
alter table app.counterparty_logos enable row level security;

create policy import_batches_select_for_members on app.import_batches
  for select to app_api using (app.is_active_member(organization_id));
create policy import_batches_insert_for_editors on app.import_batches
  for insert to app_api
  with check (app.can_edit_directory(organization_id) and created_by = app.current_user_id());

create policy counterparties_select_for_members on app.counterparties
  for select to app_api using (app.is_active_member(organization_id));
create policy counterparties_insert_for_editors on app.counterparties
  for insert to app_api
  with check (app.can_edit_directory(organization_id) and created_by = app.current_user_id());

create policy counterparty_contacts_select_for_members on app.counterparty_contacts
  for select to app_api using (app.is_active_member(organization_id));
create policy counterparty_contacts_insert_for_editors on app.counterparty_contacts
  for insert to app_api
  with check (app.can_edit_directory(organization_id) and created_by = app.current_user_id());

create policy facilities_select_for_members on app.facilities
  for select to app_api using (app.is_active_member(organization_id));
create policy facilities_insert_for_editors on app.facilities
  for insert to app_api
  with check (app.can_edit_directory(organization_id) and created_by = app.current_user_id());

create policy counterparty_logos_select_for_members on app.counterparty_logos
  for select to app_api using (app.is_active_member(organization_id));
create policy counterparty_logos_insert_for_editors on app.counterparty_logos
  for insert to app_api
  with check (app.can_edit_directory(organization_id) and updated_by = app.current_user_id());
create policy counterparty_logos_update_for_editors on app.counterparty_logos
  for update to app_api
  using (app.can_edit_directory(organization_id))
  with check (app.can_edit_directory(organization_id) and updated_by = app.current_user_id());

-- Privileges: nothing for public or the Supabase API roles; app_api gets reads, inserts
-- and replacing a logo's image, nothing else.
revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all functions in schema app from public, anon, authenticated, service_role;
grant select, insert on app.import_batches, app.counterparties, app.counterparty_contacts,
  app.facilities to app_api;
grant select, insert on app.counterparty_logos to app_api;
grant update (data, updated_by) on app.counterparty_logos to app_api;
grant execute on function app.has_role(uuid, app.member_role[]), app.can_edit_directory(uuid) to app_api;
