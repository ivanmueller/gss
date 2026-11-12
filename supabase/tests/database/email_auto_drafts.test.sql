-- Email drafts Claude makes by itself (20261115010000_email_auto_drafts.sql, F-114 step 5c): the
-- pending row added by the reading's keep only when wanted, with its assignee and From; the job's
-- claim, release, context and keep under one daily ceiling shared with the email readings; the
-- list, count and dismissal; sending from a draft (a refused send frees it, D1-01); a fifth
-- attempt still running is not failed (D1-03); privileges and other organizations. Runs in one
-- transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(51);

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000066aa', 'vic@example.test', '{"first_name": "Vic"}'),
  ('00000000-0000-4000-8000-0000000055aa', 'ann@example.test', '{"first_name": "Ann"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000066aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- Tom has an address of his own; Vic has none.
insert into app.email_settings (organization_id, shared_local_part, updated_by, updated_by_name)
values ('00000000-0000-4000-8000-0000000000aa', 'info', '00000000-0000-4000-8000-0000000055aa', 'Ann');
insert into app.member_email_addresses (organization_id, user_id, local_part) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'tom');

-- A: c1a (the buyer), c2a (a seller), c3a (archived later). B: c1b.
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic Secret Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000c3aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Third', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, email, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Pat Buyer', 'pat@buyer.example', '00000000-0000-4000-8000-0000000044aa');
insert into app.facilities (organization_id, counterparty_id, name, city, region, country, created_by) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa', 'Secret Elevator', 'Secretville', 'SK', 'CA',
   '00000000-0000-4000-8000-0000000044aa');

-- The seller's live offer of barley at a price that must never reach Claude.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.quotes (id, organization_id, counterparty_id, side, commodity_code, created_by)
values ('00000000-0000-4000-8000-0000000e0f01', '00000000-0000-4000-8000-0000000000aa',
        '00000000-0000-4000-8000-00000000c2aa', 'offer', 'feed_barley', '00000000-0000-4000-8000-0000000044aa');
insert into app.quote_revisions
  (organization_id, quote_id, revision_number, firmness, price, currency, price_unit, grade,
   delivery_basis, basis_location, quantity_min_mt, quantity_max_mt, delivery_start, delivery_end,
   quoted_at, valid_from, valid_until, source_type, recorded_by, recorded_by_name, notes)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000e0f01', 1, 'firm', 987.65, 'CAD', 'MT',
        'No. 1 CW', 'fob', 'Secret Elevator', null, 500, '2026-12-01', '2026-12-31',
        now(), now(), now() + interval '2 days', 'phone', '00000000-0000-4000-8000-0000000044aa', 'Tom', 'Secret note');

-- A call of Tom's with c1a, its recording claimed for reading.
insert into app.calls (id, organization_id, counterparty_id, contact_id, contact_name, placed_by, placed_by_name,
                       from_phone, counterparty_phone, created_at)
values ('00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
        '00000000-0000-4000-8000-00000000d1aa', 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'Tom',
        '+14035550100', '+14035550111', now() - interval '1 hour'),
       ('00000000-0000-4000-8000-0000000ca11b', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
        null, 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'Tom',
        '+14035550100', '+14035550111', now() - interval '50 minutes');
select set_config('app.user_id', '', true);
insert into app.call_recordings (id, organization_id, call_id, telnyx_recording_id, transcript, transcribed_at,
                                 transcript_lines, reading_claimed_at, reading_claim_token)
values
  ('00000000-0000-4000-8000-0000000ec01a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11a',
   'rec-1', 'Send me an email about the barley.', now(),
   '[{"side": "counterparty", "start": 0, "text": "Send me an email about the barley."}]',
   now(), '00000000-0000-4000-8000-00000000c1a1'),
  ('00000000-0000-4000-8000-0000000ec01b', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11b',
   'rec-2', 'Nothing to send.', now(), null, now(), '00000000-0000-4000-8000-00000000c1a2');

select set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);
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

-- A received email on a company, claimed for reading.
create function pg_temp.received(company text, subject text, gss text default null,
                                 org text default '00000000-0000-4000-8000-0000000000aa')
returns uuid
language plpgsql as $fn$
declare
  new_id uuid;
begin
  insert into app.emails (organization_id, direction, status, counterparty_id, from_address, from_name,
                          reply_to, to_addresses, subject, body_text, message_id, auth_passed, raw_key,
                          raw_size, envelope_to, gss_member)
  values (org::uuid, 'incoming', 'received', company::uuid, 'pat@buyer.example', 'Pat Buyer',
          'orders@buyer.example', '{info@gss.example}', subject, 'Can you send prices?',
          'm-' || gen_random_uuid(), true, 'raw/' || gen_random_uuid() || '/' || repeat('0', 64) || '.eml',
          100, 'info@gss.example', gss::uuid)
  returning id into new_id;
  insert into app.email_readings (organization_id, email_id, state, attempts, claimed_at, claim_token)
  values (org::uuid, new_id, 'pending', 1, now(), new_id);
  return new_id;
end
$fn$;

create temp table ids (name text primary key, id uuid);
grant all on ids to app_api;
insert into ids values
  ('in1', pg_temp.received('00000000-0000-4000-8000-00000000c1aa', 'Prices?')),
  ('in2', pg_temp.received('00000000-0000-4000-8000-00000000c1aa', 'Thanks', '00000000-0000-4000-8000-0000000066aa')),
  ('in3', pg_temp.received('00000000-0000-4000-8000-00000000c3aa', 'Third')),
  ('inb', pg_temp.received('00000000-0000-4000-8000-00000000c1bb', 'Org B', null, '00000000-0000-4000-8000-0000000000bb'));

create function pg_temp.id(n text) returns uuid language sql as $fn$
  select id from ids where name = n
$fn$;
create function pg_temp.draft_of(src uuid) returns uuid language sql as $fn$
  select id from app.email_auto_drafts where recording_id = src or email_id = src
$fn$;

-- Privileges ----------------------------------------------------------------
select ok(has_table_privilege('app_api', 'app.email_auto_drafts', 'select')
          and not has_table_privilege('app_api', 'app.email_auto_drafts', 'insert')
          and not has_table_privilege('app_api', 'app.email_auto_drafts', 'update')
          and not has_table_privilege('app_api', 'app.email_auto_draft_requests', 'select')
          and not has_table_privilege('authenticated', 'app.email_auto_drafts', 'select')
          and not has_table_privilege('anon', 'app.email_auto_drafts', 'select'),
          'app_api only reads the drafts, and not the ledger');
select ok(not has_function_privilege('app_api', 'app.email_draft_records(uuid, uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('app_api', 'app.add_email_auto_draft(uuid, uuid, uuid, uuid, uuid, text, uuid)', 'execute')
          and not has_function_privilege('app_api', 'app.auto_draft_taken(uuid)', 'execute')
          and has_function_privilege('app_api', 'app.claim_email_auto_drafts(integer)', 'execute')
          and has_function_privilege('app_api', 'app.email_auto_draft_list(uuid, uuid, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'app.dismiss_email_auto_draft(uuid, uuid)', 'execute')
          and not has_function_privilege('public',
                'app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid)', 'execute')
          and has_function_privilege('app_api',
                'app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid)', 'execute'),
          'the internal functions are nobody''s; the others app_api''s only');

-- The signal: a pending row only when wanted ---------------------------------
select ok(app.keep_call_reading('00000000-0000-4000-8000-0000000ec01a', '00000000-0000-4000-8000-00000000c1a1',
                                'claude-test', false, 'Notes', '[]', 10, 5, true, 'The barley GSS has'),
          'a call reading wanting an email is kept');
select ok(app.keep_call_reading('00000000-0000-4000-8000-0000000ec01b', '00000000-0000-4000-8000-00000000c1a2',
                                'claude-test', false, 'Notes', '[]', 10, 5, false, null),
          'a call reading wanting none is kept');
select is((select count(*)::int from app.email_auto_drafts), 1, 'one pending draft, for the call that asked');
select is((select row(source, state, assigned_to::text, from_choice, about)::text from app.email_auto_drafts
            where recording_id = '00000000-0000-4000-8000-0000000ec01a'),
          row('call', 'pending', '00000000-0000-4000-8000-0000000044aa', 'own', 'The barley GSS has')::text,
          'for the caller, from his own address');

select ok(app.keep_email_reading(pg_temp.id('in1'), pg_temp.id('in1'), 'claude-test', 'Asks for prices.',
                                 '["Subject: Prices?", "Can you send prices?"]', false, '[]', 10, 5,
                                 true, E'Prices\tfor  barley'),
          'an email reading wanting an answer is kept');
select is((select row(assigned_to::text, from_choice, about)::text from app.email_auto_drafts
            where email_id = pg_temp.id('in1')),
          row(null, 'shared', E'Prices for  barley')::text,
          'mail to the shared address is for anyone, from the shared address; control characters gone');
select ok(app.keep_email_reading(pg_temp.id('in2'), pg_temp.id('in2'), 'claude-test', 'Thanks.',
                                 '["Subject: Thanks", "Can you send prices?"]', false, '[]', 10, 5,
                                 true, 'An answer'),
          'a second email reading is kept');
select is((select row(assigned_to::text, from_choice)::text from app.email_auto_drafts
            where email_id = pg_temp.id('in2')),
          row('00000000-0000-4000-8000-0000000066aa', 'shared')::text,
          'mail to Vic''s address is for Vic, from the shared address (he has none of his own)');
select throws_ok(
  format($q$select app.keep_email_reading(%L, %L, null, null, '[]', false, '[]', null, null, true, 'x')$q$,
         pg_temp.id('in3'), pg_temp.id('in3')),
  '23514', 'drafts need a model', 'no draft wanted without a reading');
select ok(app.keep_email_reading(pg_temp.id('in3'), pg_temp.id('in3'), 'claude-test', 'Third.',
                                 '["Subject: Third", "x"]', false, '[]', 10, 5, true, '   '),
          'a reading with an empty about line is kept');
select is((select count(*)::int from app.email_auto_drafts where email_id = pg_temp.id('in3')), 0,
          'but no draft without an about line');

-- The old keep signatures still work and want nothing.
select ok(has_function_privilege('app_api',
            'app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer)', 'execute'),
          'the old call keep is still there for the deploy');

-- The job ------------------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            'select count(*)::text from app.claim_email_auto_drafts(10)'), '0',
          'a signed-in person cannot claim');

create temp table claims (draft_id uuid, claim_token uuid);
insert into claims select * from app.claim_email_auto_drafts(10);
select is((select count(*)::int from claims), 3, 'the three pending drafts are claimed');
select is((select count(*)::int from app.email_auto_draft_requests where refunded_at is null), 3,
          'each with a request in the ledger');

create function pg_temp.claim_of(src uuid) returns uuid language sql as $fn$
  select claim_token from claims where draft_id = pg_temp.draft_of(src)
$fn$;

select is(app.email_auto_draft_context(pg_temp.draft_of(pg_temp.id('in1')), gen_random_uuid()), null,
          'no context under another claim');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            format('select app.email_auto_draft_context(%L, %L)::text',
                   pg_temp.draft_of(pg_temp.id('in1')), pg_temp.claim_of(pg_temp.id('in1')))), null,
          'nor for a signed-in person');

create temp table ctx as
  select app.email_auto_draft_context(pg_temp.draft_of('00000000-0000-4000-8000-0000000ec01a'),
                                      pg_temp.claim_of('00000000-0000-4000-8000-0000000ec01a')) as c;
select is((select c ->> 'source' from ctx), 'call', 'the call draft''s context');
select is((select c -> 'call' ->> 'transcript' from ctx), 'Pat Buyer: Send me an email about the barley.',
          'with the call pinned to its recording');
select is((select c -> 'sender' ->> 'name' from ctx), 'Tom', 'written as Tom');
select is((select jsonb_array_length(c -> 'offers') from ctx), 1, 'what GSS has: the seller''s offer');
select ok((select c -> 'offers' -> 0 ->> 'region' = 'SK' and c -> 'offers' -> 0 ->> 'commodity' = 'feed_barley' from ctx),
          'with its grain and area');
select ok((select c::text not like '%987.65%' and c::text not like '%Secret%' and c::text not like '%CAD%' from ctx),
          'never its price, currency, seller, place or notes (answer 27)');

-- A request Anthropic did not take is given back.
do $$ begin perform app.release_email_auto_draft(pg_temp.draft_of(pg_temp.id('in2')), pg_temp.claim_of(pg_temp.id('in2'))); end $$;
select is((select row(attempts, claim_token is null)::text from app.email_auto_drafts
            where email_id = pg_temp.id('in2')), row(0, true)::text, 'released: attempt given back');
select is((select count(*)::int from app.email_auto_draft_requests where refunded_at is not null), 1,
          'and its request refunded');

create function pg_temp.keep(src uuid, subject text default 'Barley') returns boolean language sql as $fn$
  select app.keep_email_auto_draft(pg_temp.draft_of(src), pg_temp.claim_of(src), 'claude-test', subject,
                                   'Hi Pat, we have barley. [price]', '["500"]', '["[price]"]', 100, 50)
$fn$;
select ok(pg_temp.keep('00000000-0000-4000-8000-0000000ec01a'), 'the call draft is kept');
select ok(not pg_temp.keep('00000000-0000-4000-8000-0000000ec01a'), 'once');
select is((select to_addresses::text from app.email_auto_drafts
            where recording_id = '00000000-0000-4000-8000-0000000ec01a'), '{pat@buyer.example}',
          'to the call''s contact');
select ok(pg_temp.keep(pg_temp.id('in1'), 'Re: Prices?'), 'the email draft is kept');
select is((select to_addresses::text from app.email_auto_drafts where email_id = pg_temp.id('in1')),
          '{orders@buyer.example}', 'to the received email''s Reply-To');

-- The list, the count and other organizations --------------------------------
create function pg_temp.list(uid text, mine boolean, org text default '00000000-0000-4000-8000-0000000000aa')
returns jsonb language sql as $fn$
  select pg_temp.api(uid, format('select app.email_auto_draft_list(%L, null, %L)::text', org, mine))::jsonb
$fn$;
select is(jsonb_array_length(pg_temp.list('00000000-0000-4000-8000-0000000066aa', false) -> 'drafts'), 2,
          'a viewer sees both ready drafts');
select is(jsonb_array_length(pg_temp.list('00000000-0000-4000-8000-0000000066aa', true) -> 'drafts'), 1,
          'his own list: the one for anyone (Tom''s is not his)');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            $$select app.email_auto_draft_count('00000000-0000-4000-8000-0000000000aa')::text$$), '2',
          'Tom''s count: his and anyone''s');
select is(pg_temp.list('00000000-0000-4000-8000-0000000011bb', false, '00000000-0000-4000-8000-0000000000aa'), null,
          'another organization''s member sees nothing');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
            format('select app.dismiss_email_auto_draft(%L, %L)', '00000000-0000-4000-8000-0000000000bb',
                   pg_temp.draft_of(pg_temp.id('in1')))), 'not_found',
          'nor dismisses it under their own');

-- Sending from a draft (D1-01) -----------------------------------------------
create function pg_temp.send(uid text, auto uuid, key text,
                             company text default '00000000-0000-4000-8000-00000000c1aa')
returns jsonb language sql as $fn$
  select pg_temp.api(uid, format(
    'select app.start_outgoing_email(%L, %L, null, %L, %L, %L, %L, %L, %L, %L, null, null, %L)::text',
    '00000000-0000-4000-8000-0000000000aa', company, 'info', 'gss.example',
    '{pat@buyer.example}'::text[], '{}'::text[], 'Barley', 'Text.', key, auto))::jsonb
$fn$;
select is(pg_temp.send('00000000-0000-4000-8000-0000000066aa', pg_temp.draft_of('00000000-0000-4000-8000-0000000ec01a'),
                       'gss-a1', '00000000-0000-4000-8000-00000000c3aa') ->> 'status',
          'auto_draft_not_found', 'not from a draft of another company');
create temp table sent1 as
  select (pg_temp.send('00000000-0000-4000-8000-0000000066aa',
                       pg_temp.draft_of('00000000-0000-4000-8000-0000000ec01a'), 'gss-a2') ->> 'id')::uuid as id;
select isnt((select id from sent1), null, 'a viewer sends from the draft');
select is(pg_temp.send('00000000-0000-4000-8000-0000000055aa', pg_temp.draft_of('00000000-0000-4000-8000-0000000ec01a'),
                       'gss-a3') ->> 'status',
          'auto_draft_used', 'a second person cannot while it is being sent');
select is(pg_temp.api('00000000-0000-4000-8000-0000000055aa',
            format('select app.dismiss_email_auto_draft(%L, %L)', '00000000-0000-4000-8000-0000000000aa',
                   pg_temp.draft_of('00000000-0000-4000-8000-0000000ec01a'))), 'taken',
          'nor dismiss it');
-- Cloudflare refused it: nothing went, the draft is free again.
do $$ begin
  perform pg_temp.api('00000000-0000-4000-8000-0000000066aa',
    format('select app.finish_outgoing_email(%L, false, null, %L)', (select id from sent1), 'refused'));
end $$;
select is(pg_temp.send('00000000-0000-4000-8000-0000000066aa', pg_temp.draft_of('00000000-0000-4000-8000-0000000ec01a'),
                       'gss-a4') ->> 'status',
          'started', 'after a refused send the draft can be sent again under a new key');
select is(jsonb_array_length(pg_temp.list('00000000-0000-4000-8000-0000000066aa', false) -> 'drafts'), 1,
          'while it is being sent it is no longer listed');

-- Dismissing ---------------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000066aa',
            format('select app.dismiss_email_auto_draft(%L, %L)', '00000000-0000-4000-8000-0000000000aa',
                   pg_temp.draft_of(pg_temp.id('in1')))), 'dismissed', 'a viewer dismisses a draft');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            format('select app.dismiss_email_auto_draft(%L, %L)', '00000000-0000-4000-8000-0000000000aa',
                   pg_temp.draft_of(pg_temp.id('in1')))), 'already', 'once');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.draft_of(pg_temp.id('in1')), 'gss-a5')
            ->> 'status', 'auto_draft_used', 'a dismissed draft is not sent');

-- Skips, archived companies, the ceiling and the fifth attempt -----------------
update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c3aa';
-- in2 is pending again (released); a person answers it by hand.
insert into app.emails (organization_id, direction, status, counterparty_id, sent_by, sent_by_name, from_address,
                        to_addresses, subject, body_text, message_id, reply_to_email_id)
values ('00000000-0000-4000-8000-0000000000aa', 'outgoing', 'sending', '00000000-0000-4000-8000-00000000c1aa',
        '00000000-0000-4000-8000-0000000044aa', 'Tom', 'tom@gss.example', '{pat@buyer.example}', 'Re: Thanks',
        'Done.', 'gss-hand', pg_temp.id('in2'));
update app.emails set status = 'sent', provider_message_id = '<cf-hand>' where message_id = 'gss-hand';
delete from claims;
insert into claims select * from app.claim_email_auto_drafts(10);
select is((select state from app.email_auto_drafts where email_id = pg_temp.id('in2')), 'skipped',
          'a draft a person already answered by hand is skipped');

-- A fifth attempt still running is not failed by another claim (D1-03).
select set_config('app.user_id', '', true);
insert into app.email_auto_drafts (organization_id, counterparty_id, source, email_id, about, from_choice,
                                   attempts, claimed_at, claim_token)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'email',
        pg_temp.received('00000000-0000-4000-8000-00000000c1aa', 'Fifth'), 'Fifth', 'shared', 5, now(),
        '00000000-0000-4000-8000-0000000f1f1f');
select is((select count(*)::int from app.claim_email_auto_drafts(10)), 0, 'nothing to claim');
select is((select state from app.email_auto_drafts where claim_token = '00000000-0000-4000-8000-0000000f1f1f'),
          'pending', 'the fifth attempt still running stays pending');
select ok(app.keep_email_auto_draft((select id from app.email_auto_drafts
                                      where claim_token = '00000000-0000-4000-8000-0000000f1f1f'),
                                    '00000000-0000-4000-8000-0000000f1f1f', 'claude-test', 'Re: Fifth', 'Hi.',
                                    '[]', '[]', 1, 1),
          'and its answer is kept');

-- The ceiling: 200 requests a day across both ledgers.
insert into app.email_reading_requests (organization_id, email_id, claim_token)
select '00000000-0000-4000-8000-0000000000aa', pg_temp.id('in1'), gen_random_uuid() from generate_series(1, 200);
insert into app.email_auto_drafts (organization_id, counterparty_id, source, email_id, about, from_choice)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'email',
        pg_temp.received('00000000-0000-4000-8000-00000000c1aa', 'Over'), 'Over', 'shared');
select is((select count(*)::int from app.claim_email_auto_drafts(10)), 0,
          'no draft is claimed once the email readings used the day''s 200');

select * from finish();
rollback;
