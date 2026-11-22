-- The layers of the ground around the wells (F-261 part 2, docs/FEATURES_OIL_GAS.md; the owner,
-- 2026-11-22: the earth's layers at their real depths, under a well's 3D view). The Alberta
-- Geological Survey's Geological Framework of Alberta, Version 4, models the province's
-- subsurface as 90 zones, each with a grid of the elevation of its top and of its base. Kept
-- here on a lattice of about 1 km (a cell every 0.016 degrees of longitude and 0.009 of
-- latitude; packages/domain/src/formationZones.ts) for the ground within 10 km of a well: each
-- cell holds the model's own value at its centre for every zone, nothing averaged.
--
-- Open data: the Survey's material is under the Open Government Licence - Alberta, the Survey
-- to be acknowledged (docs/DECISIONS.md, 2026-11-22). Written by the manual "Load formation
-- layers" workflow, which connects as the database's owner and replaces the whole copy in one
-- transaction under the shared 400 MB size guard. The Worker only reads: petro_api has select
-- and nothing else, and no job writes here.

-- Each load: when, from which file, and what it kept.
create table petro.formation_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://[a-z0-9.-]+/'),
  -- The file's own date (its Last-Modified header), when the server sent one.
  source_date date,
  -- The model as its site names it: "Geological Framework of Alberta, Version 4".
  model text not null check (char_length(model) between 1 and 100),
  lon_step numeric(7, 5) not null check (lon_step > 0),
  lat_step numeric(7, 5) not null check (lat_step > 0),
  cells integer not null check (cells >= 0)
);

create table petro.formation_cells (
  -- The lattice cell: centred on (cell_x * lon_step, cell_y * lat_step).
  cell_x integer not null,
  cell_y integer not null,
  -- Metres above sea level of each zone's top and base, zone 1 (the surface) first, zone 90
  -- (the Precambrian) last; null where the zone is absent under the cell.
  tops smallint[] not null check (array_ndims(tops) = 1 and array_length(tops, 1) = 90),
  bases smallint[] not null check (array_ndims(bases) = 1 and array_length(bases, 1) = 90),
  primary key (cell_y, cell_x)
);

alter table petro.formation_loads enable row level security;
alter table petro.formation_cells enable row level security;

-- Members read, as they read the wells (petro.st37_may_read()).
create policy formation_loads_read on petro.formation_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy formation_cells_read on petro.formation_cells
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.formation_loads, petro.formation_cells
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.formation_loads, petro.formation_cells to petro_api;

-- The Worker's layers route needs this version (FORMATION_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 13
$$;
