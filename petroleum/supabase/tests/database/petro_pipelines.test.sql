-- Pipelines (F-249, 20261203010000_petro_pipelines.sql): the AER's pipeline file. Members read,
-- nobody but the database's owner (the manual load) writes. One transaction, rolled back.
-- Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(20);

select ok((select petro.schema_version()) >= 16, 'the schema is at version 16 or later');
select is(
  (select count(*)::int
   from unnest(array['petro.pipeline_loads', 'petro.pipelines']) t
   where has_table_privilege('petro_api', t, 'select')),
  2,
  'petro_api reads the pipelines and their loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.pipeline_loads', 'petro.pipelines']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.pipeline_loads', 'petro.pipelines']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the pipelines'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.pipeline_loads'::regclass, 'petro.pipelines'::regclass)),
  'row level security is on'
);

-- The owner (the manual load) writes.
insert into petro.pipeline_loads (source_url, file_date, west, south, east, north, segments)
values ('https://static.aer.ca/prd/data/pipeline/Pipelines_SHP.zip', '2026-11-22',
        -117, 53, -115, 55, 2);
insert into petro.pipelines
  (segment_id, licence_number, line_number, licensee_code, licensee, status, substances,
   diameter_mm, bounds, path, breaks)
values
  ('51822', '11130', '1', 'A0X1', 'Example Pipelines Ltd.', 'Operating', '{Natural Gas}', 323.9,
   box(point(-116.5, 54.1), point(-116.4, 54.2)), '{-11650000,5410000,-11640000,5420000}', '{}'),
  ('322360', '3115', '52', null, null, 'Abandoned', '{Sour Natural Gas,Fuel Gas}', 88.9,
   box(point(-115.9, 53.6), point(-115.8, 53.7)),
   '{-11590000,5360000,-11585000,5365000,-11585000,5365000,-11580000,5370000}', '{2}');

select is(
  (select licence_number || '-' || line_number from petro.pipelines
   where bounds && box(point(-116.6, 54), point(-116.3, 54.3))),
  '11130-1',
  'a segment is found by the square it touches'
);
select throws_ok(
  $$insert into petro.pipelines (licence_number, bounds, path)
    values ('11-130', box(point(-116, 54), point(-116, 54)), '{-11600000,5400000,-11600000,5410000}')$$,
  '23514', null, 'a licence number is the AER''s'
);
select throws_ok(
  $$insert into petro.pipelines (licence_number, substances, bounds, path)
    values ('11130', '{a,b,c,d}', box(point(-116, 54), point(-116, 54)), '{-11600000,5400000,-11600000,5410000}')$$,
  '23514', null, 'a segment carries at most three substances'
);
select throws_ok(
  $$insert into petro.pipelines (licence_number, bounds, path)
    values ('11130', box(point(-116, 54), point(-116, 54)), '{-11600000,5400000}')$$,
  '23514', null, 'a segment has a line of two points at least'
);
select throws_ok(
  $$insert into petro.pipelines (licence_number, bounds, path)
    values ('11130', box(point(-116, 54), point(-116, 54)), '{-11600000,5400000,-11600000}')$$,
  '23514', null, 'a line''s points come in pairs'
);
select throws_ok(
  $$insert into petro.pipelines (licence_number, diameter_mm, bounds, path)
    values ('11130', -1, box(point(-116, 54), point(-116, 54)), '{-11600000,5400000,-11600000,5410000}')$$,
  '23514', null, 'a diameter is not negative'
);
select throws_ok(
  $$insert into petro.pipeline_loads (source_url, west, south, east, north, segments)
    values ('https://example.test/x.zip', -117, 53, -115, 55, 1)$$,
  '23514', null, 'a load names the AER''s file'
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
select is(pg_temp.as_petro('select count(*)::text from petro.pipelines'), '2',
          'a member reads the pipelines');
select is(pg_temp.as_petro('select count(*)::text from petro.pipeline_loads'), '1',
          'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.pipelines set licensee = null returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no pipeline'
);
select throws_ok(
  pg_temp.try('with d as (delete from petro.pipelines returning 1) select count(*)::text from d'),
  '42501', null, 'a member removes no pipeline'
);
select throws_ok(
  pg_temp.try('with i as (insert into petro.pipeline_loads (source_url, west, south, east, north, segments) values (''https://static.aer.ca/x.zip'', -117, 53, -115, 55, 0) returning 1) select count(*)::text from i'),
  '42501', null, 'a member records no load'
);

-- Without a member, nothing is read: no member, and not a job's name.
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.pipelines) + (select count(*) from petro.pipeline_loads))::text'),
  '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.pipelines'), '0',
          'a job reads no pipeline');
-- A member of another organization reads as any member: the oil and gas data is public data,
-- and the Worker names only members of GSS (docs/FEATURES_OIL_GAS.md).
select pg_temp.be('00000000-0000-4000-8000-0000000000a2',
                  '00000000-0000-4000-8000-0000000000b2', 'org_admin', '');
select is(pg_temp.as_petro('select count(*)::text from petro.pipelines'), '2',
          'any member the Worker names reads the same public data');

select * from finish();
rollback;
