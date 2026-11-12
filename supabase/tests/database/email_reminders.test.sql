-- Reminders and the readings' thread context (20261116010000_email_reminders.sql, F-114 step 5c
-- part 2): business days in Alberta time; which GSS emails get a reminder (sent, due, quiet, not
-- removed or archived, not sent from a reminder, after the start date, within 14 days); the
-- batch of 50 reaching later emails (D1-03); the job's claim, context, skip and keep; the list,
-- count and a reminder hidden once its silence ends; sending it as a reply to GSS's own email
-- only with its draft; the earlier emails given to a reading; privileges and other
-- organizations. Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000066aa', 'vic@example.test', '{"first_name": "Vic"}'),
  ('00000000-0000-4000-8000-0000000077aa', 'lea@example.test', '{"first_name": "Lea"}'),
  ('00000000-0000-4000-8000-0000000055aa', 'ann@example.test', '{"first_name": "Ann"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

-- Lea left the team (no longer active).
insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000066aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000077aa', 'trader', 'invited', null),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.email_settings (organization_id, shared_local_part, updated_by, updated_by_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'info', '00000000-0000-4000-8000-0000000044aa', 'Tom'),
  ('00000000-0000-4000-8000-0000000000bb', 'info', '00000000-0000-4000-8000-0000000011bb', 'Bob');
insert into app.member_email_addresses (organization_id, user_id, local_part) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'tom');

-- One company per case, so each silence is its own.
create temp table co (name text primary key, id uuid not null default gen_random_uuid());
insert into co (name) values ('due'), ('replied'), ('ooo'), ('logged'), ('unlogged'), ('removed'),
  ('archived'), ('fresh'), ('stale'), ('failed'), ('chain'), ('viewer'), ('left'), ('linked'),
  ('resent'), ('thread'), ('other');
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by)
select id, '00000000-0000-4000-8000-0000000000aa', 'Synthetic ' || name, '{buyer}', 'US', 'manual',
       '00000000-0000-4000-8000-0000000044aa'
  from co;
insert into co (name) values ('orgb');
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by)
select id, '00000000-0000-4000-8000-0000000000bb', 'Synthetic B', '{buyer}', 'US', 'manual',
       '00000000-0000-4000-8000-0000000011bb'
  from co where name = 'orgb';

create function pg_temp.co(n text) returns uuid language sql as $fn$
  select id from co where name = n
$fn$;
create function pg_temp.org(company uuid) returns uuid language sql as $fn$
  select organization_id from app.counterparties where id = company
$fn$;

-- A GSS email to a company, sent `ago` before now (or refused when sent is false).
create function pg_temp.sent(company uuid, ago interval, subject text,
                             by_user uuid default '00000000-0000-4000-8000-0000000044aa',
                             auto uuid default null, sent boolean default true)
returns uuid
language plpgsql as $fn$
declare
  new_id uuid;
begin
  insert into app.emails (organization_id, direction, status, counterparty_id, sent_by, sent_by_name,
                          from_address, to_addresses, subject, body_text, message_id, auto_draft_id)
  values (pg_temp.org(company), 'outgoing', 'sending', company, by_user, 'Sender', 'tom@gss.example',
          '{pat@buyer.example,orders@buyer.example}', subject,
          'Could you confirm the 2 loads?', 'gss-' || gen_random_uuid(), auto)
  returning id into new_id;
  if sent then
    update app.emails set status = 'sent', provider_message_id = '<cf-' || new_id || '@gss.example>',
                          occurred_at = now() - ago
     where id = new_id;
  else
    update app.emails set status = 'failed', failure = 'refused', occurred_at = now() - ago
     where id = new_id;
  end if;
  return new_id;
end
$fn$;

-- A received email on a company (none when company is null), `ago` before now.
create function pg_temp.received(company uuid, ago interval, subject text,
                                 automatic boolean default false, passed boolean default true,
                                 org uuid default '00000000-0000-4000-8000-0000000000aa')
returns uuid
language plpgsql as $fn$
declare
  new_id uuid;
begin
  insert into app.emails (organization_id, direction, status, counterparty_id, from_address, from_name,
                          to_addresses, subject, body_text, message_id, auth_passed, raw_key, raw_size,
                          envelope_to, automatic, occurred_at)
  values (org, 'incoming', 'received', company, 'pat@buyer.example', 'Pat Buyer', '{info@gss.example}',
          subject, 'Text of ' || subject, 'm-' || gen_random_uuid(), passed,
          'raw/' || gen_random_uuid() || '/' || repeat('0', 64) || '.eml', 100, 'info@gss.example',
          automatic, now() - ago)
  returning id into new_id;
  return new_id;
end
$fn$;

-- A contact history entry with a company, `ago` before now.
create function pg_temp.logged(company uuid, ago interval) returns uuid
language plpgsql as $fn$
declare
  entry uuid := gen_random_uuid();
begin
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
  insert into app.contact_log_entries (id, organization_id, counterparty_id, created_by)
  values (entry, pg_temp.org(company), company, '00000000-0000-4000-8000-0000000044aa');
  insert into app.contact_log_revisions (organization_id, entry_id, occurred_at, channel, contact_name,
                                         notes, recorded_by, recorded_by_name)
  values (pg_temp.org(company), entry, now() - ago, 'call', 'Pat Buyer', 'Spoke.',
          '00000000-0000-4000-8000-0000000044aa', 'Tom');
  perform set_config('app.user_id', '', true);
  return entry;
end
$fn$;

-- An email removed by Ann, an admin, in her own name.
create function pg_temp.remove_email(email uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000055aa', true);
  insert into app.email_removals (organization_id, email_id, removed_by, removed_by_name)
  values ('00000000-0000-4000-8000-0000000000aa', email, '00000000-0000-4000-8000-0000000055aa', 'Ann');
  perform set_config('app.user_id', '', true);
end
$fn$;

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

create temp table ids (name text primary key, id uuid);
grant all on ids, co to app_api;
create function pg_temp.id(n text) returns uuid language sql as $fn$
  select id from ids where name = n
$fn$;
create function pg_temp.reminder_of(email uuid) returns uuid language sql as $fn$
  select id from app.email_auto_drafts where email_id = email and source = 'reminder'
$fn$;

-- Privileges ----------------------------------------------------------------
select ok(not has_function_privilege('app_api', 'app.add_email_reminders()', 'execute')
          and not has_function_privilege('app_api', 'app.email_quiet_since(uuid)', 'execute')
          and not has_function_privilege('app_api', 'app.add_business_days(timestamptz, integer)', 'execute')
          and not has_function_privilege('app_api', 'app.email_reminders_since()', 'execute')
          and not has_function_privilege('app_api', 'app.auto_draft_sender(uuid, uuid)', 'execute')
          and has_function_privilege('app_api', 'app.skip_email_auto_draft(uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'app.skip_email_auto_draft(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'app.skip_email_auto_draft(uuid, uuid)', 'execute'),
          'the internal functions are nobody''s; skip is app_api''s only');

-- Business days in Alberta time (UTC-6) --------------------------------------
select is(app.add_business_days('2026-11-16 16:00+00', 3), '2026-11-19 16:00+00'::timestamptz,
          'Monday 10:00 → Thursday 10:00');
select is(app.add_business_days('2026-11-20 16:00+00', 3), '2026-11-25 16:00+00'::timestamptz,
          'Friday 10:00 → Wednesday 10:00, over the weekend');
select is(app.add_business_days('2026-11-21 21:00+00', 3), '2026-11-26 06:00+00'::timestamptz,
          'Saturday 15:00 → Thursday 00:00 (the weekend starts Monday)');
select is(app.add_business_days('2026-11-23 05:30+00', 3), '2026-11-26 06:00+00'::timestamptz,
          'Sunday 23:30 in Alberta (already Monday in UTC) → Thursday 00:00: Alberta''s day counts, not UTC''s');
select is(app.add_business_days('2026-11-28 05:00+00', 3), '2026-12-03 05:00+00'::timestamptz,
          'Friday 23:00 → Wednesday 23:00, across a month');

-- The start date: nothing sent before the feature is reminded --------------
insert into ids values
  ('due', pg_temp.sent(pg_temp.co('due'), interval '8 days', 'Barley for December'));
select app.add_email_reminders();
select is((select count(*)::int from app.email_auto_drafts), 0, 'no reminder for an email sent before the start');

-- Tests move the start date back, inside this rolled-back transaction.
create or replace function app.email_reminders_since() returns timestamptz
language sql stable set search_path = '' as $$ select timestamptz '2000-01-01 00:00:00+00' $$;

-- The candidates ---------------------------------------------------------------
-- An older email to the same company is not quiet: a later one was sent.
insert into ids values
  ('due_older', pg_temp.sent(pg_temp.co('due'), interval '9 days', 'Earlier')),
  ('replied', pg_temp.sent(pg_temp.co('replied'), interval '8 days', 'Oats')),
  ('ooo', pg_temp.sent(pg_temp.co('ooo'), interval '8 days', 'Peas')),
  ('logged', pg_temp.sent(pg_temp.co('logged'), interval '8 days', 'Rye')),
  ('unlogged', pg_temp.sent(pg_temp.co('unlogged'), interval '8 days', 'Flax')),
  ('removed', pg_temp.sent(pg_temp.co('removed'), interval '8 days', 'Corn')),
  ('archived', pg_temp.sent(pg_temp.co('archived'), interval '8 days', 'Wheat')),
  ('fresh', pg_temp.sent(pg_temp.co('fresh'), interval '1 hour', 'Canola')),
  ('stale', pg_temp.sent(pg_temp.co('stale'), interval '15 days', 'Soy')),
  ('failed', pg_temp.sent(pg_temp.co('failed'), interval '8 days', 'Millet', sent => false)),
  ('viewer', pg_temp.sent(pg_temp.co('viewer'), interval '8 days', E'Tab\there',
                          '00000000-0000-4000-8000-0000000066aa')),
  ('left', pg_temp.sent(pg_temp.co('left'), interval '8 days', '',
                        '00000000-0000-4000-8000-0000000077aa')),
  ('linked', pg_temp.sent(pg_temp.co('linked'), interval '8 days', 'Lentils')),
  ('resent', pg_temp.sent(pg_temp.co('resent'), interval '8 days', 'Hemp'));
select pg_temp.received(pg_temp.co('replied'), interval '7 days', 'Re: Oats');
select pg_temp.received(pg_temp.co('ooo'), interval '7 days', 'Out of office', automatic => true);
select pg_temp.logged(pg_temp.co('logged'), interval '6 days');
-- A removed history entry (by an admin, in her own name), and one from before the email, end no
-- silence.
insert into ids values ('entry', pg_temp.logged(pg_temp.co('unlogged'), interval '6 days'));
select set_config('app.user_id', '00000000-0000-4000-8000-0000000055aa', true);
insert into app.contact_log_removals (organization_id, entry_id, removed_by, removed_by_name)
values ('00000000-0000-4000-8000-0000000000aa', pg_temp.id('entry'), '00000000-0000-4000-8000-0000000055aa', 'Ann');
select set_config('app.user_id', '', true);
select pg_temp.logged(pg_temp.co('unlogged'), interval '9 days');
select pg_temp.remove_email(pg_temp.id('removed'));
update app.counterparties set archived_at = now() where id = pg_temp.co('archived');
-- Another email being sent to 'resent' now ends its silence.
insert into app.emails (organization_id, direction, status, counterparty_id, sent_by, sent_by_name,
                        from_address, to_addresses, subject, body_text, message_id)
values ('00000000-0000-4000-8000-0000000000aa', 'outgoing', 'sending', pg_temp.co('resent'),
        '00000000-0000-4000-8000-0000000044aa', 'Tom', 'tom@gss.example', '{pat@buyer.example}', 'More',
        'More.', 'gss-resent');

select app.add_email_reminders();
select is(
  (select string_agg(c.name, ',' order by c.name)
     from app.email_auto_drafts a join co c on c.id = a.counterparty_id where a.source = 'reminder'),
  'due,left,linked,ooo,unlogged,viewer',
  'reminders only for sent, due, quiet emails (an out-of-office or a removed history entry is no answer)');
select is((select row(state, assigned_to::text, from_choice, about, call_id is null)::text
             from app.email_auto_drafts where id = pg_temp.reminder_of(pg_temp.id('due'))),
          row('pending', '00000000-0000-4000-8000-0000000044aa', 'own', 'No answer to "Barley for December"', true)::text,
          'for the sender, from his own address, about the subject (fixed text, not Claude''s)');
select is((select row(assigned_to::text, from_choice, about)::text
             from app.email_auto_drafts where id = pg_temp.reminder_of(pg_temp.id('viewer'))),
          row('00000000-0000-4000-8000-0000000066aa', 'shared', 'No answer to "Tab here"')::text,
          'a sender without an address of his own: from the shared one; control characters gone');
select is((select row(assigned_to::text, from_choice, about like 'No answer to the email of 20%')::text
             from app.email_auto_drafts where id = pg_temp.reminder_of(pg_temp.id('left'))),
          row(null, 'shared', true)::text,
          'a sender who left: for anyone, from the shared address; no subject: the date');
select is(pg_temp.reminder_of(pg_temp.id('due_older')), null, 'not the older email: a later one was sent');

-- A reply on no company, linked later, ends the silence once linked.
insert into ids values ('loose', pg_temp.received(null, interval '7 days', 'Re: Lentils'));
update app.emails set counterparty_id = pg_temp.co('linked'),
                      linked_by = '00000000-0000-4000-8000-0000000044aa', linked_by_name = 'Tom', linked_at = now()
 where id = pg_temp.id('loose');
select ok(app.auto_draft_answered(pg_temp.reminder_of(pg_temp.id('linked'))),
          'a reply linked to the company answers the reminder');

-- The job ------------------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            'select count(*)::text from app.claim_email_auto_drafts(10)'), '0',
          'a signed-in person cannot claim');
create temp table claims (draft_id uuid, claim_token uuid);
grant all on claims to app_api;
insert into claims select * from app.claim_email_auto_drafts(10);
select is((select state from app.email_auto_drafts where id = pg_temp.reminder_of(pg_temp.id('linked'))),
          'skipped', 'a pending reminder answered meanwhile is skipped at the claim');
select is((select count(*)::int from claims), 5, 'the five standing reminders are claimed');
create function pg_temp.claim_of(email uuid) returns uuid language sql as $fn$
  select c.claim_token from claims c where c.draft_id = pg_temp.reminder_of(email)
$fn$;

select is(pg_temp.api(null, format('select app.email_auto_draft_context(%L, %L)::text',
            pg_temp.reminder_of(pg_temp.id('due')), pg_temp.claim_of(pg_temp.id('due'))))::jsonb
            - 'happenedAt',
          jsonb_build_object(
            'source', 'reminder', 'about', 'No answer to "Barley for December"',
            'name', 'Synthetic due', 'types', '["buyer"]'::jsonb,
            'sender', jsonb_build_object('name', 'Tom', 'title', null), 'shared', false,
            'reminded', jsonb_build_object(
              'subject', 'Barley for December', 'body', 'Could you confirm the 2 loads?',
              'to', '["pat@buyer.example", "orders@buyer.example"]'::jsonb, 'contactName', null,
              'sentByName', 'Sender')),
          'a reminder''s context: the email reminded and the sender, nothing of the records');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa', format(
            'select coalesce(app.email_auto_draft_context(%L, %L)::text, ''none'')',
            pg_temp.reminder_of(pg_temp.id('due')), pg_temp.claim_of(pg_temp.id('due')))),
          'none', 'a signed-in person gets no context');

-- Skip: under the claim only, by the job only.
select is(pg_temp.api(null, format('select app.skip_email_auto_draft(%L, gen_random_uuid())::text',
            pg_temp.reminder_of(pg_temp.id('ooo')))), 'false', 'not under another claim');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa', format(
            'select app.skip_email_auto_draft(%L, %L)::text',
            pg_temp.reminder_of(pg_temp.id('ooo')), pg_temp.claim_of(pg_temp.id('ooo')))),
          'false', 'not by a signed-in person');
select is(pg_temp.api(null, format('select app.skip_email_auto_draft(%L, %L)::text',
            pg_temp.reminder_of(pg_temp.id('ooo')), pg_temp.claim_of(pg_temp.id('ooo')))),
          'true', 'a reminder Claude finds not needed is skipped');
select is((select row(a.state, a.claim_token is null, q.refunded_at is null)::text
             from app.email_auto_drafts a
             join app.email_auto_draft_requests q on q.auto_draft_id = a.id
            where a.id = pg_temp.reminder_of(pg_temp.id('ooo'))),
          row('skipped', true, true)::text, 'its request stays counted, as Claude was asked');

-- Keep: to the reminded email's To.
create function pg_temp.keep(email uuid) returns text language sql as $fn$
  select pg_temp.api(null, format(
    'select app.keep_email_auto_draft(%L, %L, %L, %L, %L, %L::jsonb, %L::jsonb, 400, 60)::text',
    pg_temp.reminder_of(email), pg_temp.claim_of(email), 'claude-test', 'Re: Barley for December',
    'Hi Pat, could you confirm the 2 loads?', '[]', '[]'))
$fn$;
select is(pg_temp.keep(pg_temp.id('due')), 'true', 'a wanted reminder is kept');
select is((select row(state, to_char(cardinality(to_addresses), 'FM9'), to_addresses[2]::text)::text
             from app.email_auto_drafts where id = pg_temp.reminder_of(pg_temp.id('due'))),
          row('ready', '2', 'orders@buyer.example')::text, 'to every address the email was sent to');
select is(pg_temp.keep(pg_temp.id('viewer')), 'true', 'another is kept');
select is(pg_temp.keep(pg_temp.id('left')), 'true', 'and a third');

-- The list and the count ------------------------------------------------------
create function pg_temp.listed(uid text, company uuid default null) returns jsonb language sql as $fn$
  select pg_temp.api(uid, format('select app.email_auto_draft_list(%L, %L, false)::text',
                                 '00000000-0000-4000-8000-0000000000aa', company))::jsonb
$fn$;
select is((pg_temp.listed('00000000-0000-4000-8000-0000000044aa', pg_temp.co('due')) -> 'drafts' -> 0)
            - 'draftedAt' - 'id' - 'counterpartyId' - 'emailId' - 'emailAt',
          jsonb_build_object(
            'counterpartyName', 'Synthetic due', 'source', 'reminder',
            'about', 'No answer to "Barley for December"', 'callAt', null, 'callContactName', null,
            'callBy', null, 'emailFrom', 'tom@gss.example', 'emailSubject', 'Barley for December',
            'assignedTo', '00000000-0000-4000-8000-0000000044aa', 'assignedToName', 'Tom',
            'fromChoice', 'own', 'to', '["pat@buyer.example", "orders@buyer.example"]'::jsonb,
            'subject', 'Re: Barley for December', 'message', 'Hi Pat, could you confirm the 2 loads?',
            'checkThis', '[]'::jsonb, 'placeholders', '[]'::jsonb, 'answeredSince', null),
          'a ready reminder is listed with its email');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            'select app.email_auto_draft_count(''00000000-0000-4000-8000-0000000000aa'')::text'),
          '2', 'counted for Tom: his own and the one for anyone');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb', format(
            'select coalesce(app.email_auto_draft_list(%L, null, false)::text, ''none'')',
            '00000000-0000-4000-8000-0000000000aa')), 'none',
          'another organization''s admin lists nothing');

-- Its silence ends: no longer listed or counted.
select pg_temp.received(pg_temp.co('viewer'), interval '1 hour', 'Re: Tab here');
select is(jsonb_array_length(pg_temp.listed('00000000-0000-4000-8000-0000000066aa', pg_temp.co('viewer')) -> 'drafts'),
          0, 'a reminder answered since is no longer listed');
select is(pg_temp.api('00000000-0000-4000-8000-0000000066aa',
            'select app.email_auto_draft_count(''00000000-0000-4000-8000-0000000000aa'')::text'),
          '1', 'nor counted (Vic still has the one for anyone)');

-- Sending a reminder: a reply to GSS's own email, only with its draft ------------
create function pg_temp.send(uid text, company uuid, answering uuid, auto uuid, key text,
                             org text default '00000000-0000-4000-8000-0000000000aa',
                             from_part text default 'tom') returns jsonb
language sql as $fn$
  select pg_temp.api(uid, format(
    'select app.start_outgoing_email(%L, %L, null, %L, %L, %L, %L, %L, %L, %L, %L, null, %L)::text',
    org, company, from_part, 'gss.example', '{pat@buyer.example}'::text[], '{}'::text[],
    'Re: Barley for December', 'Hi Pat, could you confirm the 2 loads?', key, answering, auto))::jsonb
$fn$;
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.co('due'), pg_temp.id('due'), null, 'gss-r1')
            ->> 'status', 'reply_not_found', 'GSS''s own email is not answered without its reminder');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.co('due'), pg_temp.id('due'),
                       pg_temp.reminder_of(pg_temp.id('left')), 'gss-r2') ->> 'status',
          'reply_not_found', 'nor with another email''s reminder');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.co('left'), pg_temp.id('due'),
                       pg_temp.reminder_of(pg_temp.id('due')), 'gss-r3') ->> 'status',
          'reply_not_found', 'nor for another company');
select is(pg_temp.send('00000000-0000-4000-8000-0000000011bb', pg_temp.co('due'), pg_temp.id('due'),
                       pg_temp.reminder_of(pg_temp.id('due')), 'gss-r4', '00000000-0000-4000-8000-0000000000bb',
                       'info')
            ->> 'status', 'company_not_found', 'nor by another organization');
insert into ids values ('reminder_sent', (pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.co('due'),
  pg_temp.id('due'), pg_temp.reminder_of(pg_temp.id('due')), 'gss-r5') ->> 'id')::uuid);
select is((select row(reply_to_email_id, auto_draft_id)::text from app.emails where id = pg_temp.id('reminder_sent')),
          row(pg_temp.id('due'), pg_temp.reminder_of(pg_temp.id('due')))::text,
          'sent as a reply to the email it reminds, from its reminder');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.co('due'), pg_temp.id('due'),
                       pg_temp.reminder_of(pg_temp.id('due')), 'gss-r6') ->> 'status',
          'auto_draft_used', 'once only');
-- A retry of its send key skips the checks and reaches the insert, whose unique key the Worker
-- answers with the earlier email (5b's R2-01), though the reminder is now answered.
select throws_ok(
  format('select pg_temp.send(%L, %L, %L, %L, %L)', '00000000-0000-4000-8000-0000000044aa',
         pg_temp.co('due'), pg_temp.id('due'), pg_temp.reminder_of(pg_temp.id('due')), 'gss-r5'),
  '23505', null, 'a retry of its send key still reaches the earlier email');

-- A reminder open in the form when the company answers is not sent (R1-01).
select pg_temp.received(pg_temp.co('left'), interval '1 minute', 'Re: the email');
select is(pg_temp.send('00000000-0000-4000-8000-0000000044aa', pg_temp.co('left'), pg_temp.id('left'),
                       pg_temp.reminder_of(pg_temp.id('left')), 'gss-r7', from_part => 'info') ->> 'status',
          'auto_draft_answered', 'a reminder answered since it was drafted is refused');
select is((select count(*)::int from app.emails where message_id = 'gss-r7'), 0, 'and nothing is kept');

-- Never a reminder of a reminder: the sent reminder goes quiet in turn, and gets none.
update app.emails set status = 'sent', provider_message_id = '<cf-r5@gss.example>',
                      occurred_at = now() - interval '5 days'
 where id = pg_temp.id('reminder_sent');
select app.add_email_reminders();
select is(pg_temp.reminder_of(pg_temp.id('reminder_sent')), null, 'no reminder of a reminder');
select ok(app.email_quiet_since(pg_temp.id('reminder_sent')), 'though it is quiet and due');

-- A refused send: the reminder may be sent again (part 1's D1-01, unchanged).
select is(pg_temp.reminder_of(pg_temp.id('failed')), null, 'a refused email is never reminded');

-- The batch reaches later emails (D1-03) -----------------------------------------
insert into co (name) select 'bulk' || n from generate_series(1, 55) n;
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by)
select id, '00000000-0000-4000-8000-0000000000aa', 'Synthetic ' || name, '{buyer}', 'US', 'manual',
       '00000000-0000-4000-8000-0000000044aa'
  from co where name like 'bulk%';
select pg_temp.sent(id, interval '8 days' + make_interval(mins => substr(name, 5)::integer), 'Bulk')
  from co where name like 'bulk%';
select app.add_email_reminders();
select is((select count(*)::int from app.email_auto_drafts a join co c on c.id = a.counterparty_id
            where c.name like 'bulk%'), 50, 'at most 50 a call, oldest first');
update app.email_auto_drafts a set state = 'skipped'
  from co c where c.id = a.counterparty_id and c.name like 'bulk%';
select app.add_email_reminders();
select is((select count(*)::int from app.email_auto_drafts a join co c on c.id = a.counterparty_id
            where c.name like 'bulk%'), 55, 'the next call reaches the other 5, past the skipped ones');
select app.add_email_reminders();
select is((select count(*)::int from app.email_auto_drafts a join co c on c.id = a.counterparty_id
            where c.name like 'bulk%'), 55, 'and never adds one twice');

-- The readings' thread context (answer 26) -----------------------------------------
insert into ids values
  ('t_out', pg_temp.sent(pg_temp.co('thread'), interval '2 days', 'Offer')),
  ('t_in1', pg_temp.received(pg_temp.co('thread'), interval '3 days', 'Question')),
  ('t_in2', pg_temp.received(pg_temp.co('thread'), interval '4 days', 'Older')),
  ('t_in3', pg_temp.received(pg_temp.co('thread'), interval '5 days', 'Oldest kept')),
  ('t_in4', pg_temp.received(pg_temp.co('thread'), interval '6 days', 'Fifth back')),
  ('t_fail', pg_temp.received(pg_temp.co('thread'), interval '1 day', 'Spoofed', passed => false)),
  ('t_auto', pg_temp.received(pg_temp.co('thread'), interval '1 day', 'Away', automatic => true)),
  ('t_gone', pg_temp.received(pg_temp.co('thread'), interval '1 day', 'Removed')),
  ('t_old', pg_temp.received(pg_temp.co('thread'), interval '100 days', 'Long ago')),
  ('t_other', pg_temp.received(pg_temp.co('other'), interval '1 day', 'Another company')),
  ('t_read', pg_temp.received(pg_temp.co('thread'), interval '1 hour', 'Yes')),
  ('t_later', pg_temp.received(pg_temp.co('thread'), interval '1 minute', 'Later'));
select pg_temp.remove_email(pg_temp.id('t_gone'));
insert into app.email_readings (organization_id, email_id, state, attempts, claimed_at, claim_token)
values ('00000000-0000-4000-8000-0000000000aa', pg_temp.id('t_read'), 'pending', 1, now(),
        '00000000-0000-4000-8000-00000000feed');
create function pg_temp.thread() returns jsonb language sql as $fn$
  select pg_temp.api(null, format('select app.email_reading_context(%L, %L)::text', pg_temp.id('t_read'),
                                  '00000000-0000-4000-8000-00000000feed'))::jsonb -> 'thread'
$fn$;
select is((select string_agg(e ->> 'subject', ',' order by n) from jsonb_array_elements(pg_temp.thread())
             with ordinality t(e, n)),
          'Oldest kept,Older,Question,Offer',
          'the 4 newest earlier emails, oldest first: none failing the sender checks, automatic, removed, '
          || 'older than 90 days, later, or of another company');
select is((select string_agg(e ->> 'direction', ',' order by n) from jsonb_array_elements(pg_temp.thread())
             with ordinality t(e, n)),
          'incoming,incoming,incoming,outgoing', 'both directions');
select is(pg_temp.thread() -> 3 ->> 'body', 'Could you confirm the 2 loads?', 'with their text');
select is(pg_temp.api(null, format('select coalesce(app.email_reading_context(%L, gen_random_uuid())::text, ''none'')',
                                   pg_temp.id('t_read'))),
          'none', 'not under another claim (as before)');

select * from finish();
rollback;
