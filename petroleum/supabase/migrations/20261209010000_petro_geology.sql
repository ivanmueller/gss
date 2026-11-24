-- Geology (F-287 part 1, docs/FEATURES_OIL_GAS.md; the owner, 2026-11-23: every formation, the
-- way "most robust and smartest"): two sets of the Alberta Geological Survey's, stored for a
-- well's panel and the map.
--
-- 1. Formation tops picked in wells, from the picks of its Geological Framework of Alberta,
--    Version 4 (the bulk download "Point data.zip"; the same model as petro.formation_cells).
--    About 1.26 million picks in 291,000 wells: too many for the space left under the guard, so
--    only the wells under a licence we hold and the three picked wells nearest each well we hold
--    (within 5 km) are kept, one row a well with its picks as lists (scripts/load-geology.js).
-- 2. Rock-Eval samples, Digital Dataset 2013-0003: Tmax, TOC, hydrogen index and the rest,
--    measured by laboratories on core and outcrop (3,472 lines, the laboratory's standards left
--    out). The Survey publishes no maturity map as data; these are what maturity is read from.
--
-- Open Government Licence – Alberta: acknowledgement of the Alberta Energy Regulator / Alberta
-- Geological Survey as the source is required. Loaded by the GitHub workflow "Load geology"
-- (.github/workflows/load-geology.yml) as the database's owner, each set replaced in one
-- transaction under the shared 400 MB size guard. The Worker only reads.

create table petro.geology_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  kind text not null check (kind in ('picks', 'samples')),
  source_url text not null check (
    source_url ~ '^https://(static\.ags\.aer\.ca|aercclrsuatagsgispub01\.blob\.core\.windows\.net)/'
  ),
  -- The file's Last-Modified date, when the server sent one.
  source_date date,
  -- Picks or samples loaded, and lines that could not be read.
  rows_loaded integer not null check (rows_loaded >= 0),
  skipped integer not null check (skipped >= 0)
);

-- The names the picks use: the formation's own name and the model's surface it marks.
create table petro.formation_pick_names (
  id smallint primary key check (id >= 1),
  -- As the Survey names the pick: "Duvernay Formation top".
  name text not null check (char_length(name) between 1 and 120),
  -- The model's surface: "68_D_Dv_Mu_top", its zone number first.
  surface text not null check (surface ~ '^[0-9]{2}[a-z]?_[A-Za-z0-9_ -]{1,60}$'),
  unique (name, surface)
);

create table petro.formation_pick_wells (
  -- A well event, as petro.st37_wells writes it: 00/01-05-037-05W5/0.
  uwi text primary key check (uwi ~ '^[0-9A-Z]{2}/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]/[0-9A-Z]$'),
  -- Zero-padded as in petro.st37_wells; empty when the Survey gives none.
  licence_number text not null check (licence_number ~ '^[0-9A-Z]{0,9}$'),
  -- Where the well's picks lie (their average: a deviated well's picks drift).
  longitude numeric(9, 6) not null check (longitude between -121 and -109),
  latitude numeric(8, 6) not null check (latitude between 48 and 61),
  kb_elevation_m numeric(7, 2),
  -- The picks, shallowest first, as three lists of one length: the name (formation_pick_names),
  -- the true vertical depth below the kelly bushing in metres, and the source (1 the Survey's own
  -- pick, 2 the AER's other picks, 0 unknown).
  names smallint[] not null,
  tvd_m numeric(6, 1)[] not null,
  sources smallint[] not null,
  check (cardinality(names) between 1 and 400),
  check (cardinality(tvd_m) = cardinality(names) and cardinality(sources) = cardinality(names)),
  check (array_ndims(names) = 1 and array_ndims(tvd_m) = 1 and array_ndims(sources) = 1),
  check (0 <= all (tvd_m) and 9000 >= all (tvd_m)),
  check (0 <= all (sources) and 2 >= all (sources))
);
create index formation_pick_wells_licence on petro.formation_pick_wells (licence_number);
create index formation_pick_wells_place on petro.formation_pick_wells (latitude, longitude);

create table petro.maturity_samples (
  -- The Survey's sample number, and which measurement of it: a few samples were measured by two
  -- laboratories under one number (59 on the file of 2013).
  sample_id integer not null check (sample_id > 0),
  run smallint not null check (run between 1 and 99),
  uwi text check (uwi ~ '^[0-9A-Z]{2}/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]/[0-9A-Z]$'),
  site text not null check (site in ('well', 'outcrop')),
  site_name text check (char_length(site_name) <= 120),
  longitude numeric(9, 6) not null check (longitude between -121 and -109),
  latitude numeric(8, 6) not null check (latitude between 48 and 61),
  -- In a well, the sample's depth below the kelly bushing (from the core's or the log's depth,
  -- feet converted); at an outcrop, its elevation above sea level.
  top_depth_m numeric(8, 2),
  base_depth_m numeric(8, 2),
  top_elevation_m numeric(8, 2),
  -- As the file names them: "Duvernay", "shale".
  unit text check (char_length(unit) <= 80),
  lithology text check (char_length(lithology) <= 80),
  sample_type text not null check (sample_type in ('core', 'outcrop', 'duplicate', 'combined', 're-run', 'cuttings')),
  collected_on date,
  lab text check (char_length(lab) <= 120),
  -- Rock-Eval, as measured: S1, S2, S3 in mg/g of rock; Tmax in °C; TOC in weight per cent;
  -- the hydrogen and oxygen indices in mg/g of TOC; the production index S1/(S1+S2). The
  -- Survey's own vitrinite reflectance calculated from Tmax, where it gives one.
  s1 numeric(10, 3),
  s2 numeric(10, 3),
  s3 numeric(10, 3),
  tmax_c numeric(5, 0) check (tmax_c between 0 and 999),
  toc_pct numeric(6, 3) check (toc_pct between 0 and 100),
  hydrogen_index numeric(7, 0),
  oxygen_index numeric(7, 0),
  production_index numeric(5, 3),
  ro_calc_pct numeric(5, 3),
  primary key (sample_id, run)
);
create index maturity_samples_uwi on petro.maturity_samples (uwi);

alter table petro.geology_loads enable row level security;
alter table petro.formation_pick_names enable row level security;
alter table petro.formation_pick_wells enable row level security;
alter table petro.maturity_samples enable row level security;

-- Members the Worker named read, as they read the wells (petro.st37_may_read).
create policy geology_loads_read on petro.geology_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy formation_pick_names_read on petro.formation_pick_names
  for select to petro_api using ((select petro.st37_may_read()));
create policy formation_pick_wells_read on petro.formation_pick_wells
  for select to petro_api using ((select petro.st37_may_read()));
create policy maturity_samples_read on petro.maturity_samples
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.geology_loads, petro.formation_pick_names, petro.formation_pick_wells,
  petro.maturity_samples
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.geology_loads, petro.formation_pick_names, petro.formation_pick_wells,
  petro.maturity_samples to petro_api;

create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 22
$$;
