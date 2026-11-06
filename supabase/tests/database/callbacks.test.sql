-- Callbacks to GSS's number (20261107020000_callbacks.sql): the settings an admin chooses; who
-- is rung (whom the call was meant for, then the callbacks person, skipping who cannot take it,
-- then voicemail); each event and incoming leg applied once; a late event of an earlier attempt
-- changing nothing; the join, voicemail and hang-ups; what is logged (entry, follow-up, or an
-- open return); returns taken, linked and dismissed; the busy lock shared with calls placed from
-- the platform; voicemail recordings; Claude reading only calls with a company; privileges and
-- cross-organization denials. Runs in one transaction that is rolled back. All fixtures are
-- synthetic (555 numbers).
begin;
create extension if not exists pgtap with schema extensions;

select plan(122);

-- Fixtures ------------------------------------------------------------------
-- Org A: tom (trader), olivia (operations), adam (org_admin), victor (viewer).
-- Org B: bob (org_admin).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom", "last_name": "Trader"}'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test', '{"first_name": "Olivia"}'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test', '{"first_name": "Adam"}'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test', '{}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- A: c1a (buyer, contact Pat), c2a (seller, contact Sam), c4a (archived). B: c1b with Pat's number.
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at, phone) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null, null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null, '(587) 555-0177'),
  ('00000000-0000-4000-8000-00000000c4aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', now(), null),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null, '(403) 555-0100');

insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, phone, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', '(403) 555-0100', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000d2aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c2aa', 'Sam Seller', '(306) 555-0101', '00000000-0000-4000-8000-0000000011aa');

insert into app.member_phones (organization_id, user_id, phone) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', '+15875550111'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', '+15875550112');

grant app_api to current_user;

-- A query as app_api for the given user (null: the Worker, with nobody signed in).
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

create function pg_temp.worker(query text) returns jsonb
language sql as $fn$ select pg_temp.api(null, query)::jsonb $fn$;

-- Telnyx's events, as the Worker passes them on.
create function pg_temp.receive(event text, leg text, from_number text, kind text default 'call.initiated',
                                to_number text default '+18255550199') returns jsonb
language sql as $fn$
  select pg_temp.worker(format('select app.receive_callback(%L, %L, now(), %L, %L, %L)::text',
                               event, kind, leg, from_number, to_number))
$fn$;
create function pg_temp.event(call text, event text, kind text, side text, attempt text, leg text,
                              digits text default null, status text default null, cause text default null) returns jsonb
language sql as $fn$
  select pg_temp.worker(format(
    'select app.apply_callback_event(%L, %L, %L, %L, %L, now(), %L, %L, %L, %L)::text',
    call, event, kind, side, attempt, leg, digits, status, cause))
$fn$;
create function pg_temp.kinds(result jsonb) returns text
language sql as $fn$
  select coalesce(string_agg(c ->> 'kind', ',' order by o), '')
    from jsonb_array_elements(result -> 'commands') with ordinality as x(c, o)
$fn$;
-- Claims a command and finishes it as given; returns the finish's answer.
create function pg_temp.send(call text, command text, outcome text default 'done', leg text default null) returns jsonb
language plpgsql as $fn$
declare
  claimed jsonb;
begin
  claimed := pg_temp.worker(format('select app.claim_callback_command(%L, %L)::text', call, command));
  if claimed ->> 'status' <> 'claimed' then
    return claimed;
  end if;
  return pg_temp.worker(format('select app.finish_callback_command(%L, %L, %s, %L, %L)::text',
                               call, command, claimed -> 'command' ->> 'claim', outcome, leg));
end
$fn$;
create function pg_temp.command_of(call text, kind text) returns text
language sql as $fn$
  select id::text from app.call_commands where call_id = call::uuid and call_commands.kind = command_of.kind
   order by created_at desc, id desc limit 1
$fn$;
create function pg_temp.attempt_of(call text, pos int) returns text
language sql as $fn$
  select id::text from app.callback_attempts where call_id = call::uuid and position = pos
$fn$;

-- A call placed by tom to a number, already over (so he is free).
create function pg_temp.placed(id text, counterparty text, contact text, number text, name text) returns void
language plpgsql as $fn$
begin
  perform pg_temp.api('00000000-0000-4000-8000-0000000044aa', format(
    $$insert into app.calls (id, organization_id, counterparty_id, contact_id, contact_name, placed_by,
                             placed_by_name, from_phone, counterparty_phone)
      values (%L, '00000000-0000-4000-8000-0000000000aa', %L, %L, %L, app.current_user_id(),
              'set by the database', '+18255550199', %L) returning id::text$$,
    id, counterparty, contact, name, number));
  perform pg_temp.api('00000000-0000-4000-8000-0000000044aa', format(
    $$update app.calls set status = 'ended', outcome = 'no_answer', ended_at = now()
       where id = %L returning id::text$$, id));
end
$fn$;

-- Privileges ----------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.callback_settings', 'select')
    and not has_table_privilege('app_api', 'app.callback_settings', 'insert')
    and not has_table_privilege('app_api', 'app.callback_settings', 'update')
    and has_table_privilege('app_api', 'app.callback_attempts', 'select')
    and not has_table_privilege('app_api', 'app.callback_attempts', 'insert')
    and not has_table_privilege('app_api', 'app.callback_attempts', 'update'),
  'app_api reads the settings and attempts and writes neither'
);
select ok(
  not has_table_privilege('anon', 'app.callback_settings', 'select')
    and not has_table_privilege('authenticated', 'app.callback_attempts', 'select')
    and not has_table_privilege('service_role', 'app.callback_attempts', 'select'),
  'the Supabase API roles read neither'
);
select ok(
  has_function_privilege('app_api', 'app.receive_callback(text, text, timestamptz, text, text, text)', 'execute')
    and has_function_privilege('app_api', 'app.apply_callback_event(uuid, text, text, text, uuid, timestamptz, text, text, text, text)', 'execute')
    and has_function_privilege('app_api', 'app.settle_callback_return(uuid, text, uuid, uuid)', 'execute')
    and not has_function_privilege('app_api', 'app.callback_record(uuid)', 'execute')
    and not has_function_privilege('app_api', 'app.callback_next(uuid, text)', 'execute')
    and not has_function_privilege('app_api', 'app.member_busy(uuid, uuid)', 'execute')
    and not has_function_privilege('app_api', 'app.callback_member_name(uuid, uuid)', 'execute'),
  'app_api runs the entry points only, not the steps inside them'
);
select ok(
  not has_function_privilege('anon', 'app.receive_callback(text, text, timestamptz, text, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'app.apply_callback_event(uuid, text, text, text, uuid, timestamptz, text, text, text, text)', 'execute')
    and not has_function_privilege('service_role', 'app.save_callback_settings(uuid, text, uuid)', 'execute')
    and not has_function_privilege('public', 'app.callback_by_leg(text)', 'execute'),
  'nobody else runs them'
);
select is(app.dialable_phone(' (403) 555-0100 '), '+14035550100', 'a saved number as Telnyx dials it');
select is(app.dialable_phone('1-403-555-0100 ext 5'), null, 'not with an extension');
select is(app.display_phone('+14035550100'), '(403) 555-0100', 'and as people read it');
select is(app.call_length_text(372), '6 min 12 s', 'a call''s length as the app writes it');

-- Settings --------------------------------------------------------------------------
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    $$select app.save_callback_settings('00000000-0000-4000-8000-0000000000aa', '+18255550199', null)$$),
  'forbidden', 'only admins choose the callbacks person'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    $$select app.save_callback_settings('00000000-0000-4000-8000-0000000000aa', '+18255550199',
                                        '00000000-0000-4000-8000-0000000033aa')$$),
  'not_a_member', 'a viewer cannot be the callbacks person'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    $$select app.save_callback_settings('00000000-0000-4000-8000-0000000000aa', '+18255550199',
                                        '00000000-0000-4000-8000-0000000011bb')$$),
  'not_a_member', 'nor someone of another organization'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    $$select app.save_callback_settings('00000000-0000-4000-8000-0000000000aa', '(825) 555-0199',
                                        '00000000-0000-4000-8000-0000000011aa')$$),
  'saved', 'an admin chooses Olivia'
);
select is(
  (select concat_ws('|', phone, callbacks_person_name, updated_by_name) from app.callback_settings
    where organization_id = '00000000-0000-4000-8000-0000000000aa'),
  '+18255550199|Olivia|Adam', 'kept with the number as Telnyx dials it and who chose'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000011bb',
    $$select app.save_callback_settings('00000000-0000-4000-8000-0000000000bb', '+18255550199', null)$$),
  'phone_taken', 'another organization cannot take the same number'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000011bb', $$select count(*)::text from app.callback_settings$$),
  '0', 'nor read the first one''s settings'
);
select throws_ok(
  $$select pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    'update app.callback_settings set callbacks_person = null returning 1')$$,
  '42501', null, 'the settings change only through the function'
);

-- A callback taken: whom it was meant for, the join, the log -----------------------------
select pg_temp.placed('00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-00000000c1aa',
                      '00000000-0000-4000-8000-00000000d1aa', '+14035550100', 'Pat Buyer');

select is(pg_temp.receive('ev-1', 'in-1', '+14035550100', to_number => '+18005550100') ->> 'status',
          'not_ours', 'a call to a number no organization takes callbacks on is not ours');
select is(pg_temp.receive('ev-1', 'in-1', 'anonymous') ->> 'status',
          'not_ours', 'nor one without a caller''s number');

create temp table r1 as select pg_temp.receive('ev-1', 'in-1', '+1 403 555 0100') as r;
grant select on r1 to app_api;
select is((select r ->> 'status' from r1), 'created', 'a callback is kept');
select is((select pg_temp.kinds(r) from r1), 'dial_member', 'and rings someone''s cell');
select is(
  (select concat_ws('|', direction, counterparty_id, contact_id, contact_name, meant_for_name, status, counterparty_call_control_id,
                    from_phone, counterparty_phone, placed_by is null)
     from app.calls where id = (select (r ->> 'callId')::uuid from r1)),
  'incoming|00000000-0000-4000-8000-00000000c1aa|00000000-0000-4000-8000-00000000d1aa|Pat Buyer|Tom Trader|calling_you|in-1|+18255550199|+14035550100|t',
  'for Pat''s company, meant for Tom who last called the number, nobody answering yet'
);
select is(
  (select concat_ws('|', position, member_name, cell, status) from app.callback_attempts
    where call_id = (select (r ->> 'callId')::uuid from r1)),
  '1|Tom Trader|+15875550111|ringing', 'Tom''s cell rings first'
);
select is(pg_temp.receive('ev-1', 'in-1', '+14035550100') ->> 'status', 'duplicate', 'the same event again is a duplicate');
select is(
  (select (pg_temp.receive('ev-1b', 'in-1', '+14035550100') -> 'commands' -> 0 ->> 'id') = (select r -> 'commands' -> 0 ->> 'id' from r1)),
  true, 'and so is another event of the same leg, giving back the unsent dial'
);
select is((select count(*)::int from app.calls where counterparty_call_control_id = 'in-1'), 1, 'one call per leg');
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa', $$select count(*)::text from app.callback_attempts$$),
  '1', 'Tom reads his attempt'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000011aa', $$select count(*)::text from app.callback_attempts$$),
  '0', 'Olivia does not read Tom''s cell or leg'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000011bb',
    format('select count(*)::text from app.calls where id = %L', (select r ->> 'callId' from r1))),
  '0', 'another organization does not read the call'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    $$select app.my_call_in_progress('00000000-0000-4000-8000-0000000000aa')::text$$),
  'true', 'while his cell rings, Tom has a call in progress'
);
select throws_ok(
  $$select pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    'insert into app.calls (organization_id, direction, contact_name, from_phone, counterparty_phone, counterparty_call_control_id)
     values (''00000000-0000-4000-8000-0000000000aa'', ''incoming'', ''X'', ''+18255550199'', ''+14035550100'', ''forged'') returning 1')$$,
  '42501', null, 'app_api cannot write an incoming call itself'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    format('update app.calls set status = ''ended'', outcome = ''missed'', ended_at = now() where id = %L returning 1',
           (select r ->> 'callId' from r1))),
  null, 'nor change one'
);

create temp table c1 as select (r ->> 'callId') as id, pg_temp.attempt_of(r ->> 'callId', 1) as a1 from r1;
grant select on c1 to app_api;
select is(
  pg_temp.worker(format('select app.claim_callback_command(%L, %L)::text', (select id from c1),
                        (select r -> 'commands' -> 0 ->> 'id' from r1))) -> 'command' ->> 'cell',
  '+15875550111', 'the dial is claimed with Tom''s cell'
);
select is(
  pg_temp.worker(format('select app.claim_callback_command(%L, %L)::text', (select id from c1),
                        (select r -> 'commands' -> 0 ->> 'id' from r1))) ->> 'status',
  'busy', 'and not claimed twice at once'
);
select is(
  pg_temp.worker(format('select app.finish_callback_command(%L, %L, 1, ''done'', ''tom-1'')::text',
                        (select id from c1), (select r -> 'commands' -> 0 ->> 'id' from r1))) -> 'commands',
  '[]'::jsonb, 'the dial is done'
);
select is((select leg from app.callback_attempts where id = (select a1::uuid from c1)), 'tom-1', 'and its leg kept');
select is(pg_temp.kinds(pg_temp.event((select id from c1), 'ev-2', 'call.answered', 'you', (select a1 from c1), 'tom-1')),
          'confirm', 'Tom answers: he is asked to press 1');
select is(
  (select pg_temp.worker(format('select app.claim_callback_command(%L, %L)::text', id, pg_temp.command_of(id, 'confirm')))
            -> 'command' ->> 'companyName' from c1),
  'Synthetic A Buyer', 'the prompt names the company'
);
select is(pg_temp.kinds(pg_temp.event((select id from c1), 'ev-3', 'call.gather.ended', 'you', (select a1 from c1), 'tom-1', '1', 'valid')),
          'answer', 'he presses 1: the caller is answered');
select is((select concat_ws('|', status, placed_by_name, staff_call_control_id) from app.calls where id = (select id::uuid from c1)),
          'joining|Tom Trader|tom-1', 'Tom is who answered');
select is(pg_temp.kinds(pg_temp.event((select id from c1), 'ev-4', 'call.answered', 'them', null, 'in-1')),
          'bridge', 'the caller answered: joined to Tom');
select is((select pg_temp.kinds(pg_temp.send(id, pg_temp.command_of(id, 'bridge'))) from c1),
          'record', 'once joined, the call is recorded');
select is((select status::text from app.calls where id = (select id::uuid from c1)), 'connected', 'and connected');
select is(pg_temp.kinds(pg_temp.event((select id from c1), 'ev-5', 'call.hangup', 'them', null, 'in-1', cause => 'normal_clearing')),
          'hang_up', 'the caller hangs up: Tom''s leg is hung up');
select is(
  (select concat_ws('|', c.outcome, v.recorded_by_name, v.contact_name, v.notes like 'Called GSS''s number back; talked %',
                    c.follow_up_id is null, c.return_status is null)
     from app.calls c join app.contact_log_revisions v on v.entry_id = c.contact_log_entry_id
    where c.id = (select id::uuid from c1)),
  'talked|Tom Trader|Pat Buyer|t|t|t', 'logged in Pat''s company''s history in Tom''s name, with no follow-up'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    $$select app.my_call_in_progress('00000000-0000-4000-8000-0000000000aa')::text$$),
  'false', 'Tom is free again'
);

-- Nobody takes it: the callbacks person next, a late event of the first ignored, voicemail ----
select pg_temp.placed('00000000-0000-4000-8000-0000000ca11b', '00000000-0000-4000-8000-00000000c2aa',
                      '00000000-0000-4000-8000-00000000d2aa', '+13065550101', 'Sam Seller');
create temp table c2 as select (pg_temp.receive('ev-10', 'in-2', '(306) 555-0101') ->> 'callId') as id;
grant select on c2 to app_api;
select is((select pg_temp.kinds(pg_temp.send(id, pg_temp.command_of(id, 'dial_member'), leg => 'tom-2')) from c2), '', 'Tom''s cell rings');
select is(
  pg_temp.kinds(pg_temp.event((select id from c2), 'ev-11', 'call.hangup', 'you', (select pg_temp.attempt_of(id, 1) from c2), 'tom-2',
                              cause => 'timeout')),
  'dial_member', 'Tom does not answer: the callbacks person is rung'
);
select is(
  (select string_agg(concat_ws(':', position, member_name, status), ',' order by position) from app.callback_attempts
    where call_id = (select id::uuid from c2)),
  '1:Tom Trader:no_answer,2:Olivia:ringing', 'Olivia next'
);
select is(
  pg_temp.kinds(pg_temp.event((select id from c2), 'ev-12', 'call.gather.ended', 'you', (select pg_temp.attempt_of(id, 1) from c2), 'tom-2',
                              '1', 'valid')),
  '', 'a late 1 from Tom''s attempt changes nothing'
);
select is((select status::text from app.calls where id = (select id::uuid from c2)), 'calling_you', 'still ringing Olivia');
select is(
  pg_temp.kinds(pg_temp.event((select id from c2), 'ev-12b', 'call.answered', 'you', (select pg_temp.attempt_of(id, 1) from c2), 'tom-2b')),
  'hang_up', 'and a second leg of Tom''s attempt is hung up'
);
select is((select pg_temp.kinds(pg_temp.send(id, pg_temp.command_of(id, 'dial_member'), leg => 'oli-2')) from c2), '', 'Olivia''s cell rings');
select is(pg_temp.kinds(pg_temp.event((select id from c2), 'ev-13', 'call.answered', 'you', (select pg_temp.attempt_of(id, 2) from c2), 'oli-2')),
          'confirm', 'she answers');
select is(
  pg_temp.kinds(pg_temp.event((select id from c2), 'ev-14', 'call.gather.ended', 'you', (select pg_temp.attempt_of(id, 2) from c2), 'oli-2',
                              null, 'timeout')),
  'hang_up,answer', 'but does not press 1: her leg hung up, the caller answered for the voicemail'
);
select is((select status::text from app.calls where id = (select id::uuid from c2)), 'voicemail', 'voicemail');
select is(pg_temp.kinds(pg_temp.event((select id from c2), 'ev-15', 'call.answered', 'them', null, 'in-2')),
          'greet', 'the caller hears the message');
select is(pg_temp.kinds(pg_temp.event((select id from c2), 'ev-16', 'call.speak.ended', 'them', null, 'in-2')),
          'record_voicemail', 'then the voicemail is recorded');
select is((select pg_temp.kinds(pg_temp.send(id, pg_temp.command_of(id, 'record_voicemail'))) from c2), '', 'recording');
select is(pg_temp.kinds(pg_temp.event((select id from c2), 'ev-17', 'call.hangup', 'them', null, 'in-2')),
          '', 'the caller hangs up');
select is(
  (select concat_ws('|', c.outcome, v.recorded_by_name, v.notes, f.task, f.assigned_to_name, f.due_at <= now())
     from app.calls c
     join app.contact_log_revisions v on v.entry_id = c.contact_log_entry_id
     join app.follow_ups f on f.id = c.follow_up_id
    where c.id = (select id::uuid from c2)),
  'voicemail|Tom Trader|Called GSS''s number back and left a voicemail.|Return call from Sam Seller|Tom Trader|t',
  'a voicemail: logged with a follow-up due now for Tom, whom it was meant for'
);
select is(
  pg_temp.worker(format($$select app.keep_callback_recording(%L, 'rec-vm', null, null, 'in-2')::text$$, (select id from c2)))::text,
  'true', 'its recording on the caller''s own leg is a voicemail'
);
select is(
  pg_temp.worker($$select coalesce(jsonb_agg(jsonb_build_array(telnyx_recording_id, voicemail)), '[]')::text
                     from app.claim_recordings_to_transcribe(10)$$),
  '[["rec-vm", true]]'::jsonb, 'transcribed as one channel, the caller''s'
);

-- The caller hangs up while a cell rings ---------------------------------------------------
create temp table c3 as select (pg_temp.receive('ev-20', 'in-3', '+14035550100') ->> 'callId') as id;
grant select on c3 to app_api;
create temp table c3claim as
  select pg_temp.worker(format('select app.claim_callback_command(%L, %L)::text', id, pg_temp.command_of(id, 'dial_member'))) as claimed from c3;
select is(pg_temp.kinds(pg_temp.event((select id from c3), 'ev-21', 'call.hangup', 'them', null, 'in-3', cause => 'originator_cancel')),
          '', 'the caller gives up while the dial is on its way');
select is(
  (select pg_temp.kinds(pg_temp.worker(format('select app.finish_callback_command(%L, %L, 1, ''done'', ''tom-3'')::text',
                                              id, pg_temp.command_of(id, 'dial_member')))) from c3),
  'hang_up', 'the leg the dial then returns is hung up'
);
select is(
  (select concat_ws('|', c.outcome, f.assigned_to_name, a.status) from app.calls c
     join app.follow_ups f on f.id = c.follow_up_id
     join app.callback_attempts a on a.call_id = c.id
    where c.id = (select id::uuid from c3)),
  'missed|Tom Trader|cancelled', 'a missed callback, with a follow-up for Tom'
);

-- A hang-up crossing the first delivery (Codex's review of f7a0d73, finding 1) ----------------
create temp table c5 as select (pg_temp.receive('ev-80', 'in-9', '+14035550100') ->> 'callId') as id;
select is(pg_temp.receive('ev-81', 'in-9', '+14035550100', 'call.hangup') ->> 'status', 'duplicate',
          'a hang-up looked up before the call was kept is found by its leg');
select is((select concat_ws('|', status, outcome) from app.calls where id = (select id::uuid from c5)),
          'ended|missed', 'and applied: the call ends missed');
select is((select status from app.call_commands where id = pg_temp.command_of((select id from c5), 'dial_member')::uuid),
          'cancelled', 'so no cell is rung for a caller who left');
select ok(exists (select 1 from app.call_events where telnyx_event_id = 'ev-81'), 'and the hang-up is kept');

-- A join whose answer comes back after a hang-up (Codex's review of f7a0d73, finding 2) --------
-- Rings Tom, who presses 1; the caller is answered; the join is claimed (on its way to Telnyx).
-- Returns the call's id and the join's claim.
create function pg_temp.joining(leg text, cell text) returns text[]
language plpgsql as $fn$
declare
  call text := pg_temp.receive('ev-' || leg, leg, '+14035550100') ->> 'callId';
  attempt text;
  claimed jsonb;
begin
  perform pg_temp.send(call, pg_temp.command_of(call, 'dial_member'), leg => cell);
  attempt := pg_temp.attempt_of(call, 1);
  perform pg_temp.event(call, 'ev-a-' || leg, 'call.answered', 'you', attempt, cell);
  perform pg_temp.send(call, pg_temp.command_of(call, 'confirm'));
  perform pg_temp.event(call, 'ev-g-' || leg, 'call.gather.ended', 'you', attempt, cell, '1', 'valid');
  perform pg_temp.send(call, pg_temp.command_of(call, 'answer'));
  perform pg_temp.event(call, 'ev-t-' || leg, 'call.answered', 'them', null, leg);
  claimed := pg_temp.worker(format('select app.claim_callback_command(%L, %L)::text', call,
                                   pg_temp.command_of(call, 'bridge')));
  return array[call, claimed -> 'command' ->> 'claim'];
end
$fn$;

create temp table j1 as select pg_temp.joining('in-10', 'tom-10') as j;
select is(pg_temp.kinds(pg_temp.event((select j[1] from j1), 'ev-h-10', 'call.hangup', 'them', null, 'in-10')),
          'hang_up', 'the caller hangs up while the join is on its way');
select is(
  (select concat_ws('|', outcome, contact_log_entry_id is null, follow_up_id is null, return_status is null)
     from app.calls where id = (select j[1]::uuid from j1)),
  'missed|t|t|t', 'ended, but not logged until the join comes back'
);
select is(
  pg_temp.worker(format('select app.finish_callback_command(%L, %L, %s, ''done'', null)::text',
                        (select j[1] from j1), pg_temp.command_of((select j[1] from j1), 'bridge'),
                        (select j[2] from j1))) -> 'commands',
  '[]'::jsonb, 'the join comes back done'
);
select is(
  (select concat_ws('|', c.outcome, c.connected_at is not null, v.recorded_by_name, c.follow_up_id is null)
     from app.calls c join app.contact_log_revisions v on v.entry_id = c.contact_log_entry_id
    where c.id = (select j[1]::uuid from j1)),
  'talked|t|Tom Trader|t', 'so they talked: logged in Tom''s name, with no follow-up'
);

create temp table j2 as select pg_temp.joining('in-11', 'tom-11') as j;
select pg_temp.event((select j[1] from j2), 'ev-h-11', 'call.hangup', 'you',
                     pg_temp.attempt_of((select j[1] from j2), 1), 'tom-11');
select is(
  pg_temp.kinds(pg_temp.event((select j[1] from j2), 'ev-b-11', 'call.bridged', 'you',
                              pg_temp.attempt_of((select j[1] from j2), 1), 'tom-11')),
  '', 'Telnyx''s call.bridged from before the end arrives'
);
select is(
  (select concat_ws('|', outcome, contact_log_entry_id is not null, follow_up_id is null)
     from app.calls where id = (select j[1]::uuid from j2)),
  'talked|t|t', 'and is taken as the join having worked'
);

create temp table j3 as select pg_temp.joining('in-12', 'tom-12') as j;
select pg_temp.event((select j[1] from j3), 'ev-h-12', 'call.hangup', 'them', null, 'in-12');
select pg_temp.worker(format('select app.finish_callback_command(%L, %L, %s, ''failed'', null)::text',
                             (select j[1] from j3), pg_temp.command_of((select j[1] from j3), 'bridge'),
                             (select j[2] from j3)));
select is(
  (select concat_ws('|', c.outcome, f.assigned_to_name) from app.calls c
     join app.follow_ups f on f.id = c.follow_up_id where c.id = (select j[1]::uuid from j3)),
  'missed|Tom Trader', 'a join that failed: missed, with its follow-up'
);

create temp table j4 as select pg_temp.joining('in-13', 'tom-13') as j;
select pg_temp.event((select j[1] from j4), 'ev-h-13', 'call.hangup', 'them', null, 'in-13');
select pg_temp.worker(format('select app.finish_callback_command(%L, %L, %s, ''retry'', null)::text',
                             (select j[1] from j4), pg_temp.command_of((select j[1] from j4), 'bridge'),
                             (select j[2] from j4)));
select is(
  pg_temp.worker(format('select app.claim_callback_command(%L, %L)::text', (select j[1] from j4),
                        pg_temp.command_of((select j[1] from j4), 'bridge'))) ->> 'status',
  'skipped', 'a join retried after the end is not sent'
);
select is(
  (select concat_ws('|', outcome, follow_up_id is null, contact_log_entry_id is null)
     from app.calls where id = (select j[1]::uuid from j4)),
  'missed|t|t', 'but its first sending may have worked: not logged yet (Codex''s review of 9d5e57b)'
);
select pg_temp.event((select j[1] from j4), 'ev-b-13', 'call.bridged', 'them', null, 'in-13');
select is(
  (select concat_ws('|', outcome, follow_up_id is null, contact_log_entry_id is not null)
     from app.calls where id = (select j[1]::uuid from j4)),
  'talked|t|t', 'so the call.bridged that comes later makes it talked'
);

-- A join sent twice, its first sending timing out and the second refused once the call ended:
-- the first may have worked, so the call waits; with no call.bridged, the sweep logs it.
create temp table j5 as select pg_temp.joining('in-14', 'tom-14') as j;
select pg_temp.worker(format('select app.finish_callback_command(%L, %L, %s, ''retry'', null)::text',
                             (select j[1] from j5), pg_temp.command_of((select j[1] from j5), 'bridge'),
                             (select j[2] from j5)));
create temp table j5claim as
  select pg_temp.worker(format('select app.claim_callback_command(%L, %L)::text', (select j[1] from j5),
                               pg_temp.command_of((select j[1] from j5), 'bridge'))) as claimed;
select pg_temp.event((select j[1] from j5), 'ev-h-14', 'call.hangup', 'them', null, 'in-14');
select pg_temp.worker(format('select app.finish_callback_command(%L, %L, %s, ''failed'', null)::text',
                             (select j[1] from j5), pg_temp.command_of((select j[1] from j5), 'bridge'),
                             (select claimed -> 'command' ->> 'claim' from j5claim)));
select is(
  (select concat_ws('|', outcome, follow_up_id is null) from app.calls where id = (select j[1]::uuid from j5)),
  'missed|t', 'a second sending refused after the end leaves the call waiting'
);
select is(
  pg_temp.worker($$select app.settle_late_callbacks(100, interval '1 hour')::text$$)::text,
  '0', 'the sweep leaves a call that ended less than its wait ago'
);
select ok(
  (pg_temp.worker($$select app.settle_late_callbacks(100, interval '0')::text$$)::text)::int >= 1,
  'and logs it once the wait is over'
);
select is(
  (select concat_ws('|', c.outcome, f.assigned_to_name) from app.calls c
     join app.follow_ups f on f.id = c.follow_up_id where c.id = (select j[1]::uuid from j5)),
  'missed|Tom Trader', 'as it ended: missed, with its follow-up'
);
select is(
  pg_temp.worker($$select app.settle_late_callbacks(100, interval '0')::text$$)::text,
  '0', 'and only once'
);
select throws_ok(
  format($$update app.calls set outcome = 'talked', connected_at = ended_at where id = %L$$, (select id from c3)),
  '23514', null, 'a missed call nobody took is never made talked'
);

-- An unknown number: the callbacks person, then an open return ------------------------------
create temp table c4 as select (pg_temp.receive('ev-30', 'in-4', '+17805550123') ->> 'callId') as id;
grant select on c4 to app_api;
select is(
  (select concat_ws('|', counterparty_id is null, contact_name, meant_for is null) from app.calls where id = (select id::uuid from c4)),
  't|(780) 555-0123|t', 'an unknown number has no company and was meant for nobody'
);
select is(
  (select string_agg(member_name, ',') from app.callback_attempts where call_id = (select id::uuid from c4)),
  'Olivia', 'the callbacks person is rung'
);
select is(pg_temp.kinds(pg_temp.event((select id from c4), 'ev-31', 'call.hangup', 'them', null, 'in-4')),
          '', 'the caller hangs up before Olivia''s cell rings');
select is((select status from app.call_commands where id = pg_temp.command_of((select id from c4), 'dial_member')::uuid),
          'cancelled', 'so her cell is not rung');
select is(
  (select concat_ws('|', outcome, return_status, return_owner_name, contact_log_entry_id is null) from app.calls
    where id = (select id::uuid from c4)),
  'missed|open|Olivia|t', 'an open return for the callbacks person, nothing logged yet'
);
insert into app.call_recordings (organization_id, call_id, telnyx_recording_id, transcript, transcribed_at)
values ('00000000-0000-4000-8000-0000000000aa', (select id::uuid from c4), 'rec-unknown', 'Counterparty: hello', now());
select is(
  pg_temp.worker($$select count(*)::text from app.claim_call_readings(10)$$)::text,
  '0', 'Claude does not read a call with no company'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000033aa',
    format('select app.settle_callback_return(%L, ''take'', null, null)', (select id from c4))),
  'forbidden', 'a viewer cannot take a return'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000011bb',
    format('select app.settle_callback_return(%L, ''dismiss'', null, null)', (select id from c4))),
  'not_found', 'nor another organization dismiss it'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    format('select app.settle_callback_return(%L, ''take'', null, null)', (select id from c4))),
  'done', 'Tom takes it'
);
select is((select return_owner_name from app.calls where id = (select id::uuid from c4)), 'Tom Trader', 'it is his');
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    format('select app.settle_callback_return(%L, ''link'', %L, null)', (select id from c4), '00000000-0000-4000-8000-00000000c4aa')),
  'company_not_found', 'not linked to an archived company'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    format('select app.settle_callback_return(%L, ''link'', %L, null)', (select id from c4), '00000000-0000-4000-8000-00000000c1bb')),
  'company_not_found', 'nor to another organization''s'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    format('select app.settle_callback_return(%L, ''link'', %L, %L)', (select id from c4),
           '00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-00000000d2aa')),
  'done', 'he links it to the seller and Sam'
);
select is(
  (select concat_ws('|', c.counterparty_id, c.contact_name, c.return_status, c.return_closed_by_name, v.recorded_by_name,
                    f.assigned_to_name, f.task)
     from app.calls c
     join app.contact_log_revisions v on v.entry_id = c.contact_log_entry_id
     join app.follow_ups f on f.id = c.follow_up_id
    where c.id = (select id::uuid from c4)),
  '00000000-0000-4000-8000-00000000c2aa|Sam Seller|done|Tom Trader|Tom Trader|Tom Trader|Return call from Sam Seller',
  'now in the seller''s history with a follow-up for Tom, the return done'
);
select is(
  pg_temp.worker($$select count(*)::text from app.claim_call_readings(10)$$)::text,
  '1', 'and Claude reads it'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    format('select app.settle_callback_return(%L, ''dismiss'', null, null)', (select id from c4))),
  'closed', 'a closed return is not settled again'
);
select throws_ok(
  format($$update app.calls set counterparty_id = '00000000-0000-4000-8000-00000000c1aa' where id = %L$$, (select id from c4)),
  '23514', null, 'and its company stays'
);

-- A company found from its listed phone, when nobody called the number --------------------------
create temp table r5 as select pg_temp.receive('ev-40', 'in-5', '587-555-0177') as r;
select is(
  (select concat_ws('|', c.counterparty_id, c.contact_id is null, c.contact_name, c.meant_for is null)
     from app.calls c where c.id = (select (r ->> 'callId')::uuid from r5)),
  '00000000-0000-4000-8000-00000000c2aa|t|Synthetic A Seller|t', 'the company whose own phone it is, meant for nobody'
);
select is(
  (select string_agg(member_name, ',') from app.callback_attempts a
     join app.calls c on c.id = a.call_id where c.counterparty_call_control_id = 'in-5'),
  'Olivia', 'so the callbacks person is rung'
);

-- Who cannot take a call is skipped --------------------------------------------------------
-- Olivia's cell is ringing for in-5, so she is busy; Tom places a call that is still ringing.
select pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  $$insert into app.calls (organization_id, counterparty_id, contact_id, contact_name, placed_by, placed_by_name,
                           from_phone, counterparty_phone)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa', null, 'Ringing',
            app.current_user_id(), 'set by the database', '+18255550199', '+15875550177') returning id::text$$);
create temp table r6 as select pg_temp.receive('ev-50', 'in-6', '+14035550100') as r;
select is((select pg_temp.kinds(r) from r6), 'answer', 'Tom on a call and Olivia ringing: straight to voicemail');
select is((select count(*)::int from app.callback_attempts where call_id = (select (r ->> 'callId')::uuid from r6)), 0, 'nobody rung');
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    $$select count(*)::text from app.calls where organization_id = '00000000-0000-4000-8000-0000000000aa'
        and placed_by = app.current_user_id() and status <> 'ended' and direction = 'outgoing'$$),
  '1', 'Tom''s own call is still his'
);

-- Nobody to give it to: an unassigned return --------------------------------------------------
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    $$select app.save_callback_settings('00000000-0000-4000-8000-0000000000aa', '+18255550199', null)$$),
  'saved', 'the admin chooses nobody'
);
update app.organization_members set status = 'suspended'
 where organization_id = '00000000-0000-4000-8000-0000000000aa' and user_id = '00000000-0000-4000-8000-0000000044aa';
create temp table r7 as select pg_temp.receive('ev-60', 'in-7', '+14035550100', 'call.hangup') as r;
select is(
  (select concat_ws('|', c.status, c.outcome, c.meant_for_name, c.return_status, c.return_owner is null, c.follow_up_id is null)
     from app.calls c where c.id = (select (r ->> 'callId')::uuid from r7)),
  'ended|missed|Tom Trader|open|t|t', 'a hang-up before anything else: missed, Tom suspended, nobody chosen: unassigned'
);
select is(pg_temp.receive('ev-61', 'in-7', '+14035550100') ->> 'status', 'duplicate', 'its call.initiated arriving after changes nothing');
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    format('select app.settle_callback_return(%L, ''link'', %L, null)', (select r ->> 'callId' from r7), '00000000-0000-4000-8000-00000000c2aa')),
  'not_unknown', 'a company''s call is not linked elsewhere'
);
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    format('select app.settle_callback_return(%L, ''take'', null, null)', (select r ->> 'callId' from r7))),
  'done', 'Adam takes it'
);
select is(
  (select concat_ws('|', c.return_status, v.recorded_by_name, f.assigned_to_name)
     from app.calls c
     join app.contact_log_revisions v on v.entry_id = c.contact_log_entry_id
     join app.follow_ups f on f.id = c.follow_up_id
    where c.id = (select (r ->> 'callId')::uuid from r7)),
  'done|Adam|Adam', 'logged with a follow-up, both his'
);
create temp table r8 as select pg_temp.receive('ev-70', 'in-8', '+17805550124', 'call.hangup') as r;
select is(
  pg_temp.api('00000000-0000-4000-8000-0000000011aa',
    format('select app.settle_callback_return(%L, ''dismiss'', null, null)', (select r ->> 'callId' from r8))),
  'done', 'Olivia dismisses a wrong number'
);
select is(
  (select concat_ws('|', return_status, return_closed_by_name, contact_log_entry_id is null) from app.calls
    where id = (select (r ->> 'callId')::uuid from r8)),
  'dismissed|Olivia|t', 'dismissed, nothing logged'
);

-- Rules of an incoming call ------------------------------------------------------------------
select throws_ok(
  format($$update app.calls set status = 'calling_you' where id = %L$$, (select id from c1)),
  '23514', null, 'an ended incoming call stays ended'
);
select throws_ok(
  format($$update app.calls set meant_for = null, meant_for_name = null where id = %L$$, (select id from c2)),
  '23514', null, 'and keeps whom it was meant for'
);
select throws_ok(
  format($$update app.calls set return_status = 'open' where id = %L$$, (select (r ->> 'callId') from r8)),
  '23514', null, 'a dismissed return stays dismissed'
);
select throws_ok(
  $$delete from app.callback_attempts$$,
  '42501', null, 'attempts are never deleted'
);
select is(
  pg_temp.worker(format($$select app.apply_callback_event(%L, 'ev-x', 'call.answered', 'you', null, now(), 'x', null, null, null)::text$$,
                        '00000000-0000-4000-8000-0000000ca11a')) ->> 'status',
  'not_found', 'a call placed from the platform is not an incoming one'
);
select is(
  (select count(*)::int from app.call_placer((select id::uuid from c1))),
  0, 'and an incoming call is never applied as anybody''s'
);
select is(
  (select concat_ws('|', side, attempt_id is null) from app.callback_by_leg('in-2')),
  'them|t', 'the caller''s leg is found without client_state'
);

select * from finish();
rollback;
