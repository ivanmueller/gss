-- Facilities (F-278, docs/FEATURES_OIL_GAS.md; the owner, 2026-11-22: "We need the facilities,
-- so these are your facilities, your batteries, and all the other types of facilities"; the
-- Duvernay's box first): the Alberta Energy Regulator's ST102 facility list, from its shapefile
-- (https://static.aer.ca/prd/data/codes/ST102-SHP.zip), for one area at a time. Each facility's
-- ID, name, type, operator and licensee (with their business associate codes), licence, status,
-- and where its point comes from: a well licence, a facility licence, or the centre of a legal
-- subdivision or section, so many points are a square's centre and not the facility's spot.
--
-- The AER's data, on the conditions recorded for its ST37 list (docs/DECISIONS.md, 2026-11-19:
-- members only, nothing exported); the file's own note allows use "to select and process data
-- for internal or client use", and no copying of a whole file for resale.
--
-- Loaded by hand by the manual GitHub workflow "Load facilities"
-- (.github/workflows/load-facilities.yml), which connects as the database's owner and replaces
-- the whole copy in one transaction under the shared 400 MB size guard. The Worker only reads:
-- petro_api has select and nothing else.

-- Each load: when, from which file (and the file's own date), over which area, and how many.
create table petro.facility_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://static\.aer\.ca/'),
  -- The file's Last-Modified, as the AER's server gave it.
  file_date date,
  west numeric(9, 6) not null,
  south numeric(8, 6) not null,
  east numeric(9, 6) not null,
  north numeric(8, 6) not null,
  facilities integer not null check (facilities >= 0),
  check (west < east and south < north)
);

create table petro.facilities (
  -- The AER's facility ID: AB, two letters for its kind (BT battery, GP gas plant ...), seven
  -- digits.
  facility_id text primary key check (facility_id ~ '^AB[A-Z]{2}[0-9]{7}$'),
  name text check (char_length(name) <= 60),
  -- Business associate codes, as the AER writes them.
  operator_code text check (operator_code ~ '^[0-9A-Z]{4}$'),
  operator text check (char_length(operator) <= 60),
  -- The facility's subtype: its code (311 crude oil single-well battery ...) and its name.
  sub_code smallint check (sub_code between 100 and 999),
  sub_type text check (char_length(sub_type) <= 100),
  licence_number text check (licence_number ~ '^[0-9A-Z]{1,9}$'),
  -- W a well licence, F a facility licence.
  licence_type text check (licence_type in ('W', 'F')),
  licensee_code text check (licensee_code ~ '^[0-9A-Z]{4}$'),
  licensee text check (char_length(licensee) <= 60),
  -- Active, New, Suspended, Abandoned ... as the AER writes them.
  status text check (char_length(status) <= 20),
  location_source text
    check (location_source in ('Well Licence', 'Facility Licence', 'LSD Centre', 'Section Centre')),
  longitude numeric(9, 6) not null check (longitude between -120.1 and -109.9),
  latitude numeric(8, 6) not null check (latitude between 48.9 and 60.1)
);

alter table petro.facility_loads enable row level security;
alter table petro.facilities enable row level security;

-- Members the Worker named read, as they read the wells (petro.st37_may_read).
create policy facility_loads_read on petro.facility_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy facilities_read on petro.facilities
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.facility_loads, petro.facilities
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.facility_loads, petro.facilities to petro_api;

-- The Worker's facilities route needs this version (FACILITIES_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 15
$$;
