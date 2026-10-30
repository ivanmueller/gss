-- Removing follow-ups: only an admin of the organization, in their own name, open or done,
-- archived counterparty or not; nothing else changes with it; a removed follow-up does not
-- change again and is still never deleted; cross-organization denials; the audit trail.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

-- Fixtures ------------------------------------------------------------------
-- Org A: adam (org_admin), tom (trader), olivia (operations), victor (viewer). Org B: bob
-- (org_admin).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test', '{"first_name": "Adam", "last_name": "Admin"}'),
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test', '{"first_name": "Olivia"}'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test', '{"first_name": "Victor"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa');

-- f1 open, for victor; f2 done by tom; f3 open, of a counterparty archived below.
-- Added as tom, so the database fills in the responsible person's name.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.follow_ups
  (id, organization_id, counterparty_id, task, due_at, assigned_to, assigned_to_name, created_by, created_by_name)
values
  ('00000000-0000-4000-8000-0000000f1aaa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Send the November bid sheet', now() + interval '1 day', '00000000-0000-4000-8000-0000000033aa', 'x',
   '00000000-0000-4000-8000-0000000044aa', 'Tom'),
  ('00000000-0000-4000-8000-0000000f2aaa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Call about canola', now() - interval '1 day', '00000000-0000-4000-8000-0000000044aa', 'x',
   '00000000-0000-4000-8000-0000000044aa', 'Tom'),
  ('00000000-0000-4000-8000-0000000f3aaa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa',
   'Check the oats sample', now() + interval '2 days', '00000000-0000-4000-8000-0000000044aa', 'x',
   '00000000-0000-4000-8000-0000000044aa', 'Tom');
update app.follow_ups
   set done_at = now(), done_by = '00000000-0000-4000-8000-0000000044aa', done_by_name = 'Tom'
 where id = '00000000-0000-4000-8000-0000000f2aaa';
update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c2aa';
select set_config('app.user_id', '', true);

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

-- Removes a follow-up, recorded as removed by a user.
create function pg_temp.remove(id text, by_user text) returns text
language sql as $fn$
  select format($$update app.follow_ups set removed_by = %L where id = %L and removed_by is null$$,
                by_user, id)
$fn$;

-- Privileges ------------------------------------------------------------------
select ok(
  has_column_privilege('app_api', 'app.follow_ups', 'removed_by', 'UPDATE')
  and not has_column_privilege('app_api', 'app.follow_ups', 'removed_at', 'UPDATE')
  and not has_column_privilege('app_api', 'app.follow_ups', 'removed_by_name', 'UPDATE')
  and not has_column_privilege('app_api', 'app.follow_ups', 'removed_by', 'INSERT')
  and not has_table_privilege('app_api', 'app.follow_ups', 'DELETE'),
  'app_api removes by removed_by only, never adds a removed follow-up and never deletes');

-- Who removes ----------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.remove('00000000-0000-4000-8000-0000000f1aaa', '00000000-0000-4000-8000-0000000044aa')),
  '42501', null, 'a trader cannot remove a follow-up');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.remove('00000000-0000-4000-8000-0000000f1aaa', '00000000-0000-4000-8000-0000000011aa')),
  '42501', null, 'nor operations');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.remove('00000000-0000-4000-8000-0000000f1aaa', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'nor the viewer responsible for it');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    pg_temp.remove('00000000-0000-4000-8000-0000000f1aaa', '00000000-0000-4000-8000-0000000044aa')),
  '42501', null, 'an admin removes only in their own name');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.remove('00000000-0000-4000-8000-0000000f1aaa', '00000000-0000-4000-8000-0000000011bb')), 0,
  'another organization''s admin cannot remove it');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.follow_ups set removed_by = '00000000-0000-4000-8000-0000000022aa', task = 'Something else'
      where id = '00000000-0000-4000-8000-0000000f1aaa'$$),
  '23514', null, 'removing changes nothing else');

select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.remove('00000000-0000-4000-8000-0000000f1aaa', '00000000-0000-4000-8000-0000000022aa')), 1,
  'an admin removes an open follow-up');
select is(
  (select row(removed_at = now(), removed_by_name, task, done_at is null)::text
     from app.follow_ups where id = '00000000-0000-4000-8000-0000000f1aaa'),
  row(true, 'Adam Admin', 'Send the November bid sheet', true)::text,
  'stamped with the database''s clock and the admin''s name, and otherwise unchanged');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.remove('00000000-0000-4000-8000-0000000f2aaa', '00000000-0000-4000-8000-0000000022aa')), 1,
  'an admin removes a follow-up someone else marked done');
select is(
  (select done_by_name from app.follow_ups where id = '00000000-0000-4000-8000-0000000f2aaa'),
  'Tom', 'who finished it is kept');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.remove('00000000-0000-4000-8000-0000000f3aaa', '00000000-0000-4000-8000-0000000022aa')), 1,
  'and one of an archived counterparty');

-- A removed follow-up stays as it is ------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.follow_ups set removed_by = null where id = '00000000-0000-4000-8000-0000000f1aaa'$$),
  '23514', null, 'a removal is not undone');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.follow_ups set task = 'Something else' where id = '00000000-0000-4000-8000-0000000f1aaa'$$),
  '23514', null, 'a removed follow-up is not changed');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    $$update app.follow_ups set done_at = now(), done_by = '00000000-0000-4000-8000-0000000033aa',
        done_by_name = 'Victor' where id = '00000000-0000-4000-8000-0000000f1aaa'$$),
  '23514', null, 'nor marked done');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.remove('00000000-0000-4000-8000-0000000f1aaa', '00000000-0000-4000-8000-0000000022aa')), 0,
  'removing it again changes nothing');
select throws_ok(
  $$delete from app.follow_ups where id = '00000000-0000-4000-8000-0000000f1aaa'$$,
  '42501', null, 'a removed follow-up is still never deleted, even by the table owner');
select is(
  (select count(*)::int from app.follow_ups where organization_id = '00000000-0000-4000-8000-0000000000aa'),
  3, 'all three are kept');
select throws_ok(
  $$update app.follow_ups set removed_at = now(), removed_by = null, removed_by_name = null
     where id = '00000000-0000-4000-8000-0000000f2aaa'$$,
  '23514', null, 'the removal columns are all set or all empty');

-- Audit -----------------------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events
    where entity = 'follow_ups' and action = 'update' and 'removed_by' = any (changed_fields)
      and actor_id = '00000000-0000-4000-8000-0000000022aa'),
  3, 'every removal is audited, with who removed it');
select is(
  (select count(*)::int from app.audit_events
    where entity = 'follow_ups' and organization_id = '00000000-0000-4000-8000-0000000000bb'),
  0, 'and none is recorded against another organization');

select * from finish();
rollback;
