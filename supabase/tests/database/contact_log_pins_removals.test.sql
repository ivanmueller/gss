-- Pinning and removing contact history entries (20261103020000_contact_log_pins_removals.sql):
-- privileges; traders, operations and admins pin and unpin, in their own name; only admins
-- remove, in their own name; a removal is never changed or undone; a removed entry is not
-- pinned; the entry and its versions stay; another organization sees and changes nothing;
-- the audit trail. Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

-- Org A: tom (trader), adam (org_admin), victor (viewer). Org B: bob (org_admin).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom", "last_name": "Trader"}'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test', '{"first_name": "Adam", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test', '{"first_name": "Victor"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');
insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');
insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa');
insert into app.contact_log_entries (id, organization_id, counterparty_id, created_by) values
  ('00000000-0000-4000-8000-0000000e1aa1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-0000000e1aa2', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   '00000000-0000-4000-8000-0000000044aa');

grant app_api to current_user;

-- Runs a statement as app_api for the given user.
create function pg_temp.as_user(uid text, statement text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);
  set local role app_api;
  execute statement;
  reset role;
  perform set_config('app.user_id', '', true);
end
$fn$;

-- A count as app_api for the given user.
create function pg_temp.count_as(uid text, query text) returns int
language plpgsql as $fn$
declare
  result int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute query into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

-- Privileges --------------------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.contact_log_pins', 'select')
    and has_table_privilege('app_api', 'app.contact_log_pins', 'delete')
    and not has_table_privilege('app_api', 'app.contact_log_pins', 'update')
    and has_column_privilege('app_api', 'app.contact_log_pins', 'pinned_by', 'insert')
    and not has_column_privilege('app_api', 'app.contact_log_pins', 'pinned_at', 'insert')
    and not has_column_privilege('app_api', 'app.contact_log_pins', 'pinned_by_name', 'insert'),
  'app_api reads, pins and unpins; the time and name are the database''s'
);
select ok(
  has_table_privilege('app_api', 'app.contact_log_removals', 'select')
    and not has_table_privilege('app_api', 'app.contact_log_removals', 'update')
    and not has_table_privilege('app_api', 'app.contact_log_removals', 'delete')
    and has_column_privilege('app_api', 'app.contact_log_removals', 'removed_by', 'insert')
    and not has_column_privilege('app_api', 'app.contact_log_removals', 'removed_at', 'insert'),
  'app_api reads and removes; it never changes or undoes a removal'
);
select ok(
  not has_table_privilege('anon', 'app.contact_log_pins', 'select')
    and not has_table_privilege('authenticated', 'app.contact_log_removals', 'select')
    and not has_table_privilege('service_role', 'app.contact_log_pins', 'insert')
    and not has_function_privilege('app_api', 'app.check_contact_log_pin()', 'execute'),
  'the Supabase API roles have nothing on pins and removals'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.contact_log_pins'::regclass)
    and (select relrowsecurity from pg_class where oid = 'app.contact_log_removals'::regclass),
  'row level security is on for pins and removals'
);

-- Pinning -----------------------------------------------------------------------------------
select lives_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000044aa',
    $q$insert into app.contact_log_pins (entry_id, organization_id, pinned_by)
       values ('00000000-0000-4000-8000-0000000e1aa1', '00000000-0000-4000-8000-0000000000aa',
               '00000000-0000-4000-8000-0000000044aa')$q$)$$,
  'a trader pins an entry'
);
select is(
  (select pinned_by_name || ' ' || (pinned_at <= now())::text from app.contact_log_pins
    where entry_id = '00000000-0000-4000-8000-0000000e1aa1'),
  'Tom Trader true', 'the pin carries the name from the login and the database''s time'
);
select is(
  pg_temp.count_as('00000000-0000-4000-8000-0000000033aa', 'select count(*)::int from app.contact_log_pins'),
  1, 'everyone on the team sees the pin, a viewer too'
);
select throws_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000033aa',
    $q$insert into app.contact_log_pins (entry_id, organization_id, pinned_by)
       values ('00000000-0000-4000-8000-0000000e1aa2', '00000000-0000-4000-8000-0000000000aa',
               '00000000-0000-4000-8000-0000000033aa')$q$)$$,
  '42501', null, 'a viewer does not pin'
);
select throws_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000044aa',
    $q$insert into app.contact_log_pins (entry_id, organization_id, pinned_by)
       values ('00000000-0000-4000-8000-0000000e1aa2', '00000000-0000-4000-8000-0000000000aa',
               '00000000-0000-4000-8000-0000000022aa')$q$)$$,
  '42501', null, 'nobody pins in someone else''s name'
);
select throws_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000044aa',
    $q$update app.contact_log_pins set pinned_by_name = 'Someone' $q$)$$,
  '42501', null, 'a pin is never edited'
);

-- Another organization ----------------------------------------------------------------------
select is(
  pg_temp.count_as('00000000-0000-4000-8000-0000000011bb', 'select count(*)::int from app.contact_log_pins'),
  0, 'another organization sees no pins'
);
select throws_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000011bb',
    $q$insert into app.contact_log_pins (entry_id, organization_id, pinned_by)
       values ('00000000-0000-4000-8000-0000000e1aa2', '00000000-0000-4000-8000-0000000000aa',
               '00000000-0000-4000-8000-0000000011bb')$q$)$$,
  '42501', null, 'another organization''s admin does not pin'
);
select pg_temp.as_user('00000000-0000-4000-8000-0000000011bb', 'delete from app.contact_log_pins');
select is((select count(*)::int from app.contact_log_pins), 1, 'nor unpins');
select throws_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000011bb',
    $q$insert into app.contact_log_removals (entry_id, organization_id, removed_by)
       values ('00000000-0000-4000-8000-0000000e1aa2', '00000000-0000-4000-8000-0000000000aa',
               '00000000-0000-4000-8000-0000000011bb')$q$)$$,
  '42501', null, 'nor removes'
);

-- Unpinning ---------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-4000-8000-0000000033aa', 'delete from app.contact_log_pins');
select is((select count(*)::int from app.contact_log_pins), 1, 'a viewer does not unpin');
select pg_temp.as_user('00000000-0000-4000-8000-0000000044aa', 'delete from app.contact_log_pins');
select is((select count(*)::int from app.contact_log_pins), 0, 'a trader unpins');

-- Removing ----------------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000044aa',
    $q$insert into app.contact_log_removals (entry_id, organization_id, removed_by)
       values ('00000000-0000-4000-8000-0000000e1aa2', '00000000-0000-4000-8000-0000000000aa',
               '00000000-0000-4000-8000-0000000044aa')$q$)$$,
  '42501', null, 'a trader does not remove an entry'
);
select lives_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000022aa',
    $q$insert into app.contact_log_removals (entry_id, organization_id, removed_by)
       values ('00000000-0000-4000-8000-0000000e1aa2', '00000000-0000-4000-8000-0000000000aa',
               '00000000-0000-4000-8000-0000000022aa')$q$)$$,
  'an admin removes an entry'
);
select is(
  (select removed_by_name from app.contact_log_removals
    where entry_id = '00000000-0000-4000-8000-0000000e1aa2'),
  'Adam Admin', 'the removal carries the admin''s name'
);
select is(
  (select count(*)::int from app.contact_log_entries where id = '00000000-0000-4000-8000-0000000e1aa2'),
  1, 'the removed entry is kept'
);
select throws_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000044aa',
    $q$insert into app.contact_log_pins (entry_id, organization_id, pinned_by)
       values ('00000000-0000-4000-8000-0000000e1aa2', '00000000-0000-4000-8000-0000000000aa',
               '00000000-0000-4000-8000-0000000044aa')$q$)$$,
  '23514', null, 'a removed entry is not pinned'
);
select throws_ok(
  $$delete from app.contact_log_removals$$,
  '42501', null, 'a removal is never undone, even by the table owner'
);
select throws_ok(
  $$update app.contact_log_removals set removed_by_name = 'Someone'$$,
  '42501', null, 'nor changed'
);

-- A removed entry is not corrected (20261103030000_contact_log_removal_lock.sql) -------------
select throws_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000044aa',
    $q$insert into app.contact_log_revisions
         (organization_id, entry_id, occurred_at, channel, contact_name, recorded_by, recorded_by_name)
       values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000e1aa2',
               now(), 'call', 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'Tom Trader')$q$)$$,
  '23514', null, 'a removed entry gets no new version'
);
select lives_ok(
  $$select pg_temp.as_user('00000000-0000-4000-8000-0000000044aa',
    $q$insert into app.contact_log_revisions
         (organization_id, entry_id, occurred_at, channel, contact_name, recorded_by, recorded_by_name)
       values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000e1aa1',
               now(), 'call', 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'Tom Trader')$q$)$$,
  'an entry not removed still gets versions'
);

-- Audit -------------------------------------------------------------------------------------
select ok(
  (select count(*) from app.audit_events where entity = 'contact_log_removals') = 1
    and (select count(*) from app.audit_events where entity = 'contact_log_pins') = 2,
  'pins, unpins and removals are audited'
);

select * from finish();
rollback;
