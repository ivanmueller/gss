-- Alberta's wells from the AER's ST37 list (F-243 part 4, 20261122010000_petro_st37_wells.sql):
-- members read, nobody but the database's owner (the manual load) writes. One transaction,
-- rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(14);

select ok((select petro.schema_version()) >= 5, 'the schema is at version 5 or later');
select ok(
  has_table_privilege('petro_api', 'petro.st37_wells', 'select')
  and has_table_privilege('petro_api', 'petro.st37_loads', 'select'),
  'petro_api reads the wells and their loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.st37_wells', 'petro.st37_loads']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.st37_wells', 'petro.st37_loads']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the wells'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.st37_wells'::regclass, 'petro.st37_loads'::regclass)),
  'row level security is on'
);

-- The owner (the manual load) writes.
insert into petro.st37_loads (source_url, west, south, east, north, wells)
values ('https://static.aer.ca/prd/documents/sts/st37/ST_37_GeoDB.zip', -114, 53.1, -113.2, 53.5, 2);
insert into petro.st37_wells (uwi, licence_number, well_name, licensee, licence_status,
  status_class, status_fluid, status_mode, status_type, spud_date, final_drill_date,
  total_depth_m, true_vertical_depth_m, surface_longitude, surface_latitude,
  bottom_longitude, bottom_latitude, path)
values
  ('00/11-23-030-27W4/2', '0505993', 'EXAMPLE HZ', 'Example Energy Ltd.', 'Issued', 'producing',
   'Crude Oil', '11', null, '2022-10-29', '2022-11-10', 6443, 2246, -113.6, 53.3, -113.62, 53.3,
   '[[-113.6, 53.3], [-113.61, 53.3], [-113.62, 53.3]]'),
  ('00/01-27-030-27W4/0', '0340721', 'EXAMPLE', 'Example Resources Inc', 'Abandoned', 'abandoned',
   null, null, null, '2006-01-24', '2006-01-30', 1139, null, -113.5, 53.2, -113.5, 53.2, null);

select throws_ok(
  $$insert into petro.st37_wells (uwi, licence_number, status_class, surface_longitude,
      surface_latitude, bottom_longitude, bottom_latitude)
    values ('bad', '1', 'producing', -113.6, 53.3, -113.6, 53.3)$$,
  '23514', null, 'a UWI has the AER''s form'
);
select throws_ok(
  $$insert into petro.st37_wells (uwi, licence_number, status_class, surface_longitude,
      surface_latitude, bottom_longitude, bottom_latitude)
    values ('00/01-01-001-01W4/0', '1', 'gushing', -113.6, 53.3, -113.6, 53.3)$$,
  '23514', null, 'a status is one the map knows'
);
select throws_ok(
  $$insert into petro.st37_wells (uwi, licence_number, status_class, surface_longitude,
      surface_latitude, bottom_longitude, bottom_latitude)
    values ('00/01-01-001-01W4/0', '1', 'producing', -100, 53.3, -113.6, 53.3)$$,
  '23514', null, 'a well lies in Alberta'
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
select is(pg_temp.as_petro('select count(*)::text from petro.st37_wells'), '2', 'a member reads the wells');
select is(pg_temp.as_petro('select count(*)::text from petro.st37_loads'), '1', 'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.st37_wells set licensee = ''x'' returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no well'
);
select throws_ok(
  pg_temp.try('with d as (delete from petro.st37_wells returning 1) select count(*)::text from d'),
  '42501', null, 'a member deletes no well'
);

-- Without a member, nothing is read: no job, and not another job's name.
select pg_temp.be('', '', '', '');
select is(pg_temp.as_petro('select count(*)::text from petro.st37_wells'), '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.st37_wells'), '0', 'a job reads no ST37 wells');

select * from finish();
rollback;
