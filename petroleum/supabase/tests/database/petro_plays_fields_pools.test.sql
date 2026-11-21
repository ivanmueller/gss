-- Several plays side by side and the names of fields and pools (F-256,
-- 20261125010000_petro_plays_fields_pools.sql): members read, nobody but the database's owner
-- (the manual load) writes. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(16);

select ok((select petro.schema_version()) >= 8, 'the schema is at version 8 or later');
select ok(
  has_table_privilege('petro_api', 'petro.fields', 'select')
  and has_table_privilege('petro_api', 'petro.pools', 'select')
  and has_table_privilege('petro_api', 'petro.field_pool_loads', 'select'),
  'petro_api reads the fields, the pools and their loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.fields', 'petro.pools', 'petro.field_pool_loads']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.fields', 'petro.pools', 'petro.field_pool_loads']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on them'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.fields'::regclass, 'petro.pools'::regclass,
                 'petro.field_pool_loads'::regclass)),
  'row level security is on'
);

-- The owner (the manual load) writes. Far-off codes no real list uses.
insert into petro.fields (field_code, name) values (990001, 'EXAMPLE NORTH'), (990002, 'EXAMPLE SOUTH');
insert into petro.pools (field_code, pool_code, name)
values (990001, 728001, 'EXAMPLE A'), (990002, 728001, 'EXAMPLE A'), (990002, 728002, 'EXAMPLE B');
insert into petro.field_pool_loads (source_url, fields, pools)
values ('https://static.aer.ca/prd/data/codes/FieldPoolList.txt', 2, 3);

select is(
  (select count(*)::int from petro.pools where pool_code = 728001 and field_code >= 990001),
  2,
  'the same pool code names a pool in each field'
);
select throws_ok(
  $$insert into petro.pools (field_code, pool_code, name) values (990001, 728001, 'AGAIN')$$,
  '23505', null, 'a field has a pool code once'
);
select throws_ok(
  $$insert into petro.pools (field_code, pool_code, name) values (990003, 1, 'NO FIELD')$$,
  '23503', null, 'a pool belongs to a field of the list'
);
select throws_ok(
  $$insert into petro.fields (field_code, name) values (990004, '')$$,
  '23514', null, 'a field has a name'
);

-- A well keeps its field code and the play it was loaded for.
insert into petro.st37_wells (uwi, licence_number, status_class, pool_code, field_code, formation,
  surface_longitude, surface_latitude, bottom_longitude, bottom_latitude)
values
  ('00/01-01-125-01W6/0', '0999001', 'producing', 728001, 990002, 'duvernay', -119.9, 59.95, -119.91, 59.95),
  ('00/02-01-125-01W6/0', '0999002', 'producing', null, null, 'example_play', -119.9, 59.96, -119.91, 59.96);
select is(
  (select f.name || ' / ' || p.name
   from petro.st37_wells w
   join petro.fields f on f.field_code = w.field_code
   join petro.pools p on p.field_code = w.field_code and p.pool_code = w.pool_code
   where w.uwi = '00/01-01-125-01W6/0'),
  'EXAMPLE SOUTH / EXAMPLE A',
  'a well''s field code and pool code name its field and pool'
);
select throws_ok(
  $$update petro.st37_wells set formation = 'Not A Key' where uwi = '00/01-01-125-01W6/0'$$,
  '23514', null, 'a play is named by its key'
);
-- Loading one play again replaces only its wells.
delete from petro.st37_wells where formation = 'example_play';
select is(
  (select count(*)::int from petro.st37_wells where uwi = '00/01-01-125-01W6/0'),
  1,
  'replacing one play leaves the wells of another'
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
select is(
  pg_temp.as_petro('select count(*)::text from petro.pools where field_code >= 990001'),
  '3', 'a member reads the pools');
select is(
  pg_temp.as_petro('select count(*)::text from petro.fields where field_code >= 990001'),
  '2', 'a member reads the fields');
select throws_ok(
  pg_temp.try('with u as (update petro.fields set name = ''x'' returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no field'
);

-- Without a member, nothing is read.
select pg_temp.be('', '', '', '');
select is(pg_temp.as_petro('select count(*)::text from petro.pools'), '0', 'without a member nothing is read');

select * from finish();
rollback;
