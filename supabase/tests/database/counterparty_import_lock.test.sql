-- One counterparty import at a time per organization: the lock only those who may import
-- can take, and only in their own organization. Runs in one transaction that is rolled back.
-- All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

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

-- Takes the import lock as app_api for the given user.
create function pg_temp.lock_as(uid text, org text) returns text
language sql as $fn$
  select format('select pg_temp.api_changed(%L, %L)', uid,
    format('select app.lock_counterparty_import(%L)', org))
$fn$;

select ok(has_function_privilege('app_api', 'app.lock_counterparty_import(uuid)', 'execute'),
  'app_api takes the import lock');
select ok(
  not has_function_privilege('anon', 'app.lock_counterparty_import(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.lock_counterparty_import(uuid)', 'execute')
    and not has_function_privilege('service_role', 'app.lock_counterparty_import(uuid)', 'execute')
    and not has_function_privilege('public', 'app.lock_counterparty_import(uuid)', 'execute'),
  'the Supabase API roles cannot');
select lives_ok(pg_temp.lock_as('00000000-0000-4000-8000-0000000011aa', '00000000-0000-4000-8000-0000000000aa'),
  'operations takes it for its own organization');
select lives_ok(pg_temp.lock_as('00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000000aa'),
  'so does an admin');
select throws_ok(pg_temp.lock_as('00000000-0000-4000-8000-0000000033aa', '00000000-0000-4000-8000-0000000000aa'),
  '42501', null, 'a viewer cannot');
select throws_ok(pg_temp.lock_as('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-0000000000aa'),
  '42501', null, 'nor a trader');
select throws_ok(pg_temp.lock_as('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-0000000000aa'),
  '42501', null, 'nor another organization''s admin');

select * from finish();
rollback;
