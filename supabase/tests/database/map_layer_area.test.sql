-- The area of a map layer, grain or oil and gas (F-240): its default, the values the database
-- refuses, who may set and change it, and cross-organization denials. Runs in one transaction
-- that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Fixtures ------------------------------------------------------------------
-- Org A: adam (org_admin), olivia (operations). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- Test-only: lets the test owner switch to app_api (see tenancy.test.sql).
grant app_api to current_user;

-- Runs a statement as app_api for the given user; 'ok' with the rows changed, or the SQLSTATE.
create function pg_temp.api_run(uid text, statement text) returns text
language plpgsql as $fn$
declare
  changed int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);
  set local role app_api;
  begin
    execute statement;
    get diagnostics changed = row_count;
  exception when others then
    reset role;
    perform set_config('app.user_id', '', true);
    return sqlstate;
  end;
  reset role;
  perform set_config('app.user_id', '', true);
  return 'ok ' || changed;
end
$fn$;

-- A web layer added by uid, with an area as SQL text (null: the column left out).
create function pg_temp.add_layer(id text, org text, uid text, area text)
returns text
language sql as $fn$
  select format($q$insert into app.map_layers
      (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
       created_by, updated_by%s)
    values (%L, %L, 'Township grid', 'arcgis_features',
            'https://maps.example.com/arcgis/rest/services/Grid/MapServer/1',
            'Synthetic publisher', 'https://example.com/terms', 'Open licence.', '#2f6baa',
            %L, %L%s)$q$,
    case when area is null then '' else ', area' end, id, org, uid, uid,
    case when area is null then '' else ', ' || area end)
$fn$;

-- Moves a layer to an area, as uid.
create function pg_temp.move(uid text, id text, area text)
returns text
language sql as $fn$
  select pg_temp.api_run(uid, format(
    'update app.map_layers set area = %L, updated_by = %L where id = %L', area, uid, id))
$fn$;

\set adam '''00000000-0000-4000-8000-0000000022aa'''
\set olivia '''00000000-0000-4000-8000-0000000011aa'''
\set bob '''00000000-0000-4000-8000-0000000011bb'''
\set orga '''00000000-0000-4000-8000-0000000000aa'''
\set grain '''00000000-0000-4000-8000-0000000a4a01'''
\set oil '''00000000-0000-4000-8000-0000000a4a02'''
\set other '''00000000-0000-4000-8000-0000000a4a03'''
\set removed '''00000000-0000-4000-8000-0000000a4a04'''

-- Default and values -----------------------------------------------------------
select is(pg_temp.api_run(:adam, pg_temp.add_layer(:grain, :orga, :adam, null)), 'ok 1',
  'an admin adds a layer without saying its area');
select is((select area from app.map_layers where id = :grain::uuid), 'grain',
  'a layer is grain unless said otherwise, as every layer added before F-240');
select is(pg_temp.api_run(:adam, pg_temp.add_layer(:oil, :orga, :adam, quote_literal('oil_gas'))),
  'ok 1', 'an admin adds an oil and gas layer');
select is((select area from app.map_layers where id = :oil::uuid), 'oil_gas', 'its area is kept');
select is(pg_temp.api_run(:adam, pg_temp.add_layer(:other, :orga, :adam, quote_literal('steel'))),
  '23514', 'only grain or oil and gas');
select is(pg_temp.api_run(:adam, pg_temp.add_layer(:other, :orga, :adam, 'null')),
  '23502', 'never without an area');

-- Who may change it ------------------------------------------------------------
select is(pg_temp.move(:adam, :grain, 'oil_gas'), 'ok 1', 'an admin moves a layer to oil and gas');
select is(pg_temp.move(:olivia, :grain, 'grain'), 'ok 0', 'operations cannot move it');
select is(pg_temp.api_run(:olivia, pg_temp.add_layer(:other, :orga, :olivia, quote_literal('oil_gas'))),
  '42501', 'operations cannot add an oil and gas layer');
select is(pg_temp.move(:bob, :grain, 'grain'), 'ok 0', 'another organization''s admin cannot move it');
select is(pg_temp.api_run(:bob, format('select 1 from app.map_layers where id = %L', :oil)),
  'ok 0', 'another organization''s admin does not see an oil and gas layer');
select is((select area from app.map_layers where id = :grain::uuid), 'oil_gas',
  'only its own admin''s change took effect');

-- A removed layer keeps its area; the change is audited ---------------------------
select is(pg_temp.api_run(:adam, pg_temp.add_layer(:removed, :orga, :adam, null)), 'ok 1',
  'an admin adds a layer');
select is(pg_temp.api_run(:adam, format(
  'update app.map_layers set archived_at = now(), archived_by = %L, updated_by = %L where id = %L',
  :adam, :adam, :removed)), 'ok 1', 'and removes it');
select is(pg_temp.move(:adam, :removed, 'oil_gas'), '23514', 'a removed layer''s area is not changed');
select ok(exists (select 1 from app.audit_events where entity = 'map_layers'
  and entity_id = :grain::uuid and action = 'update' and 'area' = any(changed_fields)),
  'moving a layer is audited');

select * from finish();
rollback;
