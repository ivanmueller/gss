-- Several plays side by side, and the names of fields and pools (F-256,
-- docs/FEATURES_OIL_GAS.md; the owner, 2026-11-20: field and pool names wanted, and a structure
-- that holds when other plays are added).
--
-- Until now a load of the wells replaced every well: one play at a time. Each well now carries
-- the play it was loaded for (`formation`, the loader's key such as 'duvernay'; null for a
-- rectangle), and a load replaces only that play's wells. A well stays one row (its UWI): a well
-- picked by two plays belongs to the one loaded first.
--
-- Each well also keeps its field code (ST37's production strings carry it beside the pool code).
-- A pool code alone names no pool: "Duvernay A" has the same code in every field, so a pool is a
-- field code and a pool code together. Their names come from the AER's ST103 field and pool
-- list, loaded whole by the same workflow, on the AER's terms (docs/DECISIONS.md, 2026-11-19).

alter table petro.st37_wells
  add column field_code integer check (field_code >= 0),
  add column formation text check (formation ~ '^[a-z][a-z_]{1,39}$');

-- The wells already loaded are those of the latest load.
update petro.st37_wells
set formation = (select l.formation from petro.st37_loads l order by l.id desc limit 1);

create index st37_wells_by_formation on petro.st37_wells (formation);

create table petro.fields (
  field_code integer primary key check (field_code >= 0),
  -- As the AER writes it: KAYBOB SOUTH.
  name text not null check (char_length(name) between 1 and 60)
);

create table petro.pools (
  field_code integer not null references petro.fields (field_code) on delete cascade,
  pool_code integer not null check (pool_code >= 0),
  -- As the AER writes it: DUVERNAY A.
  name text not null check (char_length(name) between 1 and 60),
  primary key (field_code, pool_code)
);

create table petro.field_pool_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://[a-z.]*aer\.ca/'),
  -- The file's own date (its Last-Modified header), when the AER sent one.
  source_date date,
  fields integer not null check (fields >= 0),
  pools integer not null check (pools >= 0)
);

alter table petro.fields enable row level security;
alter table petro.pools enable row level security;
alter table petro.field_pool_loads enable row level security;

create policy fields_read on petro.fields
  for select to petro_api using ((select petro.st37_may_read()));
create policy pools_read on petro.pools
  for select to petro_api using ((select petro.st37_may_read()));
create policy field_pool_loads_read on petro.field_pool_loads
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.fields, petro.pools, petro.field_pool_loads
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.fields, petro.pools, petro.field_pool_loads to petro_api;

-- The Worker's wells and production routes need this version (ST37_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 8
$$;
