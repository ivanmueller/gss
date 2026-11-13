-- Files on a sent email (20261117010000_email_sent_attachments.sql, F-114 step 7): listed with
-- the email by app.start_outgoing_email only, each with the storage key the database derives;
-- at most 10 files and 10 MiB, PDFs and JPEG or PNG photos, positions 0 to n-1; a received
-- email's attachment never has a key and a sent email's always has; the 13-argument wrapper still
-- works; never written directly, edited or deleted; privileges and other organizations. Runs in
-- one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000033aa', 'vic@example.test', '{"first_name": "Vic"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.email_settings (organization_id, shared_local_part, updated_by, updated_by_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'info', '00000000-0000-4000-8000-0000000044aa', 'Tom'),
  ('00000000-0000-4000-8000-0000000000bb', 'info', '00000000-0000-4000-8000-0000000011bb', 'Bob');

insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', null),
  ('00000000-0000-4000-8000-00000000c4aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', now()),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);

grant app_api to current_user;

-- A query as app_api for the given user.
create function pg_temp.api(uid text, query text) returns text
language plpgsql as $fn$
declare
  result text;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);
  set local role app_api;
  execute query into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

-- One file as the Worker lists it.
create function pg_temp.file(pos integer, size integer default 100,
                             kind text default 'application/pdf', name text default null)
returns jsonb
language sql as $fn$
  select jsonb_build_object('position', pos, 'file_name', coalesce(name, 'file-' || pos || '.pdf'),
                            'content_type', kind, 'size_bytes', size,
                            'sha256', encode(sha256(convert_to('file ' || pos, 'UTF8')), 'hex'))
$fn$;

-- n files of the given size each.
create function pg_temp.files(n integer, size integer default 100) returns jsonb
language sql as $fn$
  select coalesce(jsonb_agg(pg_temp.file(g, size) order by g), '[]'::jsonb)
    from generate_series(0, n - 1) g
$fn$;

-- Starting a sent email with files (the 14-argument function), from the shared address.
create function pg_temp.send(uid text, files jsonb, msg text default null,
                             company text default '00000000-0000-4000-8000-00000000c1aa',
                             org text default '00000000-0000-4000-8000-0000000000aa')
returns jsonb
language sql as $fn$
  select pg_temp.api(uid, format(
    'select app.start_outgoing_email(%L, %L, null, %L, %L, %L, %L, %L, %L, %L, null, null, null, %L)::text',
    org, company, 'info', 'gss.example', '{pat@buyer.example}'::text[], '{}'::text[], 'Hello',
    'Body text', coalesce(msg, '<' || gen_random_uuid() || '@gss.example>'), files))::jsonb
$fn$;

create function pg_temp.sent_files() returns integer language sql as $fn$
  select count(*)::integer from app.email_attachments where file_key is not null
$fn$;

-- Privileges ----------------------------------------------------------------
select ok(has_function_privilege('app_api',
            'app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid, jsonb)', 'execute'),
  'app_api starts an email with files');
select ok(not has_function_privilege('anon',
            'app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid, jsonb)', 'execute')
          and not has_function_privilege('authenticated',
            'app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid, jsonb)', 'execute')
          and not has_function_privilege('service_role',
            'app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid, jsonb)', 'execute'),
  'the Supabase API roles cannot');
select ok(not has_function_privilege('app_api', 'app.check_sent_attachments(jsonb)', 'execute')
          and not has_function_privilege('app_api', 'app.sent_attachments_max_bytes()', 'execute'),
  'app_api cannot call the helpers');
select ok(not has_table_privilege('app_api', 'app.email_attachments', 'insert')
          and not has_table_privilege('app_api', 'app.email_attachments', 'update')
          and not has_table_privilege('app_api', 'app.email_attachments', 'delete')
          and has_table_privilege('app_api', 'app.email_attachments', 'select'),
  'app_api only reads the attachments');

-- Starting with files -------------------------------------------------------
create temp table started as
  select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                      jsonb_build_array(pg_temp.file(0, 2048, 'application/pdf', 'Contract été.pdf'),
                                        pg_temp.file(1, 4096, 'image/jpeg', 'truck.jpg')),
                      '<with-files@gss.example>') as result;
select is((select result ->> 'status' from started), 'started', 'an email with two files starts');
select is((select jsonb_array_length(result -> 'file_keys') from started), 2, 'with two file keys');
select is((select result -> 'file_keys' ->> 1 from started),
          'sent/' || (select result ->> 'id' from started) || '/1-' ||
            encode(sha256(convert_to('file 1', 'UTF8')), 'hex'),
          'each key derived from the email, the position and the checksum');
select is((select array_agg(file_name order by position) from app.email_attachments
            where email_id = (select (result ->> 'id')::uuid from started)),
          '{"Contract été.pdf",truck.jpg}'::text[], 'the files are listed in order');
select is((select array_agg(file_key order by position) from app.email_attachments
            where email_id = (select (result ->> 'id')::uuid from started)),
          (select array(select jsonb_array_elements_text(result -> 'file_keys')) from started),
          'with the keys the function answered');
select is((select count(*)::integer from app.email_attachments
            where email_id = (select (result ->> 'id')::uuid from started)
              and disposition = 'attachment' and content_id is null
              and organization_id = '00000000-0000-4000-8000-0000000000aa'), 2,
          'as attachments of the organization');

select is(pg_temp.send('00000000-0000-4000-8000-0000000033aa', pg_temp.files(1)) ->> 'status',
          'started', 'a viewer sends files too (everyone on the team sends)');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.files(10, 1048576)) ->> 'status',
          'started', 'ten files of 1 MiB, exactly 10 MiB, start');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa', format(
            'select app.start_outgoing_email(%L, %L, null, %L, %L, %L, %L, %L, %L, %L, null, null, null)::text',
            '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'info',
            'gss.example', '{pat@buyer.example}'::text[], '{}'::text[], 'Hello', 'Body text',
            '<old-worker@gss.example>'))::jsonb - 'id',
          '{"status": "started", "file_keys": []}'::jsonb,
          'the 13-argument wrapper (the Worker before this deploy) still starts an email');
select is((pg_temp.send('00000000-0000-4000-8000-0000000044aa', '[]'::jsonb) -> 'file_keys'),
          '[]'::jsonb, 'no files: no keys');

-- The same send key again: the earlier email, no second list of files.
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.files(2),
                                       '<with-files@gss.example>')$$,
  '23505', null, 'a send key used before is refused by the unique key');
select is((select count(*)::integer from app.email_attachments a join app.emails e on e.id = a.email_id
            where e.message_id = '<with-files@gss.example>'), 2, 'and its files stay two');

-- Refused lists ---------------------------------------------------------------
create temp table kept_before as select pg_temp.sent_files() as n;
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.files(11))$$,
  '23514', 'at most 10 files', 'eleven files are refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     pg_temp.files(9, 1048576) || jsonb_build_array(pg_temp.file(9, 1048577)))$$,
  '23514', 'the files come to more than 10 MiB', 'one byte over 10 MiB is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(1), pg_temp.file(2)))$$,
  '23514', 'the files are numbered 0 to n-1', 'positions not starting at 0 are refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(0), pg_temp.file(0)))$$,
  '23514', 'the files are numbered 0 to n-1', 'a position twice is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(0, 100, 'image/gif')))$$,
  '23514', 'not a file a sent email may carry', 'another type is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(0, 0)))$$,
  '23514', null, 'an empty file is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(0) || '{"sha256": "abc"}'))$$,
  '23514', null, 'a malformed checksum is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(0, 100, 'application/pdf', E'a\nb.pdf')))$$,
  '23514', null, 'a name with a control character is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(0) - 'sha256'))$$,
  '23514', 'a file is malformed', 'a file without its checksum is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(0) || '{"file_key": "sent/x"}'))$$,
  '23514', 'a file is malformed', 'a file naming its own key is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa',
                     jsonb_build_array(pg_temp.file(0) || '{"size_bytes": "100"}'))$$,
  '23514', 'a file is malformed', 'a size as text is refused');
select throws_ok($$select pg_temp.send('00000000-0000-4000-8000-0000000044aa', '{"0": 1}'::jsonb)$$,
  '23514', 'the files are a list', 'files not in a list are refused');
select is(pg_temp.sent_files(), (select n from kept_before), 'nothing refused was kept');

-- Refused emails keep no files.
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.files(1), null,
                       '00000000-0000-4000-8000-00000000c4aa') ->> 'status',
          'archived', 'an archived company is refused');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.files(1), null,
                       '00000000-0000-4000-8000-00000000c1bb',
                       '00000000-0000-4000-8000-0000000000bb') ->> 'status',
          'forbidden', 'another organization''s company is refused');
select is(pg_temp.sent_files(), (select n from kept_before), 'and neither kept a file');

-- The rows themselves -------------------------------------------------------
-- Written directly (as the table's owner): a sent email's file needs its derived key and an email
-- being sent; a received email's attachment never has a key.
select throws_ok(format($$insert into app.email_attachments (organization_id, email_id, position, file_name,
                            content_type, size_bytes, sha256, disposition)
                          values ('00000000-0000-4000-8000-0000000000aa', %L, 5, 'x.pdf',
                                  'application/pdf', 10, repeat('a', 64), 'attachment')$$,
                        (select result ->> 'id' from started)),
  '23514', null, 'a sent email''s file without a key is refused');
select throws_ok(format($$insert into app.email_attachments (organization_id, email_id, position, file_name,
                            content_type, size_bytes, sha256, disposition, file_key)
                          values ('00000000-0000-4000-8000-0000000000aa', %L, 5, 'x.pdf',
                                  'application/pdf', 10, repeat('a', 64), 'attachment',
                                  'sent/' || %L || '/6-' || repeat('a', 64))$$,
                        (select result ->> 'id' from started), (select result ->> 'id' from started)),
  '23514', null, 'a key that is not the derived one is refused');
select pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  format('select app.finish_outgoing_email(%L, true, %L, null)::text',
         (select result ->> 'id' from started), '<cf-1@gss.example>'));
select throws_ok(format($$insert into app.email_attachments (organization_id, email_id, position, file_name,
                            content_type, size_bytes, sha256, disposition, file_key)
                          values ('00000000-0000-4000-8000-0000000000aa', %L, 5, 'x.pdf',
                                  'application/pdf', 10, repeat('a', 64), 'attachment',
                                  'sent/' || %L || '/5-' || repeat('a', 64))$$,
                        (select result ->> 'id' from started), (select result ->> 'id' from started)),
  '23514', 'files are added only to a sent email being started', 'no file is added once it is sent');
select throws_ok($$update app.email_attachments set file_name = 'y.pdf' where file_key is not null$$,
  '42501', null, 'a sent file is never edited');
select throws_ok($$delete from app.email_attachments where file_key is not null$$,
  '42501', null, 'or deleted');

-- Reading -------------------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
            'select count(*)::text from app.email_attachments where file_key is not null'),
          '0', 'another organization''s member sees none of them');
