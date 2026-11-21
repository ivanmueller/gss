-- Crown land sales (F-242, 20261127010000_petro_land_sales.sql): members read, nobody but the
-- database's owner (the manual load) writes. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(18);

select ok((select petro.schema_version()) >= 10, 'the schema is at version 10 or later');
select ok(
  has_table_privilege('petro_api', 'petro.land_sale_parcels', 'select')
  and has_table_privilege('petro_api', 'petro.land_sale_loads', 'select'),
  'petro_api reads the sale parcels and their loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.land_sale_parcels', 'petro.land_sale_loads']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.land_sale_parcels', 'petro.land_sale_loads']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the land sales'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.land_sale_parcels'::regclass, 'petro.land_sale_loads'::regclass)),
  'row level security is on'
);

-- The owner (the manual load) writes.
insert into petro.land_sale_loads
  (source_url, first_sale, last_sale, west, south, east, north, sales, parcels)
values ('https://content2.energy.alberta.ca/petroleum-and-natural-gas-tenure-public-offerings-and-results/',
        '2003-01-08', '2026-12-02', -117, 53, -115, 55, 2, 2);
insert into petro.land_sale_parcels
  (sale_date, contract_no, contract_type, region, hectares, zone, land, status, bonus,
   dollars_per_hectare, buyers, bounds, shape)
values
  ('2026-11-04', 'A0001', 'LEASE', 'PLAINS', 256, 'PETROLEUM AND NATURAL GAS FROM SURFACE TO BASEMENT',
   '51806024', 'ACCEPTED', 56888.32, 222.22, 'EXAMPLE LAND LTD. 100%',
   '(-116.0,54.1),(-116.1,54.0)',
   '[[[[-116.1,54.0],[-116.0,54.0],[-116.0,54.1],[-116.1,54.1],[-116.1,54.0]]]]'),
  ('2026-12-02', 'B0002', 'LICENCE', 'NORTHERN', 512, null, '51806025 51806026', null, null,
   null, null, '(-115.0,53.1),(-115.1,53.0)',
   '[[[[-115.1,53.0],[-115.0,53.0],[-115.0,53.1],[-115.1,53.1],[-115.1,53.0]]]]');

select is(
  (select bonus::text || ' ' || dollars_per_hectare::text from petro.land_sale_parcels
   where bounds && box(point(-116.05, 54.05), point(-115.9, 54.2))),
  '56888.32 222.22',
  'a parcel in view is found by its bounds, with its money to the cent'
);
select is(
  (select count(*)::int from petro.land_sale_parcels where status is null),
  1,
  'a parcel of a sale not held yet has no result'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, bounds, shape)
    values ('2026-11-04', 'A0001', '51806024', '(1,1),(0,0)', '[[[[0,0],[1,0],[1,1],[0,0]]]]')$$,
  '23505', null, 'a sale has one parcel of a contract number'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, bounds, shape)
    values ('2026-11-04', 'A1', '51806024', '(1,1),(0,0)', '[[[[0,0],[1,0],[1,1],[0,0]]]]')$$,
  '23514', null, 'a contract number is a letter and four digits'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, bonus, bounds, shape)
    values ('2026-11-04', 'A0009', '51806024', -1, '(1,1),(0,0)', '[[[[0,0],[1,0],[1,1],[0,0]]]]')$$,
  '23514', null, 'a bonus is not negative'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, bounds, shape)
    values ('2026-11-04', 'A0009', '51806024', '(1,1),(0,0)', '[]')$$,
  '23514', null, 'a shape holds at least one polygon'
);
select throws_ok(
  $$insert into petro.land_sale_loads (source_url, first_sale, last_sale, west, south, east, north, sales, parcels)
    values ('https://example.test/x', '2003-01-08', '2026-12-02', -117, 53, -115, 55, 1, 1)$$,
  '23514', null, 'a load names the department''s page'
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
select is(pg_temp.as_petro('select count(*)::text from petro.land_sale_parcels'), '2', 'a member reads the parcels');
select is(pg_temp.as_petro('select count(*)::text from petro.land_sale_loads'), '1', 'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.land_sale_parcels set bonus = 0 returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no parcel'
);
select throws_ok(
  pg_temp.try('with d as (delete from petro.land_sale_parcels returning 1) select count(*)::text from d'),
  '42501', null, 'a member removes no parcel'
);

-- Without a member, nothing is read: no job, and not a job's name.
select pg_temp.be('', '', '', '');
select is(pg_temp.as_petro('select count(*)::text from petro.land_sale_parcels'), '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.land_sale_parcels'), '0', 'a job reads no parcel');

select * from finish();
rollback;
