-- Frac data (F-288, 20261207010000_petro_frac.sql). Members read, nobody but the database's owner
-- (the "Load frac data" workflow) writes. One transaction, rolled back. Synthetic wells only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(14);

select ok((select petro.schema_version()) >= 20, 'the schema is at version 20 or later');
select is(
  (select count(*)::int
   from unnest(array['petro.frac_loads', 'petro.frac_wells']) t
   where has_table_privilege('petro_api', t, 'select')),
  2,
  'petro_api reads the frac data and its loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.frac_loads', 'petro.frac_wells']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.frac_loads', 'petro.frac_wells']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the frac data'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.frac_loads'::regclass, 'petro.frac_wells'::regclass)),
  'row level security is on'
);

-- The owner (the load) writes.
insert into petro.frac_loads (source_url, source_date, wells, skipped)
values ('https://static.aer.ca/prd/documents/example.csv', '2026-11-16', 1, 0);
insert into petro.frac_wells (uwi, licence_number, first_frac_date, last_frac_date, fracs, stages,
  water_m3, proppant_t, upgrade_hint_t, refrac_proppant_t, max_tvd_m, suspect)
values ('00/11-23-030-27W4/2', '0999999', '2020-01-02', '2020-01-20', 1, 30, 40000.5, 4784.9,
  2027.21, 0, 3880.99, false);

select is(
  (select proppant_t from petro.frac_wells),
  4784.900::numeric,
  'proppant is kept exactly, as a decimal'
);
select throws_ok(
  $$insert into petro.frac_wells (uwi, licence_number, first_frac_date, last_frac_date, fracs,
      water_m3, proppant_t, upgrade_hint_t, refrac_proppant_t, suspect)
    values ('00/11-23-030-27W4/3', '1', '2020-01-02', '2020-01-01', 1, 0, 0, 0, 0, false)$$,
  '23514', null, 'a last frac is not before the first'
);
select throws_ok(
  $$insert into petro.frac_wells (uwi, licence_number, first_frac_date, last_frac_date, fracs,
      water_m3, proppant_t, upgrade_hint_t, refrac_proppant_t, suspect)
    values ('00/11-23-030-27W4/3', '1', '2020-01-02', '2020-01-02', 1, 0, 10, 11, 0, false)$$,
  '23514', null, 'the coated or ceramic hint is part of the proppant'
);
select throws_ok(
  $$insert into petro.frac_loads (source_url, wells, skipped)
    values ('https://example.test/x.csv', 1, 0)$$,
  '23514', null, 'a load names the AER''s own site'
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
select is(pg_temp.as_petro('select count(*)::text from petro.frac_wells'), '1',
          'a member reads the frac data');
select is(pg_temp.as_petro('select count(*)::text from petro.frac_loads'), '1',
          'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.frac_wells set proppant_t = 0 returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no frac data'
);

-- Without a member, nothing is read; a job reads nothing either.
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.frac_wells) + (select count(*) from petro.frac_loads))::text'),
  '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.frac_wells'), '0',
          'a job reads no frac data');

select * from finish();
rollback;
