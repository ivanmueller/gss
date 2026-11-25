-- F-300 part 1 undone (20261213010000_petro_waterflood_removed.sql): the injection table and
-- the load's injection counts are gone; the production and its loads read as before. One
-- transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(5);

select ok((select petro.schema_version()) >= 26, 'the schema is at version 26 or later');
select hasnt_table('petro', 'well_injection', 'the injection table is gone');
select hasnt_column('petro', 'production_loads', 'injection_wells', 'a load counts no injection wells');
select hasnt_column('petro', 'production_loads', 'injection_well_months', 'nor injection months');

-- A load is recorded as before F-300.
insert into petro.production_loads (source_url, formation, first_month, last_month, files, wells, well_months)
values ('https://www.petrinex.gov.ab.ca/publicdata/API/Files/AB/Vol/', 'duvernay', '2022-01-01', '2022-02-01', 2, 1, 2);
select is((select count(*)::int from petro.production_loads where formation = 'duvernay'), 1,
          'a production load is recorded as before');

select * from finish();
rollback;
