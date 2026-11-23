-- Rigs on the oil and gas map (F-282, 20261204010000_petro_rigs.sql): the monthly archives'
-- addresses, and the licences' locations: who reads and writes them, what never changes.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(19);

select ok((select petro.schema_version()) >= 17, 'the schema is at version 17 or later');

-- Privileges.
select ok(
  has_table_privilege('petro_api', 'petro.aer_licence_locations', 'select')
  and has_column_privilege('petro_api', 'petro.aer_licence_locations', 'licence_number', 'insert')
  and has_column_privilege('petro_api', 'petro.aer_licence_locations', 'found', 'update')
  and not has_column_privilege('petro_api', 'petro.aer_licence_locations', 'licence_number',
    'update')
  and not has_column_privilege('petro_api', 'petro.aer_licence_locations', 'tried_at', 'insert')
  and not has_table_privilege('petro_api', 'petro.aer_licence_locations', 'delete')
  and not has_table_privilege('petro_api', 'petro.aer_licence_locations', 'truncate'),
  'petro_api reads, inserts what the job writes, updates only a retried result, deletes nothing'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, 'petro.aer_licence_locations', p.name)),
  0,
  'public, anon, authenticated and service_role hold nothing on the licences'' locations'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'petro.aer_licence_locations'::regclass),
  'row level security is on'
);
select ok(
  not has_function_privilege('petro_api', 'petro.keep_aer_licence_location()', 'execute'),
  'the trigger function is out of reach'
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

create function pg_temp.location(num text, found boolean, lon text, lat text) returns text
language sql as $fn$
  select case when found then format(
    'insert into petro.aer_licence_locations (licence_number, found, surface_location, licensee,
       licence_status, longitude, latitude)
     values (%L, true, ''10-12-055-05W5'', ''Example Energy Ltd.(A1XX)'', ''Issued'', %s, %s)
     returning licence_number', num, lon, lat)
  else format(
    'insert into petro.aer_licence_locations (licence_number, found) values (%L, false)
     returning licence_number', num)
  end
$fn$;

-- A member reads but never writes.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select throws_ok(
  pg_temp.try(pg_temp.location('0500001', true, '-116.4', '53.5')),
  '42501', null, 'a member cannot store a licence''s location'
);

-- The job stores locations, found or not.
select pg_temp.be('', '', '', 'aer_lists');
select is(
  pg_temp.as_petro(pg_temp.location('0500001', true, '-116.412345', '53.512345')),
  '0500001',
  'the job stores a licence''s location'
);
select pg_temp.as_petro(pg_temp.location('0500002', false, null, null));
select throws_ok(
  pg_temp.try(pg_temp.location('0500003', true, '-100.0', '53.5')),
  '23514', null, 'a found location lies in Alberta'
);
select throws_ok(
  pg_temp.try(
    'insert into petro.aer_licence_locations (licence_number, found, licensee)
     values (''0500004'', false, ''Example'') returning licence_number'),
  '23514', null, 'a licence not found has nothing else'
);
select throws_ok(
  pg_temp.try(pg_temp.location('500005', true, '-116.4', '53.5')),
  '23514', null, 'a licence number is seven digits'
);
select throws_ok(
  pg_temp.try(
    'with u as (update petro.aer_licence_locations set longitude = -116.5, tried_at = now(),
       attempts = attempts + 1 where licence_number = ''0500001'' returning 1)
     select count(*)::text from u'),
  '23514', null, 'a found location never changes'
);
select throws_ok(
  pg_temp.try(
    'with u as (update petro.aer_licence_locations set found = false, tried_at = now(),
       attempts = attempts + 1 where licence_number = ''0500002'' returning 1)
     select count(*)::text from u'),
  '23514', null, 'a licence not found is asked again only after a week'
);
-- Setup only, as the owner and with triggers off: the licence was tried 8 days ago.
reset role;
set local session_replication_role = replica;
update petro.aer_licence_locations set tried_at = now() - interval '8 days'
  where licence_number = '0500002';
set local session_replication_role = origin;
select is(
  pg_temp.as_petro(
    'with u as (update petro.aer_licence_locations set found = true,
       surface_location = ''01-01-060-10W5'', licensee = ''Example'', licence_status = ''Issued'',
       longitude = -117.2, latitude = 54.1, tried_at = now(), attempts = attempts + 1
     where licence_number = ''0500002'' returning 1)
     select count(*)::text from u'),
  '1',
  'a licence not found for a week is asked again'
);

-- The archive addresses beside the daily ones; any other zip address is refused.
select pg_temp.as_petro(format(
  'insert into petro.aer_list_files (report, body, body_sha256) values (''st49'', %L, %L)
   returning id::text', 'archive day', encode(sha256(convert_to('archive day', 'UTF8')), 'hex')))
  as file_id \gset
select is(
  pg_temp.as_petro(format(
    'insert into petro.aer_list_editions (file_id, source_url, seen_at)
     values (%L, ''https://static.aer.ca/prd/data/wells/spud2026-09.zip#SPUD0901.txt'',
       clock_timestamp()) returning source_url', :'file_id')),
  'https://static.aer.ca/prd/data/wells/spud2026-09.zip#SPUD0901.txt',
  'a day of a monthly archive is kept at its own address'
);
select throws_ok(
  pg_temp.try(format(
    'insert into petro.aer_list_editions (file_id, source_url, seen_at)
     values (%L, ''https://static.aer.ca/prd/data/wells/spud2026-13.zip#SPUD1301.txt'',
       clock_timestamp()) returning source_url', :'file_id')),
  '23514', null, 'a month that does not exist is refused'
);
select throws_ok(
  pg_temp.try(format(
    'insert into petro.aer_list_editions (file_id, source_url, seen_at)
     values (%L, ''https://example.com/spud2026-09.zip#SPUD0901.txt'',
       clock_timestamp()) returning source_url', :'file_id')),
  '23514', null, 'only the AER''s archive addresses are kept'
);
select throws_ok(
  pg_temp.try(format(
    'insert into petro.aer_list_editions (file_id, source_url, seen_at)
     values (%L, ''https://static.aer.ca/prd/data/well-lic/spud2026-09.zip#SPUD0901.txt'',
       clock_timestamp()) returning source_url', :'file_id')),
  '23514', null, 'an archive is of the rig lists only'
);

-- Members read the locations; a person with no organization reads nothing.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.aer_licence_locations'),
  '2',
  'a member reads every location'
);
select pg_temp.be('00000000-0000-4000-8000-0000000000a1', '', '', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.aer_licence_locations'),
  '0',
  'a person without an organization reads nothing'
);

select * from finish();
rollback;
