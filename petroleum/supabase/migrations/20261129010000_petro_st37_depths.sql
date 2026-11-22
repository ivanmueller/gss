-- The ST37 wells' paths with their depth (F-261, docs/FEATURES_OIL_GAS.md; the owner,
-- 2026-11-22: a well under the ground in 3D, on its panel). The AER's layer of drilled paths is
-- three-dimensional: every point has an elevation in metres above sea level, from the kelly
-- bushing down. Kept beside the flat path the map draws (20261122010000_petro_st37_wells.sql),
-- with whether the path was surveyed or worked out by the AER, and the kelly bushing's and the
-- ground's elevation. Same source and terms as the rest of the copy (docs/DECISIONS.md,
-- 2026-11-19): members only, never exported.
--
-- Written by the manual "Load ST37 wells" workflow, as the rest of the copy; the Worker only
-- reads (petro_api keeps select and nothing else). The columns are empty until that workflow
-- has run once more.

alter table petro.st37_wells
  -- [[longitude, latitude, metres above sea level], ...] from the surface down, kept to within
  -- 2 m; also for a vertical well (whose flat `path` is null).
  add column path_3d jsonb
    check (path_3d is null
           or (jsonb_typeof(path_3d) = 'array' and jsonb_array_length(path_3d) >= 2)),
  -- True for a path the AER marks Surveyed, false for Calculated, null when it says neither.
  add column path_surveyed boolean,
  add column kb_elevation_m numeric(6, 1)
    check (kb_elevation_m between -9000 and 4000),
  add column ground_elevation_m numeric(6, 1)
    check (ground_elevation_m between -9000 and 4000);

-- A well's panel asks for every leg under its licence.
create index st37_wells_by_licence on petro.st37_wells (licence_number);

-- The Worker's 3D route needs this version (ST37_3D_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 12
$$;
