-- More of each Crown land sale parcel (F-265, 20261128010000_petro_land_sale_details.sql): the
-- restriction and reversion zone codes and each sale's documents. Members read, nobody but the
-- database's owner (the manual load) writes. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(12);

select ok((select petro.schema_version()) >= 11, 'the schema is at version 11 or later');
select is(
  (select count(*)::int
   from unnest(array['petro.land_sale_parcels', 'petro.land_sale_loads']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api still writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['restrictions', 'reversion_zones']) as c(name),
        unnest(array['select', 'insert', 'update']) as p(name)
   where has_column_privilege(r.name, 'petro.land_sale_parcels', c.name, p.name))
  + (select count(*)::int
     from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
          unnest(array['select', 'insert', 'update']) as p(name)
     where has_column_privilege(r.name, 'petro.land_sale_loads', 'documents', p.name)),
  0,
  'the Supabase API roles hold nothing on the new columns'
);

-- The owner (the manual load) writes.
insert into petro.land_sale_loads
  (source_url, first_sale, last_sale, west, south, east, north, sales, parcels, documents)
values ('https://content2.energy.alberta.ca/petroleum-and-natural-gas-tenure-public-offerings-and-results/',
        '2003-01-08', '2026-12-02', -117, 53, -115, 55, 1, 2,
        '{"2026-11-04": {"notice": "/download/?s=png&id=20261104PON&ft=.pdf", "results": "/download/?s=png&id=20261104PSR&ft=.pdf"}}');
insert into petro.land_sale_parcels
  (sale_date, contract_no, land, restrictions, reversion_zones, bounds, path)
values
  ('2026-11-04', 'A0001', '51806024', 'SHA010301 SHA010401', 'D00039 D00004',
   '(-116.0,54.1),(-116.1,54.0)',
   '{-11610000,5400000,-11600000,5400000,-11600000,5410000,-11610000,5410000}'),
  ('2026-11-04', 'A0002', '51806025', null, null, '(-115.0,53.1),(-115.1,53.0)',
   '{-11510000,5300000,-11500000,5300000,-11500000,5310000,-11510000,5310000}');

select is(
  (select restrictions || ' | ' || reversion_zones from petro.land_sale_parcels
   where contract_no = 'A0001'),
  'SHA010301 SHA010401 | D00039 D00004',
  'a parcel keeps its restriction and reversion zone codes'
);
select is(
  (select count(*)::int from petro.land_sale_parcels
   where restrictions is null and reversion_zones is null),
  1,
  'a parcel with none has none'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, restrictions, bounds, path)
    values ('2026-11-04', 'A0009', '51806024', 'SHA010301; drop table x', '(1,1),(0,0)',
            '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'restrictions are codes separated by spaces and nothing else'
);
select throws_ok(
  $$insert into petro.land_sale_parcels (sale_date, contract_no, land, reversion_zones, bounds, path)
    values ('2026-11-04', 'A0009', '51806024', '', '(1,1),(0,0)', '{0,0,100000,0,100000,100000}')$$,
  '23514', null, 'no codes is null, not an empty text'
);
select throws_ok(
  $$insert into petro.land_sale_loads
      (source_url, first_sale, last_sale, west, south, east, north, sales, parcels, documents)
    values ('https://content2.energy.alberta.ca/x', '2003-01-08', '2026-12-02', -117, 53, -115, 55,
            1, 1, '[]')$$,
  '23514', null, 'the documents are kept by sale date, in one object'
);
select is(
  (select count(*)::int from petro.land_sale_loads where documents ? '2026-11-04'),
  1,
  'a load keeps its sales'' documents'
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
  pg_temp.as_petro($$select restrictions from petro.land_sale_parcels where contract_no = 'A0001'$$),
  'SHA010301 SHA010401',
  'a member reads a parcel''s codes'
);
select is(
  pg_temp.as_petro($$select documents -> '2026-11-04' ->> 'notice' from petro.land_sale_loads order by id desc limit 1$$),
  '/download/?s=png&id=20261104PON&ft=.pdf',
  'a member reads a sale''s documents'
);
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.land_sale_loads'),
  '0',
  'without a member no documents are read'
);

select * from finish();
rollback;
