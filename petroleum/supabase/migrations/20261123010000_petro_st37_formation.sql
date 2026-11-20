-- One formation loaded whole, and licensed wells as planned lines (F-252 step 2 and F-243 part
-- 4b, docs/FEATURES_OIL_GAS.md). The "Load ST37 wells" workflow can now load every well of one
-- formation (the Duvernay first) instead of a rectangle: wells in the formation's pools (the
-- AER's pool codes) and licences aimed at it (Petrinex's public Well Licence file, used on the
-- owner's decision, docs/DECISIONS.md 2026-11-20: non-commercial, members only, never exported,
-- Crown copyright acknowledged).
--
-- New on a well: what its licence planned (from Petrinex), and, for a well with no drilled path
-- yet, the planned bottom hole: the legal subdivision in its own UWI, placed from the province's
-- township grid by the loader. The map draws a dashed straight line to it.

alter table petro.st37_loads
  -- The formation loaded whole, as the loader names it ('duvernay'); null for a rectangle.
  add column formation text check (formation ~ '^[a-z][a-z_]{1,39}$');

alter table petro.st37_wells
  add column licence_date date,
  -- Vertical, Horizontal, Directional, Slant: the licence's drilling operation, in words.
  add column planned_operation text check (char_length(planned_operation) <= 20),
  -- The formation the licence aims at, in words.
  add column planned_formation text check (char_length(planned_formation) <= 60),
  add column planned_depth_m numeric(8, 2) check (planned_depth_m >= 0),
  add column planned_bottom_longitude numeric(9, 6),
  add column planned_bottom_latitude numeric(8, 6),
  add constraint st37_wells_planned_bottom check (
    -- Both or neither (a null on one side would otherwise pass the check as unknown).
    (planned_bottom_longitude is null) = (planned_bottom_latitude is null)
    and (planned_bottom_longitude is null
         or (planned_bottom_longitude between -120.1 and -109.9
             and planned_bottom_latitude between 48.9 and 60.1))
  );

-- The Worker's ST37 route needs this version (ST37_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 6
$$;
