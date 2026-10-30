-- A counterparty's markets and tier: the column privileges, who may set them,
-- cross-organization denials, the values the database refuses and the audit trail. Runs in
-- one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

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

-- Sets counterparty A's markets and tier, as text.
create function pg_temp.set_a(markets text, tier text) returns text
language sql as $fn$
  select format($$update app.counterparties set markets = %L::text[], tier = %L
                   where id = '00000000-0000-4000-8000-00000000c1aa'$$, markets, tier)
$fn$;

-- Privileges ------------------------------------------------------------------
select ok(has_column_privilege('app_api', 'app.counterparties', 'markets', 'UPDATE')
  and has_column_privilege('app_api', 'app.counterparties', 'tier', 'UPDATE'),
  'app_api sets markets and the tier');

-- Who sets them ------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.set_a('{pet,bird}', 'A')), 1, 'operations sets markets and a tier');
select is((select row(markets, tier)::text from app.counterparties
            where id = '00000000-0000-4000-8000-00000000c1aa'),
  row(array['pet', 'bird'], 'A')::text, 'and they are saved');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.set_a('{small_animal,exotic,wildlife,aqua,equine,specialty}', 'C')), 1,
  'an admin sets every other market');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  pg_temp.set_a('{pet}', 'B')), 0, 'a viewer cannot change them');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  pg_temp.set_a('{pet}', 'B')), 0, 'nor a trader');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.set_a('{pet}', 'B')), 0, 'nor another organization');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.set_a('{}', null)), 1, 'none and no tier are allowed');

-- Refused values ----------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a('{pet,cattle}', null)),
  '23514', null, 'only the eight markets');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a('{pet,NULL}', null)),
  '23514', null, 'no empty market');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a('{}', 'D')),
  '23514', null, 'only tier A, B or C');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparties set markets = null where id = '00000000-0000-4000-8000-00000000c1aa'$$),
  '23502', null, 'markets is a list, never missing');

-- Audit -----------------------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events
    where entity = 'counterparties' and action = 'update' and 'markets' = any (changed_fields)),
  3, 'every change of markets is audited');

select * from finish();
rollback;
