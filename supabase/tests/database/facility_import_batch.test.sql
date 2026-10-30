-- The import a location came from: set when an import adds it, only to an import of the
-- location's own organization, and never changed through the API. Runs in one transaction
-- that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (operations), adam (org_admin), victor (viewer), tom (trader).
-- Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

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

insert into app.import_batches (id, organization_id, kind, file_name, content_sha256, row_count, created_count, skipped_count, created_by) values
  ('00000000-0000-4000-8000-0000000ba7aa', '00000000-0000-4000-8000-0000000000aa', 'counterparties', 'synthetic-a.csv',
   repeat('a', 64), 1, 0, 1, '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-0000000ba7bb', '00000000-0000-4000-8000-0000000000bb', 'counterparties', 'synthetic-b.csv',
   repeat('b', 64), 1, 0, 1, '00000000-0000-4000-8000-0000000011bb');

-- Adds a location to counterparty A, from an import, as a user.
create function pg_temp.add_from(batch text, by_user text) returns text
language sql as $fn$
  select format($$insert into app.facilities
                    (organization_id, counterparty_id, city, country, import_batch_id, created_by)
                  values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                          'Synthetic Spur', 'CA', %L, %L)$$, batch, by_user)
$fn$;

select ok(has_column_privilege('app_api', 'app.facilities', 'import_batch_id', 'INSERT'),
  'app_api records the import a location came from');
select ok(not has_column_privilege('app_api', 'app.facilities', 'import_batch_id', 'UPDATE'),
  'and never changes it');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.add_from('00000000-0000-4000-8000-0000000ba7aa', '00000000-0000-4000-8000-0000000011aa')), 1,
  'operations adds a location from an import of its own organization');
select is(
  (select count(*)::int from app.facilities where import_batch_id = '00000000-0000-4000-8000-0000000ba7aa'),
  1, 'and the location names that import');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.add_from('00000000-0000-4000-8000-0000000ba7bb', '00000000-0000-4000-8000-0000000011aa')),
  '23503', null, 'a location cannot name another organization''s import');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add_from('00000000-0000-4000-8000-0000000ba7bb', '00000000-0000-4000-8000-0000000011bb')),
  '42501', null, 'nor another organization add one to this organization''s counterparty');

select * from finish();
rollback;
