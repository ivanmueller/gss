-- Transcripts of calls with the audio kept 24 hours: privileges; everyone on the team reads a
-- call's recordings and transcript, another organization none; recordings and transcripts are
-- written only through the Worker's functions, once, and never moved to another call; which
-- recordings are due for deletion; recordings are never deleted; the record command kind.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

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
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa');

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

create function pg_temp.api_exec(statement text) returns void
language plpgsql as $fn$
begin
  set local role app_api;
  execute statement;
  reset role;
end
$fn$;

-- Two calls of Tom's, placed as Tom.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.calls (id, organization_id, counterparty_id, contact_name, placed_by, placed_by_name,
                       from_phone, counterparty_phone)
values ('00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000000aa',
        '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'x',
        '+18255550199', '+14035550100'),
       ('00000000-0000-4000-8000-0000000ca11b', '00000000-0000-4000-8000-0000000000aa',
        '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'x',
        '+18255550199', '+14035550100');
select set_config('app.user_id', '', true);

-- Privileges ----------------------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.call_recordings', 'select')
    and not has_table_privilege('app_api', 'app.call_recordings', 'insert')
    and not has_table_privilege('app_api', 'app.call_recordings', 'update')
    and not has_table_privilege('app_api', 'app.call_recordings', 'delete'),
  'app_api only reads recordings; it writes them through the functions'
);
select ok(
  not has_table_privilege('anon', 'app.call_recordings', 'select')
    and not has_table_privilege('authenticated', 'app.call_recordings', 'select')
    and not has_table_privilege('service_role', 'app.call_recordings', 'select'),
  'the Supabase API roles have nothing on recordings'
);
select ok(
  has_function_privilege('app_api', 'app.keep_call_recording(uuid, text, timestamptz, timestamptz)', 'execute')
    and has_function_privilege('app_api', 'app.keep_call_transcript(uuid, text, text)', 'execute')
    and has_function_privilege('app_api', 'app.recordings_to_delete(integer)', 'execute')
    and has_function_privilege('app_api', 'app.mark_recording_deleted(text)', 'execute')
    and not has_function_privilege('anon', 'app.keep_call_transcript(uuid, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'app.keep_call_recording(uuid, text, timestamptz, timestamptz)', 'execute')
    and not has_function_privilege('service_role', 'app.mark_recording_deleted(text)', 'execute'),
  'app_api alone calls the recording functions'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.call_recordings'::regclass),
  'row level security is on for recordings'
);

-- Keeping recordings and transcripts -------------------------------------------------------
select lives_ok(
  $$select pg_temp.api_exec($q$select app.keep_call_recording('00000000-0000-4000-8000-0000000ca11a',
      'synthetic-rec-1', now() - interval '30 hours', now() - interval '25 hours')$q$)$$,
  'the Worker keeps a recording of a call'
);
select lives_ok(
  $$select pg_temp.api_exec($q$select app.keep_call_recording('00000000-0000-4000-8000-0000000ca11a',
      'synthetic-rec-1', now(), now())$q$)$$,
  'keeping it again changes nothing'
);
select is(
  (select count(*)::int from app.call_recordings where telnyx_recording_id = 'synthetic-rec-1'
     and recording_ended_at < now() - interval '24 hours'),
  1, 'one row, with its first times'
);
select lives_ok(
  $$select pg_temp.api_exec($q$select app.keep_call_transcript('00000000-0000-4000-8000-0000000ca11a',
      'synthetic-rec-1', 'We can do November at the posted price.')$q$)$$,
  'its transcript is kept'
);
select pg_temp.api_exec($q$select app.keep_call_transcript('00000000-0000-4000-8000-0000000ca11a',
    'synthetic-rec-1', 'A second delivery with other words.')$q$);
select is(
  (select transcript from app.call_recordings where telnyx_recording_id = 'synthetic-rec-1'),
  'We can do November at the posted price.', 'the first transcript stays'
);
select pg_temp.api_exec($q$select app.keep_call_transcript('00000000-0000-4000-8000-0000000ca11b',
    'synthetic-rec-1', 'Claimed by another call.')$q$);
select is(
  (select call_id::text from app.call_recordings where telnyx_recording_id = 'synthetic-rec-1'),
  '00000000-0000-4000-8000-0000000ca11a', 'a recording never moves to another call'
);
-- A transcript arriving before its recording keeps both.
select pg_temp.api_exec($q$select app.keep_call_transcript('00000000-0000-4000-8000-0000000ca11b',
    'synthetic-rec-2', 'Call me back on Friday.')$q$);
select is(
  (select count(*)::int from app.call_recordings where telnyx_recording_id = 'synthetic-rec-2'
     and transcript is not null),
  1, 'a transcript that arrives first keeps its recording too'
);

-- Who reads them ---------------------------------------------------------------------------------
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000033aa', 'select count(*)::text from app.call_recordings'),
  '2', 'everyone on the team reads them, a viewer too'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb', 'select count(*)::text from app.call_recordings'),
  '0', 'another organization reads none'
);

-- Deleting the audio -----------------------------------------------------------------------------
select is(
  pg_temp.api_text(null, 'select string_agg(telnyx_recording_id, '','') from app.recordings_to_delete(100)'),
  'synthetic-rec-1', 'only a recording past 24 hours is due'
);
select pg_temp.api_exec($q$select app.mark_recording_deleted('synthetic-rec-1')$q$);
select is(
  pg_temp.api_text(null, 'select count(*)::text from app.recordings_to_delete(100)'),
  '0', 'once deleted, it is no longer due'
);
select isnt(
  (select audio_deleted_at from app.call_recordings where telnyx_recording_id = 'synthetic-rec-1'),
  null, 'when it was deleted is kept, with its transcript'
);
select throws_ok(
  $$delete from app.call_recordings$$,
  '42501', null, 'recordings are never deleted, even by the table owner'
);

-- The record command kind --------------------------------------------------------------------
select ok(
  pg_catalog.pg_get_constraintdef((select oid from pg_constraint where conname = 'call_commands_kind_check'))
    like '%record%',
  'a command may start a recording'
);

-- The transcript split by side (20261102080000_transcript_lines.sql) ----------------------------
select ok(
  has_function_privilege('app_api', 'app.claim_recordings_to_transcribe(integer)', 'execute')
    and has_function_privilege('app_api', 'app.keep_call_transcript_lines(text, jsonb, text)', 'execute')
    and not has_function_privilege('anon', 'app.claim_recordings_to_transcribe(integer)', 'execute')
    and not has_function_privilege('authenticated', 'app.keep_call_transcript_lines(text, jsonb, text)', 'execute'),
  'app_api alone claims recordings to transcribe and keeps their lines'
);
select pg_temp.api_exec($q$select app.keep_call_recording('00000000-0000-4000-8000-0000000ca11b',
    'synthetic-rec-3', now() - interval '3 minutes', now() - interval '1 minute')$q$);
select is(
  pg_temp.api_text(null, 'select string_agg(telnyx_recording_id, '','') from app.claim_recordings_to_transcribe(10)'),
  'synthetic-rec-3', 'a recording without a transcript is claimed to be transcribed'
);
select is(
  pg_temp.api_text(null, 'select count(*)::text from app.claim_recordings_to_transcribe(10)'),
  '0', 'not claimed again while the claim holds'
);
update app.call_recordings set transcribe_claimed_at = now() - interval '11 minutes'
 where telnyx_recording_id = 'synthetic-rec-3';
select is(
  pg_temp.api_text(null, 'select count(*)::text from app.claim_recordings_to_transcribe(10)'),
  '1', 'claimed again once the claim has lapsed'
);
select pg_temp.api_exec($q$select app.keep_call_transcript_lines('synthetic-rec-3',
    '[{"side": "caller", "start": 0.4, "text": "Morning Pat."}, {"side": "counterparty", "start": 2.1, "text": "Two loads at the posted price."}]',
    'Caller: Morning Pat.' || chr(10) || 'Counterparty: Two loads at the posted price.')$q$);
select is(
  (select jsonb_array_length(transcript_lines) || ' ' || (transcript_lines -> 1 ->> 'side')
     from app.call_recordings where telnyx_recording_id = 'synthetic-rec-3'),
  '2 counterparty', 'its lines are kept with their side'
);
select is(
  pg_temp.api_text(null, 'select count(*)::text from app.claim_recordings_to_transcribe(10)'),
  '0', 'a transcribed recording is not claimed again'
);
update app.call_recordings set transcribe_attempts = 5, transcript = null, transcribed_at = null,
                               transcript_lines = null, transcribe_claimed_at = null
 where telnyx_recording_id = 'synthetic-rec-3';
select is(
  pg_temp.api_text(null, 'select count(*)::text from app.claim_recordings_to_transcribe(10)'),
  '0', 'after 5 attempts it is no longer tried'
);

select * from finish();
rollback;
