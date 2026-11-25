-- Land kept as whole numbers (F-310, 20261210010000_petro_land_compact.sql): each row holds its
-- shape as a path of whole numbers with its ring counts; the JSON form is gone since the cleanup
-- (20261211010000_petro_land_shape_dropped.sql), the path required; members read the columns,
-- nobody but the database's owner writes them.
-- One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

select ok((select petro.schema_version()) >= 23, 'the schema is at version 23 or later');
select is(
  (select count(*)::int
   from unnest(array['land_agreements', 'land_offsets', 'land_freehold', 'land_sale_parcels']) t,
        unnest(array['path', 'rings']) c
   where exists (select 1 from information_schema.columns
                 where table_schema = 'petro' and table_name = t and column_name = c
                   and data_type = 'ARRAY' and udt_name = '_int4')),
  8,
  'the four land tables have a path and ring counts of whole numbers'
);
select is(
  (select count(*)::int
   from unnest(array['petro.land_agreements', 'petro.land_offsets', 'petro.land_freehold', 'petro.land_sale_parcels']) t,
        unnest(array['path', 'rings']) c
   where has_column_privilege('petro_api', t, c, 'select')),
  8,
  'petro_api reads the new columns'
);
select is(
  (select count(*)::int
   from unnest(array['petro.land_agreements', 'petro.land_offsets', 'petro.land_freehold', 'petro.land_sale_parcels']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api still writes nothing'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.land_agreements', 'petro.land_offsets', 'petro.land_freehold', 'petro.land_sale_parcels']) as t(name),
        unnest(array['path', 'rings']) as c(name),
        unnest(array['select', 'insert', 'update']) as p(name)
   where has_column_privilege(r.name, t.name, c.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the new columns'
);

-- The owner (the manual load) writes.
insert into petro.land_agreements (rights, agreement_type, agreement_number, bounds, path)
values ('png', '002', '924', '(-116.0,54.1),(-116.1,54.0)',
        '{-11610000,5400000,-11600000,5400000,-11600000,5410000,-11610000,5410000}');
insert into petro.land_offsets (offset_number, bounds, path, rings)
values ('2050843E02', '(-116.0,54.1),(-116.1,54.0)',
        '{-11610000,5400000,-11600000,5400000,-11600000,5410000,-11605000,5401000,-11604000,5401000,-11604000,5402000}',
        '{1,3,1,3}');
insert into petro.land_freehold (land_key, bounds, path)
values (501032312, '(-114.0,52.1),(-114.1,52.0)', '{-11410000,5200000,-11400000,5200000,-11400000,5210000}');
insert into petro.land_sale_parcels (sale_date, contract_no, land, bounds, path)
values ('2026-11-04', 'A0001', '51806024', '(-115.975,54.0145),(-116,54)',
        '{-11600000,5400000,-11597500,5400000,-11597500,5401450,-11600000,5401450}');

select is(
  (select rings from petro.land_agreements where agreement_number = '924'),
  '{}'::integer[],
  'one polygon of one ring needs no counts'
);
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'petro' and column_name = 'shape'
     and table_name in ('land_agreements', 'land_offsets', 'land_freehold', 'land_sale_parcels')),
  0,
  'no land table keeps a JSON shape any more'
);

select ok((select petro.schema_version()) >= 24, 'the schema is at version 24 or later');
select throws_ok(
  $$insert into petro.land_freehold (bounds) values ('(1,1),(0,0)')$$,
  '23502', null, 'a row keeps its path'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, bounds)
    values ('2026-11-04', 'A0002', '1', '(1,1),(0,0)')$$,
  '23502', null, 'a parcel keeps its path too'
);
select throws_ok(
  $$insert into petro.land_offsets (offset_number, bounds, path) values ('1', '(1,1),(0,0)', '{0,0,1,0,1}')$$,
  '23514', null, 'a path is whole pairs'
);
select throws_ok(
  $$insert into petro.land_offsets (offset_number, bounds, path) values ('1', '(1,1),(0,0)', '{0,0,1,0}')$$,
  '23514', null, 'a path holds at least three points'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, bounds, path)
    values ('2026-11-04', 'A0003', '1', '(1,1),(0,0)', '{{0,0,1},{0,1,1}}')$$,
  '23514', null, 'a path is one list'
);
select throws_ok(
  $$insert into petro.land_freehold (bounds, path, rings)
    values ('(1,1),(0,0)', '{0,0,1,0,1,1}', '{{1},{3}}')$$,
  '23514', null, 'the counts are one list'
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

-- A member reads both forms; without a member, nothing.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(
  pg_temp.as_petro('select string_agg(agreement_number || '':'' || (path is not null)::text, '' '' order by agreement_number) from petro.land_agreements'),
  '924:true', 'a member reads the rows and their paths');
select is(
  pg_temp.as_petro('select (cardinality(path) / 2)::text || '' '' || rings::text from petro.land_offsets'),
  '6 {1,3,1,3}', 'a member reads a path with its counts');
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.land_agreements) + (select count(*) from petro.land_offsets) + (select count(*) from petro.land_freehold) + (select count(*) from petro.land_sale_parcels))::text'),
  '0', 'without a member nothing is read');

select * from finish();
rollback;
