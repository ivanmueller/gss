-- Codex's review of the Telnyx calls (ivanmueller/gss#107): commands to Telnyx kept until sent
-- (app.call_commands) and the one correction of an ended call (a late answer makes it talked).
-- Privileges; who may add and move commands; that a command starts pending, stays what it is,
-- and once finished stays finished; that commands are never deleted; cross-organization
-- denials; and what check_call allows of a late answer. Runs in one transaction that is rolled
-- back. All fixtures are synthetic (555 numbers).
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom", "last_name": "Trader"}'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test', '{"first_name": "Olivia"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');
insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');
insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa');

grant app_api to current_user;

create function pg_temp.api_changed(uid text, statement text) returns int
language plpgsql as $fn$
declare
  changed int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute statement;
  get diagnostics changed = row_count;
  reset role;
  perform set_config('app.user_id', '', true);
  return changed;
end
$fn$;

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

-- Tom's two calls (one to end without an answer) and an event of the first.
select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', format($$
  insert into app.calls (id, organization_id, counterparty_id, contact_name, placed_by, placed_by_name,
                         from_phone, counterparty_phone)
  values (%L, %L, %L, 'Pat Buyer', %L, 'x', '+18255550199', '+14035550100'),
         (%L, %L, %L, 'Pat Buyer', %L, 'x', '+18255550199', '+14035550100')$$,
  '00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000044aa',
  '00000000-0000-4000-8000-0000000ca11b', '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000044aa'));
select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
  insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at)
  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11a',
          'synthetic-event-1', 'call.answered', 'you', now())$$);

-- Privileges ------------------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.call_commands', 'select')
    and has_table_privilege('app_api', 'app.call_commands', 'insert')
    and has_column_privilege('app_api', 'app.call_commands', 'status', 'update')
    and has_column_privilege('app_api', 'app.call_commands', 'attempts', 'update')
    and has_column_privilege('app_api', 'app.call_commands', 'claimed_at', 'update'),
  'app_api reads and adds commands, and moves them on'
);
select ok(
  not has_table_privilege('app_api', 'app.call_commands', 'delete')
    and not has_column_privilege('app_api', 'app.call_commands', 'kind', 'update')
    and not has_column_privilege('app_api', 'app.call_commands', 'call_control_id', 'update')
    and not has_column_privilege('app_api', 'app.call_commands', 'call_id', 'update'),
  'app_api never deletes a command or changes what it is'
);
select ok(
  not has_table_privilege('anon', 'app.call_commands', 'select')
    and not has_table_privilege('authenticated', 'app.call_commands', 'select')
    and not has_table_privilege('service_role', 'app.call_commands', 'select')
    and not has_function_privilege('app_api', 'app.check_call_command()', 'execute'),
  'the Supabase API roles have nothing on commands; the trigger function is not callable'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.call_commands'::regclass),
  'row level security is on for commands'
);

-- Adding and moving commands --------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
    insert into app.call_commands (id, organization_id, call_id, telnyx_event_id, kind, call_control_id)
    values ('00000000-0000-4000-8000-0000000c0d01', '00000000-0000-4000-8000-0000000000aa',
            '00000000-0000-4000-8000-0000000ca11a', 'synthetic-event-1', 'confirm', 'v3:staff')$$),
  1, 'the caller adds a pending command for their call'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    'insert into app.call_commands (organization_id, call_id, telnyx_event_id, kind, call_control_id) values (''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000ca11a'', ''synthetic-event-1'', ''hang_up'', ''v3:staff'')')$$,
  '42501', null, 'nobody else adds commands for the caller''s call'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    'insert into app.call_commands (organization_id, call_id, telnyx_event_id, kind, call_control_id) values (''00000000-0000-4000-8000-0000000000bb'', ''00000000-0000-4000-8000-0000000ca11a'', ''synthetic-event-1'', ''hang_up'', ''v3:staff'')')$$,
  '42501', null, 'another organization adds none'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb', 'select count(*)::text from app.call_commands'),
  '0', 'another organization sees none'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011aa', 'select count(*)::text from app.call_commands'),
  '0', 'a colleague in the same organization sees none of the caller''s commands (re-review, 4)'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa', 'select count(*)::text from app.call_commands'),
  '1', 'the caller sees their own'
);
-- An event of Tom's other call, and of another organization's call.
select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
  insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at)
  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11b',
          'synthetic-event-b', 'call.initiated', 'you', now())$$);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'insert into app.call_commands (organization_id, call_id, telnyx_event_id, kind, call_control_id) values (''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000ca11a'', ''synthetic-event-b'', ''hang_up'', ''v3:staff'')')$$,
  '23503', null, 'a command names an event of its own call only (re-review, 5)'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'insert into app.call_commands (organization_id, call_id, telnyx_event_id, kind, call_control_id, status, attempts, claimed_at) values (''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000ca11a'', ''synthetic-event-1'', ''hang_up'', ''v3:staff'', ''sending'', 1, now())')$$,
  '23514', null, 'a command starts pending'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'insert into app.call_commands (organization_id, call_id, telnyx_event_id, kind, call_control_id) values (''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000ca11a'', ''no-such-event'', ''hang_up'', ''v3:staff'')')$$,
  '23503', null, 'a command follows from an event that was kept'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', $$
    update app.call_commands set status = 'cancelled'
     where id = '00000000-0000-4000-8000-0000000c0d01'$$),
  0, 'nobody else moves the caller''s commands'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
    update app.call_commands set status = 'sending', attempts = 1, claimed_at = now()
     where id = '00000000-0000-4000-8000-0000000c0d01'$$),
  1, 'the caller claims it for sending'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.call_commands set attempts = 0, claimed_at = null where id = ''00000000-0000-4000-8000-0000000c0d01''')$$,
  '23514', null, 'attempts only go up'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
    update app.call_commands set status = 'pending'
     where id = '00000000-0000-4000-8000-0000000c0d01'$$),
  1, 'Telnyx could not be reached: pending again, for the next delivery'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
    update app.call_commands set status = 'done'
     where id = '00000000-0000-4000-8000-0000000c0d01'$$),
  1, 'done once Telnyx took it'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.call_commands set status = ''pending'' where id = ''00000000-0000-4000-8000-0000000c0d01''')$$,
  '23514', null, 'a finished command stays finished'
);
select throws_ok(
  $$update app.call_commands set kind = 'hang_up' where id = '00000000-0000-4000-8000-0000000c0d01'$$,
  '23514', null, 'a command stays what it is, even for the table owner'
);
select throws_ok(
  $$delete from app.call_commands$$,
  '42501', null, 'commands are never deleted, even by the table owner'
);

-- A late answer -----------------------------------------------------------------------------
-- Call b was dialed to them (their leg known) and ended without an answer five minutes ago.
select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
  update app.calls set status = 'ended', outcome = 'no_answer', ended_at = now() - interval '5 minutes',
                       hangup_cause = 'normal_clearing', counterparty_call_control_id = 'v3:them'
   where id = '00000000-0000-4000-8000-0000000ca11b'$$);

select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set outcome = ''talked'', connected_at = now() - interval ''8 minutes'' where id = ''00000000-0000-4000-8000-0000000ca11b''')$$,
  '23514', null, 'no late answer without their "answered" event (re-review, 6)'
);
-- Their answer eight minutes ago, received late.
select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
  insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at)
  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11b',
          'synthetic-answer-b', 'call.answered', 'them', now() - interval '8 minutes')$$);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set outcome = ''talked'', connected_at = now() - interval ''7 minutes'' where id = ''00000000-0000-4000-8000-0000000ca11b''')$$,
  '23514', null, 'only at the time of their answer'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set outcome = ''talked'', connected_at = now() - interval ''8 minutes'', counterparty_call_control_id = ''v3:other'' where id = ''00000000-0000-4000-8000-0000000ca11b''')$$,
  '23514', null, 'with their leg unchanged'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set outcome = ''talked'', connected_at = now() - interval ''8 minutes'', ended_at = now() where id = ''00000000-0000-4000-8000-0000000ca11b''')$$,
  '23514', null, 'a late answer does not move the end'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set outcome = ''busy'' where id = ''00000000-0000-4000-8000-0000000ca11b''')$$,
  '23514', null, 'an ended call gets no other outcome'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
    update app.calls set outcome = 'talked', connected_at = now() - interval '8 minutes'
     where id = '00000000-0000-4000-8000-0000000ca11b'$$),
  1, 'their answer from before the end, received, makes it talked'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set outcome = ''no_answer'', connected_at = null where id = ''00000000-0000-4000-8000-0000000ca11b''')$$,
  '23514', null, 'and it stays talked'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set connected_at = now() - interval ''9 minutes'' where id = ''00000000-0000-4000-8000-0000000ca11b''')$$,
  '23514', null, 'with the time it connected kept'
);

-- Call a, never dialed to them: the caller's cell went unanswered.
select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
  update app.calls set status = 'ended', outcome = 'you_missed', ended_at = now() - interval '1 minute',
                       hangup_cause = 'timeout'
   where id = '00000000-0000-4000-8000-0000000ca11a'$$);
select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', $$
  insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at)
  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11a',
          'synthetic-answer-a', 'call.answered', 'them', now() - interval '1 minute')$$);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set outcome = ''talked'', connected_at = ended_at, counterparty_call_control_id = ''v3:invented'' where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'a call never dialed to them is never made talked (re-review, 6)'
);

select * from finish();
rollback;
