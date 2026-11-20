-- Monthly production by well from Petrinex's public files (F-252 step 3,
-- 20261124010000_petro_well_production.sql): members read, nobody but the database's owner (the
-- manual load) writes. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

select ok((select petro.schema_version()) >= 7, 'the schema is at version 7 or later');
select ok(
  has_table_privilege('petro_api', 'petro.well_production', 'select')
  and has_table_privilege('petro_api', 'petro.production_loads', 'select'),
  'petro_api reads the production and its loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.well_production', 'petro.production_loads']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.well_production', 'petro.production_loads']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the production'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.well_production'::regclass, 'petro.production_loads'::regclass)),
  'row level security is on'
);

-- The owner (the manual load) writes.
insert into petro.production_loads (source_url, formation, first_month, last_month, files, wells, well_months)
values ('https://www.petrinex.gov.ab.ca/publicdata/API/Files/AB/Vol/', 'duvernay', '2022-01-01', '2022-02-01', 2, 1, 2);
insert into petro.well_production (uwi, month, oil_m3, gas_e3m3, water_m3, condensate_m3, hours)
values
  ('00/11-23-030-27W4/2', '2022-01-01', 310.5, 120.25, 80, null, 744),
  ('00/11-23-030-27W4/2', '2022-02-01', 280, 110, null, 12.125, 600);

select is(
  (select oil_m3::text || ' ' || coalesce(condensate_m3::text, 'none') from petro.well_production
   where month = '2022-01-01'),
  '310.500 none',
  'a month keeps its volumes, and a product not reported stays empty'
);
select throws_ok(
  $$insert into petro.well_production (uwi, month, oil_m3) values ('00/11-23-030-27W4/2', '2022-01-01', 1)$$,
  '23505', null, 'a well has one row a month'
);
select throws_ok(
  $$insert into petro.well_production (uwi, month, oil_m3) values ('bad', '2022-03-01', 1)$$,
  '23514', null, 'a UWI has the form the wells use'
);
select throws_ok(
  $$insert into petro.well_production (uwi, month, oil_m3) values ('00/11-23-030-27W4/2', '2022-03-15', 1)$$,
  '23514', null, 'a month is written as its first day'
);
select throws_ok(
  $$insert into petro.well_production (uwi, month, gas_e3m3) values ('00/11-23-030-27W4/2', '2022-03-01', -1)$$,
  '23514', null, 'a volume is not negative'
);
select throws_ok(
  $$insert into petro.well_production (uwi, month, hours) values ('00/11-23-030-27W4/2', '2022-03-01', 745)$$,
  '23514', null, 'a month has at most 744 hours'
);
select throws_ok(
  $$insert into petro.production_loads (source_url, first_month, last_month, files, wells, well_months)
    values ('https://example.test/x', '2022-01-01', '2022-02-01', 1, 1, 1)$$,
  '23514', null, 'a load names the address of the source'
);

grant petro_api to current_user;

create function pg_temp.as_petro(query text) returns text
language plpgsql as $fn$
declare
  result text;
begin
  set local role petro_api;
  execute query into result;
  reset role;
  return result;
end
$fn$;

create function pg_temp.try(query text) returns text
language sql as $fn$ select format('select pg_temp.as_petro(%L)', query) $fn$;

create function pg_temp.be(usr text, org text, member_role text, job text) returns void
language sql as $fn$
  select set_config('petro.user_id', usr, true),
         set_config('petro.organization_id', org, true),
         set_config('petro.member_role', member_role, true),
         set_config('petro.job', job, true);
$fn$;

-- A member reads, and writes nothing.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(pg_temp.as_petro('select count(*)::text from petro.well_production'), '2', 'a member reads the production');
select is(pg_temp.as_petro('select count(*)::text from petro.production_loads'), '1', 'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.well_production set oil_m3 = 0 returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no production'
);

-- Without a member, nothing is read: no job, and not a job's name.
select pg_temp.be('', '', '', '');
select is(pg_temp.as_petro('select count(*)::text from petro.well_production'), '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.well_production'), '0', 'a job reads no production');

select * from finish();
rollback;
