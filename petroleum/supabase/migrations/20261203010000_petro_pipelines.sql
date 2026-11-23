-- Pipelines (F-249, docs/FEATURES_OIL_GAS.md; the owner, 2026-11-22: "We need the pipeline data,
-- so the pipelines and who owns them"; every status, with filters; the Duvernay's box first):
-- the Alberta Energy Regulator's pipeline file, from its shapefile
-- (https://static.aer.ca/prd/data/pipeline/Pipelines_SHP.zip; layout
-- https://static.aer.ca/prd/data/pipeline/EnhancedPipeline_Layout.pdf), for one area at a time.
-- Each segment's licence and line number, licensee (with its business associate code), status,
-- substances, the facilities and land locations it runs from and to, its pipe (outside diameter,
-- wall thickness, material, type, grade, maximum operating pressure), H2S content, field centre,
-- dates, and its line thinned to about 3 m.
--
-- On a local load of the Duvernay's box (2026-11-22, the AER's file of that day): 182,974
-- segments.
--
-- The AER's data, on the conditions recorded for its ST37 list (docs/DECISIONS.md, 2026-11-19:
-- members only, nothing exported); the file's own note allows use "to select and process data
-- for internal or client use", and no copying of a whole file for resale.
--
-- Loaded by hand by the manual GitHub workflow "Load pipelines"
-- (.github/workflows/load-pipelines.yml), which connects as the database's owner and replaces
-- the whole copy in one transaction under the shared 400 MB size guard. The Worker only reads:
-- petro_api has select and nothing else.

create table petro.pipeline_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://static\.aer\.ca/'),
  -- The file's Last-Modified, as the AER's server gave it.
  file_date date,
  west numeric(9, 6) not null,
  south numeric(8, 6) not null,
  east numeric(9, 6) not null,
  north numeric(8, 6) not null,
  segments integer not null check (segments >= 0),
  check (west < east and south < north)
);

create table petro.pipelines (
  id bigint generated always as identity primary key,
  -- The AER's own key for a segment (Pipeline_Licence_Segment_Id); a few repeat in the file.
  segment_id text check (segment_id ~ '^[0-9]{1,12}$'),
  licence_number text not null check (licence_number ~ '^[0-9A-Z]{1,9}$'),
  line_number text check (line_number ~ '^[0-9A-Z]{1,10}$'),
  -- In the National Energy Board's 80000 series, as the AER marks it.
  federal boolean not null default false,
  licensee_code text check (licensee_code ~ '^[0-9A-Z]{4}$'),
  licensee text check (char_length(licensee) <= 60),
  -- Operating, Permitted, Discontinued, Abandoned, Removed, as the AER writes them.
  status text check (char_length(status) <= 20),
  -- Up to three, the first the one the AER ranks highest.
  substances text[] not null default '{}' check (cardinality(substances) <= 3),
  from_facility text check (char_length(from_facility) <= 30),
  from_location text check (char_length(from_location) <= 25),
  to_facility text check (char_length(to_facility) <= 30),
  to_location text check (char_length(to_location) <= 25),
  length_km numeric(10, 3) check (length_km >= 0),
  diameter_mm numeric(8, 2) check (diameter_mm >= 0),
  wall_mm numeric(7, 3) check (wall_mm >= 0),
  material text check (char_length(material) <= 40),
  pipe_type text check (char_length(pipe_type) <= 30),
  pipe_grade text check (char_length(pipe_grade) <= 40),
  -- As the AER lists them: its layout names no unit for either.
  max_pressure numeric(12, 2) check (max_pressure >= 0),
  h2s numeric(12, 3) check (h2s >= 0),
  field_centre text check (char_length(field_centre) <= 40),
  licence_approved date,
  last_occurrence_year smallint check (last_occurrence_year between 1900 and 2100),
  geometry_source text check (char_length(geometry_source) <= 50),
  bounds box not null,
  -- The line, thinned to about 3 m: its points as longitude, latitude, longitude, latitude ...
  -- in hundred-thousandths of a degree (about a metre), whole numbers to keep the table small
  -- (as JSON it took three times the room on a local load, 2026-11-22). `breaks` lists the
  -- points where a new part starts, empty for a line of one part.
  path integer[] not null
    check (array_ndims(path) = 1 and cardinality(path) >= 4 and cardinality(path) % 2 = 0),
  breaks integer[] not null default '{}'
    check (cardinality(breaks) = 0 or array_ndims(breaks) = 1)
);
-- The map asks for the lines that touch a square.
create index pipelines_by_place on petro.pipelines using gist (bounds);

alter table petro.pipeline_loads enable row level security;
alter table petro.pipelines enable row level security;

-- Members the Worker named read, as they read the wells (petro.st37_may_read).
create policy pipeline_loads_read on petro.pipeline_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy pipelines_read on petro.pipelines
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.pipeline_loads, petro.pipelines
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.pipeline_loads, petro.pipelines to petro_api;

-- The Worker's pipelines routes need this version (PIPELINES_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 16
$$;
