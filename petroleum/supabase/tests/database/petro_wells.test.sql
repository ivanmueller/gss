-- Alberta's wells (F-243 part 3, 20261121010000_petro_wells.sql): who reads and writes them, the
-- loads' rules, and which wells are current. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(23);

select ok((select petro.schema_version()) >= 4, 'the schema is at version 4 or later');
select ok(
  has_table_privilege('petro_api', 'petro.wells', 'select')
  and has_table_privilege('petro_api', 'petro.current_wells', 'select')
  and has_column_privilege('petro_api', 'petro.wells', 'uwi', 'insert')
  and not has_column_privilege('petro_api', 'petro.wells', 'first_seen_at', 'insert')
  and not has_column_privilege('petro_api', 'petro.wells', 'uwi', 'update')
  and not has_column_privilege('petro_api', 'petro.well_loads', 'id', 'insert'),
  'petro_api reads, and writes only the columns the job writes'
);
select ok(
  (select bool_and(not has_table_privilege('petro_api', t, p))
   from unnest(array['petro.wells', 'petro.well_loads']) t, unnest(array['delete', 'truncate']) p),
  'nothing is deleted'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.wells', 'petro.well_loads', 'petro.current_wells']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the wells'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.wells'::regclass, 'petro.well_loads'::regclass)),
  'row level security is on'
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

create function pg_temp.well(uwi text, load_id text) returns text
language sql as $fn$
  select format(
    'insert into petro.wells (uwi, source_object_id, well_name, operator_code, operator_name,
       well_type, status_code, status, final_drill_date, longitude, latitude, load_id)
     values (%L, 1, ''EXAMPLE'', ''A62D'', ''Example Energy Ltd.'', ''Oil'', ''0111000000'',
       ''Oil'', ''1999-01-01'', -113.6, 53.4, %s) returning uwi',
    uwi, load_id)
$fn$;

-- A member, or the AER job, cannot write wells; the wells job can.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'org_admin', 'wells');
select throws_ok(
  pg_temp.try('insert into petro.well_loads (status) values (''running'') returning id::text'),
  '42501', null, 'a member that names the wells job cannot start a load'
);
select pg_temp.be('', '', '', 'aer_lists');
select throws_ok(
  pg_temp.try('insert into petro.well_loads (status) values (''running'') returning id::text'),
  '42501', null, 'the AER job cannot start a wells load'
);
select pg_temp.be('', '', '', 'wells');
select pg_temp.as_petro('insert into petro.well_loads (status) values (''running'') returning id::text') as load1 \gset
select throws_ok(
  pg_temp.try('insert into petro.well_loads (status) values (''running'') returning id::text'),
  '23505', null, 'one load runs at a time'
);
select is(pg_temp.as_petro(pg_temp.well('0514250908000', :'load1')), '0514250908000', 'the job stores a well');
select pg_temp.as_petro(pg_temp.well('0514250908001', :'load1'));
select throws_ok(
  pg_temp.try(replace(pg_temp.well('0514250908002', :'load1'), '-113.6', '-100.0')),
  '23514', null, 'a well lies in Alberta'
);
select throws_ok(
  pg_temp.try(pg_temp.well('bad', :'load1')),
  '23514', null, 'a UWI has the province''s form'
);
select pg_temp.as_petro('with u as (update petro.well_loads set last_object_id = 50 where id = ' || :'load1' || ' returning 1) select count(*)::text from u');
select throws_ok(
  pg_temp.try('with u as (update petro.well_loads set last_object_id = 10 where id = ' || :'load1' || ' returning 1) select count(*)::text from u'),
  '23514', null, 'a load''s cursor never moves back (F-243-3-D1-03)'
);
select is(
  pg_temp.as_petro('with u as (update petro.well_loads set last_object_id = 100, status = ''done'', finished_at = now() where id = ' || :'load1' || ' returning 1) select count(*)::text from u'),
  '1',
  'a load finishes'
);
select throws_ok(
  pg_temp.try('with u as (update petro.well_loads set rows_saved = 5 where id = ' || :'load1' || ' returning 1) select count(*)::text from u'),
  '23514', null, 'a finished load does not change'
);
select is(pg_temp.as_petro('select count(*)::text from petro.current_wells'), '2', 'both wells are current');

-- A second load sees only one of them: the other stays current until that load finishes clean.
select pg_temp.as_petro('insert into petro.well_loads (status) values (''running'') returning id::text') as load2 \gset
select pg_temp.as_petro('with u as (update petro.wells set load_id = ' || :'load2' || ' where uwi = ''0514250908000'' returning 1) select count(*)::text from u');
select is(pg_temp.as_petro('select count(*)::text from petro.current_wells'), '2', 'a running load retires nothing');
select pg_temp.as_petro('with u as (update petro.well_loads set last_object_id = 200, status = ''done_unclean'', finished_at = now() where id = ' || :'load2' || ' returning 1) select count(*)::text from u');
select is(pg_temp.as_petro('select count(*)::text from petro.current_wells'), '2', 'an unclean load retires nothing (F-243-3-D1-01)');
select pg_temp.as_petro('insert into petro.well_loads (status) values (''running'') returning id::text') as load3 \gset
select pg_temp.as_petro('with u as (update petro.wells set load_id = ' || :'load3' || ' where uwi = ''0514250908000'' returning 1) select count(*)::text from u');
select pg_temp.as_petro('with u as (update petro.well_loads set last_object_id = 300, status = ''done'', finished_at = now() where id = ' || :'load3' || ' returning 1) select count(*)::text from u');
select is(
  pg_temp.as_petro('select count(*)::text from petro.current_wells'),
  '2',
  'no well is retired automatically, even one a later load did not see (F-243-3-R3-01)'
);
select is(pg_temp.as_petro('select count(*)::text from petro.wells'), '2', 'the retired well is kept');

-- Who reads.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(pg_temp.as_petro('select count(*)::text from petro.current_wells'), '2', 'a member reads the wells');
select is(
  pg_temp.as_petro('with u as (update petro.wells set well_name = ''x'' returning 1) select count(*)::text from u'),
  '0',
  'a member changes no well'
);
select pg_temp.be('', '', '', '');
select is(pg_temp.as_petro('select count(*)::text from petro.wells'), '0', 'without a context nothing is read');
select pg_temp.be('', '', '', 'aer_lists');
select is(pg_temp.as_petro('select count(*)::text from petro.wells'), '0', 'the AER job reads no wells');

select * from finish();
rollback;
