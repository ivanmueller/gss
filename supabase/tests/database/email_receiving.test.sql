-- Email received by the Worker (20261112010000_email_receiving.sql, F-114 step 4a): admission
-- before anything is stored (duplicates, GSS's own copies, the flood limits); receiving never
-- refuses for volume; replies matched on the sending service's id with or without angle
-- brackets, and on the latest reference; mail to an address of nobody left on no company even
-- when it answers GSS's email or comes from a known contact; unauthenticated mail kept with
-- auth_passed false; attachments listed once, never changed or deleted, read only within the
-- organization; privileges. Runs in one transaction that is rolled back. All fixtures are
-- synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- Fixtures ------------------------------------------------------------------
-- Org A: tom (trader, own address tom@), bob in org B.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.member_email_addresses (organization_id, user_id, local_part) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'tom');

insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa');

insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, email, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', 'pat@buyer.example', '00000000-0000-4000-8000-0000000044aa');

select set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);

-- A sent email from tom@, accepted by the sending service with its own id.
insert into app.emails (id, organization_id, direction, status, counterparty_id, contact_id, sent_by,
                        sent_by_name, from_address, to_addresses, subject, body_text, message_id)
values ('00000000-0000-4000-8000-00000000e1aa', '00000000-0000-4000-8000-0000000000aa', 'outgoing',
        'sending', '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-00000000d1aa',
        '00000000-0000-4000-8000-0000000044aa', 'Tom', 'tom@gss.example', '{pat@buyer.example}',
        'Offer', 'Body', 'gss-send-key-1');
update app.emails set status = 'sent', provider_message_id = '<cf-1@gss.example>'
 where id = '00000000-0000-4000-8000-00000000e1aa';

grant app_api to current_user;

create function pg_temp.api(uid text, query text) returns text
language plpgsql as $fn$
declare
  result text;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute query into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

create function pg_temp.admit(sender text, msg text,
                              org text default '00000000-0000-4000-8000-0000000000aa',
                              uid text default null)
returns text
language sql as $fn$
  select pg_temp.api(uid, format('select app.admit_email(%L, %L, %L)', org, sender, msg))
$fn$;

create function pg_temp.receive(msg text, sender text default 'pat@buyer.example',
                                answers text default null, refs text[] default '{}',
                                dmarc boolean default true,
                                envelope text default 'info@gss.example',
                                files jsonb default '[]',
                                org text default '00000000-0000-4000-8000-0000000000aa',
                                uid text default null)
returns jsonb
language sql as $fn$
  select pg_temp.api(uid, format(
    'select app.receive_email(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)::text',
    org, envelope, sender, 'Sender', '{info@gss.example}'::text[], '{}'::text[], null, 'Re: Offer',
    'Reply', false, msg, answers, refs, dmarc, false, false,
    'raw/' || org || '/' || encode(sha256(convert_to(msg, 'UTF8')), 'hex') || '.eml', 100, files))::jsonb
$fn$;

create function pg_temp.kept(msg text) returns app.emails
language sql as $fn$
  select * from app.emails where direction = 'incoming' and message_id = msg
$fn$;

-- Privileges ----------------------------------------------------------------
select ok(has_table_privilege('app_api', 'app.email_attachments', 'select')
          and not has_table_privilege('app_api', 'app.email_attachments', 'insert')
          and not has_table_privilege('app_api', 'app.email_attachments', 'update')
          and not has_table_privilege('app_api', 'app.email_attachments', 'delete'),
  'app_api only reads attachments');
select ok(not has_table_privilege('authenticated', 'app.email_attachments', 'select')
          and not has_table_privilege('anon', 'app.email_attachments', 'select')
          and not has_table_privilege('service_role', 'app.email_attachments', 'select'),
  'the Supabase API roles cannot read attachments');
select ok(has_function_privilege('app_api', 'app.admit_email(uuid, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'app.admit_email(uuid, text, text)', 'execute')
          and not has_function_privilege('authenticated',
            'app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text, text[], boolean, boolean, boolean, text, integer, jsonb)', 'execute'),
  'only app_api admits and receives');
select ok(not has_function_privilege('app_api', 'app.is_own_email_copy(uuid, text, text)', 'execute')
          and not has_function_privilege('app_api', 'app.email_id_core(text)', 'execute')
          and not has_function_privilege('app_api', 'app.check_email_attachment()', 'execute'),
  'app_api cannot call the helpers');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname = 'receive_email'), 1,
  'step 2''s receive_email is gone');

-- Admission -------------------------------------------------------------------
select is(pg_temp.admit('pat@buyer.example', '<new-1@buyer.example>',
                        uid => '00000000-0000-4000-8000-0000000044aa'), 'forbidden',
  'admission is for the Worker only, never a signed-in person');
select is(pg_temp.admit('pat@buyer.example', '<new-1@buyer.example>',
                        org => '00000000-0000-4000-8000-0000000000cc'), 'unknown_organization',
  'an unknown organization is refused');
select is(pg_temp.admit('pat@buyer.example', '<new-1@buyer.example>'), 'admit', 'new mail is admitted');
select is(pg_temp.admit('tom@gss.example', 'cf-1@gss.example'), 'own_copy',
  'GSS''s own sent email is its own copy, brackets or not');
select is(pg_temp.admit('mallory@else.example', '<cf-1@gss.example>'), 'admit',
  'the same Message-ID from another sender is not an own copy');

-- Receiving and matching ------------------------------------------------------
select is(pg_temp.receive('<reply-1@buyer.example>', answers => 'cf-1@gss.example') ->> 'counterparty_id',
          '00000000-0000-4000-8000-00000000c1aa',
  'a reply is matched on the sending service''s id without angle brackets');
select is((pg_temp.kept('<reply-1@buyer.example>')).contact_id, '00000000-0000-4000-8000-00000000d1aa'::uuid,
  'with the contact the sent email was to');
select is(pg_temp.admit('pat@buyer.example', '<reply-1@buyer.example>'), 'duplicate',
  'a kept message is a duplicate at admission');
select is(pg_temp.receive('<reply-1@buyer.example>') ->> 'duplicate', 'true',
  'and a duplicate when delivered again');
select is(pg_temp.receive('<reply-2@buyer.example>', answers => '<unknown@x.example>',
                          refs => '{<cf-1@gss.example>,<later@x.example>}', dmarc => false)
            ->> 'counterparty_id', '00000000-0000-4000-8000-00000000c1aa',
  'a reply is matched on a reference when In-Reply-To matches nothing');
select is((pg_temp.kept('<reply-2@buyer.example>')).auth_passed, false,
  'an unauthenticated reply matched by its headers stays marked as not passed');
select is(pg_temp.receive('<typo-1@buyer.example>', answers => '<cf-1@gss.example>',
                          envelope => 'tmo@gss.example') ->> 'counterparty_id', null,
  'a reply sent to an address of nobody stays on no company');
select is((pg_temp.kept('<typo-1@buyer.example>')).gss_member, null,
  'and belongs to no person');
select is(pg_temp.receive('<typo-2@buyer.example>', envelope => 'sales@gss.example') ->> 'counterparty_id', null,
  'a known contact writing to an address of nobody stays on no company');
select is(pg_temp.receive('<direct-1@buyer.example>', envelope => 'tom@gss.example') ->> 'counterparty_id',
          '00000000-0000-4000-8000-00000000c1aa',
  'a known contact writing to a person''s own address is put on the company');
select is((pg_temp.kept('<direct-1@buyer.example>')).gss_member, '00000000-0000-4000-8000-0000000044aa'::uuid,
  'and on that person');
select is(pg_temp.receive('<forged-1@buyer.example>', dmarc => false) ->> 'counterparty_id', null,
  'a known address without DMARC is not put on the company');
select is(pg_temp.receive('<cf-1@gss.example>', sender => 'tom@gss.example') ->> 'status', 'own_copy',
  'GSS''s own copy is not kept');
select is((select count(*)::int from app.emails where direction = 'incoming' and message_id = '<cf-1@gss.example>'), 0,
  'no row for the own copy');

-- Flood limits at admission only -----------------------------------------------
insert into app.emails (organization_id, direction, status, envelope_to, from_address, subject, body_text,
                        message_id, raw_key, raw_size)
select '00000000-0000-4000-8000-0000000000aa', 'incoming', 'received', 'info@gss.example', 'flood@else.example',
       'Spam', 'Spam', '<flood-' || i || '@else.example>',
       'raw/00000000-0000-4000-8000-0000000000aa/' || encode(sha256(convert_to(i::text, 'UTF8')), 'hex') || '.eml', 10
  from generate_series(1, 100) i;
select is(pg_temp.admit('flood@else.example', '<flood-101@else.example>'), 'too_many',
  'a sender with 100 messages in the last hour is refused at admission');
select is(pg_temp.admit('other@else.example', '<other-1@else.example>'), 'admit',
  'another sender is still admitted');
select is(pg_temp.receive('<flood-101@else.example>', sender => 'flood@else.example') ->> 'status', 'received',
  'mail already accepted is kept whatever the volume');

-- Attachments ---------------------------------------------------------------
select is(pg_temp.receive('<files-1@buyer.example>', files => $$[
  {"position": 0, "file_name": "contract.pdf", "content_type": "application/pdf", "size_bytes": 9,
   "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "disposition": "attachment",
   "content_id": null},
  {"position": 1, "file_name": null, "content_type": "image/png", "size_bytes": 6,
   "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "disposition": "inline",
   "content_id": "<logo1>"}]$$) ->> 'duplicate', 'false', 'mail with attachments is kept');
select is((select count(*)::int from app.email_attachments a
            join app.emails e on e.id = a.email_id where e.message_id = '<files-1@buyer.example>'), 2,
  'its attachments are listed');
select is(pg_temp.receive('<files-1@buyer.example>', files => $$[
  {"position": 0, "file_name": "other.pdf", "content_type": "application/pdf", "size_bytes": 1,
   "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "disposition": "attachment",
   "content_id": null}]$$) ->> 'duplicate', 'true', 'a second delivery is a duplicate');
select is((select count(*)::int from app.email_attachments a
            join app.emails e on e.id = a.email_id where e.message_id = '<files-1@buyer.example>'), 2,
  'and lists no attachment again');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  $$select count(*)::text from app.email_attachments$$), '2', 'a member reads the attachments');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
  $$select count(*)::text from app.email_attachments$$), '0', 'another organization''s member reads none');
select throws_ok($$update app.email_attachments set file_name = 'x.pdf'$$, '42501', null,
  'an attachment is never changed');
select throws_ok($$delete from app.email_attachments$$, '42501', null, 'or deleted');
select throws_ok($$insert into app.email_attachments (organization_id, email_id, position, content_type,
                    size_bytes, sha256, disposition)
                  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000e1aa', 0,
                    'text/plain', 1, repeat('a', 64), 'attachment')$$, '23514', null,
  'attachments are listed only on received email');
select throws_ok(format($$select app.receive_email('00000000-0000-4000-8000-0000000000aa', 'info@gss.example',
    'pat@buyer.example', 'P', '{}', '{}', null, 'S', 'B', false, '<bad-file@x>', null, '{}', true, false, false,
    'raw/00000000-0000-4000-8000-0000000000aa/%s.eml', 1,
    '[{"position": 0, "content_type": "not a type", "size_bytes": 1, "sha256": "%s", "disposition": "attachment"}]')$$,
    repeat('d', 64), repeat('e', 64)), '23514', null,
  'a malformed attachment refuses the whole message, nothing half kept');
select is((select count(*)::int from app.emails where message_id = '<bad-file@x>'), 0,
  'no email row is left behind');

-- Shapes --------------------------------------------------------------------
select throws_ok($$update app.emails set automatic = true where id = '00000000-0000-4000-8000-00000000e1aa'$$,
  null, null, 'sent email is never automatic');
select throws_ok($$update app.emails set raw_key = null where message_id = '<reply-1@buyer.example>'$$,
  '42501', null, 'a received email''s raw key never changes');
select throws_ok(format($$insert into app.emails (organization_id, direction, status, envelope_to, from_address,
                    body_text, message_id, raw_key, raw_size)
                  values ('00000000-0000-4000-8000-0000000000aa', 'incoming', 'received', 'info@gss.example',
                    'x@y.example', 'B', '<shape-1@x>', 'raw/../%s.eml', 1)$$, repeat('a', 64)), '23514', null,
  'a raw key outside the bucket''s layout is refused');
select throws_ok($$insert into app.emails (organization_id, direction, status, envelope_to, from_address,
                    body_text, message_id)
                  values ('00000000-0000-4000-8000-0000000000aa', 'incoming', 'received', 'info@gss.example',
                    'x@y.example', 'B', '<shape-2@x>')$$, '23514', null,
  'received mail without its raw object is refused');
select is((pg_temp.kept('<reply-1@buyer.example>')).raw_key,
          'raw/00000000-0000-4000-8000-0000000000aa/' || encode(sha256(convert_to('<reply-1@buyer.example>', 'UTF8')), 'hex') || '.eml',
  'the raw object''s key is kept');

-- Cross-organization ----------------------------------------------------------
select is(pg_temp.receive('<b-1@buyer.example>', answers => '<cf-1@gss.example>',
                          org => '00000000-0000-4000-8000-0000000000bb') ->> 'counterparty_id', null,
  'a reply to org A''s email received for org B is never put on org A''s company');
select is(pg_temp.admit('tom@gss.example', '<cf-1@gss.example>', org => '00000000-0000-4000-8000-0000000000bb'),
  'admit', 'org A''s sent email is no own copy for org B');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
  $$select count(*)::text from app.emails where organization_id = '00000000-0000-4000-8000-0000000000aa'$$), '0',
  'org B reads none of org A''s mail');

select * from finish();
rollback;
