-- A carrier's lanes and equipment: privileges, who may add, change and remove lanes,
-- carriers only, cross-organization denials, refused values, archived carriers, deletion
-- with the carrier and the audit trail. Runs in one transaction that is rolled back. All
-- fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(49);

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

-- Privileges ------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'app.carrier_lanes', 'SELECT')
  and not has_table_privilege('authenticated', 'app.carrier_lanes', 'SELECT')
  and not has_table_privilege('service_role', 'app.carrier_lanes', 'SELECT'),
  'the Supabase API roles cannot read lanes');
select ok(has_table_privilege('app_api', 'app.carrier_lanes', 'SELECT')
  and has_table_privilege('app_api', 'app.carrier_lanes', 'DELETE'),
  'app_api reads and removes lanes');
select ok(not has_column_privilege('app_api', 'app.carrier_lanes', 'created_at', 'INSERT')
  and not has_column_privilege('app_api', 'app.carrier_lanes', 'updated_at', 'INSERT')
  and not has_column_privilege('app_api', 'app.carrier_lanes', 'id', 'INSERT'),
  'app_api never sets a lane''s times');
select ok(has_column_privilege('app_api', 'app.carrier_lanes', 'transport', 'UPDATE')
  and not has_column_privilege('app_api', 'app.carrier_lanes', 'origin', 'UPDATE')
  and not has_column_privilege('app_api', 'app.carrier_lanes', 'destination', 'UPDATE')
  and not has_column_privilege('app_api', 'app.carrier_lanes', 'carrier_id', 'UPDATE'),
  'app_api changes only a lane''s transport');
select ok(not has_function_privilege('app_api', 'app.check_carrier_lane()', 'EXECUTE'),
  'app_api cannot call the check itself');
select ok(has_column_privilege('app_api', 'app.counterparties', 'equipment', 'UPDATE'),
  'app_api sets equipment');
select is((select relrowsecurity from pg_class where oid = 'app.carrier_lanes'::regclass), true,
  'row level security is on');

-- Who adds lanes ----------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'CA-AB', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000044aa')), 1,
  'a trader adds a lane');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'CA-AB', 'US-ND', 'rail_and_truck', '00000000-0000-4000-8000-0000000011aa')), 1,
  'operations adds one');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
              'CA-AB', 'CA-AB', 'truck', '00000000-0000-4000-8000-0000000022aa')), 1,
  'an admin adds one within a province');
select is(pg_temp.a_lanes(), array['CA-AB>CA-AB truck', 'CA-AB>US-MT truck', 'CA-AB>US-ND rail_and_truck'],
  'the lanes hold what each added');
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000033aa',
  'select 1 from app.carrier_lanes'), 3, 'a viewer reads the lanes');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-SK', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'a viewer cannot add a lane');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-SK', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000011aa')),
  '42501', null, 'no one adds in someone else''s name');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000055aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-SK', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000055aa')),
  '42501', null, 'a suspended member cannot add');
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000055aa',
  'select 1 from app.carrier_lanes'), 0, 'nor read');

-- Carriers only -----------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa',
                'CA-SK', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000044aa')),
  '23514', null, 'a buyer has no lanes');

-- Changing and removing -----------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  $$update app.carrier_lanes set transport = 'rail' where destination = 'US-MT'$$), 1,
  'a trader changes a lane''s transport');
select isnt((select updated_at from app.carrier_lanes where destination = 'US-MT'), null,
  'and its time of change is kept');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  $$update app.carrier_lanes set transport = 'truck' where destination = 'US-MT'$$), 0,
  'a viewer cannot change one');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.carrier_lanes set destination = 'US-SD' where destination = 'US-MT'$$),
  '42501', null, 'a lane''s places are never changed, only removed and added');
select throws_ok(
  $$update app.carrier_lanes set destination = 'US-SD' where destination = 'US-MT'$$,
  '23514', null, 'not even by the table''s owner');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  $$delete from app.carrier_lanes$$), 0, 'a viewer cannot remove lanes');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000055aa',
  $$delete from app.carrier_lanes$$), 0, 'nor a suspended member');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  $$delete from app.carrier_lanes where origin = 'CA-AB' and destination = 'CA-AB'$$), 1,
  'operations removes a lane');

-- Other organizations ----------------------------------------------------------------
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
  'select 1 from app.carrier_lanes'), 0, 'another organization sees none of them');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  $$delete from app.carrier_lanes$$), 0, 'nor removes them');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  $$update app.carrier_lanes set transport = 'truck'$$), 0, 'nor changes them');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-SK', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000011bb')),
  '42501', null, 'nor adds to them');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1aa',
                'CA-SK', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000011bb')),
  '23503', null, 'nor reaches them through its own organization');
-- A lane org A already lists does not stop org B's attempt quietly (which would tell it the
-- lane exists); the tenant-matching key refuses it.
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1aa',
                'CA-AB', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000011bb')
      || ' on conflict do nothing'),
  '23503', null, 'another organization learns nothing from a lane this one lists');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.add('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1bb',
              'US-ND', 'US-MN', 'truck', '00000000-0000-4000-8000-0000000011bb')), 1,
  'each organization keeps its own carriers'' lanes');

-- Refused values ------------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-AB', 'US-MT', 'rail', '00000000-0000-4000-8000-0000000044aa')),
  '23505', null, 'a pair of places is listed once per carrier');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-XX', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000044aa')),
  '23514', null, 'only Canada''s provinces and territories and the U.S. states');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-AB', 'MX-SON', 'truck', '00000000-0000-4000-8000-0000000044aa')),
  '23514', null, 'no other country');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'ca-ab', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000044aa')),
  '23514', null, 'codes in capitals only');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-SK', 'US-MT', 'barge', '00000000-0000-4000-8000-0000000044aa')),
  '23514', null, 'only truck, rail or both');

-- Equipment ---------------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  $$update app.counterparties set equipment = '{super_b,van,hopper_car}'
    where id = '00000000-0000-4000-8000-00000000c1aa'$$), 1, 'operations sets equipment');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  $$update app.counterparties set equipment = '{tridem}'
    where id = '00000000-0000-4000-8000-00000000c1aa'$$), 0,
  'a trader cannot, as with the company''s other details');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparties set equipment = '{super_b,spaceship}'
      where id = '00000000-0000-4000-8000-00000000c1aa'$$),
  '23514', null, 'only the listed equipment');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparties set equipment = '{super_b,NULL}'
      where id = '00000000-0000-4000-8000-00000000c1aa'$$),
  '23514', null, 'no empty equipment');

-- Archived carriers ------------------------------------------------------------------
update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c1aa';
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-SK', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000044aa')),
  'GS005', null, 'nothing is added to an archived carrier');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.carrier_lanes set transport = 'truck' where destination = 'US-MT'$$),
  'GS005', null, 'nor changed');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$delete from app.carrier_lanes where destination = 'US-MT'$$),
  'GS005', null, 'nor removed by operations');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.add('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
                'CA-SK', 'US-MT', 'truck', '00000000-0000-4000-8000-0000000011bb')),
  '42501', null, 'another organization is refused by the policy, not told it is archived');
-- An admin deleting the archived carrier removes its lanes first (as the API does).
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  $$delete from app.carrier_lanes where carrier_id = '00000000-0000-4000-8000-00000000c1aa'$$), 2,
  'an admin removes an archived carrier''s lanes to delete it');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  $$delete from app.counterparties where id = '00000000-0000-4000-8000-00000000c1aa'$$), 1,
  'and then the carrier');

-- Audit -----------------------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events
    where entity = 'carrier_lanes' and action = 'insert'
      and organization_id = '00000000-0000-4000-8000-0000000000aa'),
  3, 'every lane added is audited');
select is(
  (select array_agg(actor_id::text order by actor_id) from app.audit_events
    where entity = 'carrier_lanes' and action in ('update', 'delete')
      and organization_id = '00000000-0000-4000-8000-0000000000aa'),
  array['00000000-0000-4000-8000-0000000011aa', '00000000-0000-4000-8000-0000000022aa',
        '00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000044aa'],
  'and every change and removal, with who made it');

select * from finish();
rollback;
