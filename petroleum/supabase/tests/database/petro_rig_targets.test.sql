-- What each rig is drilling for (F-283, 20261205010000_petro_rig_targets.sql): who reads and writes
-- the licences' targets, and what never changes. Runs in one transaction that is rolled back. All
-- fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(14);

select ok((select petro.schema_version()) >= 18, 'the schema is at version 18 or later');

select ok(
  has_table_privilege('petro_api', 'petro.aer_licence_targets', 'select')
  and has_column_privilege('petro_api', 'petro.aer_licence_targets', 'terminating_zone', 'insert')
  and has_column_privilege('petro_api', 'petro.aer_licence_targets', 'found', 'update')
  and not has_column_privilege('petro_api', 'petro.aer_licence_targets', 'licence_number',
    'update')
  and not has_column_privilege('petro_api', 'petro.aer_licence_targets', 'tried_at', 'insert')
  and not has_table_privilege('petro_api', 'petro.aer_licence_targets', 'delete')
  and not has_table_privilege('petro_api', 'petro.aer_licence_targets', 'truncate'),
  'petro_api reads, inserts what the job writes, updates only a retried result, deletes nothing'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, 'petro.aer_licence_targets', p.name)),
  0,
  'public, anon, authenticated and service_role hold nothing on the licences'' targets'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'petro.aer_licence_targets'::regclass)
  and not has_function_privilege('petro_api', 'petro.keep_aer_licence_target()', 'execute'),
  'row level security is on, the trigger function out of reach'
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

create function pg_temp.target(num text, zone text) returns text
language sql as $fn$
  select case when zone is not null then format(
    'insert into petro.aer_licence_targets (licence_number, found, terminating_zone, list_date)
     values (%L, true, %L, ''2025-06-02'') returning licence_number', num, zone)
  else format(
    'insert into petro.aer_licence_targets (licence_number, found) values (%L, false)
     returning licence_number', num)
  end
$fn$;

-- A member reads but never writes.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select throws_ok(
  pg_temp.try(pg_temp.target('0500001', 'EXAMPLE FM')),
  '42501', null, 'a member cannot store a licence''s target'
);

-- The job stores targets, found or not.
select pg_temp.be('', '', '', 'aer_lists');
select is(
  pg_temp.as_petro(pg_temp.target('0500001', 'EXAMPLE FM')),
  '0500001',
  'the job stores a licence''s target'
);
select pg_temp.as_petro(pg_temp.target('0500002', null));
select throws_ok(
  pg_temp.try(
    'insert into petro.aer_licence_targets (licence_number, found, terminating_zone)
     values (''0500003'', true, ''EXAMPLE FM'') returning licence_number'),
  '23514', null, 'a found target has the date of its list'
);
select throws_ok(
  pg_temp.try(
    'insert into petro.aer_licence_targets (licence_number, found, terminating_zone)
     values (''0500004'', false, ''EXAMPLE FM'') returning licence_number'),
  '23514', null, 'a licence not found has nothing else'
);
select throws_ok(
  pg_temp.try(
    'with u as (update petro.aer_licence_targets set terminating_zone = ''OTHER FM'',
       tried_at = now(), attempts = attempts + 1 where licence_number = ''0500001'' returning 1)
     select count(*)::text from u'),
  '23514', null, 'a found target never changes'
);
select throws_ok(
  pg_temp.try(
    'with u as (update petro.aer_licence_targets set found = false, tried_at = now(),
       attempts = attempts + 1 where licence_number = ''0500002'' returning 1)
     select count(*)::text from u'),
  '23514', null, 'a licence not found is asked again only after a week'
);
-- Setup only, as the owner and with triggers off: the licence was tried 8 days ago.
reset role;
set local session_replication_role = replica;
update petro.aer_licence_targets set tried_at = now() - interval '8 days'
  where licence_number = '0500002';
set local session_replication_role = origin;
select is(
  pg_temp.as_petro(
    'with u as (update petro.aer_licence_targets set found = true,
       terminating_zone = ''EXAMPLE FM'', list_date = ''2024-01-05'', tried_at = now(),
       attempts = attempts + 1 where licence_number = ''0500002'' returning 1)
     select count(*)::text from u'),
  '1',
  'a licence not found for a week is asked again'
);

-- Members read the targets; a person with no organization reads nothing.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.aer_licence_targets'),
  '2',
  'a member reads every target'
);
select pg_temp.be('00000000-0000-4000-8000-0000000000a1', '', '', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.aer_licence_targets'),
  '0',
  'a person without an organization reads nothing'
);
select throws_ok(
  pg_temp.try(pg_temp.target('0500005', 'EXAMPLE FM')),
  '42501', null, 'a person without an organization cannot store a target'
);

select * from finish();
rollback;
