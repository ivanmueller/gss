-- A seller's details (grain types, kind, tonnes a year, organic certificate): the column
-- privileges, who may set them, cross-organization denials, the values the database refuses,
-- inserts with them and the audit trail. Runs in
-- one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

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
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Seller', 'US', 'manual',
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

-- Sets counterparty A's seller details from a SQL fragment ("grain_types = '{feed}'").
create function pg_temp.set_a(assignments text) returns text
language sql as $fn$
  select format($$update app.counterparties set %s
                   where id = '00000000-0000-4000-8000-00000000c1aa'$$, assignments)
$fn$;

create function pg_temp.refused(assignments text) returns text
language sql as $fn$
  select format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a(assignments))
$fn$;

-- Privileges ------------------------------------------------------------------
select ok(has_column_privilege('app_api', 'app.counterparties', 'grain_types', 'UPDATE')
  and has_column_privilege('app_api', 'app.counterparties', 'seller_kind', 'UPDATE')
  and has_column_privilege('app_api', 'app.counterparties', 'annual_tonnes', 'UPDATE')
  and has_column_privilege('app_api', 'app.counterparties', 'organic_certifier', 'UPDATE')
  and has_column_privilege('app_api', 'app.counterparties', 'organic_certified_until', 'UPDATE'),
  'app_api sets the seller details');

-- Who sets them ------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', pg_temp.set_a(
  $$grain_types = '{feed,organic}', seller_kind = 'farm', annual_tonnes = 4500,
    organic_certifier = 'Synthetic Certifier', organic_certified_until = '2027-03-31'$$)), 1,
  'operations sets the seller details');
select is((select row(grain_types, seller_kind, annual_tonnes, organic_certifier,
                      organic_certified_until)::text
             from app.counterparties where id = '00000000-0000-4000-8000-00000000c1aa'),
  row(array['feed', 'organic'], 'farm', 4500, 'Synthetic Certifier', date '2027-03-31')::text,
  'and they are saved');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa', pg_temp.set_a(
  $$grain_types = '{human_consumption,non_gmo_ip}', seller_kind = 'elevator'$$)), 1,
  'an admin sets the other grain types');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  pg_temp.set_a($$grain_types = '{feed}'$$)), 0, 'a viewer cannot change them');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  pg_temp.set_a($$seller_kind = 'processor'$$)), 0, 'nor a trader');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.set_a($$annual_tonnes = 1$$)), 0, 'nor another organization');
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
  $$select 1 from app.counterparties where id = '00000000-0000-4000-8000-00000000c1aa'
      and grain_types is not null$$), 0, 'which does not see them either');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', pg_temp.set_a(
  $$grain_types = '{}', seller_kind = null, annual_tonnes = null, organic_certifier = null,
    organic_certified_until = null$$)), 1, 'each may be left empty');

-- Refused values ----------------------------------------------------------------------
select throws_ok(pg_temp.refused($$grain_types = '{feed,pet}'$$), '23514', null,
  'only the four grain types');
select throws_ok(pg_temp.refused($$grain_types = '{feed,NULL}'$$), '23514', null,
  'no empty grain type');
select throws_ok(pg_temp.refused($$grain_types = null$$), '23502', null,
  'grain types is a list, never missing');
select throws_ok(pg_temp.refused($$seller_kind = 'broker'$$), '23514', null,
  'only a farm, elevator, processor or other');
select throws_ok(pg_temp.refused($$annual_tonnes = 0$$), '23514', null,
  'tonnes a year above zero');
select throws_ok(pg_temp.refused($$annual_tonnes = 10000001$$), '23514', null,
  'and at most ten million');
select throws_ok(pg_temp.refused($$organic_certifier = ' Padded'$$), '23514', null,
  'a certifier without spaces around it');
select throws_ok(pg_temp.refused($$organic_certifier = ''$$), '23514', null,
  'nor empty');
select throws_ok(pg_temp.refused(format('organic_certifier = %L', repeat('x', 201))), '23514',
  null, 'nor over 200 characters');
select throws_ok(pg_temp.refused($$organic_certified_until = '1999-12-31'$$), '23514', null,
  'a certificate date from 2000');

-- Inserted with them -------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  $$insert into app.counterparties (organization_id, legal_name, primary_country, types,
      grain_types, seller_kind, annual_tonnes, source, created_by)
    values ('00000000-0000-4000-8000-0000000000aa', 'Synthetic New Seller', 'CA', '{seller}',
      '{non_gmo_ip}', 'processor', 12000, 'manual', '00000000-0000-4000-8000-0000000011aa')$$),
  1, 'a new seller is added with its details');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$insert into app.counterparties (organization_id, legal_name, primary_country, types,
        grain_types, source, created_by)
      values ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Stray Seller', 'US', '{seller}',
        '{feed}', 'manual', '00000000-0000-4000-8000-0000000011aa')$$),
  '42501', null, 'but not into another organization');

-- Audit -----------------------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events
    where entity = 'counterparties' and action = 'update' and 'grain_types' = any (changed_fields)),
  3, 'every change of grain types is audited');

select * from finish();
rollback;
