-- Each well's production, month by month (F-252 step 3, docs/FEATURES_OIL_GAS.md): oil, gas,
-- water and condensate volumes and the hours on production, from Petrinex's public Conventional
-- Volumetric Data files (one a month, the current production year and the four before it).
-- Used on the owner's decision (docs/DECISIONS.md, 2026-11-20): non-commercial, members only,
-- never exported, Crown copyright acknowledged. Loaded by hand by the "Load Petrinex production"
-- workflow for the wells of the formation loaded whole; members only read.
--
-- Units are Petrinex's own (its "Conventional Volumetric Data Download" description, read
-- 2026-11-20): "m3 for liquids, e3m3 for gas"; hours are "Hours of production or injection".
-- A null volume means the month's file had no production line of that product for the well.
--
-- No foreign key to petro.st37_wells: a load of the wells replaces them all in one transaction,
-- and the production of a well must outlive it.

create table petro.production_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://www\.petrinex\.gov\.ab\.ca/'),
  -- The formation whose wells were looked for, as the wells' load names it.
  formation text check (formation ~ '^[a-z][a-z_]{1,39}$'),
  first_month date not null,
  last_month date not null,
  -- How many monthly files answered, how many wells had a line in them, how many rows are kept.
  files integer not null check (files >= 0),
  wells integer not null check (wells >= 0),
  well_months integer not null check (well_months >= 0),
  check (first_month <= last_month),
  check (extract(day from first_month) = 1 and extract(day from last_month) = 1)
);

create table petro.well_production (
  -- The UWI as petro.st37_wells writes it: 00/11-23-030-27W4/2.
  uwi text not null check (uwi ~ '^[0-9A-Z]{2}/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]/[0-9A-Z]$'),
  -- The production month, as its first day.
  month date not null check (extract(day from month) = 1),
  oil_m3 numeric(13, 3) check (oil_m3 >= 0),
  gas_e3m3 numeric(13, 3) check (gas_e3m3 >= 0),
  water_m3 numeric(13, 3) check (water_m3 >= 0),
  condensate_m3 numeric(13, 3) check (condensate_m3 >= 0),
  -- The most hours any of its products reports for the month (a month has at most 744).
  hours smallint check (hours between 0 and 744),
  primary key (uwi, month)
);

alter table petro.production_loads enable row level security;
alter table petro.well_production enable row level security;

create policy production_loads_read on petro.production_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy well_production_read on petro.well_production
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.production_loads, petro.well_production
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.production_loads, petro.well_production to petro_api;

-- The Worker's production routes need this version (PRODUCTION_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 7
$$;
