-- Land held today (F-241, docs/FEATURES_OIL_GAS.md): the province's Crown petroleum and natural
-- gas and oil sands agreements, its active offset notices, and the land whose petroleum and
-- natural gas is not the Crown's (freehold, national parks, reserves), copied from the
-- Government of Alberta's public map services for one area at a time (the Duvernay's wells
-- first; the owner, 2026-11-21).
--
-- Agreements and non-Crown minerals: Alberta Energy and Minerals, under the Open Government
-- Licence - Alberta, which asks that the department be named as the source (each service's own
-- metadata, read 2026-11-21). Offset notices: the department's Geoview map service, which states
-- no terms of its own (docs/DECISIONS.md, 2026-11-21).
--
-- Loaded by hand by the manual GitHub workflow "Load land" (.github/workflows/load-land.yml),
-- which connects as the database's owner (as migrations do) and replaces the whole copy in one
-- transaction under the shared 400 MB size guard. The Worker only reads: petro_api has select
-- and nothing else.
--
-- A shape is kept as the coordinates of a GeoJSON MultiPolygon, [[[[longitude, latitude], ...]]],
-- to about a metre; `bounds` is the box around it, which the map's requests are answered by.

-- Each load of each layer: when, from which service, over which area, and how many shapes.
create table petro.land_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  layer text not null check (layer in (
    'png_agreements', 'oil_sands_agreements', 'offset_notices', 'freehold')),
  source_url text not null
    check (source_url ~ '^https://(geospatial\.alberta\.ca|gis\.energy\.gov\.ab\.ca)/'),
  west numeric(9, 6) not null,
  south numeric(8, 6) not null,
  east numeric(9, 6) not null,
  north numeric(8, 6) not null,
  shapes integer not null check (shapes >= 0),
  check (west < east and south < north)
);

-- One row per tract of a Crown agreement.
create table petro.land_agreements (
  id bigint generated always as identity primary key,
  rights text not null check (rights in ('png', 'oil_sands')),
  -- The province's own numbers: the agreement's type (002, P05 ...), its number and its tract.
  agreement_type text not null check (agreement_type ~ '^[0-9A-Z]{1,3}$'),
  agreement_number text not null check (agreement_number ~ '^[0-9A-Z]{1,10}$'),
  tract text check (char_length(tract) <= 2),
  mineral_type text check (char_length(mineral_type) <= 10),
  -- LEASE, LICENSE, OTHER, as the province writes them.
  agreement_group text check (char_length(agreement_group) <= 10),
  status text check (char_length(status) <= 255),
  vintage text check (char_length(vintage) <= 50),
  -- The designated representative, and every party with its share, as the province writes them.
  holder text check (char_length(holder) <= 150),
  parties text check (char_length(parties) <= 1730),
  zone text check (char_length(zone) <= 1000),
  original_area_ha numeric(12, 4) check (original_area_ha >= 0),
  area_ha numeric(12, 4) check (area_ha >= 0),
  term_date date,
  continuation_date date,
  -- A date or a word such as INDEFINITE, as published.
  expiry_text text check (char_length(expiry_text) <= 4000),
  bounds box not null,
  shape jsonb not null check (jsonb_typeof(shape) = 'array' and jsonb_array_length(shape) >= 1)
);
create index land_agreements_by_place on petro.land_agreements using gist (bounds);
create index land_agreements_by_number on petro.land_agreements (agreement_type, agreement_number);

-- One row per tract of an active offset notice.
create table petro.land_offsets (
  id bigint generated always as identity primary key,
  offset_type text check (char_length(offset_type) <= 10),
  offset_number text not null check (offset_number ~ '^[0-9A-Z]{1,20}$'),
  tract text check (char_length(tract) <= 2),
  holder text check (char_length(holder) <= 150),
  expiry_date date,
  zone text check (char_length(zone) <= 1000),
  bounds box not null,
  shape jsonb not null check (jsonb_typeof(shape) = 'array' and jsonb_array_length(shape) >= 1)
);
create index land_offsets_by_place on petro.land_offsets using gist (bounds);

-- One row per piece of land whose petroleum and natural gas is not the Crown's. The province
-- names no owner: only which substances, and the national park or reserve when it is one.
create table petro.land_freehold (
  id bigint generated always as identity primary key,
  land_key bigint,
  substances text check (char_length(substances) <= 245),
  national_park text check (char_length(national_park) <= 60),
  reserve_number text check (char_length(reserve_number) <= 20),
  reserve_name text check (char_length(reserve_name) <= 75),
  bounds box not null,
  shape jsonb not null check (jsonb_typeof(shape) = 'array' and jsonb_array_length(shape) >= 1)
);
create index land_freehold_by_place on petro.land_freehold using gist (bounds);

alter table petro.land_loads enable row level security;
alter table petro.land_agreements enable row level security;
alter table petro.land_offsets enable row level security;
alter table petro.land_freehold enable row level security;

-- Members the Worker named read, as they read the wells (petro.st37_may_read).
create policy land_loads_read on petro.land_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy land_agreements_read on petro.land_agreements
  for select to petro_api using ((select petro.st37_may_read()));
create policy land_offsets_read on petro.land_offsets
  for select to petro_api using ((select petro.st37_may_read()));
create policy land_freehold_read on petro.land_freehold
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.land_loads, petro.land_agreements, petro.land_offsets, petro.land_freehold
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.land_loads, petro.land_agreements, petro.land_offsets, petro.land_freehold
  to petro_api;

-- The Worker's land route needs this version (LAND_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 9
$$;
