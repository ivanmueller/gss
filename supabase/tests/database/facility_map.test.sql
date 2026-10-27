-- Map viewport search: privileges on app.location_in_bbox, the box it describes, and
-- tenant isolation of a map query made as app_api. Runs in one transaction that is
-- rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (viewer), sam (suspended viewer). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000055aa', 'sam@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'viewer', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c0aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c0bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

-- In the box -110,49,-95,60: A's f1a (inside) and f2a (on the southern edge), B's f1b.
-- Outside it: A's f3a. Without coordinates: A's f4a.
insert into app.facilities (id, organization_id, counterparty_id, country, latitude, longitude, location_precision, created_by) values
  ('00000000-0000-4000-8000-000000000f1a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c0aa',
   'CA', 52.133214, -106.670046, 'exact', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f2a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c0aa',
   'CA', 49.000000, -97.000000, 'approximate', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f3a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c0aa',
   'US', 44.977753, -93.265011, 'exact', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f4a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c0aa',
   'CA', null, null, null, '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f1b', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb',
   'CA', 50.000000, -100.000000, 'exact', '00000000-0000-4000-8000-0000000011bb');

-- Test-only: lets the test owner switch to app_api (see tenancy.test.sql).
grant app_api to current_user;

-- The query switches to app_api only around the query itself, so the pgTAP assertions run
-- as the test owner.
create function pg_temp.api_rows(uid text, query text) returns jsonb
language plpgsql as $fn$
declare
  result jsonb;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute format('select coalesce(jsonb_agg(q), ''[]''::jsonb) from (%s) q', query) into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

-- The ids of the facilities a user's map query returns for the prairie box.
create function pg_temp.map_ids(uid text) returns jsonb
language sql as $fn$
  select coalesce(jsonb_agg(row->>'id' order by row->>'id'), '[]'::jsonb)
  from jsonb_array_elements(pg_temp.api_rows(uid,
    $$select id from app.facilities where app.location_in_bbox(location, -110, 49, -95, 60)$$)) row
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_function_privilege('app_api',
    'app.location_in_bbox(extensions.geography, double precision, double precision, double precision, double precision)',
    'execute'),
  'app_api can call app.location_in_bbox'
);
select ok(
  not has_function_privilege('public',
    'app.location_in_bbox(extensions.geography, double precision, double precision, double precision, double precision)',
    'execute'),
  'public cannot call app.location_in_bbox'
);
select ok(
  not has_schema_privilege('app_api', 'extensions', 'usage'),
  'app_api still has no access to the extensions schema'
);
select ok(
  (select not prosecdef and proconfig is null from pg_proc where oid = 'app.location_in_bbox'::regproc),
  'app.location_in_bbox runs as its caller and can be inlined (no SET clause)'
);

-- The box ------------------------------------------------------------------------
select ok(
  app.location_in_bbox('SRID=4326;POINT(-97 49)'::extensions.geography, -110, 49, -95, 60),
  'a point on the edge is inside'
);
select ok(
  not app.location_in_bbox('SRID=4326;POINT(-94.999999 50)'::extensions.geography, -110, 49, -95, 60),
  'a point just east of the box is outside'
);
select ok(
  not app.location_in_bbox('SRID=4326;POINT(-100 48.999999)'::extensions.geography, -110, 49, -95, 60),
  'a point just south of the box, mid-way along its edge, is outside'
);
select is(
  app.location_in_bbox(null, -110, 49, -95, 60),
  null,
  'a facility without coordinates is never inside'
);

-- Tenant isolation through app_api -------------------------------------------------
select is(
  pg_temp.map_ids('00000000-0000-4000-8000-0000000011aa'),
  '["00000000-0000-4000-8000-000000000f1a", "00000000-0000-4000-8000-000000000f2a"]'::jsonb,
  'a member sees only their organization''s facilities inside the box'
);
select is(
  pg_temp.map_ids('00000000-0000-4000-8000-0000000011bb'),
  '["00000000-0000-4000-8000-000000000f1b"]'::jsonb,
  'the other organization sees only its own facility in the same box'
);
select is(
  pg_temp.map_ids('00000000-0000-4000-8000-0000000055aa'),
  '[]'::jsonb,
  'a suspended member sees no facilities'
);
select is(
  pg_temp.map_ids(null),
  '[]'::jsonb,
  'without a user nothing is returned'
);

select * from finish();
rollback;
