-- A company phone, a location's rail or truck access, and verified commodities: column
-- privileges, who may set each, cross-organization denials, refused values, archived
-- counterparties and the audit trail. Runs in one transaction that is rolled back. All
-- fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (operations), victor (viewer), tom (trader), sam (suspended trader).
-- Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000055aa', 'sam@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'trader', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

insert into app.facilities (id, organization_id, counterparty_id, city, region, country, created_by) values
  ('00000000-0000-4000-8000-00000000f1aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Lethbridge', 'AB', 'CA', '00000000-0000-4000-8000-0000000011aa');

-- Listed before verification existed, as from a spreadsheet: unverified.
insert into app.counterparty_commodities (organization_id, counterparty_id, commodity_code, direction, created_by) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'canola', 'buys',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'oats', 'buys',
   '00000000-0000-4000-8000-0000000011aa');

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

-- Verifies counterparty A's commodity, recorded as by a user.
create function pg_temp.verify(commodity text, by_user text) returns text
language sql as $fn$
  select format(
    $$update app.counterparty_commodities set verified_by = %L
      where counterparty_id = '00000000-0000-4000-8000-00000000c1aa' and commodity_code = %L
        and verified_by is null$$, by_user, commodity)
$fn$;

-- Privileges ------------------------------------------------------------------
select ok(has_column_privilege('app_api', 'app.counterparties', 'phone', 'UPDATE'),
  'app_api sets a company phone');
select ok(has_column_privilege('app_api', 'app.facilities', 'transport_access', 'UPDATE'),
  'app_api sets a location''s access');
select ok(
  has_column_privilege('app_api', 'app.counterparty_commodities', 'verified_by', 'UPDATE')
  and has_column_privilege('app_api', 'app.counterparty_commodities', 'verified_by', 'INSERT')
  and not has_column_privilege('app_api', 'app.counterparty_commodities', 'verified_at', 'UPDATE')
  and not has_column_privilege('app_api', 'app.counterparty_commodities', 'verified_at', 'INSERT')
  and not has_column_privilege('app_api', 'app.counterparty_commodities', 'commodity_code', 'UPDATE'),
  'app_api verifies by verified_by only; verified_at is the database''s clock');
select ok(not has_function_privilege('app_api', 'app.stamp_commodity_verification()', 'EXECUTE'),
  'app_api cannot call the verification trigger itself');

-- Company phone ------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  $$update app.counterparties set phone = '+1 (403) 555-0100 x12'
    where id = '00000000-0000-4000-8000-00000000c1aa'$$), 1,
  'operations sets the company phone');
select is((select phone from app.counterparties where id = '00000000-0000-4000-8000-00000000c1aa'),
  '+1 (403) 555-0100 x12', 'and it is saved');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  $$update app.counterparties set phone = '403 555 0199'
    where id = '00000000-0000-4000-8000-00000000c1aa'$$), 0,
  'a viewer cannot change it');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  $$update app.counterparties set phone = '403 555 0199'
    where id = '00000000-0000-4000-8000-00000000c1aa'$$), 0,
  'nor another organization');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparties set phone = 'call reception'
      where id = '00000000-0000-4000-8000-00000000c1aa'$$),
  '23514', null, 'a phone number is digits and + ( ) . / x - only');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparties set phone = '12'
      where id = '00000000-0000-4000-8000-00000000c1aa'$$),
  '23514', null, 'of at least 3 characters');
select is(
  (select count(*)::int from app.audit_events
    where entity = 'counterparties' and action = 'update' and 'phone' = any (changed_fields)),
  1, 'a change of phone is audited');

-- Rail and truck ------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  $$update app.facilities set transport_access = 'rail_and_truck'
    where id = '00000000-0000-4000-8000-00000000f1aa'$$), 1,
  'operations says a location is served by rail and truck');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  $$update app.facilities set transport_access = null
    where id = '00000000-0000-4000-8000-00000000f1aa'$$), 1,
  'or that it is not known');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.facilities set transport_access = 'barge'
      where id = '00000000-0000-4000-8000-00000000f1aa'$$),
  '23514', null, 'only rail, truck or rail and truck');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  $$update app.facilities set transport_access = 'rail'
    where id = '00000000-0000-4000-8000-00000000f1aa'$$), 0,
  'a viewer cannot change it');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  $$update app.facilities set transport_access = 'rail'
    where id = '00000000-0000-4000-8000-00000000f1aa'$$), 0,
  'nor another organization');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  $$insert into app.facilities (organization_id, counterparty_id, city, country, transport_access, created_by)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
            'Taber', 'CA', 'truck', '00000000-0000-4000-8000-0000000011aa')$$), 1,
  'a new location is added with its access');

-- Verified commodities ------------------------------------------------------------
select is(
  (select count(*)::int from app.counterparty_commodities
    where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'
      and verified_by is null and verified_at is null),
  2, 'commodities listed before start unverified');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  pg_temp.verify('canola', '00000000-0000-4000-8000-0000000033aa')), 1,
  'a viewer verifies a commodity');
select is(
  (select verified_at from app.counterparty_commodities where commodity_code = 'canola'),
  now(), 'stamped with the database''s clock');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  pg_temp.verify('canola', '00000000-0000-4000-8000-0000000044aa')), 0,
  'verifying one already verified changes nothing');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.counterparty_commodities set verified_by = '00000000-0000-4000-8000-0000000044aa'
      where commodity_code = 'canola'$$),
  'GS006', null, 'nor is it verified again in another name');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    $$update app.counterparty_commodities set verified_by = null where commodity_code = 'canola'$$),
  'GS006', null, 'a verified commodity stays verified');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.verify('oats', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'no one verifies in someone else''s name');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.counterparty_commodities set verified_at = now() - interval '1 year'
      where commodity_code = 'oats'$$),
  '42501', null, 'nor sets the time of a verification');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000055aa',
  pg_temp.verify('oats', '00000000-0000-4000-8000-0000000055aa')), 0,
  'a suspended member cannot verify');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.verify('oats', '00000000-0000-4000-8000-0000000011bb')), 0,
  'nor another organization');
select is(
  (select verified_by from app.counterparty_commodities where commodity_code = 'oats'),
  null, 'oats is still unverified');

-- Added by hand: verified by whoever adds it, never in another name.
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  $$insert into app.counterparty_commodities
      (organization_id, counterparty_id, commodity_code, direction, created_by, verified_by)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'yellow_peas',
            'buys', '00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-0000000044aa')$$), 1,
  'a trader adds a commodity as verified');
select ok(
  (select verified_at is not null from app.counterparty_commodities where commodity_code = 'yellow_peas'),
  'stamped as verified');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$insert into app.counterparty_commodities
        (organization_id, counterparty_id, commodity_code, direction, created_by, verified_by)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'flaxseed',
              'buys', '00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-0000000033aa')$$),
  '42501', null, 'not in someone else''s name');
select is(
  (select verified_at from app.counterparty_commodities where commodity_code = 'oats'),
  null, 'an unverified commodity has no verification time');

-- Archived counterparties ------------------------------------------------------------
update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c1aa';
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.verify('oats', '00000000-0000-4000-8000-0000000033aa')),
  'GS005', null, 'nothing is verified on an archived counterparty');
update app.counterparties set archived_at = null where id = '00000000-0000-4000-8000-00000000c1aa';
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  pg_temp.verify('oats', '00000000-0000-4000-8000-0000000033aa')), 1,
  'once restored, it can be verified');

-- Audit -----------------------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events
    where entity = 'counterparty_commodities' and action = 'update'
      and actor_id = '00000000-0000-4000-8000-0000000033aa'),
  2, 'every verification is audited, with who verified');
select is(
  (select count(*)::int from app.audit_events
    where entity = 'counterparty_commodities' and action = 'update'
      and organization_id = '00000000-0000-4000-8000-0000000000bb'),
  0, 'and none is recorded against another organization');

select * from finish();
rollback;
