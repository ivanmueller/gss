-- F-300 part 1 undone (the owner, 2026-11-25: "All of those wells that you loaded in were
-- abandoned and SPUD a long time ago. I want to remove this and revert the changes. I will not
-- be doing waterflooding for now until we load in the other remaining data so for now I simply
-- want duvernay only").
--
-- 20261212010000_petro_well_injection.sql stays (a migration is never edited or removed once on
-- main); this one takes back what it and the Stettler D-2 A load added:
-- 1. The wells and the load of the Stettler D-2 A pool (`stettler_nisku_a`), with any production
--    of those wells (none on staging: the production load ran before the wells were loaded).
-- 2. The injection table, empty on staging, and the load's two injection counts.
-- Nothing of the Duvernay changes.

delete from petro.well_production
where uwi in (select uwi from petro.st37_wells where formation = 'stettler_nisku_a');
delete from petro.st37_wells where formation = 'stettler_nisku_a';
delete from petro.st37_loads where formation = 'stettler_nisku_a';

drop table petro.well_injection;

alter table petro.production_loads
  drop column injection_wells,
  drop column injection_well_months;

create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 26
$$;
