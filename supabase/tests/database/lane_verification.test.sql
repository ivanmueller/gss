-- Verified lanes (20261101030000_lane_verification.sql): unverified from a spreadsheet,
-- verified by hand, once, in one's own name, by traders, operations and admins of the lane's
-- organization only; the time from the database's clock; archived carriers unchanged.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (operations), adam (org_admin), victor (viewer), tom (trader), sam (suspended
-- trader). Org B: bob (org_admin).
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

-- c1aa: org A's carrier; c2aa: org A's buyer; c1bb: org B's carrier.
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Hauling',
   '{carrier}', 'CA', 'manual', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer',
   '{buyer}', 'CA', 'manual', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Hauling',
   '{carrier}', 'US', 'manual', '00000000-0000-4000-8000-0000000011bb');

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

-- An insert of one lane, as text.
create function pg_temp.add(org text, carrier text, origin text, destination text,
                            transport text, by_user text) returns text
language sql as $fn$
  select format($$insert into app.carrier_lanes
                    (organization_id, carrier_id, origin, destination, transport, created_by)
                  values (%L, %L, %L, %L, %L, %L)$$,
                org, carrier, origin, destination, transport, by_user)
$fn$;

-- Org A's carrier's lanes, as "origin>destination transport", sorted.
create function pg_temp.a_lanes() returns text[]
language sql as $fn$
  select coalesce(array_agg(origin || '>' || destination || ' ' || transport
                          order by origin || '>' || destination collate "C"), '{}')
  from app.carrier_lanes where carrier_id = '00000000-0000-4000-8000-00000000c1aa'
$fn$;


-- verified_at of org A's lane CA-AB > US-MT, as text ('null' when not verified).
create function pg_temp.verified() returns text
language sql as $fn$
  select coalesce(verified_by::text, 'null') from app.carrier_lanes
  where carrier_id = '00000000-0000-4000-8000-00000000c1aa' and origin = 'CA-AB' and destination = 'US-MT'
$fn$;

-- Privileges ------------------------------------------------------------------
select ok(has_column_privilege('app_api', 'app.carrier_lanes', 'verified_by', 'INSERT')
  and has_column_privilege('app_api', 'app.carrier_lanes', 'verified_by', 'UPDATE'),
  'app_api adds and verifies lanes');
select ok(not has_column_privilege('app_api', 'app.carrier_lanes', 'verified_at', 'INSERT')
  and not has_column_privilege('app_api', 'app.carrier_lanes', 'verified_at', 'UPDATE'),
  'but never sets the time of a verification');
select ok(not has_function_privilege('app_api', 'app.stamp_lane_verification()', 'EXECUTE'),
  'nor calls the stamp itself');

-- Unverified from a spreadsheet, verified by hand --------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'CA-AB', 'US-MT', null, '00000000-0000-4000-8000-0000000011aa')), 1,
  'a lane is added unverified, as an import adds it');
select is((select verified_at from app.carrier_lanes where destination = 'US-MT'), null,
  'with no time of verification');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  format($$insert into app.carrier_lanes
             (organization_id, carrier_id, origin, destination, transport, created_by, verified_by)
           values (%L, %L, 'CA-AB', 'US-ND', 'truck', %L, %L)$$,
         '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
         '00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-0000000044aa')), 1,
  'a lane added by hand is verified by whoever adds it');
select isnt((select verified_at from app.carrier_lanes where destination = 'US-ND'), null,
  'stamped by the database');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    format($$insert into app.carrier_lanes
               (organization_id, carrier_id, origin, destination, transport, created_by, verified_by)
             values (%L, %L, 'CA-AB', 'US-SD', null, %L, %L)$$,
           '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
           '00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-0000000011aa')),
  '42501', null, 'nobody adds a lane verified in someone else''s name');

-- Verifying ------------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  $$update app.carrier_lanes set verified_by = '00000000-0000-4000-8000-0000000033aa' where destination = 'US-MT'$$), 0,
  'a viewer cannot verify a lane');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  $$update app.carrier_lanes set verified_by = '00000000-0000-4000-8000-0000000011bb' where destination = 'US-MT'$$), 0,
  'nor another organization');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.carrier_lanes set verified_by = '00000000-0000-4000-8000-0000000011aa' where destination = 'US-MT'$$),
  'GS006', null, 'nobody verifies in someone else''s name');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  $$update app.carrier_lanes set verified_by = '00000000-0000-4000-8000-0000000044aa' where destination = 'US-MT'$$), 1,
  'a trader verifies a lane after calling the carrier');
select is(pg_temp.verified(), '00000000-0000-4000-8000-0000000044aa', 'in their own name');
select isnt((select verified_at from app.carrier_lanes where destination = 'US-MT'), null,
  'at the database''s time');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.carrier_lanes set verified_by = '00000000-0000-4000-8000-0000000022aa' where destination = 'US-MT'$$),
  'GS006', null, 'a lane is verified once');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.carrier_lanes set verified_by = null where destination = 'US-MT'$$),
  'GS006', null, 'and never unverified');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  $$update app.carrier_lanes set transport = 'rail' where destination = 'US-MT'$$), 1,
  'its transport still changes');
select is(pg_temp.verified(), '00000000-0000-4000-8000-0000000044aa',
  'and it stays verified by the same person');

-- Archived carriers ------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'CA-SK', 'US-MN', null, '00000000-0000-4000-8000-0000000011aa')), 1,
  'another unverified lane');
update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c1aa';
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.carrier_lanes set verified_by = '00000000-0000-4000-8000-0000000044aa' where destination = 'US-MN'$$),
  'GS005', null, 'an archived carrier''s lanes are not verified');

select * from finish();
rollback;
