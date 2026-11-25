-- Water and gas injected by well and month from Petrinex's public files (F-300 part 1,
-- 20261212010000_petro_well_injection.sql): members read, nobody but the database's owner (the
-- manual load) writes. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(14);

select ok((select petro.schema_version()) >= 25, 'the schema is at version 25 or later');
select ok(
  has_table_privilege('petro_api', 'petro.well_injection', 'select'),
  'petro_api reads the injection'
);
select is(
  (select count(*)::int
   from unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', 'petro.well_injection', p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, 'petro.well_injection', p.name)),
  0,
  'the Supabase API roles hold nothing on the injection'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'petro.well_injection'::regclass),
  'row level security is on'
);

-- The owner (the manual load) writes; a load counts its injection.
insert into petro.production_loads (source_url, formation, first_month, last_month, files, wells,
                                    well_months, injection_wells, injection_well_months)
values ('https://www.petrinex.gov.ab.ca/publicdata/API/Files/AB/Vol/', 'stettler_nisku_a',
        '2022-01-01', '2022-02-01', 2, 1, 2, 1, 2);
insert into petro.well_injection (uwi, month, water_m3, gas_e3m3, hours)
values
  ('00/08-22-038-20W4/0', '2022-01-01', 812.5, null, 744),
  ('00/08-22-038-20W4/0', '2022-02-01', 790, 1.25, 672);

select is(
  (select water_m3::text || ' ' || coalesce(gas_e3m3::text, 'none') from petro.well_injection
   where month = '2022-01-01'),
  '812.500 none',
  'a month keeps its volumes, and a fluid not injected stays empty'
);
select throws_ok(
  $$insert into petro.well_injection (uwi, month, water_m3) values ('00/08-22-038-20W4/0', '2022-01-01', 1)$$,
  '23505', null, 'a well has one row a month'
);
select throws_ok(
  $$insert into petro.well_injection (uwi, month, water_m3) values ('00/08-22-038-20W4/0', '2022-03-15', 1)$$,
  '23514', null, 'a month is written as its first day'
);
select throws_ok(
  $$insert into petro.well_injection (uwi, month, water_m3) values ('00/08-22-038-20W4/0', '2022-03-01', -1)$$,
  '23514', null, 'a volume is not negative'
);
select throws_ok(
  $$insert into petro.well_injection (uwi, month, hours) values ('00/08-22-038-20W4/0', '2022-03-01', 10)$$,
  '23514', null, 'a row holds water or gas'
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
select is(pg_temp.as_petro('select count(*)::text from petro.well_injection'), '2', 'a member reads the injection');
select throws_ok(
  pg_temp.try('with u as (update petro.well_injection set water_m3 = 0 returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no injection'
);

-- Without a member, nothing is read: no job, and not a job's name.
select pg_temp.be('', '', '', '');
select is(pg_temp.as_petro('select count(*)::text from petro.well_injection'), '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.well_injection'), '0', 'a job reads no injection');

select * from finish();
rollback;
