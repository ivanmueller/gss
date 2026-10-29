-- The CRM for counterparties: privileges; who may log contacts, correct entries and plan,
-- change and finish follow-ups; that log revisions are numbered by the database and never
-- changed or deleted; the values refused; that the person responsible is an active member
-- whose name comes from their login; that a done follow-up stays done; archived
-- counterparties; cross-organization denials; the team list; and the audit trail. Runs in
-- one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(77);

-- Fixtures ------------------------------------------------------------------
-- Org A: tom (trader), adam (org_admin), olivia (operations), victor (viewer, no name),
-- sue (suspended operations), alan (analyst). Org B: bob (org_admin).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom", "last_name": "Trader"}'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test', '{"first_name": "Adam", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test', '{"first_name": "Olivia"}'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test', '{}'),
  ('00000000-0000-4000-8000-0000000055aa', 'sue@example.test', '{"first_name": "Sue"}'),
  ('00000000-0000-4000-8000-0000000066aa', 'alan@example.test', '{"first_name": "Alan"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'operations', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000066aa', 'analyst', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- A: c1a (buyer), c2a (seller, archived later in the test), c4a (archived). B: c1b.
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c4aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', now()),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);

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

create function pg_temp.api_count(uid text, query text) returns int
language plpgsql as $fn$
declare
  result int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute format('select count(*)::int from (%s) q', query) into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
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

-- A contact log entry for the counterparty (c1a by default) in org A, by the given user.
create function pg_temp.new_entry(id text, uid text,
                                  counterparty text default '00000000-0000-4000-8000-00000000c1aa',
                                  org text default '00000000-0000-4000-8000-0000000000aa') returns text
language sql as $fn$
  select format($$insert into app.contact_log_entries (id, organization_id, counterparty_id, created_by)
                  values (%L, %L, %L, %L)$$, id, org, counterparty, uid)
$fn$;

-- A revision of the entry: a call an hour ago with the named person, recorded by the given user.
create function pg_temp.new_revision(entry text, uid text, contact text default 'Pat Buyer',
                                     org text default '00000000-0000-4000-8000-0000000000aa') returns text
language sql as $fn$
  select format($$insert into app.contact_log_revisions
                    (organization_id, entry_id, revision_number, occurred_at, channel, contact_name,
                     notes, recorded_by, recorded_by_name)
                  values (%L, %L, 99, now() - interval '1 hour', 'call', %L,
                          'Asked about November delivery.', %L, 'Synthetic Person')$$,
                org, entry, contact, uid)
$fn$;

-- A follow-up for the counterparty (c1a by default) in org A, due tomorrow, created by
-- `uid` and assigned to `assignee`, with a name the database is expected to replace.
create function pg_temp.new_follow_up(id text, uid text, assignee text,
                                      counterparty text default '00000000-0000-4000-8000-00000000c1aa',
                                      entry text default null,
                                      org text default '00000000-0000-4000-8000-0000000000aa') returns text
language sql as $fn$
  select format($$insert into app.follow_ups
                    (id, organization_id, counterparty_id, contact_log_entry_id, task, due_at,
                     assigned_to, assigned_to_name, created_by, created_by_name)
                  values (%L, %L, %L, %L, 'Send the November bid sheet', now() + interval '1 day',
                          %L, 'Someone Else', %L, 'Synthetic Person')$$,
                id, org, counterparty, entry, assignee, uid)
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.contact_log_entries', 'select')
    and has_table_privilege('app_api', 'app.contact_log_revisions', 'select')
    and has_table_privilege('app_api', 'app.follow_ups', 'select')
    and has_column_privilege('app_api', 'app.contact_log_entries', 'counterparty_id', 'insert')
    and has_column_privilege('app_api', 'app.contact_log_revisions', 'occurred_at', 'insert')
    and has_column_privilege('app_api', 'app.follow_ups', 'due_at', 'insert'),
  'app_api reads and adds contact log entries, revisions and follow-ups'
);
-- Codex's review of ivanmueller/gss#69 (20261029080000_crm_insert_column_grants.sql).
select ok(
  not has_table_privilege('app_api', 'app.contact_log_entries', 'insert')
    and not has_table_privilege('app_api', 'app.contact_log_revisions', 'insert')
    and not has_table_privilege('app_api', 'app.follow_ups', 'insert')
    and not has_column_privilege('app_api', 'app.contact_log_entries', 'created_at', 'insert')
    and not has_column_privilege('app_api', 'app.contact_log_revisions', 'created_at', 'insert')
    and not has_column_privilege('app_api', 'app.follow_ups', 'created_at', 'insert')
    and not has_column_privilege('app_api', 'app.follow_ups', 'updated_at', 'insert')
    and not has_column_privilege('app_api', 'app.follow_ups', 'done_at', 'insert')
    and not has_column_privilege('app_api', 'app.follow_ups', 'done_by', 'insert')
    and not has_column_privilege('app_api', 'app.follow_ups', 'done_by_name', 'insert'),
  'app_api cannot set the times the database records, or add a follow-up already done'
);
select ok(
  not has_table_privilege('app_api', 'app.contact_log_entries', 'update, delete, truncate')
    and not has_table_privilege('app_api', 'app.contact_log_revisions', 'update, delete, truncate')
    and not has_table_privilege('app_api', 'app.follow_ups', 'delete, truncate'),
  'app_api cannot change or delete the contact log, or delete a follow-up'
);
select ok(
  has_column_privilege('app_api', 'app.follow_ups', 'task', 'update')
    and has_column_privilege('app_api', 'app.follow_ups', 'due_at', 'update')
    and has_column_privilege('app_api', 'app.follow_ups', 'assigned_to', 'update')
    and has_column_privilege('app_api', 'app.follow_ups', 'done_at', 'update')
    and has_column_privilege('app_api', 'app.follow_ups', 'done_by', 'update')
    and has_column_privilege('app_api', 'app.follow_ups', 'done_by_name', 'update'),
  'app_api can change a follow-up''s task, due time and responsible person and mark it done'
);
select ok(
  not has_column_privilege('app_api', 'app.follow_ups', 'organization_id', 'update')
    and not has_column_privilege('app_api', 'app.follow_ups', 'counterparty_id', 'update')
    and not has_column_privilege('app_api', 'app.follow_ups', 'contact_log_entry_id', 'update')
    and not has_column_privilege('app_api', 'app.follow_ups', 'created_by', 'update'),
  'app_api cannot move a follow-up to another organization, counterparty, entry or creator'
);
select ok(
  not has_table_privilege('anon', 'app.contact_log_entries', 'select')
    and not has_table_privilege('authenticated', 'app.contact_log_revisions', 'select')
    and not has_table_privilege('service_role', 'app.follow_ups', 'select'),
  'the Supabase API roles cannot read the contact log or follow-ups'
);
select ok(
  has_function_privilege('app_api', 'app.can_log_contacts(uuid)', 'execute')
    and has_function_privilege('app_api', 'app.team_names(uuid)', 'execute')
    and has_function_privilege('app_api', 'app.member_name(uuid, uuid)', 'execute')
    and has_function_privilege('app_api', 'app.lock_contact_log_entry(uuid)', 'execute')
    and not has_function_privilege('app_api', 'app.number_contact_log_revision()', 'execute')
    and not has_function_privilege('app_api', 'app.keep_contact_log()', 'execute')
    and not has_function_privilege('app_api', 'app.check_follow_up()', 'execute')
    and not has_function_privilege('app_api', 'app.keep_follow_ups()', 'execute')
    and not has_function_privilege('anon', 'app.team_names(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.member_name(uuid, uuid)', 'execute'),
  'app_api can ask who logs contacts and for the team''s names, but cannot call the triggers'
);

-- Logging contacts: who may, and for whom ------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'a viewer cannot log a contact'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000066aa',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000066aa')),
  '42501', null, 'an analyst cannot log a contact'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000055aa',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000055aa')),
  '42501', null, 'a suspended operations member cannot log a contact'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000011bb')),
  '42501', null, 'another organization''s admin cannot log a contact in this organization'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000011bb',
      '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000bb')),
  '42501', null, 'another organization''s admin cannot log a contact with this organization''s counterparty'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000022aa')),
  '42501', null, 'a contact cannot be logged in someone else''s name'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000c4aa')),
  '42501', null, 'an archived counterparty gets no new contact log entries'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa')),
  1, 'a trader logs a contact'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-0000000011aa',
      '00000000-0000-4000-8000-00000000c2aa')),
  1, 'an operations member logs a contact with another counterparty'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_entry('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-0000000011bb',
      '00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb')),
  1, 'the other organization''s admin logs a contact in their own organization'
);

-- Revisions: numbered by the database, never changed ------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'a viewer cannot record what a contact said'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000022aa')),
  '42501', null, 'a revision cannot be recorded in someone else''s name'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000011bb',
      'Pat Buyer', '00000000-0000-4000-8000-0000000000bb')),
  '23503', null, 'another organization''s admin cannot correct this organization''s entry'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa')),
  1, 'a trader records what was said'
);
select is(
  (select revision_number from app.contact_log_revisions where entry_id = '00000000-0000-4000-8000-00000000e001'),
  1, 'the database numbers the first version 1, whatever number was sent'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000022aa', 'Pat Q. Buyer')),
  1, 'an admin corrects the entry'
);
select is(
  (select array_agg(revision_number::text || ':' || contact_name order by revision_number)::text
     from app.contact_log_revisions where entry_id = '00000000-0000-4000-8000-00000000e001'),
  '{"1:Pat Buyer","2:Pat Q. Buyer"}', 'the correction is revision 2 and the first version is kept'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-0000000011aa', 'Sam Seller')),
  1, 'an operations member records what was said in their entry'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.contact_log_revisions set notes = 'Changed' where entry_id = '00000000-0000-4000-8000-00000000e001'$$),
  '42501', null, 'app_api cannot change a contact log revision'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$delete from app.contact_log_entries where id = '00000000-0000-4000-8000-00000000e001'$$),
  '42501', null, 'app_api cannot delete a contact log entry'
);
select throws_ok(
  $$update app.contact_log_revisions set notes = 'Changed' where entry_id = '00000000-0000-4000-8000-00000000e001'$$,
  '42501', null, 'not even the table owner can change a contact log revision'
);
select throws_ok(
  $$delete from app.contact_log_revisions where entry_id = '00000000-0000-4000-8000-00000000e001'$$,
  '42501', null, 'not even the table owner can delete a contact log revision'
);
select throws_ok(
  $$update app.contact_log_entries set counterparty_id = '00000000-0000-4000-8000-00000000c2aa'
     where id = '00000000-0000-4000-8000-00000000e001'$$,
  '42501', null, 'not even the table owner can move a contact log entry'
);
select throws_ok(
  $$truncate app.contact_log_revisions cascade$$,
  '42501', null, 'not even the table owner can empty the contact log'
);

-- Revisions: the values the database refuses ---------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa'),
            'now() - interval ''1 hour''', 'now() + interval ''1 hour''')),
  '23514', null, 'a contact in the future is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa'),
            'now() - interval ''1 hour''', '''1999-12-31T12:00:00Z''')),
  '23514', null, 'a contact before 2000 is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa'),
            '''call''', '''fax''')),
  '22P02', null, 'an unknown way of contact is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', ' ')),
  '23514', null, 'a blank name of who was spoken to is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa'),
            '''Asked about November delivery.''', 'repeat(''x'', 5001)')),
  '23514', null, 'notes longer than 5,000 characters are refused'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa'),
            '''Asked about November delivery.''', 'null')),
  1, 'notes may be left out'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa'),
                    'recorded_by_name)', 'recorded_by_name, created_at)'),
            '''Synthetic Person'')', '''Synthetic Person'', ''2099-01-01T00:00:00Z'')')),
  '42501', null, 'a revision cannot set its own recording time'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(replace(replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa'),
                    'recorded_by_name)', 'recorded_by_name, created_at)'),
            '''Synthetic Person'')', '''Synthetic Person'', ''2099-01-01T00:00:00Z'')'),
            'now() - interval ''1 hour''', '''2099-01-01T00:00:00Z''')),
  '42501', null, 'a contact in 2099 cannot pass as recorded in 2099 (Codex''s case)'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$insert into app.contact_log_entries (organization_id, counterparty_id, created_by, created_at)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              '00000000-0000-4000-8000-0000000044aa', '2020-01-01T00:00:00Z')$$),
  '42501', null, 'an entry cannot set its own creation time'
);

-- Follow-ups: who may plan them, and for whom ------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000033aa',
      '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'a viewer cannot plan a follow-up'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000011bb',
      '00000000-0000-4000-8000-0000000011bb')),
  'GS004', null, 'another organization''s admin cannot plan a follow-up in this organization (nobody here is theirs to name)'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000055aa')),
  'GS004', null, 'a suspended member cannot be made responsible'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000011bb')),
  'GS004', null, 'someone from another organization cannot be made responsible'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-00000000c1aa',
      '00000000-0000-4000-8000-00000000e002')),
  '23503', null, 'a follow-up cannot come from another counterparty''s entry'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-00000000c4aa')),
  '42501', null, 'an archived counterparty gets no new follow-ups'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000022aa'), 'now() + interval ''1 day''', '''2100-01-01T00:00:00Z''')),
  '23514', null, 'a due time in 2100 or later is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(replace(pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000022aa'), 'created_by_name)', 'created_by_name, created_at, updated_at)'),
      '''Synthetic Person'')', '''Synthetic Person'', ''2020-01-01T00:00:00Z'', ''2020-01-01T00:00:00Z'')')),
  '42501', null, 'a follow-up cannot set its own creation or change time'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(replace(pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000022aa'), 'created_by_name)', 'created_by_name, done_at, done_by, done_by_name)'),
      '''Synthetic Person'')', '''Synthetic Person'', now(), ''00000000-0000-4000-8000-0000000044aa'', ''Synthetic Person'')')),
  '42501', null, 'a follow-up cannot be added already done'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-00000000c1aa',
      '00000000-0000-4000-8000-00000000e001')),
  1, 'a trader plans a follow-up from an entry, with an admin responsible'
);
select is(
  (select assigned_to_name from app.follow_ups where id = '00000000-0000-4000-8000-00000000f001'),
  'Adam Admin', 'the responsible person''s name comes from their login, not from the request'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-0000000011aa',
      '00000000-0000-4000-8000-0000000033aa')),
  1, 'an operations member plans a follow-up with a viewer responsible'
);
select is(
  (select assigned_to_name from app.follow_ups where id = '00000000-0000-4000-8000-00000000f002'),
  'victor@example.test', 'a member without a name is named by their email'
);

-- Follow-ups: changing and finishing them ---------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$update app.follow_ups set due_at = now() + interval '2 days' where id = '00000000-0000-4000-8000-00000000f001'$$),
  0, 'a viewer who is not responsible cannot change a follow-up'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$update app.follow_ups set due_at = now() + interval '2 days' where id = '00000000-0000-4000-8000-00000000f001'$$),
  0, 'another organization''s admin cannot change this organization''s follow-up'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.follow_ups set due_at = now() + interval '2 days', assigned_to = '00000000-0000-4000-8000-0000000044aa',
        assigned_to_name = 'Someone Else' where id = '00000000-0000-4000-8000-00000000f001'$$),
  1, 'an operations member reschedules a follow-up and hands it to the trader'
);
select is(
  (select assigned_to_name from app.follow_ups where id = '00000000-0000-4000-8000-00000000f001'),
  'Tom Trader', 'the new responsible person''s name comes from their login'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.follow_ups set assigned_to = '00000000-0000-4000-8000-0000000055aa' where id = '00000000-0000-4000-8000-00000000f001'$$),
  'GS004', null, 'a follow-up cannot be handed to a suspended member'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    $$update app.follow_ups set task = 'Something else' where id = '00000000-0000-4000-8000-00000000f002'$$),
  '42501', null, 'a viewer responsible for a follow-up cannot change what it says'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.follow_ups set done_at = now(), done_by = '00000000-0000-4000-8000-0000000022aa', done_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000f001'$$),
  '42501', null, 'a follow-up cannot be marked done in someone else''s name'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$update app.follow_ups set done_at = now(), done_by = '00000000-0000-4000-8000-0000000033aa', done_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000f002'$$),
  1, 'a viewer marks the follow-up they are responsible for done'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.follow_ups set due_at = now() + interval '3 days' where id = '00000000-0000-4000-8000-00000000f002'$$),
  '23514', null, 'a follow-up that is done does not change'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.follow_ups set done_at = null, done_by = null, done_by_name = null where id = '00000000-0000-4000-8000-00000000f002'$$),
  '23514', null, 'a follow-up that is done is not reopened'
);
select throws_ok(
  $$update app.follow_ups set counterparty_id = '00000000-0000-4000-8000-00000000c2aa'
     where id = '00000000-0000-4000-8000-00000000f001'$$,
  '23514', null, 'not even the table owner can move a follow-up to another counterparty'
);
select throws_ok(
  $$delete from app.follow_ups where id = '00000000-0000-4000-8000-00000000f001'$$,
  '42501', null, 'not even the table owner can delete a follow-up'
);

-- An archived counterparty: no corrections or replanning, but follow-ups can be finished --
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_follow_up('00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c2aa')),
  1, 'a trader plans a follow-up for the seller'
);
update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c2aa';
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-0000000011aa', 'Sam B. Seller')),
  '42501', null, 'an archived counterparty''s entries are not corrected'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.follow_ups set task = 'Call again' where id = '00000000-0000-4000-8000-00000000f003'$$),
  '23514', null, 'an archived counterparty''s follow-ups are not replanned'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$update app.follow_ups set done_at = now(), done_by = '00000000-0000-4000-8000-0000000044aa', done_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000f003'$$),
  1, 'an archived counterparty''s follow-up can still be marked done'
);

-- Reading and the team list ------------------------------------------------------------
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa',
    $$select id from app.contact_log_entries union all select id from app.contact_log_revisions
      union all select id from app.follow_ups$$),
  9, 'a viewer reads the organization''s entries, revisions and follow-ups'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    $$select id from app.contact_log_entries where organization_id = '00000000-0000-4000-8000-0000000000aa'
      union all select id from app.contact_log_revisions where organization_id = '00000000-0000-4000-8000-0000000000aa'
      union all select id from app.follow_ups where organization_id = '00000000-0000-4000-8000-0000000000aa'$$),
  0, 'another organization''s admin reads none of this organization''s contact log or follow-ups'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000055aa',
    $$select id from app.contact_log_entries union all select id from app.follow_ups$$),
  0, 'a suspended member reads no contact log or follow-ups'
);
select is(
  pg_temp.api_count(null, $$select id from app.contact_log_entries union all select id from app.follow_ups$$),
  0, 'nothing is read without a user'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000033aa',
    $$select string_agg(name, ', ' order by lower(name)) from app.team_names('00000000-0000-4000-8000-0000000000aa')$$),
  'Adam Admin, Alan, Olivia, Tom Trader, victor@example.test',
  'any active member lists the active team by name, without suspended members'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    $$select * from app.team_names('00000000-0000-4000-8000-0000000000aa')$$),
  0, 'another organization''s admin cannot list this organization''s team'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000011bb',
    $$select coalesce(app.member_name('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa'), 'none')$$),
  'none', 'another organization''s admin cannot read this organization''s members'' names'
);

-- The audit trail ----------------------------------------------------------------------
select is(
  (select array_agg(entity || ':' || action order by id)::text from app.audit_events
    where entity in ('contact_log_entries', 'contact_log_revisions', 'follow_ups')
      and organization_id = '00000000-0000-4000-8000-0000000000aa'),
  '{contact_log_entries:insert,contact_log_entries:insert,contact_log_revisions:insert,contact_log_revisions:insert,contact_log_revisions:insert,contact_log_revisions:insert,follow_ups:insert,follow_ups:insert,follow_ups:update,follow_ups:update,follow_ups:insert,follow_ups:update}',
  'logging, correcting, planning, replanning and finishing are audited'
);

select * from finish();
rollback;
