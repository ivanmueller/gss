-- What counterparties buy and sell: privileges, any active member may add and remove,
-- cross-organization denials, refused values, archived counterparties and the audit trail.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (operations), adam (org_admin), victor (viewer), tom (trader),
-- sam (suspended trader). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000055aa', 'sam@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'trader', 'suspended', now()),
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

-- Adds a commodity to a counterparty, in an organization, recorded as by a user.
create function pg_temp.add(org text, counterparty text, commodity text, direction text, by_user text)
returns text language sql as $fn$
  select format(
    'insert into app.counterparty_commodities (organization_id, counterparty_id, commodity_code, direction, created_by)
     values (%L, %L, %L, %L, %L)', org, counterparty, commodity, direction, by_user)
$fn$;

create function pg_temp.a_list() returns text[]
language sql as $fn$
  select coalesce(array_agg(direction || ' ' || commodity_code order by direction, commodity_code), '{}')
  from app.counterparty_commodities where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'
$fn$;

-- Privileges ------------------------------------------------------------------
select table_privs_are('app', 'counterparty_commodities', 'app_api', array['SELECT', 'DELETE'],
  'app_api reads and removes rows; it adds only by column and never updates');
select ok(
  has_column_privilege('app_api', 'app.counterparty_commodities', 'commodity_code', 'INSERT')
  and has_column_privilege('app_api', 'app.counterparty_commodities', 'created_by', 'INSERT')
  and not has_column_privilege('app_api', 'app.counterparty_commodities', 'created_at', 'INSERT')
  and not has_column_privilege('app_api', 'app.counterparty_commodities', 'id', 'INSERT'),
  'app_api adds only the columns a caller sets, never created_at');
select ok(not has_column_privilege('app_api', 'app.counterparty_commodities', 'direction', 'UPDATE'),
  'app_api cannot change a row');
select table_privs_are('app', 'counterparty_commodities', 'authenticated', '{}'::text[],
  'the Supabase API roles have no access');
select table_privs_are('app', 'counterparty_commodities', 'anon', '{}'::text[], 'nor anon');
select ok(not has_function_privilege('app_api', 'app.check_counterparty_commodity()', 'EXECUTE'),
  'app_api cannot call the check itself');

-- Anyone on the team adds and removes -------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'canola', 'buys', '00000000-0000-4000-8000-0000000033aa')), 1,
  'a viewer adds a commodity');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'yellow_peas', 'buys', '00000000-0000-4000-8000-0000000044aa')), 1,
  'a trader adds one');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'canola', 'sells', '00000000-0000-4000-8000-0000000011aa')), 1,
  'operations adds one the counterparty sells');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'durum_wheat', 'buys', '00000000-0000-4000-8000-0000000022aa')), 1,
  'an admin adds one');
select is(pg_temp.a_list(), array['buys canola', 'buys durum_wheat', 'buys yellow_peas', 'sells canola'],
  'the list holds what each added');
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000033aa',
  'select 1 from app.counterparty_commodities'), 4, 'a viewer reads the list');

select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'buys', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'no one adds in someone else''s name');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000055aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'buys', '00000000-0000-4000-8000-0000000055aa')),
  '42501', null, 'a suspended member cannot add');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000055aa',
  $$delete from app.counterparty_commodities$$), 0, 'nor remove');

-- Other organizations ----------------------------------------------------------------
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
  'select 1 from app.counterparty_commodities'), 0, 'another organization sees none of them');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  $$delete from app.counterparty_commodities$$), 0, 'nor removes them');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'buys', '00000000-0000-4000-8000-0000000011bb')),
  '42501', null, 'nor adds to them');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'buys', '00000000-0000-4000-8000-0000000011bb')),
  '23503', null, 'nor reaches them through its own organization');
-- Codex's review of ivanmueller/gss#78: a row already listed by org A does not stop org B's
-- attempt quietly (which would tell it the row exists); the tenant-matching key refuses it.
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1aa',
                'canola', 'buys', '00000000-0000-4000-8000-0000000011bb')
      || ' on conflict do nothing'),
  '23503', null, 'another organization learns nothing from a commodity this one lists');

-- Refused values ------------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'canola', 'buys', '00000000-0000-4000-8000-0000000044aa')),
  '23505', null, 'a commodity is listed once each way');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'hemp', 'buys', '00000000-0000-4000-8000-0000000044aa')),
  '23503', null, 'only commodities on the shared list');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'trades', '00000000-0000-4000-8000-0000000044aa')),
  '23514', null, 'only buys or sells');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.counterparty_commodities set direction = 'sells' where commodity_code = 'durum_wheat'$$),
  '42501', null, 'a row is never changed, only removed');

-- Removing ----------------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  $$delete from app.counterparty_commodities where commodity_code = 'durum_wheat'$$), 1,
  'a viewer removes a commodity');

-- Archived counterparties ------------------------------------------------------------------
update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c1aa';
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'buys', '00000000-0000-4000-8000-0000000022aa')),
  'GS005', null, 'nothing is added to an archived counterparty');
-- By anyone but an admin, who removes them when deleting the counterparty
-- (counterparty_deletion.test.sql).
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$delete from app.counterparty_commodities where commodity_code = 'canola'$$),
  'GS005', null, 'nor removed');
-- Another organization learns nothing about the archiving either: it is refused as always.
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'buys', '00000000-0000-4000-8000-0000000011bb')),
  '42501', null, 'another organization is refused by the policy, not told it is archived');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'buys', '00000000-0000-4000-8000-0000000011bb')),
  '23503', null, 'nor through its own organization');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000055aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'oats', 'buys', '00000000-0000-4000-8000-0000000055aa')),
  '42501', null, 'a suspended member is refused by the policy, not told it is archived');
update app.counterparties set archived_at = null where id = '00000000-0000-4000-8000-00000000c1aa';
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'oats', 'buys', '00000000-0000-4000-8000-0000000022aa')), 1,
  'once restored, it can be changed again');
select is(pg_temp.a_list(), array['buys canola', 'buys oats', 'buys yellow_peas', 'sells canola'],
  'the list after the changes');
select col_is_unique('app', 'counterparty_commodities',
  array['organization_id', 'counterparty_id', 'commodity_code', 'direction'],
  'a commodity is listed once each way, keyed by organization');

-- Audit -----------------------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events
    where entity = 'counterparty_commodities' and action = 'insert'
      and organization_id = '00000000-0000-4000-8000-0000000000aa'),
  5, 'every addition is audited (including one later removed)');
select is(
  (select actor_id from app.audit_events
    where entity = 'counterparty_commodities' and action = 'delete'),
  '00000000-0000-4000-8000-0000000033aa'::uuid, 'and every removal, with who removed it');

select * from finish();
rollback;
