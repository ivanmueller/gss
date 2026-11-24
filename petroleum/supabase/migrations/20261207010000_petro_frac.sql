-- Frac data (F-288, docs/FEATURES_OIL_GAS.md; the owner, 2026-11-23: "start F-288 frac data"):
-- every well event fractured in Alberta since 31 December 2012, one line each, from the AER's
-- Hydraulic Fracturing Summary Chemical and Water Use Data (Directive 059), read from
-- https://static.aer.ca/prd/documents/by-topic/hydraulic-fracturing/SummaryChemical-WaterUse.csv
-- (where the AER's page links it).
-- Kept: the fracs' dates, stages and water, and the proppant placed, which the C* of the
-- Modernized Royalty Framework needs (packages/domain/src/royalties.ts); the chemicals are not.
--
-- The AER's data, on the owner's decision for its lists (docs/DECISIONS.md, 2026-11-19): members
-- only, non-commercial, the AER named as the source, not shown as an official version. Loaded by
-- the GitHub workflow "Load frac data" (.github/workflows/load-frac.yml), by hand and once a
-- month, as the database's owner, replacing the whole copy in one transaction under the shared
-- 400 MB size guard. The Worker only reads: petro_api has select and nothing else.

-- Each load: when, the file's own date, and how many wells and lines it read.
create table petro.frac_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://(www|static)\.aer\.ca/'),
  -- The file's Last-Modified date, when the AER sent one.
  source_date date,
  wells integer not null check (wells >= 0),
  -- Lines the reader could not read (a wrong number of fields, a malformed UWI or date).
  skipped integer not null check (skipped >= 0)
);

create table petro.frac_wells (
  -- A well event, as petro.st37_wells writes it: 00/11-23-030-27W4/2.
  uwi text primary key check (uwi ~ '^[0-9A-Z]{2}/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]/[0-9A-Z]$'),
  licence_number text not null check (licence_number ~ '^[0-9A-Z]{0,9}$'),
  first_frac_date date not null,
  last_frac_date date not null check (last_frac_date >= first_frac_date),
  -- Reports (frac jobs) filed.
  fracs smallint not null check (fracs >= 1),
  -- Stages of the first completion (the fracs within a year of the first).
  stages integer check (stages >= 0),
  water_m3 numeric(14, 3) not null check (water_m3 >= 0),
  -- Proppant of the first completion, tonnes, as reported.
  proppant_t numeric(14, 3) not null check (proppant_t >= 0),
  -- Of it, tonnes whose trade name or ingredients suggest a coating or a ceramic (a hint only).
  upgrade_hint_t numeric(14, 3) not null check (upgrade_hint_t between 0 and proppant_t),
  -- Proppant of later fracs (re-fracs), tonnes.
  refrac_proppant_t numeric(14, 3) not null check (refrac_proppant_t >= 0),
  max_tvd_m numeric(8, 2) check (max_tvd_m >= 0),
  -- More than 1,000 t a stage: read as a reporting error and not used (SUSPECT_TONNES_PER_STAGE).
  suspect boolean not null
);

alter table petro.frac_loads enable row level security;
alter table petro.frac_wells enable row level security;

-- Members the Worker named read, as they read the wells (petro.st37_may_read).
create policy frac_loads_read on petro.frac_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy frac_wells_read on petro.frac_wells
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.frac_loads, petro.frac_wells
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.frac_loads, petro.frac_wells to petro_api;

-- The Worker's frac route needs this version (FRAC_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 20
$$;
