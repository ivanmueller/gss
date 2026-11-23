-- Facilities (F-278, 20261202010000_petro_facilities.sql): the AER's ST102 facility list. Members
-- read, nobody but the database's owner (the manual load) writes. One transaction, rolled back.
-- Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

select ok((select petro.schema_version()) >= 15, 'the schema is at version 15 or later');
select is(
  (select count(*)::int
   from unnest(array['petro.facility_loads', 'petro.facilities']) t
   where has_table_privilege('petro_api', t, 'select')),
  2,
  'petro_api reads the facilities and their loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.facility_loads', 'petro.facilities']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.facility_loads', 'petro.facilities']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the facilities'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.facility_loads'::regclass, 'petro.facilities'::regclass)),
  'row level security is on'
);

-- The owner (the manual load) writes.
insert into petro.facility_loads (source_url, file_date, west, south, east, north, facilities)
values ('https://static.aer.ca/prd/data/codes/ST102-SHP.zip', '2026-11-22', -117, 53, -115, 55, 2);
insert into petro.facilities
  (facility_id, name, operator_code, operator, sub_code, sub_type, licence_number, licence_type,
   licensee_code, licensee, status, location_source, longitude, latitude)
values
  ('ABBT0000001', 'EXAMPLE 14-29 BATTERY', 'A0X1', 'Example Energy Ltd.', 311,
   'Crude Oil Single-Well Battery', '6422', 'F', 'A0X1', 'Example Energy Ltd.', 'Active',
   'Facility Licence', -116.5, 54.2),
  ('ABGP0000002', 'EXAMPLE GAS PLANT', null, null, 401, 'Gas Plant Sweet', null, null, null, null,
   'Suspended', 'LSD Centre', -115.5, 53.5);

select is(
  (select facility_id from petro.facilities where sub_code = 401),
  'ABGP0000002',
  'a facility is kept with its type'
);
select throws_ok(
  $$insert into petro.facilities (facility_id, longitude, latitude)
    values ('BT0000003', -116, 54)$$,
  '23514', null, 'a facility ID is the AER''s'
);
select throws_ok(
  $$insert into petro.facilities (facility_id, longitude, latitude)
    values ('ABBT0000003', -100, 54)$$,
  '23514', null, 'a facility is in Alberta'
);
select throws_ok(
  $$insert into petro.facilities (facility_id, licence_type, longitude, latitude)
    values ('ABBT0000003', 'X', -116, 54)$$,
  '23514', null, 'a licence is a well''s or a facility''s'
);
select throws_ok(
  $$insert into petro.facilities (facility_id, location_source, longitude, latitude)
    values ('ABBT0000003', 'Guessed', -116, 54)$$,
  '23514', null, 'a point comes from one of the AER''s four sources'
);
select throws_ok(
  $$insert into petro.facility_loads (source_url, west, south, east, north, facilities)
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
select is(pg_temp.as_petro('select count(*)::text from petro.facilities'), '2',
          'a member reads the facilities');
select is(pg_temp.as_petro('select count(*)::text from petro.facility_loads'), '1',
          'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.facilities set operator = null returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no facility'
);
select throws_ok(
  pg_temp.try('with d as (delete from petro.facilities returning 1) select count(*)::text from d'),
  '42501', null, 'a member removes no facility'
);

-- Without a member, nothing is read: no member, and not a job's name.
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.facilities) + (select count(*) from petro.facility_loads))::text'),
  '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.facilities'), '0',
          'a job reads no facility');

select * from finish();
rollback;
