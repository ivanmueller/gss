-- Land held today (F-241, 20261126010000_petro_land.sql): Crown agreements, offset notices and
-- land whose petroleum and natural gas is not the Crown's. Members read, nobody but the
-- database's owner (the manual load) writes. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(21);

select ok((select petro.schema_version()) >= 9, 'the schema is at version 9 or later');
select is(
  (select count(*)::int
   from unnest(array['petro.land_loads', 'petro.land_agreements', 'petro.land_offsets', 'petro.land_freehold']) t
   where has_table_privilege('petro_api', t, 'select')),
  4,
  'petro_api reads the land and its loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.land_loads', 'petro.land_agreements', 'petro.land_offsets', 'petro.land_freehold']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.land_loads', 'petro.land_agreements', 'petro.land_offsets', 'petro.land_freehold']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the land'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.land_loads'::regclass, 'petro.land_agreements'::regclass,
                 'petro.land_offsets'::regclass, 'petro.land_freehold'::regclass)),
  'row level security is on'
);

-- The owner (the manual load) writes.
insert into petro.land_loads (layer, source_url, west, south, east, north, shapes)
values ('png_agreements',
        'https://geospatial.alberta.ca/titan/rest/services/energy/mineral_agreement/MapServer/8',
        -117, 53, -115, 55, 2);
insert into petro.land_agreements
  (rights, agreement_type, agreement_number, tract, status, holder, parties, zone, area_ha,
   term_date, expiry_text, bounds, path)
values
  ('png', '002', '924', '00', 'ACTIVE', 'EXAMPLE ENERGY LTD.', 'EXAMPLE ENERGY LTD. 100%',
   'PNG TO BASE EXAMPLE', 256, '2020-02-17', 'INDEFINITE', '(-116.0,54.1),(-116.1,54.0)',
   '{-11610000,5400000,-11600000,5400000,-11600000,5410000,-11610000,5410000}'),
  ('oil_sands', '010', 'A1B2', null, 'ACTIVE', null, null, null, null, null, null,
   '(-115.0,53.1),(-115.1,53.0)',
   '{-11510000,5300000,-11500000,5300000,-11500000,5310000,-11510000,5310000}');
insert into petro.land_offsets (offset_type, offset_number, holder, expiry_date, bounds, path)
values ('AAY', '2050843E02', 'EXAMPLE ENERGY LTD.', '2027-05-08', '(-116.0,54.1),(-116.1,54.0)',
        '{-11610000,5400000,-11600000,5400000,-11600000,5410000,-11610000,5410000}');
insert into petro.land_freehold (land_key, substances, bounds, path)
values (501032312, 'ALL MINERALS EXCEPT GOLD,SILVER', '(-114.0,52.1),(-114.1,52.0)',
        '{-11410000,5200000,-11400000,5200000,-11400000,5210000,-11410000,5210000}');

select is(
  (select agreement_number from petro.land_agreements
   where bounds && box(point(-116.05, 54.05), point(-115.9, 54.2))),
  '924',
  'the tracts touching a view are found by their bounds'
);
select is(
  (select count(*)::int from petro.land_agreements
   where bounds && box(point(-113, 50), point(-112, 51))),
  0,
  'a view elsewhere finds none'
);
select throws_ok(
  $$insert into petro.land_agreements (rights, agreement_type, agreement_number, bounds, path)
    values ('coal', '002', '1', '(1,1),(0,0)', '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'an agreement is for petroleum and natural gas or for oil sands'
);
select throws_ok(
  $$insert into petro.land_agreements (rights, agreement_type, agreement_number, bounds, path)
    values ('png', '002', 'not a number', '(1,1),(0,0)', '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'an agreement number is letters and digits'
);
select throws_ok(
  $$insert into petro.land_agreements (rights, agreement_type, agreement_number, area_ha, bounds, path)
    values ('png', '002', '1', -1, '(1,1),(0,0)', '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'an area is not negative'
);
select throws_ok(
  $$insert into petro.land_agreements (rights, agreement_type, agreement_number, bounds, path)
    values ('png', '002', '1', '(1,1),(0,0)', '{}')$$,
  '23514', null, 'a path is not empty'
);
select throws_ok(
  $$insert into petro.land_freehold (bounds, path) values ('(1,1),(0,0)', '{0,0,1,1}')$$,
  '23514', null, 'a path holds at least three points'
);
select throws_ok(
  $$insert into petro.land_offsets (offset_number, bounds, path)
    values ('x; y', '(1,1),(0,0)', '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'an offset notice number is letters and digits'
);
select throws_ok(
  $$insert into petro.land_loads (layer, source_url, west, south, east, north, shapes)
    values ('freehold', 'https://example.test/x', -117, 53, -115, 55, 1)$$,
  '23514', null, 'a load names the province''s service'
);
select throws_ok(
  $$insert into petro.land_loads (layer, source_url, west, south, east, north, shapes)
    values ('coal', 'https://geospatial.alberta.ca/x', -117, 53, -115, 55, 1)$$,
  '23514', null, 'a load is of one of the four layers'
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
  pg_temp.as_petro('select (select count(*) from petro.land_agreements)::text || '' '' || (select count(*) from petro.land_offsets)::text || '' '' || (select count(*) from petro.land_freehold)::text'),
  '2 1 1', 'a member reads the land');
select is(pg_temp.as_petro('select count(*)::text from petro.land_loads'), '1', 'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.land_agreements set holder = null returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no agreement'
);
select throws_ok(
  pg_temp.try('with d as (delete from petro.land_freehold returning 1) select count(*)::text from d'),
  '42501', null, 'a member removes no land'
);

-- Without a member, nothing is read: no job, and not a job's name.
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.land_agreements) + (select count(*) from petro.land_offsets) + (select count(*) from petro.land_freehold) + (select count(*) from petro.land_loads))::text'),
  '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.land_agreements) + (select count(*) from petro.land_offsets) + (select count(*) from petro.land_freehold))::text'),
  '0', 'a job reads no land');

select * from finish();
rollback;
