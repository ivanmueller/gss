-- Claude's summaries of companies: privileges; the job's claims (something new since the summary,
-- at most once an hour, after 3 quiet minutes, not while a call is still being read, not for an
-- archived company, 5 attempts unless something newer happened, one claim at a time); the
-- context it reads and the summary kept under the current claim only; a person asks for one
-- (traders, operations and admins; not too soon; not another organization's); everyone on the
-- team reads them, another organization none; removed with their company. Runs in one
-- transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test', '{"first_name": "Victor"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');
insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');
insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());
-- c1: a company added after the summaries began; c2: archived; c3: listed before them (its row
-- says nothing to summarize up to now); c4: a note just now; b1: another organization's.
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', now()),
  ('00000000-0000-4000-8000-00000000c3aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Earlier', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', null),
  ('00000000-0000-4000-8000-00000000c4aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Quiet', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa', null),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);
insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, role, email, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Pat Buyer', 'Merchandiser', 'pat@example.test', '00000000-0000-4000-8000-0000000044aa');

grant app_api to current_user;

create function pg_temp.api_text(uid text, query text) returns text
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

-- Logs a contact with a company, recorded `minutes` ago, as Tom.
create function pg_temp.log(company uuid, minutes integer, note text) returns void
language plpgsql as $fn$
declare
  entry uuid := gen_random_uuid();
  org uuid := (select organization_id from app.counterparties where id = company);
begin
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
  insert into app.contact_log_entries (id, organization_id, counterparty_id, created_by, created_at)
  values (entry, org, company, '00000000-0000-4000-8000-0000000044aa', now() - make_interval(mins => minutes));
  insert into app.contact_log_revisions (organization_id, entry_id, occurred_at, channel, contact_name, notes,
                                         recorded_by, recorded_by_name, created_at)
  values (org, entry, now() - make_interval(mins => minutes), 'call', 'Pat Buyer', note,
          '00000000-0000-4000-8000-0000000044aa', 'Tom', now() - make_interval(mins => minutes));
  perform set_config('app.user_id', '', true);
end
$fn$;

-- The companies the job claims now, as app_api, in order.
create function pg_temp.claimed() returns text
language plpgsql as $fn$
declare
  result text;
begin
  set local role app_api;
  select coalesce(string_agg(counterparty_id::text, ',' order by counterparty_id), '')
    into result from app.claim_counterparty_summaries(10);
  reset role;
  return result;
end
$fn$;

create function pg_temp.token(company uuid) returns uuid
language sql as $fn$
  select claim_token from app.counterparty_summaries where counterparty_id = company
$fn$;

create function pg_temp.lapse(company uuid) returns void
language sql as $fn$
  update app.counterparty_summaries set claimed_at = now() - interval '11 minutes'
   where counterparty_id = company and claimed_at is not null
$fn$;

-- c3 was listed before the summaries began: a row saying nothing to summarize up to now.
insert into app.counterparty_summaries (counterparty_id, organization_id, source_at)
values ('00000000-0000-4000-8000-00000000c3aa', '00000000-0000-4000-8000-0000000000aa', now());

-- Privileges ----------------------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.counterparty_summaries', 'select')
    and not has_table_privilege('app_api', 'app.counterparty_summaries', 'insert')
    and not has_table_privilege('app_api', 'app.counterparty_summaries', 'update')
    and not has_table_privilege('app_api', 'app.counterparty_summaries', 'delete'),
  'app_api only reads summaries; it writes them through the functions'
);
select ok(
  not has_table_privilege('anon', 'app.counterparty_summaries', 'select')
    and not has_table_privilege('authenticated', 'app.counterparty_summaries', 'select')
    and not has_table_privilege('service_role', 'app.counterparty_summaries', 'select'),
  'the Supabase API roles have nothing on summaries'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.counterparty_summaries'::regclass),
  'summaries have row level security'
);
select ok(
  has_function_privilege('app_api', 'app.claim_counterparty_summaries(integer)', 'execute')
    and has_function_privilege('app_api', 'app.release_counterparty_summary(uuid, uuid)', 'execute')
    and has_function_privilege('app_api', 'app.counterparty_summary_context(uuid, uuid)', 'execute')
    and has_function_privilege('app_api', 'app.keep_counterparty_summary(uuid, uuid, text, text, integer, integer)', 'execute')
    and has_function_privilege('app_api', 'app.request_counterparty_summary(uuid)', 'execute'),
  'app_api runs the summary functions'
);
select ok(
  not has_function_privilege('app_api', 'app.counterparty_activity_at(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'app.claim_counterparty_summaries(integer)', 'execute')
    and not has_function_privilege('authenticated', 'app.request_counterparty_summary(uuid)', 'execute'),
  'nobody else runs them'
);

-- Claims ----------------------------------------------------------------------------------------
select is(pg_temp.claimed(), '', 'nothing has happened: nothing to summarize');

select pg_temp.log('00000000-0000-4000-8000-00000000c3aa', 10, 'Before the summaries began.');
update app.counterparty_summaries set source_at = now() where counterparty_id = '00000000-0000-4000-8000-00000000c3aa';
select pg_temp.log('00000000-0000-4000-8000-00000000c4aa', 1, 'Just now.');
select is(pg_temp.claimed(), '', 'a company is not summarized in its first 3 quiet minutes');

select pg_temp.log('00000000-0000-4000-8000-00000000c1aa', 10, 'Wants November delivery.');
select is(pg_temp.claimed(), '00000000-0000-4000-8000-00000000c1aa',
  'after a note, the company is claimed; not one listed earlier with nothing new since');
select is(pg_temp.claimed(), '', 'a claim is held: no second claim within 10 minutes');

-- An archived company with a note is never summarized.
update app.counterparties set archived_at = null where id = '00000000-0000-4000-8000-00000000c2aa';
select pg_temp.log('00000000-0000-4000-8000-00000000c2aa', 10, 'Archived company note.');
update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c2aa';
select is(pg_temp.claimed(), '', 'an archived company is not summarized');

-- Context -----------------------------------------------------------------------------------------
select is(
  pg_temp.api_text(null, $$select app.counterparty_summary_context('00000000-0000-4000-8000-00000000c1aa',
    gen_random_uuid())::text$$),
  null,
  'no context without the current claim'
);
select is(
  pg_temp.api_text(null, format($$select app.counterparty_summary_context('00000000-0000-4000-8000-00000000c1aa', %L)
    ->> 'name'$$, pg_temp.token('00000000-0000-4000-8000-00000000c1aa'))),
  'Synthetic A Buyer',
  'the context names the company'
);
select is(
  pg_temp.api_text(null, format($$select app.counterparty_summary_context('00000000-0000-4000-8000-00000000c1aa', %L)
    -> 'history' -> 0 ->> 'notes'$$, pg_temp.token('00000000-0000-4000-8000-00000000c1aa'))),
  'Wants November delivery.',
  'the context has the contact history'
);
select is(
  pg_temp.api_text(null, format($$select (app.counterparty_summary_context('00000000-0000-4000-8000-00000000c1aa', %L)
    -> 'contacts' -> 0)::text$$, pg_temp.token('00000000-0000-4000-8000-00000000c1aa'))),
  '{"main": false, "name": "Pat Buyer", "role": "Merchandiser"}',
  'contacts by name and role only: no email or phone is sent'
);

-- Keeping -------------------------------------------------------------------------------------------
select is(
  pg_temp.api_text(null, $$select app.keep_counterparty_summary('00000000-0000-4000-8000-00000000c1aa',
    gen_random_uuid(), 'claude-test', 'Wrong claim.', 1, 1)::text$$),
  'false',
  'a summary is not kept under another claim'
);
select is(
  pg_temp.api_text(null, format($$select app.keep_counterparty_summary('00000000-0000-4000-8000-00000000c1aa', %L,
    'claude-test', 'Pat wants November delivery.', 9000, 400)::text$$,
    pg_temp.token('00000000-0000-4000-8000-00000000c1aa'))),
  'true',
  'the summary is kept under its claim'
);
select ok(
  (select summary = 'Pat wants November delivery.' and claim_token is null and attempts = 0
          and source_at = (select max(r.created_at) from app.contact_log_revisions r
                             join app.contact_log_entries e on e.id = r.entry_id
                            where e.counterparty_id = '00000000-0000-4000-8000-00000000c1aa')
     from app.counterparty_summaries where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'),
  'it covers the latest note, and the claim is let go'
);

select pg_temp.log('00000000-0000-4000-8000-00000000c1aa', 5, 'Sent the bid sheet.');
select is(pg_temp.claimed(), '', 'something new within the hour waits');
update app.counterparty_summaries set written_at = now() - interval '61 minutes'
 where counterparty_id = '00000000-0000-4000-8000-00000000c1aa';
select is(pg_temp.claimed(), '00000000-0000-4000-8000-00000000c1aa',
  'something new an hour after the summary: written again');

-- Release ------------------------------------------------------------------------------------------
select is(
  pg_temp.api_text(null, format($$select app.release_counterparty_summary('00000000-0000-4000-8000-00000000c1aa', %L)::text$$,
    pg_temp.token('00000000-0000-4000-8000-00000000c1aa'))),
  null,
  'a claim Anthropic did not take is given back'
);
select ok(
  (select claim_token is null and attempts = 0 from app.counterparty_summaries
    where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'),
  'its attempt is not counted'
);

-- Attempts --------------------------------------------------------------------------------------
select pg_temp.claimed();
select pg_temp.lapse('00000000-0000-4000-8000-00000000c1aa');
select pg_temp.claimed();
select pg_temp.lapse('00000000-0000-4000-8000-00000000c1aa');
select pg_temp.claimed();
select pg_temp.lapse('00000000-0000-4000-8000-00000000c1aa');
select pg_temp.claimed();
select pg_temp.lapse('00000000-0000-4000-8000-00000000c1aa');
select pg_temp.claimed();
select pg_temp.lapse('00000000-0000-4000-8000-00000000c1aa');
select is(pg_temp.claimed(), '', 'after 5 attempts the job stops');
select pg_temp.log('00000000-0000-4000-8000-00000000c1aa', 4, 'Called again.');
select is(pg_temp.claimed(), '00000000-0000-4000-8000-00000000c1aa', 'something newer: tried again');
select is(
  (select attempts from app.counterparty_summaries where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'),
  1,
  'counting from 1'
);
select pg_temp.lapse('00000000-0000-4000-8000-00000000c1aa');

-- A call still being read holds the summary back, so it has the call.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.calls (id, organization_id, counterparty_id, contact_name, placed_by, placed_by_name,
                       from_phone, counterparty_phone)
values ('00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000000aa',
        '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'x',
        '+18255550199', '+14035550100');
select set_config('app.user_id', '', true);
insert into app.call_recordings (id, organization_id, call_id, telnyx_recording_id, created_at)
values ('00000000-0000-4000-8000-0000000ec01a', '00000000-0000-4000-8000-0000000000aa',
        '00000000-0000-4000-8000-0000000ca11a', 'rec-pending', now() - interval '5 minutes');
select is(pg_temp.claimed(), '', 'not while a call of the last hour is still being transcribed or read');
update app.call_recordings set created_at = now() - interval '2 hours';
select is(pg_temp.claimed(), '00000000-0000-4000-8000-00000000c1aa', 'a call stuck for over an hour holds nothing');
select pg_temp.lapse('00000000-0000-4000-8000-00000000c1aa');

-- Asking for one -----------------------------------------------------------------------------------
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000033aa',
    $$select app.request_counterparty_summary('00000000-0000-4000-8000-00000000c3aa')$$),
  'forbidden',
  'a viewer does not ask for a summary'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb',
    $$select app.request_counterparty_summary('00000000-0000-4000-8000-00000000c3aa')$$),
  'not_found',
  'another organization''s admin does not see the company'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.request_counterparty_summary('00000000-0000-4000-8000-00000000c2aa')$$),
  'archived',
  'not for an archived company'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.request_counterparty_summary('00000000-0000-4000-8000-00000000c3aa')$$),
  'requested',
  'a trader asks for a summary of a company with nothing new'
);
select ok(
  pg_temp.claimed() like '%00000000-0000-4000-8000-00000000c3aa%',
  'it is claimed at the next run'
);
select pg_temp.api_text(null, format($$select app.keep_counterparty_summary('00000000-0000-4000-8000-00000000c3aa', %L,
    'claude-test', 'A seller, nothing new.', 5000, 300)::text$$,
    pg_temp.token('00000000-0000-4000-8000-00000000c3aa')));
select ok(
  (select requested_at is null and requested_by_name is null from app.counterparty_summaries
    where counterparty_id = '00000000-0000-4000-8000-00000000c3aa'),
  'the request is answered'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.request_counterparty_summary('00000000-0000-4000-8000-00000000c3aa')$$),
  'too_soon',
  'not again within 10 minutes of a summary'
);

-- Reading ------------------------------------------------------------------------------------------
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000033aa',
    $$select summary from app.counterparty_summaries where counterparty_id = '00000000-0000-4000-8000-00000000c3aa'$$),
  'A seller, nothing new.',
  'everyone on the team reads a summary'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb',
    $$select count(*)::text from app.counterparty_summaries$$),
  '0',
  'another organization reads none'
);

-- Removed with the company --------------------------------------------------------------------
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb',
    $$select app.request_counterparty_summary('00000000-0000-4000-8000-00000000c1bb')$$),
  'requested',
  'an admin asks for a summary of their own organization''s company'
);
delete from app.counterparties where id = '00000000-0000-4000-8000-00000000c1bb';
select is(
  (select count(*)::integer from app.counterparty_summaries where counterparty_id = '00000000-0000-4000-8000-00000000c1bb'),
  0,
  'a deleted company''s summary goes with it'
);

select * from finish();
rollback;
