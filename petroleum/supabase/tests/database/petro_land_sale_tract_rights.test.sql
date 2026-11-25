-- A Crown land sale parcel's rights tract by tract (F-276,
-- 20261201010000_petro_land_sale_tract_rights.sql). Members read, nobody but the database's
-- owner (the manual load) writes. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(11);

select ok((select petro.schema_version()) >= 14, 'the schema is at version 14 or later');
select is(
  (select count(*)::int
   from unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', 'petro.land_sale_parcels', p)),
  0,
  'petro_api still writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['select', 'insert', 'update']) as p(name)
   where has_column_privilege(r.name, 'petro.land_sale_parcels', 'tract_rights', p.name)),
  0,
  'the Supabase API roles hold nothing on the new column'
);

-- The owner (the manual load) writes.
insert into petro.land_sale_parcels (sale_date, contract_no, land, tract_rights, bounds, path)
values
  ('1990-03-07', 'B0001', '51806024 51806025',
   '["PETROLEUM AND NATURAL GAS FROM SURFACE; TO THE TOP OF THE EXAMPLE FM", "PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE SAMPLE GRP; TO BASEMENT"]',
   '(-116.0,54.1),(-116.1,54.0)',
   '{-11610000,5400000,-11600000,5400000,-11600000,5410000,-11610000,5410000}'),
  ('1990-03-07', 'B0002', '51806026', null, '(-115.0,53.1),(-115.1,53.0)',
   '{-11510000,5300000,-11500000,5300000,-11500000,5310000,-11510000,5310000}');

select is(
  (select tract_rights ->> 1 from petro.land_sale_parcels where contract_no = 'B0001'),
  'PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE SAMPLE GRP; TO BASEMENT',
  'a parcel keeps each tract''s rights, in order'
);
select is(
  (select count(*)::int from petro.land_sale_parcels
   where sale_date = '1990-03-07' and tract_rights is null),
  1,
  'a parcel loaded before has none'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, tract_rights, bounds, path)
    values ('1990-03-07', 'B0009', '51806024', '"PETROLEUM"', '(1,1),(0,0)',
            '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'the tracts'' rights are a list'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, tract_rights, bounds, path)
    values ('1990-03-07', 'B0009', '51806024', '[]', '(1,1),(0,0)',
            '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'no rights is null, not an empty list'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, tract_rights, bounds, path)
    values ('1990-03-07', 'B0009', '51806024', '["PETROLEUM", {"a": 1}]', '(1,1),(0,0)',
            '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'each tract''s rights are a text and nothing else'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, tract_rights, bounds, path)
    select '1990-03-07', 'B0009', '51806024', jsonb_agg('TRACT ' || n), '(1,1),(0,0)',
           '{0,0,100000,0,100000,100000}'
    from generate_series(1, 41) n$$,
  '23514', null, 'at most forty wordings a parcel'
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

-- A member reads the new column; without a member nothing is read.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(
  pg_temp.as_petro($$select tract_rights ->> 0 from petro.land_sale_parcels where contract_no = 'B0001' and sale_date = '1990-03-07'$$),
  'PETROLEUM AND NATURAL GAS FROM SURFACE; TO THE TOP OF THE EXAMPLE FM',
  'a member reads a parcel''s rights tract by tract'
);
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro($$select count(*)::text from petro.land_sale_parcels where sale_date = '1990-03-07'$$),
  '0',
  'without a member no parcel is read'
);

select * from finish();
rollback;
