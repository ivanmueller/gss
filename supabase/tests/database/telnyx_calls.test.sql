-- Calling counterparties through Telnyx: privileges; each member's own cell phone, which nobody
-- else reads or changes; who may place calls and to what; that a call only moves forward,
-- keeps what Telnyx reported and is never deleted; its events, each kept once and never
-- changed; app.call_placer; cross-organization denials; and the audit trail. Runs in one
-- transaction that is rolled back. All fixtures are synthetic (555 numbers).
begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

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

-- A: c1a (buyer, contact d1a), c2a (seller, contact d2a), c4a (archived). B: c1b.
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c4aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', now()),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);

insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, phone, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', '(403) 555-0100', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000d2aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c2aa', 'Sam Seller', '(306) 555-0101', '00000000-0000-4000-8000-0000000011aa');

-- Test-only: lets the test owner switch to app_api (see tenancy.test.sql).
grant app_api to current_user;

-- Runs a statement as app_api for the given user and returns how many rows it changed.
create function pg_temp.api_changed(uid text, statement text) returns int
language plpgsql as $fn$
declare
  changed int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);
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

-- A call by `uid` to contact d1a of c1a (or the given counterparty and contact) in org A.
create function pg_temp.new_call(id text, uid text,
                                 counterparty text default '00000000-0000-4000-8000-00000000c1aa',
                                 contact text default '00000000-0000-4000-8000-00000000d1aa',
                                 org text default '00000000-0000-4000-8000-0000000000aa',
                                 status text default 'calling_you') returns text
language sql as $fn$
  select format($$insert into app.calls (id, organization_id, counterparty_id, contact_id, contact_name,
                    placed_by, placed_by_name, from_phone, counterparty_phone, status)
                  values (%L, %L, %L, %L, 'Pat Buyer', %L, 'A name to replace', '+18255550199',
                          '+14035550100', %L)$$,
                id, org, counterparty, contact, uid, status)
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.calls', 'select')
    and has_table_privilege('app_api', 'app.calls', 'insert')
    and has_table_privilege('app_api', 'app.call_events', 'select')
    and has_table_privilege('app_api', 'app.call_events', 'insert')
    and has_table_privilege('app_api', 'app.member_phones', 'select')
    and has_table_privilege('app_api', 'app.member_phones', 'delete')
    and has_column_privilege('app_api', 'app.member_phones', 'phone', 'update')
    and has_column_privilege('app_api', 'app.calls', 'status', 'update')
    and has_column_privilege('app_api', 'app.calls', 'contact_log_entry_id', 'update'),
  'app_api reads and adds calls, events and phones, and changes what a call reports'
);
select ok(
  not has_table_privilege('app_api', 'app.calls', 'delete')
    and not has_table_privilege('app_api', 'app.call_events', 'delete')
    and not has_table_privilege('app_api', 'app.call_events', 'update')
    and not has_column_privilege('app_api', 'app.calls', 'placed_by', 'update')
    and not has_column_privilege('app_api', 'app.calls', 'counterparty_phone', 'update')
    and not has_column_privilege('app_api', 'app.calls', 'placed_by_name', 'update')
    and not has_column_privilege('app_api', 'app.member_phones', 'user_id', 'update'),
  'app_api never deletes calls or events, changes events, or changes who placed a call and where'
);
select ok(
  not exists (
    select 1 from unnest(array['public', 'anon', 'authenticated', 'service_role']) r(name)
     cross join unnest(array['app.calls', 'app.call_events', 'app.member_phones']) t(name)
     cross join unnest(array['select', 'insert', 'update', 'delete']) p(name)
     where r.name <> 'public' and has_table_privilege(r.name, t.name, p.name)
  ) and not has_table_privilege('public', 'app.calls', 'select'),
  'the Supabase API roles have nothing on the call tables'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('app.calls'::regclass, 'app.call_events'::regclass, 'app.member_phones'::regclass)),
  'row level security is on for the call tables'
);
select ok(
  has_function_privilege('app_api', 'app.call_placer(uuid)', 'execute')
    and not has_function_privilege('anon', 'app.call_placer(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.call_placer(uuid)', 'execute')
    and not has_function_privilege('app_api', 'app.check_call()', 'execute')
    and not has_function_privilege('app_api', 'app.keep_calls()', 'execute'),
  'app_api calls app.call_placer only; the trigger functions are not callable'
);

-- A member's own cell phone -----------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$insert into app.member_phones (organization_id, user_id, phone)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', '+14035550142')$$),
  1, 'a trader saves their own cell phone'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa', 'select phone from app.member_phones'),
  '+14035550142', 'they read it back'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000022aa', 'select count(*)::text from app.member_phones'),
  '0', 'an admin of the same organization does not read it'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    'insert into app.member_phones (organization_id, user_id, phone) values (''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000033aa'', ''+14035550143'')')$$,
  '42501', null, 'nobody saves a cell phone for someone else'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    $$update app.member_phones set phone = '+14035550199'$$),
  0, 'nobody changes someone else''s cell phone'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa', 'delete from app.member_phones'),
  0, 'nobody removes someone else''s cell phone'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    'insert into app.member_phones (organization_id, user_id, phone) values (''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000011bb'', ''+14035550144'')')$$,
  '42501', null, 'a member of another organization saves no phone in this one'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    'insert into app.member_phones (organization_id, user_id, phone) values (''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000033aa'', ''403-555-0145'')')$$,
  '23514', null, 'a phone not in E.164 form is refused'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$update app.member_phones set phone = '+13065550146'$$),
  1, 'the owner changes their cell phone'
);
select is(
  (select count(*)::int from app.audit_events
    where entity = 'member_phones' and actor_id = '00000000-0000-4000-8000-0000000044aa'),
  2, 'saving and changing a cell phone are audited'
);

-- Placing calls ------------------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000044aa')),
  1, 'a trader places a call to a contact'
);
select is(
  (select placed_by_name || ' ' || status::text from app.calls where id = '00000000-0000-4000-8000-0000000ca11a'),
  'Tom Trader calling_you', 'the caller''s name comes from their login; it starts by calling their cell'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11b', '00000000-0000-4000-8000-0000000011aa',
                     '00000000-0000-4000-8000-00000000c2aa', null)),
  1, 'operations calls a company''s own phone (no contact)'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11c', '00000000-0000-4000-8000-0000000033aa'))$$,
  '42501', null, 'a viewer places no calls'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11c', '00000000-0000-4000-8000-0000000011aa'))$$,
  '42501', null, 'nobody places a call in someone else''s name'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11c', '00000000-0000-4000-8000-0000000044aa',
                     '00000000-0000-4000-8000-00000000c4aa', null))$$,
  '42501', null, 'an archived counterparty is not called'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11c', '00000000-0000-4000-8000-0000000044aa',
                     '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-00000000d2aa'))$$,
  '23503', null, 'the contact called belongs to the counterparty'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11c', '00000000-0000-4000-8000-0000000044aa',
                     status => 'connected'))$$,
  '23514', null, 'a call starts by calling the caller''s cell'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11c', '00000000-0000-4000-8000-0000000011bb'))$$,
  '42501', null, 'a member of another organization calls none of its counterparties'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_call('00000000-0000-4000-8000-0000000ca11c', '00000000-0000-4000-8000-0000000011bb',
                     '00000000-0000-4000-8000-00000000c1aa', null, '00000000-0000-4000-8000-0000000000bb'))$$,
  '42501', null, 'nor by naming its own organization on the other''s counterparty'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000033aa', 'select count(*)::text from app.calls'),
  '2', 'every active member of the organization sees its calls'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb', 'select count(*)::text from app.calls'),
  '0', 'another organization sees none of them'
);

-- A call moving forward ----------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.calls set status = 'confirming', staff_answered_at = now()
       where id = '00000000-0000-4000-8000-0000000ca11a'$$),
  0, 'nobody else moves the caller''s call on'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$update app.calls set status = 'confirming', staff_answered_at = now(),
                           staff_call_control_id = 'v3:synthetic-staff-leg'
       where id = '00000000-0000-4000-8000-0000000ca11a'$$),
  1, 'the caller''s cell answered: confirming'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set status = ''calling_you'' where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'a call never moves back'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set staff_answered_at = now() - interval ''1 hour'' where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'when the cell answered is kept'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set staff_call_control_id = ''v3:another'' where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'Telnyx''s id for a leg is kept'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set counterparty_phone = ''+14035550111'' where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '42501', null, 'the number dialed never changes'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set connected_at = now() where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'a time it connected only with connected'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set status = ''connected'' where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'connected only with the time it connected'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$update app.calls set status = 'connected', connected_at = now(),
                           counterparty_call_control_id = 'v3:synthetic-counterparty-leg'
       where id = '00000000-0000-4000-8000-0000000ca11a'$$),
  1, 'the counterparty answered: connected'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set status = ''ended'', ended_at = now() where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'an ended call says how it ended'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$update app.calls set status = 'ended', outcome = 'talked', ended_at = now() + interval '6 minutes',
                           hangup_cause = 'normal_clearing'
       where id = '00000000-0000-4000-8000-0000000ca11a'$$),
  1, 'the call ended after they talked'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set hangup_cause = ''user_busy'' where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'how it ended is kept'
);

-- The contact log entry it made.
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$insert into app.contact_log_entries (id, organization_id, counterparty_id, created_by)
      values ('00000000-0000-4000-8000-0000000e11aa', '00000000-0000-4000-8000-0000000000aa',
              '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000044aa')$$),
  1, 'the caller logs the contact'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$insert into app.contact_log_entries (id, organization_id, counterparty_id, created_by)
      values ('00000000-0000-4000-8000-0000000e22aa', '00000000-0000-4000-8000-0000000000aa',
              '00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000044aa')$$),
  1, '(an entry for another counterparty)'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set contact_log_entry_id = ''00000000-0000-4000-8000-0000000e22aa'' where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23503', null, 'a call names an entry of its own counterparty only'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$update app.calls set contact_log_entry_id = '00000000-0000-4000-8000-0000000e11aa'
       where id = '00000000-0000-4000-8000-0000000ca11a'$$),
  1, 'an ended call gets the contact log entry it made'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    'update app.calls set contact_log_entry_id = null where id = ''00000000-0000-4000-8000-0000000ca11a''')$$,
  '23514', null, 'and keeps it'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    'update app.calls set contact_log_entry_id = ''00000000-0000-4000-8000-0000000e22aa'' where id = ''00000000-0000-4000-8000-0000000ca11b''')$$,
  '23514', null, 'only a call where they talked gets an entry'
);
select throws_ok(
  $$delete from app.calls where id = '00000000-0000-4000-8000-0000000ca11a'$$,
  '42501', null, 'calls are never deleted, even by the table owner'
);
select is(
  (select count(*)::int from app.audit_events where entity = 'calls'
    and entity_id = '00000000-0000-4000-8000-0000000ca11a'),
  5, 'placing a call and each step are audited'
);

-- Call events --------------------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11a',
              'synthetic-event-1', 'call.answered', 'you', now())$$),
  1, 'an event of the caller''s call is kept'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11a',
              'synthetic-event-1', 'call.answered', 'you', now())
      on conflict (telnyx_event_id) do nothing$$),
  0, 'the same event again is recognized and adds nothing'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    'insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at) values (''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000ca11a'', ''synthetic-event-2'', ''call.hangup'', ''them'', now())')$$,
  '42501', null, 'nobody else records events for the caller''s call'
);
select throws_ok(
  $$select pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    'insert into app.call_events (organization_id, call_id, telnyx_event_id, event_type, leg, occurred_at) values (''00000000-0000-4000-8000-0000000000bb'', ''00000000-0000-4000-8000-0000000ca11a'', ''synthetic-event-3'', ''call.hangup'', ''them'', now())')$$,
  '42501', null, 'another organization records no events for it'
);
select throws_ok(
  $$update app.call_events set event_type = 'call.hangup'$$,
  '42501', null, 'events are never changed, even by the table owner'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb', 'select count(*)::text from app.call_events'),
  '0', 'another organization sees none of the events'
);

-- app.call_placer ----------------------------------------------------------------------
select is(
  pg_temp.api_text(null, $$select placed_by::text from app.call_placer('00000000-0000-4000-8000-0000000ca11a')$$),
  '00000000-0000-4000-8000-0000000044aa', 'app.call_placer names the caller without a signed-in user'
);
select is(
  pg_temp.api_text(null, $$select count(*)::text from app.call_placer('00000000-0000-4000-8000-0000000ca11f')$$),
  '0', 'and nothing for a call that does not exist'
);

-- A suspended caller's call is no longer moved on by them.
update app.organization_members set status = 'suspended'
 where user_id = '00000000-0000-4000-8000-0000000011aa';
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.calls set status = 'confirming', staff_answered_at = now()
       where id = '00000000-0000-4000-8000-0000000ca11b'$$),
  0, 'a suspended member''s call is not moved on in their name'
);

select * from finish();
rollback;
