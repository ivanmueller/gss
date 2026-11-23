-- Alberta's royalty prices (F-285, 20261206010000_petro_prices.sql). Members read, nobody but the
-- database's owner (the "Load prices" workflow) writes. One transaction, rolled back. Synthetic
-- prices only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(15);

select ok((select petro.schema_version()) >= 19, 'the schema is at version 19 or later');
select is(
  (select count(*)::int
   from unnest(array['petro.price_loads', 'petro.reference_prices']) t
   where has_table_privilege('petro_api', t, 'select')),
  2,
  'petro_api reads the prices and their loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.price_loads', 'petro.reference_prices']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.price_loads', 'petro.reference_prices']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the prices'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.price_loads'::regclass, 'petro.reference_prices'::regclass)),
  'row level security is on'
);

-- The owner (the load) writes.
insert into petro.price_loads (prices, first_month, last_month, unread)
values (2, '2001-01-01', '2001-02-01', '{https://open.alberta.ca/example.pdf}');
insert into petro.reference_prices (series, month, price, unit, source_url) values
  ('gas_reference', '2001-01-01', 1.11, '$/GJ', 'https://www.alberta.ca/example'),
  ('oil_light_par', '2001-02-01', 222.22, '$/m3', 'https://inform.energy.gov.ab.ca/example.pdf');

select is(
  (select price from petro.reference_prices where series = 'oil_light_par'),
  222.2200::numeric,
  'a price is kept exactly, as a decimal'
);
select throws_ok(
  $$insert into petro.reference_prices (series, month, price, unit, source_url)
    values ('gas_reference', '2001-03-15', 1, '$/GJ', 'https://www.alberta.ca/x')$$,
  '23514', null, 'a price is for a whole month, kept as its first day'
);
select throws_ok(
  $$insert into petro.reference_prices (series, month, price, unit, source_url)
    values ('gas_reference', '2001-03-01', 1, '$/bbl', 'https://www.alberta.ca/x')$$,
  '23514', null, 'a price is in one of the province''s units'
);
select throws_ok(
  $$insert into petro.reference_prices (series, month, price, unit, source_url)
    values ('gas_reference', '2001-03-01', 1, '$/GJ', 'https://example.test/x')$$,
  '23514', null, 'a price comes from the province''s own sites'
);
select throws_ok(
  $$insert into petro.reference_prices (series, month, price, unit, source_url)
    values ('gas_reference', '2001-01-01', 2, '$/GJ', 'https://www.alberta.ca/x')$$,
  '23505', null, 'one price per series and month'
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
select is(pg_temp.as_petro('select count(*)::text from petro.reference_prices'), '2',
          'a member reads the prices');
select is(pg_temp.as_petro('select count(*)::text from petro.price_loads'), '1',
          'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.reference_prices set price = 0 returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no price'
);

-- Without a member, nothing is read; a job reads nothing either.
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.reference_prices) + (select count(*) from petro.price_loads))::text'),
  '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.reference_prices'), '0',
          'a job reads no price');

select * from finish();
rollback;
