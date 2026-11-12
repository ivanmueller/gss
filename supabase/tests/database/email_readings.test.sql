-- Claude's readings of received email (20261113010000_email_readings.sql, F-114 step 5a): only
-- received mail on a company, not automatic, whose sender checks passed, not removed; claims
-- with tokens; each claim reserves a request against the daily limit, refunded only when
-- Anthropic was not asked; keep once, refused after removal; drafts from an email have exactly
-- one source; a removed email's drafts cannot be decided; privileges and other organizations.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000055aa', 'ann@example.test', '{"first_name": "Ann"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, email, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', 'pat@buyer.example', '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000d1bb', '00000000-0000-4000-8000-0000000000bb',
   '00000000-0000-4000-8000-00000000c1bb', 'Bea Buyer', 'bea@buyer.example', '00000000-0000-4000-8000-0000000011bb');

select set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);

-- A sent email from Tom, accepted by the sending service with its own id.
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

-- Mail received by the Worker: its id.
create function pg_temp.receive(msg text, sender text default 'pat@buyer.example',
                                dmarc boolean default true, auto boolean default false,
                                answers text default null,
                                org text default '00000000-0000-4000-8000-0000000000aa')
returns uuid
language sql as $fn$
  select (pg_temp.api(null, format(
    'select app.receive_email(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)::text',
    org, 'info@gss.example', sender, 'Sender', '{info@gss.example}'::text[], '{}'::text[], null,
    'Re: Offer', 'We can take 2 loads.', false, msg, answers, '{}'::text[], dmarc, auto, false,
    'raw/' || org || '/' || encode(sha256(convert_to(msg, 'UTF8')), 'hex') || '.eml', 100, '[]', now()))::jsonb ->> 'id')::uuid
$fn$;

create temp table ids (name text primary key, id uuid);
grant all on ids to app_api;
insert into ids values
  ('good', pg_temp.receive('m-good', answers => '<cf-1@gss.example>')),
  ('spoofed', pg_temp.receive('m-spoofed', dmarc => false, answers => '<cf-1@gss.example>')),
  ('auto', pg_temp.receive('m-auto', auto => true)),
  ('loose', pg_temp.receive('m-loose', sender => 'nobody@else.example')),
  ('other', pg_temp.receive('m-other', sender => 'bea@buyer.example',
                            org => '00000000-0000-4000-8000-0000000000bb'));

create function pg_temp.id(n text) returns uuid language sql as $fn$
  select id from ids where name = n
$fn$;

-- Privileges ----------------------------------------------------------------
select ok(has_table_privilege('app_api', 'app.email_readings', 'select')
          and not has_table_privilege('app_api', 'app.email_readings', 'insert')
          and not has_table_privilege('app_api', 'app.email_readings', 'update')
          and not has_table_privilege('app_api', 'app.email_readings', 'delete'),
          'app_api only reads the readings');
select ok(not has_table_privilege('app_api', 'app.email_reading_requests', 'select')
          and not has_table_privilege('authenticated', 'app.email_reading_requests', 'select')
          and not has_table_privilege('anon', 'app.email_readings', 'select'),
          'nobody reads the request count through the API');
select ok(not has_function_privilege('app_api', 'app.email_readable(uuid)', 'execute')
          and not has_function_privilege('anon', 'app.claim_email_readings(integer)', 'execute')
          and not has_function_privilege('authenticated',
                'app.keep_email_reading(uuid, uuid, text, text, jsonb, boolean, jsonb, integer, integer)', 'execute')
          and has_function_privilege('app_api', 'app.claim_email_readings(integer)', 'execute'),
          'functions are the Worker''s only');

-- Claims --------------------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa', 'select count(*)::text from app.claim_email_readings(10)'),
          '0', 'a signed-in person claims nothing');

create temp table claims as
  select * from app.claim_email_readings(10);
grant all on claims to app_api;

select set_eq('select email_id from claims',
              format('select unnest(array[%L, %L]::uuid[])', pg_temp.id('good'), pg_temp.id('other')),
              'the good email of each organization is claimed; spoofed, automatic and unmatched mail are not');
select is((select state from app.email_readings where email_id = pg_temp.id('spoofed')), 'skipped',
          'mail whose sender checks failed is skipped for good');
select is((select state from app.email_readings where email_id = pg_temp.id('auto')), 'skipped',
          'automatic mail is skipped for good');
select ok(not exists (select 1 from app.email_readings where email_id = pg_temp.id('loose')),
          'mail on no company waits to be linked');
select is((select count(*)::int from app.claim_email_readings(10)), 0,
          'a claimed email is not claimed again within 10 minutes');
select is((select count(*)::int from app.email_reading_requests where refunded_at is null), 2,
          'each claim reserved one request');

-- Context -------------------------------------------------------------------
select is(app.email_reading_context(pg_temp.id('good'), gen_random_uuid()), null,
          'no context under another token');
select is(app.email_reading_context(pg_temp.id('good'),
            (select claim_token from claims where email_id = pg_temp.id('good'))) ->> 'assigneeId',
          '00000000-0000-4000-8000-0000000044aa',
          'a reply''s follow-ups go to who sent the email it answers');
select is(app.email_reading_context(pg_temp.id('other'),
            (select claim_token from claims where email_id = pg_temp.id('other'))) ->> 'assigneeId',
          null, 'mail answering nothing, to the shared address, has nobody to assign');
select is(app.email_reading_context(pg_temp.id('good'),
            (select claim_token from claims where email_id = pg_temp.id('good'))) ->> 'body',
          'We can take 2 loads.', 'the context carries the text');

-- Keep ----------------------------------------------------------------------
create function pg_temp.keep(email uuid, token uuid, model text default 'claude-test',
                             drafts jsonb default '[]') returns boolean
language sql as $fn$
  select app.keep_email_reading(email, token, model, 'Notes', '["Subject: Re: Offer", "We can take 2 loads."]',
                                false, drafts, 10, 20)
$fn$;

select is(pg_temp.keep(pg_temp.id('good'), gen_random_uuid()), false, 'not kept under another token');
select is(pg_temp.keep(pg_temp.id('good'), (select claim_token from claims where email_id = pg_temp.id('good')),
                       drafts => '[{"kind": "follow_up", "fields": {"values": {"task": "Send the contract"}}, "lines": [1]},
                                   {"kind": "contact", "contactId": "00000000-0000-4000-8000-00000000d1bb",
                                    "fields": {"values": {"contactRole": "Buyer"}}, "lines": [1]}]'),
          true, 'kept under its claim');
select is((select state from app.email_readings where email_id = pg_temp.id('good')), 'read', 'marked read');
select is((select count(*)::int from app.call_drafts where email_id = pg_temp.id('good')), 2,
          'its drafts are kept with the email as their source');
select ok((select call_id is null and recording_id is null and counterparty_id = '00000000-0000-4000-8000-00000000c1aa'
             from app.call_drafts where email_id = pg_temp.id('good') and position = 0),
          'a draft from an email has no call and the email''s company');
select is((select contact_id from app.call_drafts where email_id = pg_temp.id('good') and position = 1), null,
          'a contact of another company becomes a new contact');
select is(pg_temp.keep(pg_temp.id('good'), (select claim_token from claims where email_id = pg_temp.id('good'))),
          false, 'kept only once');
select is((select count(*)::int from app.email_reading_requests
            where email_id = pg_temp.id('good') and refunded_at is null), 1,
          'a request Claude answered stays counted');

-- Release and nothing sent ----------------------------------------------------
select app.release_email_reading(pg_temp.id('other'), (select claim_token from claims where email_id = pg_temp.id('other')));
select ok((select attempts = 0 and claim_token is null from app.email_readings where email_id = pg_temp.id('other')),
          'a released claim gives its attempt back');
select ok((select refunded_at is not null from app.email_reading_requests where email_id = pg_temp.id('other')),
          'and refunds its request');

insert into claims select * from app.claim_email_readings(10);
select throws_ok(
  format('select pg_temp.keep(%L, %L, null, %L)', pg_temp.id('other'),
         (select claim_token from app.email_readings where email_id = pg_temp.id('other')),
         '[{"kind": "follow_up", "fields": {"values": {"task": "x"}}, "lines": [1]}]'),
  '23514', null, 'drafts are refused without a model');
select is(pg_temp.keep(pg_temp.id('other'), (select claim_token from app.email_readings where email_id = pg_temp.id('other')), null), true,
          'an email with nothing of its own is kept as read without a model');
select is((select count(*)::int from app.email_reading_requests
            where email_id = pg_temp.id('other') and refunded_at is null), 0,
          'and its request is refunded: Anthropic was never asked');

-- Removal -------------------------------------------------------------------
insert into ids values ('late', pg_temp.receive('m-late'));
insert into claims select * from app.claim_email_readings(10);
select is(pg_temp.api('00000000-0000-4000-8000-0000000055aa',
            format('select app.remove_email(%L)', pg_temp.id('late'))), 'done', 'an admin removes the email');
select is(pg_temp.keep(pg_temp.id('late'), (select claim_token from claims where email_id = pg_temp.id('late'))),
          false, 'a removed email''s reading is not kept');
select is(pg_temp.api('00000000-0000-4000-8000-0000000055aa',
            format('select app.remove_email(%L)', pg_temp.id('good'))), 'done', 'a read email removed');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            format('select app.decide_call_draft(%L, ''dismissed'', null)',
                   (select id from app.call_drafts where email_id = pg_temp.id('good') and position = 0))),
          'not_found', 'a removed email''s draft is neither verified nor dismissed');

-- Daily limit -----------------------------------------------------------------
insert into ids values ('flood', pg_temp.receive('m-flood'));
insert into app.email_reading_requests (organization_id, email_id, claim_token)
select '00000000-0000-4000-8000-0000000000aa', pg_temp.id('flood'), gen_random_uuid()
  from generate_series(1, 198);
select is((select count(*)::int from app.claim_email_readings(10)), 0,
          'nothing is claimed with 200 requests in the last 24 hours, kept or not');
update app.email_reading_requests set claimed_at = now() - interval '25 hours'
 where email_id = pg_temp.id('flood');
select is((select count(*)::int from app.claim_email_readings(10)), 1, 'claimed again a day later');

-- One source, one organization -------------------------------------------------
select throws_ok(
  format($q$insert into app.call_drafts (organization_id, counterparty_id, position, kind, fields, lines)
            values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 5,
                    'follow_up', '{"values": {}}', '[0]')$q$),
  '23514', null, 'a draft with no source is refused');
select throws_ok(
  format($q$insert into app.call_drafts (organization_id, counterparty_id, email_id, position, kind, fields, lines)
            values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', %L, 5,
                    'follow_up', '{"values": {}}', '[0]')$q$, pg_temp.id('other')),
  '23503', null, 'a draft cannot point to another organization''s email');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
            format('select count(*)::text from app.email_readings where email_id = %L', pg_temp.id('good'))),
          '0', 'another organization''s readings are not seen');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            format('select count(*)::text from app.email_readings where email_id = %L', pg_temp.id('good'))),
          '1', 'the organization''s own readings are seen');

select * from finish();
rollback;
