-- The ST37 wells' paths with their depth (F-261, 20261129010000_petro_st37_depths.sql): members
-- read, nobody but the database's owner (the manual load) writes. One transaction, rolled back.
-- Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(11);

select ok((select petro.schema_version()) >= 12, 'the schema is at version 12 or later');
select is(
  (select count(*)::int
   from unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', 'petro.st37_wells', p)),
  0,
  'petro_api still writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['path_3d', 'path_surveyed', 'kb_elevation_m', 'ground_elevation_m']) as c(name),
        unnest(array['select', 'insert', 'update']) as p(name)
   where has_column_privilege(r.name, 'petro.st37_wells', c.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the new columns'
);

-- The owner (the manual load) writes.
insert into petro.st37_wells (uwi, licence_number, status_class, surface_longitude,
  surface_latitude, bottom_longitude, bottom_latitude, path, path_3d, path_surveyed,
  kb_elevation_m, ground_elevation_m)
values
  ('00/11-23-030-27W4/2', '0505993', 'producing', -113.6, 53.3, -113.62, 53.3,
   '[[-113.6, 53.3], [-113.62, 53.3]]',
   '[[-113.6, 53.3, 904.1], [-113.6, 53.3, -1300], [-113.62, 53.3, -1355.8]]', true, 904.1, 898.5),
  -- A vertical well: no flat path, yet a path with depth.
  ('00/01-27-030-27W4/0', '0340721', 'abandoned', -113.5, 53.2, -113.5, 53.2, null,
   '[[-113.5, 53.2, 850], [-113.5, 53.2, -289]]', false, 850, null),
  ('00/02-27-030-27W4/0', '0340722', 'licensed', -113.5, 53.21, -113.5, 53.21, null,
   null, null, null, null);

select is(
  (select path_3d -> 2 ->> 2 from petro.st37_wells where uwi = '00/11-23-030-27W4/2'),
  '-1355.8',
  'a well keeps the elevation of each point of its path'
);
select is(
  (select count(*)::int from petro.st37_wells where path is null and path_3d is not null),
  1,
  'a vertical well has a path with depth and no flat path'
);
select throws_ok(
  $$update petro.st37_wells set path_3d = '[[-113.6, 53.3, 904.1]]'
    where uwi = '00/11-23-030-27W4/2'$$,
  '23514', null, 'a path with depth has at least two points'
);
select throws_ok(
  $$update petro.st37_wells set path_3d = '{"a": 1}' where uwi = '00/11-23-030-27W4/2'$$,
  '23514', null, 'a path with depth is a list'
);
select throws_ok(
  $$update petro.st37_wells set kb_elevation_m = 9000 where uwi = '00/11-23-030-27W4/2'$$,
  null, null, 'an elevation is one the ground can have'
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

create function pg_temp.be(usr text, org text, member_role text, job text) returns void
language sql as $fn$
  select set_config('petro.user_id', usr, true),
         set_config('petro.organization_id', org, true),
         set_config('petro.member_role', member_role, true),
         set_config('petro.job', job, true);
$fn$;

-- A member reads the new columns; without a member nothing is read.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(
  pg_temp.as_petro($$select jsonb_array_length(path_3d)::text || ' ' || path_surveyed::text
                       || ' ' || kb_elevation_m::text || ' ' || ground_elevation_m::text
                     from petro.st37_wells where uwi = '00/11-23-030-27W4/2'$$),
  '3 true 904.1 898.5',
  'a member reads a well''s path with depth and its elevations'
);
select throws_ok(
  $$select pg_temp.as_petro($q$update petro.st37_wells set path_3d = null$q$)$$,
  '42501', null, 'a member cannot change a path'
);
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.st37_wells where path_3d is not null'),
  '0',
  'without a member no path is read'
);

select * from finish();
rollback;
