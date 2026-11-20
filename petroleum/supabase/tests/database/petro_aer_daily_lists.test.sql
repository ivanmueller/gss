-- The AER's daily lists (F-243 part 1, 20261120010000_petro_aer_daily_lists.sql): who reads and
-- writes them, what never changes, the checks, and what is served.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(47);

-- Privileges.
select ok(
  has_table_privilege('petro_api', 'petro.aer_list_files', 'select')
  and has_table_privilege('petro_api', 'petro.aer_served_licences', 'select')
  and has_column_privilege('petro_api', 'petro.aer_list_files', 'body', 'insert')
  and has_column_privilege('petro_api', 'petro.aer_licences', 'licence_number', 'insert'),
  'petro_api reads the lists and inserts the columns the job writes'
);
select ok(
  not has_column_privilege('petro_api', 'petro.aer_list_files', 'id', 'insert')
  and not has_column_privilege('petro_api', 'petro.aer_list_files', 'stored_at', 'insert')
  and not has_column_privilege('petro_api', 'petro.aer_list_reads', 'read_at', 'insert')
  and not has_column_privilege('petro_api', 'petro.ats_lsd_points', 'tried_at', 'insert'),
  'ids and times are the database''s to set'
);
select ok(
  (select bool_and(not has_table_privilege('petro_api', t, p))
   from unnest(array['petro.aer_list_files', 'petro.aer_list_editions', 'petro.aer_list_reads',
                     'petro.aer_licences', 'petro.aer_rig_activities', 'petro.ats_lsd_points']) t,
        unnest(array['update', 'delete', 'truncate']) p),
  'petro_api cannot update every column, delete or truncate any AER table'
);
select ok(
  has_column_privilege('petro_api', 'petro.ats_lsd_points', 'found', 'update')
  and not has_column_privilege('petro_api', 'petro.ats_lsd_points', 'lsd', 'update')
  and not has_column_privilege('petro_api', 'petro.aer_list_reads', 'status', 'update'),
  'only a retried point''s result can be updated'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.aer_list_files', 'petro.aer_list_editions', 'petro.aer_list_reads',
                     'petro.aer_licences', 'petro.aer_rig_activities', 'petro.ats_lsd_points',
                     'petro.aer_served_licences']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'public, anon, authenticated and service_role hold nothing on the AER tables'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.aer_list_files'::regclass, 'petro.aer_list_editions'::regclass,
                 'petro.aer_list_reads'::regclass, 'petro.aer_licences'::regclass,
                 'petro.aer_rig_activities'::regclass, 'petro.ats_lsd_points'::regclass)),
  'row level security is on for every AER table'
);
select ok(
  not has_function_privilege('petro_api', 'petro.check_aer_list_file()', 'execute')
  and not has_function_privilege('petro_api', 'petro.check_aer_list_edition()', 'execute')
  and not has_function_privilege('petro_api', 'petro.keep_ats_lsd_point()', 'execute')
  and not has_function_privilege('anon', 'petro.aer_job_writing()', 'execute'),
  'the trigger functions are out of reach; the rules only for petro_api'
);
select ok((select petro.schema_version()) >= 3, 'the schema is at version 3 or later');

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

-- The statement throws_ok runs: the query as petro_api.
create function pg_temp.try(query text) returns text
language sql as $fn$ select format('select pg_temp.as_petro(%L)', query) $fn$;

create function pg_temp.be(usr text, org text, member_role text, job text) returns void
language sql as $fn$
  select set_config('petro.user_id', usr, true),
         set_config('petro.organization_id', org, true),
         set_config('petro.member_role', member_role, true),
         set_config('petro.job', job, true);
$fn$;

create function pg_temp.job() returns void
language sql as $fn$ select pg_temp.be('', '', '', 'aer_lists') $fn$;

create function pg_temp.member() returns void
language sql as $fn$
  select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                    '00000000-0000-4000-8000-0000000000b1', 'viewer', '')
$fn$;

create function pg_temp.file(report text, body text) returns text
language sql as $fn$
  select format(
    'insert into petro.aer_list_files (report, body, body_sha256) values (%L, %L, %L)
     returning id::text',
    report, body, encode(sha256(convert_to(body, 'UTF8')), 'hex'))
$fn$;

create function pg_temp.edition(file_id text, url text) returns text
language sql as $fn$
  select format(
    'insert into petro.aer_list_editions (file_id, source_url, seen_at)
     values (%L, %L, clock_timestamp()) returning id::text',
    file_id, url)
$fn$;

create function pg_temp.reading(file_id text, version int, status text, list_date text, n int,
  skipped int) returns text
language sql as $fn$
  select format(
    'insert into petro.aer_list_reads (file_id, reader_version, status, list_date, rows_read,
       rows_skipped) values (%L, %s, %L, %L, %s, %s) returning id::text',
    file_id, version, status, list_date, n, skipped)
$fn$;

create function pg_temp.licence(read_id text, line int, num text, loc text) returns text
language sql as $fn$
  select format(
    'insert into petro.aer_licences (read_id, line_no, licence_number, well_name, mineral_rights,
       ground_elevation, uwi, surface_offsets, field_centre, projected_depth, classification,
       field, terminating_zone, drilling_operation, well_purpose, well_type, substance, licensee,
       surface_location, lsd, section, township, range, meridian)
     values (%L, %s, %L, ''EXAMPLE 1-2-3-4'', ''ALBERTA CROWN'', ''700.1M'',
       ''100/01-02-003-04W5/00'', '''', ''RED DEER'', ''2500.0M'', ''DEV (NC)'', ''TESTFIELD'',
       ''CARDIUM FM'', ''HORIZONTAL'', ''NEW'', ''PRODUCTION'', ''CRUDE OIL'',
       ''EXAMPLE ENERGY LTD.'', %L, %s, %s, %s, %s, %s) returning line_no::text',
    read_id, line, num, loc,
    split_part(loc, '-', 1)::int, split_part(loc, '-', 2)::int, split_part(loc, '-', 3)::int,
    split_part(split_part(loc, '-', 4), 'W', 1)::int, split_part(loc, 'W', 2)::int)
$fn$;

\set st1_mon 'https://static.aer.ca/prd/data/well-lic/WELLSMON.TXT'
\set st1_tue 'https://static.aer.ca/prd/data/well-lic/WELLSTUE.TXT'
\set st49_mon 'https://static.aer.ca/prd/data/wells/SPUDMon.txt'

-- Without a context nothing is written.
select throws_ok(
  pg_temp.try(pg_temp.file('st1', 'no context')),
  '42501', null, 'without a context nothing is stored'
);

-- A member reads but never writes, even when it also names the job (F-243-1 plan).
select pg_temp.member();
select throws_ok(
  pg_temp.try(pg_temp.file('st1', 'a member')),
  '42501', null, 'a member cannot store a file'
);
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'org_admin', 'aer_lists');
select throws_ok(
  pg_temp.try(pg_temp.file('st1', 'a member as the job')),
  '42501', null, 'a member that also names the job cannot store a file'
);
select pg_temp.be('', '', '', 'other_job');
select throws_ok(
  pg_temp.try(pg_temp.file('st1', 'another job')),
  '42501', null, 'an unknown job cannot store a file'
);

-- The job stores files, editions and readings.
select pg_temp.job();
select pg_temp.as_petro(pg_temp.file('st1', 'list A')) as file_a \gset
select pg_temp.as_petro(pg_temp.file('st1', 'list B')) as file_b \gset
select pg_temp.as_petro(pg_temp.file('st49', 'rigs')) as file_r \gset
select ok(:'file_a' is not null and :'file_b' is not null, 'the job stores files');
select throws_ok(
  pg_temp.try(format(
    'insert into petro.aer_list_files (report, body, body_sha256) values (''st1'', ''x'', %L)
     returning id::text', repeat('0', 64))),
  '23514', null, 'a file''s hash must be its body''s'
);
select throws_ok(
  pg_temp.try(pg_temp.file('st1', 'list A')),
  '23505', null, 'a content is stored once per report'
);

-- Editions: A, B, then A again are three; the same file twice in a row is refused
-- (F-243-1-D1-01, D2-05).
select pg_temp.as_petro(pg_temp.edition(:'file_a', :'st1_mon'));
select pg_temp.as_petro(pg_temp.edition(:'file_b', :'st1_mon'));
select throws_ok(
  pg_temp.try(pg_temp.edition(:'file_b', :'st1_mon')),
  '23514', null, 'an edition must change its address''s contents'
);
select pg_temp.as_petro(pg_temp.edition(:'file_a', :'st1_mon'));
select is(
  (select array_agg(file_id::text order by seen_at, id) from petro.aer_list_editions
   where source_url = :'st1_mon'),
  array[:'file_a', :'file_b', :'file_a'],
  'A, B, then A again are three editions'
);
select throws_ok(
  pg_temp.try(pg_temp.edition(:'file_a', :'st49_mon')),
  '23514', null, 'an address of one report cannot hold a file of the other'
);
select throws_ok(
  pg_temp.try(pg_temp.edition(:'file_a', 'https://example.com/WELLSMON.TXT')),
  '23514', null, 'only the AER''s fixed addresses are kept'
);

-- Readings.
select throws_ok(
  pg_temp.try(pg_temp.reading(:'file_a', 1, 'read', null, 1, 0)),
  '23514', null, 'a usable reading has its list''s date'
);
select throws_ok(
  pg_temp.try(pg_temp.reading(:'file_a', 1, 'unreadable', null, 3, 0)),
  '23514', null, 'an unreadable reading has no rows'
);
select throws_ok(
  pg_temp.try(pg_temp.reading(:'file_a', 1, 'read', '2026-11-09', 2, 1)),
  '23514', null, 'a reading that skipped records is partial'
);
select pg_temp.as_petro(pg_temp.reading(:'file_a', 1, 'read', '2026-11-09', 1, 0)) as read_a1 \gset
select pg_temp.as_petro(pg_temp.reading(:'file_b', 1, 'read', '2026-11-09', 1, 0)) as read_b1 \gset
select throws_ok(
  pg_temp.try(pg_temp.reading(:'file_a', 1, 'partial', '2026-11-09', 1, 1)),
  '23505', null, 'a file is read once per reader version'
);

-- Licences.
select pg_temp.as_petro(pg_temp.licence(:'read_a1', 18, '0526001', '10-12-095-05W4'));
select pg_temp.as_petro(pg_temp.licence(:'read_b1', 18, '0526001', '01-05-062-26W4'));
select throws_ok(
  pg_temp.try(pg_temp.licence(:'read_a1', 24, '52600', '10-12-095-05W4')),
  '23514', null, 'a licence number has 7 digits'
);
select throws_ok(
  pg_temp.try(replace(pg_temp.licence(:'read_a1', 30, '0526002', '10-12-095-05W4'),
    '10-12-095-05W4', '10-12-095-06W4')),
  '23514', null, 'the parsed subdivision must be the published location''s'
);

-- What is served: for 9 November, A was seen last (A, B, A), so its licence location is served.
select is(
  (select surface_location from petro.aer_served_licences where licence_number = '0526001'),
  '10-12-095-05W4',
  'a list date is served from its newest edition (A, B, then A again serves A)'
);
-- A later list date corrects the licence's location: the licence moves (F-243-1-D2-06).
select pg_temp.as_petro(pg_temp.file('st1', 'list C')) as file_c \gset
select pg_temp.as_petro(pg_temp.edition(:'file_c', :'st1_tue'));
select pg_temp.as_petro(pg_temp.reading(:'file_c', 1, 'read', '2026-11-17', 1, 0)) as read_c1 \gset
select pg_temp.as_petro(pg_temp.licence(:'read_c1', 18, '0526001', '04-24-041-02W4'));
select is(
  (select surface_location || ' ' || list_date::text from petro.aer_served_licences
   where licence_number = '0526001'),
  '04-24-041-02W4 2026-11-17',
  'a licence is served from its latest list date'
);
-- A newer edition that is unreadable never displaces a usable one (F-243-1-D1-02).
select pg_temp.as_petro(pg_temp.file('st1', 'list D, broken')) as file_d \gset
select pg_temp.as_petro(pg_temp.edition(:'file_d', :'st1_tue'));
select pg_temp.as_petro(pg_temp.reading(:'file_d', 1, 'unreadable', null, 0, 0));
select is(
  (select file_id::text from petro.aer_served_reads where report = 'st1' and list_date = '2026-11-17'),
  :'file_c',
  'an unreadable newer edition never displaces a usable one'
);
-- A newer edition that is only partly read does not displace a fully read one of the same date.
select pg_temp.as_petro(pg_temp.file('st1', 'list E, partial')) as file_e \gset
select pg_temp.as_petro(pg_temp.edition(:'file_e', :'st1_tue'));
select pg_temp.as_petro(pg_temp.reading(:'file_e', 1, 'partial', '2026-11-17', 1, 2));
select is(
  (select file_id::text from petro.aer_served_reads where report = 'st1' and list_date = '2026-11-17'),
  :'file_c',
  'a fully read edition is served before a partly read newer one'
);
-- A list with any record the reader could not read is never served (F-243-1-R2-02).
select pg_temp.as_petro(pg_temp.file('st1', 'list F, partial only')) as file_f \gset
select pg_temp.as_petro(pg_temp.edition(:'file_f', :'st1_mon'));
select pg_temp.as_petro(pg_temp.reading(:'file_f', 1, 'partial', '2026-11-18', 1, 1));
select is(
  (select count(*)::int from petro.aer_served_reads where report = 'st1' and list_date = '2026-11-18'),
  0,
  'a partly read list is never served'
);
-- A reader upgrade that fails on a file keeps its earlier usable reading (F-243-1-D2-03).
select pg_temp.as_petro(pg_temp.reading(:'file_c', 2, 'unreadable', null, 0, 0));
select is(
  (select reader_version from petro.aer_usable_reads where file_id = :'file_c'::uuid),
  1,
  'a failed re-reading keeps the earlier usable reading'
);
select pg_temp.as_petro(pg_temp.reading(:'file_a', 2, 'read', '2026-11-09', 1, 0));
select is(
  (select reader_version from petro.aer_usable_reads where file_id = :'file_a'::uuid),
  2,
  'a successful re-reading takes over'
);

-- Rig activity.
select pg_temp.as_petro(pg_temp.reading(:'file_r', 1, 'read', '2026-11-17', 1, 0)) as read_r1 \gset
select is(
  pg_temp.as_petro(format(
    'insert into petro.aer_rig_activities (read_id, line_no, well_id, well_name, licence_number,
       contractor_ba_id, contractor_name, rig_number, activity_local, activity_wall_time,
       activity_at, field_centre, licensee_ba_id, licensee_name, new_projected_depth,
       activity_type, bottom_lsd, bottom_section, bottom_township, bottom_range, bottom_meridian)
     values (%L, 8, ''02/02-27-017-13W4/0'', ''EXAMPLE'', ''0526001'', ''A1XX'', ''Example'',
       ''11'', ''15 Nov 2026 08:30:15 PM'', ''2026-11-15T20:30:15'',
       ''2026-11-16T02:30:15Z'', ''Medicine Hat'', ''A7XX'', ''Example'', '''',
       ''Drill to LD'', 2, 27, 17, 13, 4) returning line_no::text', :'read_r1')),
  '8',
  'the job stores rig activity'
);
select throws_ok(
  pg_temp.try(format(
    'insert into petro.aer_rig_activities (read_id, line_no, well_id, well_name, licence_number,
       contractor_ba_id, contractor_name, rig_number, activity_local, activity_wall_time,
       activity_at, field_centre, licensee_ba_id, licensee_name, new_projected_depth,
       activity_type, bottom_lsd, bottom_section, bottom_township, bottom_range, bottom_meridian)
     values (%L, 9, ''02/02-27-017-13W4/0'', ''EXAMPLE'', ''0526001'', '''', '''', '''', '''',
       ''2026-11-15T20:30'', now(), '''', '''', '''', '''', '''', 2, 27, 17, 13, 4)
     returning line_no::text', :'read_r1')),
  '23514', null, 'a rig activity''s wall time keeps its seconds'
);

-- Township grid points.
select is(
  pg_temp.as_petro(
    'insert into petro.ats_lsd_points (meridian, range, township, section, lsd, longitude,
       latitude, found) values (4, 5, 95, 12, 10, -110.666926, 57.229894, true)
     returning found::text'),
  'true',
  'the job stores a point'
);
select throws_ok(
  pg_temp.try(
    'insert into petro.ats_lsd_points (meridian, range, township, section, lsd, longitude,
       latitude, found) values (4, 5, 95, 12, 11, -100.0, 57.2, true) returning found::text'),
  '23514', null, 'a found point lies in Alberta'
);
select pg_temp.as_petro(
  'insert into petro.ats_lsd_points (meridian, range, township, section, lsd, found)
   values (4, 5, 95, 12, 12, false) returning found::text');
select throws_ok(
  pg_temp.try(
    'with u as (update petro.ats_lsd_points set longitude = -110.6, latitude = 57.2,
       found = true, tried_at = now(), attempts = attempts + 1
     where (meridian, range, township, section, lsd) = (4, 5, 95, 12, 10) returning 1)
     select count(*)::text from u'),
  '23514', null, 'a found point never changes'
);
select throws_ok(
  pg_temp.try(
    'with u as (update petro.ats_lsd_points set found = false, tried_at = now(),
       attempts = attempts + 1
     where (meridian, range, township, section, lsd) = (4, 5, 95, 12, 12) returning 1)
     select count(*)::text from u'),
  '23514', null, 'a point not found is asked again only after a week'
);
-- Setup only, as the owner and with triggers off: the point was tried 8 days ago.
reset role;
set local session_replication_role = replica;
update petro.ats_lsd_points set tried_at = now() - interval '8 days'
  where (meridian, range, township, section, lsd) = (4, 5, 95, 12, 12);
set local session_replication_role = origin;
select is(
  pg_temp.as_petro(
    'with u as (update petro.ats_lsd_points set longitude = -110.6, latitude = 57.2,
       found = true, tried_at = now(), attempts = attempts + 1
     where (meridian, range, township, section, lsd) = (4, 5, 95, 12, 12) returning 1)
     select count(*)::text from u'),
  '1',
  'a point not found for a week is asked again'
);

-- Nothing is deleted.
select throws_ok(
  pg_temp.try('with d as (delete from petro.aer_list_files returning 1) select count(*)::text from d'),
  '42501', null, 'the job cannot delete a file'
);
select throws_ok(
  pg_temp.try('with u as (update petro.aer_list_reads set status = ''read'' returning 1) select count(*)::text from u'),
  '42501', null, 'the job cannot change a reading'
);

-- Who reads: a member reads everything served; no context reads nothing.
select pg_temp.member();
select is(
  pg_temp.as_petro('select count(*)::text from petro.aer_served_licences'),
  '1',
  'a member reads the served licences'
);
select is(
  pg_temp.as_petro('select count(*)::text from petro.ats_lsd_points'),
  '2',
  'a member reads the points'
);
-- Row level security leaves a member no point to update.
select is(
  pg_temp.as_petro(
    'with u as (update petro.ats_lsd_points set attempts = attempts returning 1) select count(*)::text from u'),
  '0',
  'a member changes no point'
);
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.aer_list_files'),
  '0',
  'without a context nothing is read'
);
select is(
  pg_temp.as_petro('select count(*)::text from petro.aer_served_licences'),
  '0',
  'without a context nothing is served'
);
select pg_temp.be('00000000-0000-4000-8000-0000000000a1', '', 'viewer', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.aer_licences'),
  '0',
  'a person without an organization reads nothing'
);

select * from finish();
rollback;
