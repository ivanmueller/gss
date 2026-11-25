-- Water and gas injected into each well, month by month (F-300 part 1, docs/FEATURES_OIL_GAS.md):
-- the injection lines (activity INJ) of Petrinex's public Conventional Volumetric Data, the files
-- "Load Petrinex production" already reads, kept for the wells of a waterflood pool only (the
-- Stettler D-2 A pool first; the owner, 2026-11-25: not the Duvernay's yet). Used on the owner's
-- decision (docs/DECISIONS.md, 2026-11-20): non-commercial, members only, never exported, Crown
-- copyright acknowledged. Replaced with the production, in the same transaction.
--
-- Units are Petrinex's own: m3 for water (WATER, fresh FSHWTR and brackish BRKWTR added
-- together), e3m3 for gas; hours are "Hours of production or injection". A null volume means
-- the month's file had no injection line of that fluid for the well.
--
-- No foreign key to petro.st37_wells, as for the production: a load of the wells replaces them.

create table petro.well_injection (
  -- The UWI as petro.st37_wells writes it: 00/11-23-030-27W4/2.
  uwi text not null check (uwi ~ '^[0-9A-Z]{2}/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]/[0-9A-Z]$'),
  -- The month, as its first day.
  month date not null check (extract(day from month) = 1),
  water_m3 numeric(13, 3) check (water_m3 >= 0),
  gas_e3m3 numeric(13, 3) check (gas_e3m3 >= 0),
  hours smallint check (hours between 0 and 744),
  primary key (uwi, month),
  check (water_m3 is not null or gas_e3m3 is not null)
);

-- How many wells and well-months of injection each load kept (null before F-300).
alter table petro.production_loads
  add column injection_wells integer check (injection_wells >= 0),
  add column injection_well_months integer check (injection_well_months >= 0);

alter table petro.well_injection enable row level security;

create policy well_injection_read on petro.well_injection
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.well_injection from public, anon, authenticated, service_role, petro_api;
grant select on petro.well_injection to petro_api;

-- The Worker's production routes read the injection from this version (PRODUCTION_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 25
$$;
