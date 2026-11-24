-- Licence transfers (F-295, 20261208010000_petro_licence_transfers.sql). Members read, nobody but
-- the database's owner (the "Load licence transfers" workflow) writes, and the record of loads
-- and transfers is never changed or removed. One transaction, rolled back. Made-up companies and
-- licences only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(19);

select ok((select petro.schema_version()) >= 21, 'the schema is at version 21 or later');
select is(
  (select count(*)::int
   from unnest(array['petro.licence_loads', 'petro.licence_companies', 'petro.licence_holdings',
                     'petro.licence_transfers']) t
   where has_table_privilege('petro_api', t, 'select')),
  4,
  'petro_api reads the licence record'
);
select is(
  (select count(*)::int
   from unnest(array['petro.licence_loads', 'petro.licence_companies', 'petro.licence_holdings',
                     'petro.licence_transfers']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.licence_loads', 'petro.licence_companies', 'petro.licence_holdings',
                      'petro.licence_transfers']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the licence record'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.licence_loads'::regclass, 'petro.licence_companies'::regclass,
                 'petro.licence_holdings'::regclass, 'petro.licence_transfers'::regclass)),
  'row level security is on'
);
select ok(
  not has_function_privilege('petro_api', 'petro.keep_licence_record()', 'execute'),
  'petro_api cannot run the keeping trigger''s function'
);

-- The owner (the load) writes: a first load, then one compared with it.
insert into petro.licence_loads (alberta_day, wells, facilities, pipelines, added, transfers,
  skipped, ambiguous)
values ('2030-01-01', 2, 0, 0, 2, 0, 0, 0);
insert into petro.licence_companies (ba_code, name) values ('ZZ01', 'Test Oil Corp.'),
  ('ZZ02', 'Example Energy Ltd.');
insert into petro.licence_holdings (kind, ba_code, licences)
values ('well', 'ZZ01', array['W 9999998']), ('well', 'ZZ02', array['W 9999999']);
insert into petro.licence_loads (alberta_day, previous_load_id, wells, facilities, pipelines,
  added, transfers, skipped, ambiguous)
select '2030-01-02', id, 2, 0, 0, 0, 1, 0, 0 from petro.licence_loads;
insert into petro.licence_transfers (load_id, kind, licence, from_ba, from_name, to_ba, to_name)
select max(id), 'well', 'W 9999998', 'ZZ01', 'Test Oil Corp.', 'ZZ02', 'Example Energy Ltd.'
from petro.licence_loads;

select throws_ok(
  $$insert into petro.licence_loads (alberta_day, wells, facilities, pipelines, added, transfers,
      skipped, ambiguous) values ('2030-01-03', 0, 0, 0, 0, 0, 0, 0)$$,
  '23505', null, 'there is only one first load'
);
select throws_ok(
  $$insert into petro.licence_loads (alberta_day, previous_load_id, wells, facilities, pipelines,
      added, transfers, skipped, ambiguous)
    select '2030-01-03', min(id), 0, 0, 0, 0, 0, 0, 0 from petro.licence_loads$$,
  '23505', null, 'two loads never compare with the same one'
);
select throws_ok(
  $$insert into petro.licence_transfers (load_id, kind, licence, from_ba, to_ba, to_name)
    select max(id), 'well', 'W 9999999', 'ZZ02', 'ZZ02', 'x' from petro.licence_loads$$,
  '23514', null, 'a transfer is to another company'
);
select throws_ok(
  $$insert into petro.licence_holdings (kind, ba_code, licences) values ('well', 'ZZ03', '{}')$$,
  '23514', null, 'a company''s holdings are never empty'
);
select throws_ok(
  $$update petro.licence_transfers set to_ba = 'ZZ01'$$,
  '23514', null, 'a transfer is never changed, by the owner either'
);
select throws_ok(
  $$delete from petro.licence_loads$$,
  '23514', null, 'a load is never removed'
);
select throws_ok(
  $$truncate petro.licence_transfers$$,
  '23514', null, 'the transfers are never emptied'
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
select is(pg_temp.as_petro('select count(*)::text from petro.licence_transfers'), '1',
          'a member reads the transfers');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.licence_loads) + (select count(*) from petro.licence_companies) + (select count(*) from petro.licence_holdings))::text'),
  '6', 'a member reads the loads, companies and holdings');
select throws_ok(
  pg_temp.try('with u as (update petro.licence_companies set name = $$x$$ returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no company'
);
select throws_ok(
  pg_temp.try('with d as (delete from petro.licence_holdings returning 1) select count(*)::text from d'),
  '42501', null, 'a member removes no holdings'
);

-- Without a member, nothing is read; a job reads nothing either.
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.licence_transfers) + (select count(*) from petro.licence_loads) + (select count(*) from petro.licence_holdings) + (select count(*) from petro.licence_companies))::text'),
  '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.licence_transfers'), '0',
          'a job reads no transfers');

select * from finish();
rollback;
