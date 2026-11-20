-- Alberta's wells from the AER's ST37 list (F-243 part 4, docs/FEATURES_OIL_GAS.md): each well
-- (one row per UWI, so every leg of a multi-leg well), its status, licensee, depths, surface and
-- bottom-hole locations, and its surveyed drilled path. Used on the owner's decision
-- (docs/DECISIONS.md, 2026-11-19): members only, never exported, the AER named as the source.
--
-- Loaded by hand, area by area, by the manual GitHub workflow "Load ST37 wells"
-- (.github/workflows/load-st37.yml), which connects as the database's owner (as migrations do)
-- and replaces the whole copy in one transaction under the shared 400 MB size guard. The Worker
-- only reads: petro_api has select and nothing else, and no job writes here.

-- Who may read the ST37 wells: a member the Worker named.
create function petro.st37_may_read()
returns boolean
language sql
stable
set search_path = ''
as $$
  select petro.current_user_id() is not null
     and petro.current_organization_id() is not null
     and petro.current_member_role() is not null
$$;

-- Each load: when, from which file, over which area, and how many wells it kept.
create table petro.st37_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://[a-z.]*aer\.ca/'),
  -- The file's own date (its Last-Modified header), when the AER sent one.
  source_date date,
  west numeric(9, 6) not null,
  south numeric(8, 6) not null,
  east numeric(9, 6) not null,
  north numeric(8, 6) not null,
  wells integer not null check (wells >= 0),
  check (west < east and south < north)
);

create table petro.st37_wells (
  -- The UWI as the AER labels it, with its event: 00/11-23-030-27W4/2.
  uwi text primary key check (uwi ~ '^[0-9A-Z]{2}/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]/[0-9A-Z]$'),
  licence_number text not null check (licence_number ~ '^[0-9A-Z]{1,9}$'),
  well_name text check (char_length(well_name) <= 60),
  licensee text check (char_length(licensee) <= 100),
  licence_status text check (char_length(licence_status) <= 20),
  -- What the map colours by, decided by the loader from the codes below
  -- (packages/domain/src/st37.ts).
  status_class text not null check (status_class in (
    'producing', 'awaiting', 'drilling', 'inactive', 'suspended', 'abandoned', 'licensed')),
  -- The AER's own status: fluid and type in words, mode as its two-digit code.
  status_fluid text check (char_length(status_fluid) <= 60),
  status_mode text check (status_mode ~ '^[0-9]{2}$'),
  status_type text check (char_length(status_type) <= 60),
  pool_code integer,
  spud_date date,
  final_drill_date date,
  total_depth_m numeric(8, 2) check (total_depth_m >= 0),
  true_vertical_depth_m numeric(8, 2) check (true_vertical_depth_m >= 0),
  surface_longitude numeric(9, 6) not null,
  surface_latitude numeric(8, 6) not null,
  bottom_longitude numeric(9, 6) not null,
  bottom_latitude numeric(8, 6) not null,
  -- The drilled path, simplified to about a metre, as [[longitude, latitude], ...] from the
  -- surface down; null for a well that runs less than 20 m sideways (drawn as a dot).
  path jsonb check (path is null or (jsonb_typeof(path) = 'array' and jsonb_array_length(path) >= 2)),
  check (surface_longitude between -120.1 and -109.9 and surface_latitude between 48.9 and 60.1),
  check (bottom_longitude between -120.1 and -109.9 and bottom_latitude between 48.9 and 60.1)
);
-- The map asks for the wells in its view.
create index st37_wells_by_place on petro.st37_wells (surface_longitude, surface_latitude);

alter table petro.st37_loads enable row level security;
alter table petro.st37_wells enable row level security;

create policy st37_loads_read on petro.st37_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy st37_wells_read on petro.st37_wells
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.st37_loads, petro.st37_wells
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.st37_loads, petro.st37_wells to petro_api;

revoke all on function petro.st37_may_read()
  from public, anon, authenticated, service_role, petro_api;
grant execute on function petro.st37_may_read() to petro_api;

-- The Worker's ST37 route needs this version (ST37_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 5
$$;
