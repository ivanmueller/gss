-- Alberta's wells from the AER's ST37 list (F-243 part 4, 20261122010000_petro_st37_wells.sql):
-- members read, nobody but the database's owner (the manual load) writes. One transaction,
-- rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(18);

select ok((select petro.schema_version()) >= 6, 'the schema is at version 6 or later');
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

-- One formation whole, and what a licence planned (20261123010000_petro_st37_formation.sql).
insert into petro.st37_loads (source_url, west, south, east, north, wells, formation)
values ('https://static.aer.ca/prd/documents/sts/st37/ST_37_GeoDB.zip', -118.75, 51.57, -112.9, 55.28, 1, 'duvernay');
update petro.st37_wells
set licence_date = '2026-11-19', planned_operation = 'Horizontal', planned_formation = 'Duvernay Fm',
    planned_depth_m = 5300, planned_bottom_longitude = -113.52, planned_bottom_latitude = 53.21
where uwi = '00/01-27-030-27W4/0';
select is(
  (select planned_bottom_longitude::text || ' ' || planned_formation from petro.st37_wells
   where uwi = '00/01-27-030-27W4/0'),
  '-113.520000 Duvernay Fm',
  'a well keeps what its licence planned and its planned bottom hole'
);
select throws_ok(
  $$update petro.st37_wells set planned_bottom_latitude = null where uwi = '00/01-27-030-27W4/0'$$,
  '23514', null, 'a planned bottom hole has both its longitude and its latitude'
);
select throws_ok(
  $$update petro.st37_wells set planned_bottom_longitude = -100 where uwi = '00/01-27-030-27W4/0'$$,
  '23514', null, 'a planned bottom hole lies in Alberta'
);
select throws_ok(
  $$insert into petro.st37_loads (source_url, west, south, east, north, wells, formation)
    values ('https://static.aer.ca/x', -114, 53, -113, 54, 1, 'Not A Key')$$,
  '23514', null, 'a formation is named by its key'
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
select is(pg_temp.as_petro('select count(*)::text from petro.st37_loads'), '2', 'a member reads the loads');
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
