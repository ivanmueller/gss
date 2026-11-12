-- Draft with Claude and Reply (20261114010000_email_drafts.sql, F-114 step 5b): each request
-- recorded, one pending per person, a repeated key refused, a lost answer lapsing after
-- 2 minutes; the draft context limited and always holding the answered email; the outgoing
-- email's links checked; privileges and other organizations. Runs in one transaction that is
-- rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(45);

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

-- A: c1a (the buyer), c2a (another buyer), c3a (archived). B: c1b.
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Other', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', null),
  ('00000000-0000-4000-8000-00000000c3aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', now()),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);

-- 40 contacts on c1a (the context keeps 30).
insert into app.counterparty_contacts (organization_id, counterparty_id, name, email, created_by)
select '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
       'Contact ' || lpad(n::text, 2, '0'), 'c' || n || '@buyer.example', '00000000-0000-4000-8000-0000000044aa'
  from generate_series(1, 40) n;

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

-- Emails, written directly (the receiving and sending paths have their own tests).
create function pg_temp.mail(company text, dir text, subject text, body text, at timestamptz,
                             auto boolean default false,
                             org text default '00000000-0000-4000-8000-0000000000aa')
returns uuid
language plpgsql as $fn$
declare
  new_id uuid;
begin
  insert into app.emails (organization_id, direction, status, counterparty_id, sent_by, sent_by_name,
                          from_address, to_addresses, subject, body_text, message_id, occurred_at,
                          automatic, raw_key, raw_size, envelope_to)
  values (org::uuid, dir::app.email_direction,
          (case when dir = 'outgoing' then 'sending' else 'received' end)::app.email_status,
          company::uuid,
          case when dir = 'outgoing' then '00000000-0000-4000-8000-0000000044aa'::uuid end,
          case when dir = 'outgoing' then 'Tom' end,
          case when dir = 'outgoing' then 'tom@gss.example' else 'pat@buyer.example' end,
          '{x@example.test}', subject, body, 'm-' || gen_random_uuid(), at, auto,
          case when dir = 'incoming' then 'raw/' || gen_random_uuid() || '/' || repeat('0', 64) || '.eml' end,
          case when dir = 'incoming' then 100 end,
          case when dir = 'incoming' then 'info@gss.example' end)
  returning id into new_id;
  if dir = 'outgoing' then
    update app.emails set status = 'sent', provider_message_id = '<cf-' || new_id || '>', occurred_at = at
     where id = new_id;
  end if;
  return new_id;
end
$fn$;

create temp table ids (name text primary key, id uuid);
grant all on ids to app_api;
insert into ids values
  ('sent1', pg_temp.mail('00000000-0000-4000-8000-00000000c1aa', 'outgoing', 'Offer', 'Our offer.', now() - interval '3 days')),
  ('in1', pg_temp.mail('00000000-0000-4000-8000-00000000c1aa', 'incoming', 'Re: Offer', 'We bid 300.', now() - interval '2 days')),
  ('later', pg_temp.mail('00000000-0000-4000-8000-00000000c1aa', 'incoming', 'Later', 'After the answer.', now() - interval '1 day')),
  ('auto', pg_temp.mail('00000000-0000-4000-8000-00000000c1aa', 'incoming', 'Out of office', 'Away.', now() - interval '4 days', true)),
  ('old', pg_temp.mail('00000000-0000-4000-8000-00000000c1aa', 'incoming', 'Old', 'Long ago.', now() - interval '120 days')),
  ('removed', pg_temp.mail('00000000-0000-4000-8000-00000000c1aa', 'incoming', 'Removed', 'Gone.', now() - interval '5 days')),
  ('otherco', pg_temp.mail('00000000-0000-4000-8000-00000000c2aa', 'incoming', 'Other', 'Other company.', now() - interval '1 day')),
  ('orgb', pg_temp.mail('00000000-0000-4000-8000-00000000c1bb', 'incoming', 'B', 'Org B.', now() - interval '1 day',
                        org => '00000000-0000-4000-8000-0000000000bb'));

create function pg_temp.id(n text) returns uuid language sql as $fn$
  select id from ids where name = n
$fn$;

select is(pg_temp.api('00000000-0000-4000-8000-0000000055aa',
            format('select app.remove_email(%L)', pg_temp.id('removed'))), 'done', 'an admin removes an email');

-- A call 6 days ago with a transcript by side, and one 8 days ago, placed as Tom.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.calls (id, organization_id, counterparty_id, contact_name, placed_by, placed_by_name,
                       from_phone, counterparty_phone, created_at)
values
  ('00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'Tom', '+14035550100', '+14035550111', now() - interval '6 days'),
  ('00000000-0000-4000-8000-0000000ca11b', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'Tom', '+14035550100', '+14035550111', now() - interval '8 days');
select set_config('app.user_id', '', true);
insert into app.call_recordings (organization_id, call_id, telnyx_recording_id, transcript, transcribed_at, transcript_lines)
values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11a', 'rec-new',
   'Send me an email about the barley.', now(),
   '[{"side": "counterparty", "start": 0, "text": "Send me an email about the barley."}]'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11b', 'rec-old',
   'An older call.', now(), null);

-- Privileges ----------------------------------------------------------------
select ok(has_table_privilege('app_api', 'app.email_draft_requests', 'select')
          and not has_table_privilege('app_api', 'app.email_draft_requests', 'insert')
          and not has_table_privilege('app_api', 'app.email_draft_requests', 'update')
          and not has_table_privilege('app_api', 'app.email_draft_requests', 'delete')
          and not has_table_privilege('authenticated', 'app.email_draft_requests', 'select')
          and not has_table_privilege('anon', 'app.email_draft_requests', 'select'),
          'app_api only reads the draft requests');
select ok(not has_function_privilege('app_api', 'app.answerable_email(uuid, uuid, uuid)', 'execute')
          and has_function_privilege('app_api', 'app.start_email_draft(uuid, uuid, uuid, uuid)', 'execute')
          and has_function_privilege('app_api', 'app.email_draft_context(uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'app.start_email_draft(uuid, uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'app.email_draft_context(uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('public',
                'app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid)', 'execute')
          and has_function_privilege('app_api',
                'app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid)', 'execute'),
          'the functions are app_api''s only');

-- Starting a draft ----------------------------------------------------------
create function pg_temp.start(uid text, company text, reply uuid, key text,
                              org text default '00000000-0000-4000-8000-0000000000aa')
returns jsonb language sql as $fn$
  select pg_temp.api(uid, format('select app.start_email_draft(%L, %L, %L, %L)::text',
                                 org, company, reply, key))::jsonb
$fn$;

select is(pg_temp.start('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c1aa',
                        pg_temp.id('in1'), '00000000-0000-4000-8000-00000000f001') ->> 'status',
          'started', 'a viewer asks for a draft');
select is(pg_temp.start('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c1aa',
                        null, '00000000-0000-4000-8000-00000000f001') ->> 'status',
          'already', 'the same key again is refused');
select is(pg_temp.start('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c1aa',
                        null, '00000000-0000-4000-8000-00000000f002') ->> 'status',
          'in_progress', 'one pending draft per person');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa',
                        null, '00000000-0000-4000-8000-00000000f003') ->> 'status',
          'started', 'another person drafts at the same time');

update app.email_draft_requests set created_at = created_at - interval '3 minutes'
 where draft_key = '00000000-0000-4000-8000-00000000f001';
select is(pg_temp.start('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c1aa',
                        null, '00000000-0000-4000-8000-00000000f004') ->> 'status',
          'started', 'a pending draft lapses after 2 minutes');
select is((select status from app.email_draft_requests where draft_key = '00000000-0000-4000-8000-00000000f001'),
          'failed', 'and is marked failed');

select is(pg_temp.start('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-00000000c1aa',
                        null, '00000000-0000-4000-8000-00000000f005') ->> 'status',
          'forbidden', 'not for another organization');
select is(pg_temp.start('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-00000000c1aa',
                        null, '00000000-0000-4000-8000-00000000f006',
                        org => '00000000-0000-4000-8000-0000000000bb') ->> 'status',
          'not_found', 'another organization''s company is not found');
select is(pg_temp.start('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-00000000c1bb',
                        pg_temp.id('in1'), '00000000-0000-4000-8000-00000000f007',
                        org => '00000000-0000-4000-8000-0000000000bb') ->> 'status',
          'reply_not_found', 'another organization''s email cannot be answered');
select is(pg_temp.start(null, '00000000-0000-4000-8000-00000000c1aa', null,
                        '00000000-0000-4000-8000-00000000f008') ->> 'status',
          'forbidden', 'nobody signed in');

-- The finished drafts of Tom and Vic, for the tests below.
update app.email_draft_requests set status = 'failed', finished_at = now() where status = 'pending';

select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c3aa',
                        null, '00000000-0000-4000-8000-00000000f009') ->> 'status',
          'archived', 'no draft for an archived company');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa',
                        pg_temp.id('removed'), '00000000-0000-4000-8000-00000000f00a') ->> 'status',
          'reply_not_found', 'a removed email cannot be answered');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa',
                        pg_temp.id('otherco'), '00000000-0000-4000-8000-00000000f00b') ->> 'status',
          'reply_not_found', 'another company''s email cannot be answered');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa',
                        pg_temp.id('sent1'), '00000000-0000-4000-8000-00000000f00c') ->> 'status',
          'reply_not_found', 'an email GSS sent is not answered');

-- Finishing -----------------------------------------------------------------
insert into ids values ('tomdraft', (pg_temp.start('00000000-0000-4000-8000-0000000044aa',
  '00000000-0000-4000-8000-00000000c1aa', pg_temp.id('auto'), '00000000-0000-4000-8000-00000000f00d') ->> 'id')::uuid);
select isnt(pg_temp.id('tomdraft'), null, 'an automatic email can be answered (D1-02)');
select is(pg_temp.api('00000000-0000-4000-8000-0000000066aa',
            format('select app.finish_email_draft(%L, true, %L, 10, 5)', pg_temp.id('tomdraft'), 'claude-opus-5-5')),
          'not_found', 'only the person who asked finishes it');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            format('select app.finish_email_draft(%L, true, %L, 10, 5)', pg_temp.id('tomdraft'), 'claude-opus-5-5')),
          'done', 'the person who asked finishes it');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            format('select app.finish_email_draft(%L, false, %L, 0, 0)', pg_temp.id('tomdraft'), 'claude-opus-5-5')),
          'not_found', 'once');
select results_eq(
  format('select status, model, input_tokens, output_tokens from app.email_draft_requests where id = %L', pg_temp.id('tomdraft')),
  $$values ('drafted', 'claude-opus-5-5', 10, 5)$$, 'its model and tokens are kept');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
            'select count(*)::text from app.email_draft_requests'),
          '0', 'another organization reads none of them');
select is(pg_temp.api('00000000-0000-4000-8000-0000000066aa',
            'select (count(*) > 0)::text from app.email_draft_requests'),
          'true', 'members read what drafting cost');

-- The context ---------------------------------------------------------------
create function pg_temp.ctx(uid text, company text, reply uuid,
                            org text default '00000000-0000-4000-8000-0000000000aa')
returns jsonb language sql as $fn$
  select pg_temp.api(uid, format('select app.email_draft_context(%L, %L, %L)::text', org, company, reply))::jsonb
$fn$;

create temp table c as
  select pg_temp.ctx('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c1aa', pg_temp.id('in1')) as j;

select is((select j ->> 'name' from c), 'Synthetic A Buyer', 'a viewer reads the context');
select is((select jsonb_array_length(j -> 'contacts') from c), 30, 'at most 30 contacts (D1-01)');
select is((select j -> 'answer' ->> 'id' from c), pg_temp.id('in1')::text, 'the answered email');
select is((select j -> 'answer' ->> 'body' from c), 'We bid 300.', 'with its text');
select set_eq(
  'select (t ->> ''id'')::uuid from c, jsonb_array_elements(c.j -> ''thread'') t',
  format('values (%L::uuid)', pg_temp.id('sent1')),
  'the thread: earlier emails only, not the answer, a later one, an automatic, an old, a removed or another company''s');
select is((select j -> 'call' ->> 'transcript' from c), 'Pat Buyer: Send me an email about the barley.',
          'the call of the last 7 days, by side');

select is(pg_temp.ctx('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c1aa',
                      pg_temp.id('old')) -> 'answer' ->> 'id',
          pg_temp.id('old')::text, 'an email over 90 days old is still the answer (D1-02)');
select is(pg_temp.ctx('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c1aa',
                      pg_temp.id('auto')) -> 'answer' ->> 'id',
          pg_temp.id('auto')::text, 'an automatic email is still the answer (D1-02)');
select is(jsonb_array_length(pg_temp.ctx('00000000-0000-4000-8000-0000000066aa',
                                         '00000000-0000-4000-8000-00000000c1aa', null) -> 'thread'),
          3, 'a new email: the last emails, automatic and removed ones left out');
select is(pg_temp.ctx('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c1aa',
                      pg_temp.id('removed')), null, 'no context to answer a removed email');
select is(pg_temp.ctx('00000000-0000-4000-8000-0000000066aa', '00000000-0000-4000-8000-00000000c3aa', null),
          null, 'no context for an archived company');
select is(pg_temp.ctx('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-00000000c1aa', null),
          null, 'no context for another organization');
select is(pg_temp.ctx('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-00000000c1aa', null,
                      org => '00000000-0000-4000-8000-0000000000bb'),
          null, 'nor for another organization''s company under one''s own');

-- Sending with the links ----------------------------------------------------
insert into app.email_settings (organization_id, shared_local_part, updated_by, updated_by_name)
values ('00000000-0000-4000-8000-0000000000aa', 'info', '00000000-0000-4000-8000-0000000044aa', 'Tom');

create function pg_temp.send(uid text, reply uuid, draft uuid, key text,
                             company text default '00000000-0000-4000-8000-00000000c1aa')
returns jsonb language sql as $fn$
  select pg_temp.api(uid, format(
    'select app.start_outgoing_email(%L, %L, null, %L, %L, %L, %L, %L, %L, %L, %L, %L)::text',
    '00000000-0000-4000-8000-0000000000aa', company, 'info', 'gss.example',
    '{pat@buyer.example}'::text[], '{}'::text[], 'Re: Offer', 'Thanks.', key, reply, draft))::jsonb
$fn$;

select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.id('removed'), null, 'gss-k1') ->> 'status',
          'reply_not_found', 'not as a reply to a removed email');
select is(pg_temp.send('00000000-0000-4000-8000-0000000066aa', null, pg_temp.id('tomdraft'), 'gss-k2') ->> 'status',
          'draft_not_found', 'not from another person''s draft');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', null, pg_temp.id('tomdraft'), 'gss-k3',
                       company => '00000000-0000-4000-8000-00000000c2aa') ->> 'status',
          'draft_not_found', 'not from a draft for another company');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', null,
                       (select id from app.email_draft_requests where draft_key = '00000000-0000-4000-8000-00000000f003'),
                       'gss-k4') ->> 'status',
          'draft_not_found', 'not from a failed draft');

insert into ids values ('reply', (pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.id('in1'),
                                               pg_temp.id('tomdraft'), 'gss-k5') ->> 'id')::uuid);
select results_eq(
  format('select reply_to_email_id, claude_draft_id from app.emails where id = %L', pg_temp.id('reply')),
  format('values (%L::uuid, %L::uuid)', pg_temp.id('in1'), pg_temp.id('tomdraft')),
  'a reply keeps the email it answers and the draft it started from');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa', format(
            'select app.start_outgoing_email(%L, %L, null, %L, %L, %L, %L, %L, %L, %L)::text',
            '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'info', 'gss.example',
            '{pat@buyer.example}'::text[], '{}'::text[], 'Hello', 'Text.', 'gss-k6'))::jsonb ->> 'status',
          'started', 'the old function still sends (the deploy''s few seconds)');

select throws_ok(
  format($q$insert into app.emails (organization_id, direction, status, counterparty_id, from_address,
                                   subject, body_text, message_id, raw_key, raw_size, envelope_to,
                                   claude_draft_id)
            values ('00000000-0000-4000-8000-0000000000aa', 'incoming', 'received',
                    '00000000-0000-4000-8000-00000000c1aa', 'pat@buyer.example', 'x', 'x', 'm-links',
                    'raw/' || gen_random_uuid() || '/' || repeat('0', 64) || '.eml', 1,
                    'info@gss.example', %L)$q$, pg_temp.id('tomdraft')),
  '23514', null, 'received mail carries no links');
select throws_ok(
  format('update app.emails set reply_to_email_id = null where id = %L', pg_temp.id('reply')),
  '42501', null, 'a sent email''s links are never edited');

select * from finish();
rollback;
