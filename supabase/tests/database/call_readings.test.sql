-- Claude's readings of call transcripts and their drafts: privileges; the job's claims (a
-- transcript with words, newest first, one claim at a time, 5 attempts); the context it reads;
-- a reading kept once, its drafts tied to the call's company; everyone on the team reads the
-- drafts, another organization none; drafts written only through the functions and never
-- deleted; a person accepts (naming what they saved) or dismisses a draft, by role; a person
-- corrects "voicemail", audited. Runs in one transaction that is rolled back. All fixtures are
-- synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000055aa', 'olga@example.test', '{"first_name": "Olga"}'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test', '{"first_name": "Victor"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');
insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');
insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Other', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa');
insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Pat Buyer', '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000d2aa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa',
   'Other Contact', '00000000-0000-4000-8000-0000000044aa');

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

create function pg_temp.api_exec(uid text, statement text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute statement;
  reset role;
  perform set_config('app.user_id', '', true);
end
$fn$;

-- A recording's current claim token, read as the table owner.
create function pg_temp.claim_of(recording uuid) returns text
language sql as $fn$
  select coalesce(quote_literal(reading_claim_token::text), 'null')
    from app.call_recordings where id = recording
$fn$;

-- Three calls of Tom's to Synthetic A Buyer, placed as Tom; their recordings: one transcribed
-- an hour ago, one just now, one with nothing said, one not transcribed yet.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.calls (id, organization_id, counterparty_id, contact_name, placed_by, placed_by_name,
                       from_phone, counterparty_phone)
select ('00000000-0000-4000-8000-0000000ca11' || n)::uuid, '00000000-0000-4000-8000-0000000000aa',
       '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'x',
       '+18255550199', '+14035550100'
  from unnest(array['a', 'b', 'c', 'd']) n;
select set_config('app.user_id', '', true);
insert into app.call_recordings (id, organization_id, call_id, telnyx_recording_id, transcript,
                                 transcript_lines, transcribed_at, created_at) values
  ('00000000-0000-4000-8000-0000000ec01a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11a',
   'rec-old', 'Caller: Hi Pat. Counterparty: We bid 725 a tonne.',
   '[{"side":"caller","start":0,"text":"Hi Pat."},{"side":"counterparty","start":2,"text":"We bid 725 a tonne."}]',
   now(), now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000ec01b', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11b',
   'rec-new', 'Counterparty: Leave a message after the tone.', null, now(), now()),
  ('00000000-0000-4000-8000-0000000ec01c', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11c',
   'rec-empty', '', '[]', now(), now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000ec01d', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11d',
   'rec-untranscribed', null, null, null, now() - interval '3 hours');

-- Privileges ----------------------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.call_drafts', 'select')
    and not has_table_privilege('app_api', 'app.call_drafts', 'insert')
    and not has_table_privilege('app_api', 'app.call_drafts', 'update')
    and not has_table_privilege('app_api', 'app.call_drafts', 'delete'),
  'app_api only reads drafts; it writes them through the functions'
);
select ok(
  not has_table_privilege('anon', 'app.call_drafts', 'select')
    and not has_table_privilege('authenticated', 'app.call_drafts', 'select')
    and not has_table_privilege('service_role', 'app.call_drafts', 'select'),
  'the Supabase API roles have nothing on drafts'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.call_drafts'::regclass),
  'drafts have row level security'
);
select ok(
  has_function_privilege('app_api', 'app.claim_call_readings(integer)', 'execute')
    and has_function_privilege('app_api', 'app.call_reading_context(uuid, uuid)', 'execute')
    and has_function_privilege('app_api', 'app.release_call_reading(uuid, uuid)', 'execute')
    and has_function_privilege('app_api', 'app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer, boolean, text)', 'execute')
    and has_function_privilege('app_api', 'app.decide_call_draft(uuid, text, uuid)', 'execute')
    and has_function_privilege('app_api', 'app.correct_call_voicemail(uuid, boolean)', 'execute'),
  'app_api runs the reading functions'
);
select ok(
  not has_function_privilege('anon', 'app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer, boolean, text)', 'execute')
    and not has_function_privilege('authenticated', 'app.decide_call_draft(uuid, text, uuid)', 'execute')
    and not has_function_privilege('service_role', 'app.claim_call_readings(integer)', 'execute')
    and not has_function_privilege('public', 'app.call_reading_context(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'app.correct_call_voicemail(uuid, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'app.release_call_reading(uuid, uuid)', 'execute'),
  'nobody else runs them'
);

-- Claims --------------------------------------------------------------------------------------
select is(
  pg_temp.api_text(null, $$select string_agg(recording_id::text, ',') from app.claim_call_readings(1)$$),
  '00000000-0000-4000-8000-0000000ec01b',
  'the newest transcript is claimed first'
);
select is(
  pg_temp.api_text(null, $$select string_agg(recording_id::text, ',') from app.claim_call_readings(10)$$),
  '00000000-0000-4000-8000-0000000ec01a',
  'then the older one; none with nothing said or not transcribed'
);
select is(
  pg_temp.api_text(null, $$select count(*)::text from app.claim_call_readings(10)$$),
  '0',
  'a claim is held: they are not claimed again at once'
);
update app.call_recordings set reading_claimed_at = now() - interval '11 minutes'
 where id = '00000000-0000-4000-8000-0000000ec01b';
select is(
  pg_temp.api_text(null, $$select string_agg(recording_id::text, ',') from app.claim_call_readings(10)$$),
  '00000000-0000-4000-8000-0000000ec01b',
  'a claim that lapsed after 10 minutes is claimed again'
);
update app.call_recordings set reading_attempts = 5, reading_claimed_at = now() - interval '1 hour'
 where id = '00000000-0000-4000-8000-0000000ec01b';
select is(
  pg_temp.api_text(null, $$select count(*)::text from app.claim_call_readings(10)$$),
  '0',
  'after 5 attempts a recording is no longer claimed'
);
select is(
  (select reading_attempts from app.call_recordings where id = '00000000-0000-4000-8000-0000000ec01a'),
  1,
  'a claim counts an attempt'
);
select is(
  pg_temp.api_text(null, format($$select count(*)::text from app.claim_call_readings(0) c
                                   where c.claim_token = %s$$, pg_temp.claim_of('00000000-0000-4000-8000-0000000ec01a'))),
  '0',
  'claiming none claims nothing'
);
select pg_temp.api_exec(null, format($$select app.release_call_reading('00000000-0000-4000-8000-0000000ec01a', %s)$$,
                                      pg_temp.claim_of('00000000-0000-4000-8000-0000000ec01a')));
select is(
  (select concat_ws(':', reading_attempts, reading_claimed_at is null, reading_claim_token is null)
     from app.call_recordings where id = '00000000-0000-4000-8000-0000000ec01a'),
  '0:t:t',
  'a claim given back with its token does not count its attempt'
);
select is(
  pg_temp.api_text(null, $$select string_agg(recording_id::text, ',') from app.claim_call_readings(10)$$),
  '00000000-0000-4000-8000-0000000ec01a',
  'and the recording is claimed again at once'
);

-- A run whose claim lapsed (Codex's review of c9222d3, finding 5): another run claims the
-- recording again; the first run's token gives back, reads and keeps nothing.
create temp table stale on commit drop as
  select reading_claim_token as token from app.call_recordings where id = '00000000-0000-4000-8000-0000000ec01a';
update app.call_recordings set reading_claimed_at = now() - interval '11 minutes'
 where id = '00000000-0000-4000-8000-0000000ec01a';
select is(
  pg_temp.api_text(null, $$select count(*)::text from app.claim_call_readings(10)$$),
  '1',
  'a lapsed claim is taken by another run'
);
select pg_temp.api_exec(null, format($$select app.release_call_reading('00000000-0000-4000-8000-0000000ec01a', %L)$$,
                                      (select token from stale)));
select is(
  (select concat_ws(':', reading_attempts, reading_claim_token is distinct from (select token from stale),
                    reading_claimed_at > now() - interval '1 minute')
     from app.call_recordings where id = '00000000-0000-4000-8000-0000000ec01a'),
  '2:t:t',
  'the first run cannot give back the newer claim'
);
select is(
  pg_temp.api_text(null, format($$select coalesce(app.call_reading_context('00000000-0000-4000-8000-0000000ec01a', %L)::text, 'none')
                                   || '|' || app.keep_call_reading('00000000-0000-4000-8000-0000000ec01a', %L, 'claude-opus-5-5',
                                                                  true, null, '[]'::jsonb, 1, 1, false, null)::text$$,
                                (select token from stale), (select token from stale))),
  'none|false',
  'nor read its context, nor keep a reading under it'
);

-- Context -------------------------------------------------------------------------------------
select is(
  pg_temp.api_text(null, $$select concat_ws('|', c ->> 'counterpartyName', c -> 'counterpartyTypes' ->> 0,
                                            c ->> 'callerName', jsonb_array_length(c -> 'contacts'),
                                            c -> 'contacts' -> 0 ->> 'name', jsonb_array_length(c -> 'lines'))
                           from app.call_reading_context('00000000-0000-4000-8000-0000000ec01a', $$
                   || pg_temp.claim_of('00000000-0000-4000-8000-0000000ec01a') || ') c'),
  'Synthetic A Buyer|buyer|Tom|1|Pat Buyer|2',
  'a claimed recording''s context: the company, the caller, its own contacts only, the lines'
);
select is(
  pg_temp.api_text(null, $$select count(*)::text from app.call_reading_context('00000000-0000-4000-8000-0000000ec01d', gen_random_uuid()) c
                           where c is not null$$),
  '0',
  'no context for a recording not claimed'
);

-- Keeping a reading ---------------------------------------------------------------------------
select is(
  pg_temp.api_text(null, $$select app.keep_call_reading('00000000-0000-4000-8000-0000000ec01a', $$
    || pg_temp.claim_of('00000000-0000-4000-8000-0000000ec01a') || $$, 'claude-opus-5-5', false,
    'Pat bids on canola.',
    '[{"kind":"quote","fields":{"side":"bid","commodity":"canola","values":{"price":"725"}},"lines":[1]},
      {"kind":"follow_up","fields":{"values":{"task":"Call Pat back"}},"lines":[0,1]},
      {"kind":"contact","contactId":"00000000-0000-4000-8000-00000000d1aa","fields":{"values":{"contactRole":"Merchandiser"}},"lines":[1]},
      {"kind":"contact","contactId":"00000000-0000-4000-8000-00000000d2aa","fields":{"values":{"contactName":"Sam"}},"lines":[1]},
      {"kind":"quote","fields":{"side":"bid","commodity":"canola","values":{}},"lines":[1]}]'::jsonb,
    1200, 300, false, null)::text$$),
  'true',
  'a reading is kept under its claim'
);
select is(
  (select concat_ws(':', reading_claimed_at is null, reading_claim_token is null)
     from app.call_recordings where id = '00000000-0000-4000-8000-0000000ec01a'),
  't:t',
  'and its claim is done with'
);
select is(
  (select concat_ws('|', read_model, read_voicemail, read_summary, read_input_tokens, read_output_tokens,
                    read_at is not null)
     from app.call_recordings where id = '00000000-0000-4000-8000-0000000ec01a'),
  'claude-opus-5-5|f|Pat bids on canola.|1200|300|t',
  'with its model, voicemail, notes and tokens'
);
select is(
  (select string_agg(concat_ws(':', position, kind, counterparty_id = '00000000-0000-4000-8000-00000000c1aa',
                               call_id = '00000000-0000-4000-8000-0000000ca11a', status), ',' order by position)
     from app.call_drafts where recording_id = '00000000-0000-4000-8000-0000000ec01a'),
  '0:quote:t:t:open,1:follow_up:t:t:open,2:contact:t:t:open,3:contact:t:t:open,4:quote:t:t:open',
  'its drafts are kept in order, open, for the call''s company'
);
select is(
  (select string_agg(coalesce(contact_id::text, 'new'), ',' order by position)
     from app.call_drafts where recording_id = '00000000-0000-4000-8000-0000000ec01a' and kind = 'contact'),
  '00000000-0000-4000-8000-00000000d1aa,new',
  'a contact of another company named in a draft becomes a new contact'
);
select is(
  pg_temp.api_text(null, $$select app.keep_call_reading('00000000-0000-4000-8000-0000000ec01a', gen_random_uuid(),
    'claude-opus-5-5', true, null, '[{"kind":"quote","fields":{},"lines":[0]}]'::jsonb, 1, 1, false, null)::text$$),
  'false',
  'a reading is kept once'
);
select is(
  (select count(*)::int from app.call_drafts where recording_id = '00000000-0000-4000-8000-0000000ec01a'),
  5,
  'and its drafts are not added to'
);
select throws_ok(
  $$select pg_temp.api_text(null, 'select app.keep_call_reading(''00000000-0000-4000-8000-0000000ec01b'', gen_random_uuid(), ''claude-opus-5-5'', true, null, ''{}''::jsonb, 1, 1, false, null)::text')$$,
  '23514', null, 'drafts must be an array'
);
select throws_ok(
  $$select pg_temp.api_text(null, format('select app.keep_call_reading(''00000000-0000-4000-8000-0000000ec01b'', %s, ''claude-opus-5-5'', true, null, ''[{"kind":"quote","fields":{},"lines":[]}]''::jsonb, 1, 1, false, null)::text', pg_temp.claim_of('00000000-0000-4000-8000-0000000ec01b')))$$,
  '23514', null, 'a draft names at least one line of the transcript'
);
select is(
  pg_temp.api_text(null, $$select app.keep_call_reading('00000000-0000-4000-8000-0000000ec01d', gen_random_uuid(),
    'claude-opus-5-5', true, null, '[]'::jsonb, 1, 1, false, null)::text$$),
  'false',
  'a recording without a transcript cannot be read'
);

-- Who sees the drafts -------------------------------------------------------------------------
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000033aa', $$select count(*)::text from app.call_drafts$$),
  '5',
  'everyone on the team, a viewer too, reads the drafts'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb', $$select count(*)::text from app.call_drafts$$),
  '0',
  'another organization reads none'
);
select is(
  pg_temp.api_text(null, $$select count(*)::text from app.call_drafts$$),
  '0',
  'and nobody signed out'
);
select throws_ok(
  $$select pg_temp.api_exec('00000000-0000-4000-8000-0000000044aa', 'update app.call_drafts set status = ''dismissed''')$$,
  '42501', null, 'drafts are not changed directly'
);
select throws_ok(
  $$delete from app.call_drafts$$,
  '42501', null, 'drafts are never deleted'
);

-- Deciding ------------------------------------------------------------------------------------
-- A bid of Tom's on Synthetic A Buyer, and a contact Olga adds there.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.quotes (id, organization_id, counterparty_id, side, commodity_code, created_by)
values ('00000000-0000-4000-8000-0000000e0e01', '00000000-0000-4000-8000-0000000000aa',
        '00000000-0000-4000-8000-00000000c1aa', 'bid', 'canola', '00000000-0000-4000-8000-0000000044aa');
select set_config('app.user_id', '', true);
insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, created_by) values
  ('00000000-0000-4000-8000-00000000d3aa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Sam', '00000000-0000-4000-8000-0000000055aa'),
  ('00000000-0000-4000-8000-00000000d4aa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Someone Tom Added', '00000000-0000-4000-8000-0000000044aa');

create temp table drafts on commit drop as
  select position, id from app.call_drafts where recording_id = '00000000-0000-4000-8000-0000000ec01a';
grant select on drafts to app_api;

select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000033aa',
    $$select app.decide_call_draft((select id from drafts where position = 0), 'dismissed', null)$$),
  'forbidden',
  'a viewer cannot decide a draft'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb',
    $$select app.decide_call_draft((select id from drafts where position = 0), 'dismissed', null)$$),
  'not_found',
  'another organization cannot decide one'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.decide_call_draft((select id from drafts where position = 0), 'accepted', gen_random_uuid())$$),
  'result_not_found',
  'accepting names a bid or offer that exists'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000055aa',
    $$select app.decide_call_draft((select id from drafts where position = 0), 'accepted', '00000000-0000-4000-8000-0000000e0e01')$$),
  'forbidden',
  'only traders and admins decide a bid or offer draft'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.decide_call_draft((select id from drafts where position = 0), 'accepted', '00000000-0000-4000-8000-0000000e0e01')$$),
  'decided',
  'a trader accepts a bid draft with the bid they saved'
);
select is(
  (select concat_ws('|', status, decided_by_name, result_id, decided_at is not null) from app.call_drafts
    where id = (select id from drafts where position = 0)),
  'accepted|Tom|00000000-0000-4000-8000-0000000e0e01|t',
  'the draft records who accepted it, when, and the bid'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.decide_call_draft((select id from drafts where position = 0), 'dismissed', null)$$),
  'already_decided',
  'a decided draft stays as it is'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.decide_call_draft((select id from drafts where position = 4), 'accepted', '00000000-0000-4000-8000-0000000e0e01')$$),
  'result_not_found',
  'one bid accepts one draft'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.decide_call_draft((select id from drafts where position = 1), 'dismissed', gen_random_uuid())$$),
  'decided',
  'a trader dismisses a follow-up draft'
);
select is(
  (select concat_ws(':', status, result_id is null, decided_by_name) from app.call_drafts
    where id = (select id from drafts where position = 1)),
  'dismissed:t:Tom',
  'a dismissal names nothing'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.decide_call_draft((select id from drafts where position = 3), 'accepted', '00000000-0000-4000-8000-00000000d3aa')$$),
  'forbidden',
  'only operations and admins decide a contact draft'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000055aa',
    $$select app.decide_call_draft((select id from drafts where position = 2), 'accepted', '00000000-0000-4000-8000-00000000d3aa')$$),
  'result_not_found',
  'a change to a listed contact is accepted with that contact only'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000055aa',
    $$select app.decide_call_draft((select id from drafts where position = 3), 'accepted', '00000000-0000-4000-8000-00000000d4aa')$$),
  'result_not_found',
  'a new-contact draft is not accepted with a contact someone else added'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000055aa',
    $$select app.decide_call_draft((select id from drafts where position = 3), 'accepted', '00000000-0000-4000-8000-00000000d3aa')$$),
  'decided',
  'operations accepts a new-contact draft with the contact they added'
);
select is(
  (select count(*)::int from app.audit_events
    where entity = 'call_drafts' and action = 'update'
      and entity_id in (select id from drafts)),
  3,
  'each decision is audited'
);

-- Voicemail -----------------------------------------------------------------------------------
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000033aa',
    $$select app.correct_call_voicemail('00000000-0000-4000-8000-0000000ec01a', true)$$)
  || '|' || pg_temp.api_text('00000000-0000-4000-8000-0000000011bb',
    $$select app.correct_call_voicemail('00000000-0000-4000-8000-0000000ec01a', true)$$)
  || '|' || pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.correct_call_voicemail('00000000-0000-4000-8000-0000000ec01b', true)$$),
  'forbidden|not_found|not_read',
  'a viewer cannot correct voicemail, another organization cannot, nor before Claude read the call'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    $$select app.correct_call_voicemail('00000000-0000-4000-8000-0000000ec01a', true)$$),
  'saved',
  'a trader corrects voicemail'
);
select is(
  (select concat_ws('|', read_voicemail, voicemail_corrected, voicemail_corrected_by_name,
                    voicemail_corrected_at is not null,
                    (select count(*) from app.audit_events a where a.entity = 'call_recordings'
                       and a.entity_id = r.id and a.actor_id = '00000000-0000-4000-8000-0000000044aa'))
     from app.call_recordings r where id = '00000000-0000-4000-8000-0000000ec01a'),
  'f|t|Tom|t|1',
  'Claude''s answer is kept beside the person''s, who made it and when, audited'
);

select * from finish();
rollback;
