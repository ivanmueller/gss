-- A map layer's zoomed-out view (F-134): who may add its parts and publish it, who reads them,
-- cross-organization denials, the kinds of layer that take one, replacing and dropping parts,
-- and the audit trail. Runs in one
-- transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- Org A: a live lines layer, a pictures layer, and a removed lines layer; org B: a lines layer.
insert into app.map_layers (id, organization_id, name, kind, source_url, wms_layers, source_name,
    terms_url, terms_note, colour, created_by, updated_by, archived_at, archived_by) values
  ('00000000-0000-4000-8000-0000000a1a01', '00000000-0000-4000-8000-0000000000aa', 'Rail', 'arcgis_features',
   'https://services.example.com/x/FeatureServer/0', null, 'P', 'https://example.com/t', 'T', '#2f6baa',
   '00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000022aa', null, null),
  ('00000000-0000-4000-8000-0000000a1a02', '00000000-0000-4000-8000-0000000000aa', 'Soil', 'arcgis_image',
   'https://services.example.com/x/MapServer', null, 'P', 'https://example.com/t', 'T', '#2f6baa',
   '00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000022aa', null, null),
  ('00000000-0000-4000-8000-0000000a1a03', '00000000-0000-4000-8000-0000000000aa', 'Old', 'arcgis_features',
   'https://services.example.com/y/FeatureServer/0', null, 'P', 'https://example.com/t', 'T', '#2f6baa',
   '00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000022aa', now(),
   '00000000-0000-4000-8000-0000000022aa'),
  ('00000000-0000-4000-8000-0000000b1b01', '00000000-0000-4000-8000-0000000000bb', 'B rail', 'arcgis_features',
   'https://services.example.com/z/FeatureServer/0', null, 'P', 'https://example.com/t', 'T', '#2f6baa',
   '00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-0000000011bb', null, null);

grant app_api to current_user;

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

-- Adds part `n` of preparation `v` of `layer` in `org` as `uid`.
create function pg_temp.part(layer text, org text, uid text, v text, n int default 0, body text default '[{"type":"Feature"}]')
returns text
language sql as $fn$
  select format($$insert into app.map_layer_overview_parts (layer_id, organization_id, version,
      part_no, features, feature_count, created_by)
    values (%L, %L, %L, %s, convert_to(%L, 'UTF8'), 1, %L)$$, layer, org, v, n, body, uid)
$fn$;

-- Publishes preparation `v` of `layer` in `org` as `uid`.
create function pg_temp.publish(layer text, org text, uid text, v text)
returns text
language sql as $fn$
  select format($$insert into app.map_layer_overviews (layer_id, organization_id, version,
      colour_field, part_count, feature_count, source_count, prepared_by)
    values (%L, %L, %L, 'OWNER', 1, 1, 10, %L)$$, layer, org, v, uid)
$fn$;

\set adam '''00000000-0000-4000-8000-0000000022aa'''
\set olivia '''00000000-0000-4000-8000-0000000011aa'''
\set victor '''00000000-0000-4000-8000-0000000033aa'''
\set bob '''00000000-0000-4000-8000-0000000011bb'''
\set orga '''00000000-0000-4000-8000-0000000000aa'''
\set orgb '''00000000-0000-4000-8000-0000000000bb'''
\set rail '''00000000-0000-4000-8000-0000000a1a01'''
\set soil '''00000000-0000-4000-8000-0000000a1a02'''
\set old '''00000000-0000-4000-8000-0000000a1a03'''
\set brail '''00000000-0000-4000-8000-0000000b1b01'''
\set v1 '''00000000-0000-4000-8000-00000000f001'''
\set v2 '''00000000-0000-4000-8000-00000000f002'''

select ok((select relrowsecurity from pg_class where oid = 'app.map_layer_overviews'::regclass)
  and (select relrowsecurity from pg_class where oid = 'app.map_layer_overview_parts'::regclass),
  'views and their parts have row level security');
select ok(not has_table_privilege('anon', 'app.map_layer_overview_parts', 'select')
  and not has_table_privilege('authenticated', 'app.map_layer_overviews', 'select')
  and not has_table_privilege('service_role', 'app.map_layer_overview_parts', 'select'),
  'the Supabase API roles cannot read views or parts');
select ok(not has_table_privilege('app_api', 'app.map_layer_overviews', 'delete')
  and not has_table_privilege('app_api', 'app.map_layer_overview_parts', 'update')
  and not has_column_privilege('app_api', 'app.map_layer_overviews', 'layer_id', 'update')
  and not has_column_privilege('app_api', 'app.map_layer_overviews', 'organization_id', 'update'),
  'app_api cannot delete a view, change a part, or move a view to another layer or organization');
select ok(not has_function_privilege('anon', 'app.can_prepare_map_overview(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.can_prepare_map_overview(uuid, uuid)', 'execute'),
  'the Supabase API roles cannot call can_prepare_map_overview');

-- Who may add parts.
select is(pg_temp.api_run(:olivia, pg_temp.part(:rail, :orga, :olivia, :v1)), '42501',
  'operations cannot add a part');
select is(pg_temp.api_run(:victor, pg_temp.part(:rail, :orga, :victor, :v1)), '42501',
  'a viewer cannot add a part');
select is(pg_temp.api_run(:bob, pg_temp.part(:rail, :orga, :bob, :v1)), '42501',
  'another organization''s admin cannot add a part to this organization''s layer');
select is(pg_temp.api_run(:bob, pg_temp.part(:rail, :orgb, :bob, :v1)), '42501',
  'nor pass it off as their own organization''s');
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :victor, :v1)), '42501',
  'an admin adds a part only in their own name');
select is(pg_temp.api_run(:adam, pg_temp.part(:soil, :orga, :adam, :v1)), '42501',
  'a pictures layer takes no view');
select is(pg_temp.api_run(:adam, pg_temp.part(:old, :orga, :adam, :v1)), '42501',
  'a removed layer takes no view');
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v1, 0, '{"a":1}')), '23514',
  'a part must be a JSON array');
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v1, 64)), '23514',
  'a view has at most 64 parts');
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v1)), 'ok 1',
  'an admin adds a part of a live lines layer''s view');
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v1)), '23505',
  'each part of a preparation once');

-- Who may publish.
select is(pg_temp.api_run(:olivia, pg_temp.publish(:rail, :orga, :olivia, :v1)), '42501',
  'operations cannot publish a view');
select is(pg_temp.api_run(:bob, pg_temp.publish(:rail, :orga, :bob, :v1)), '42501',
  'another organization''s admin cannot publish this organization''s view');
select is(pg_temp.api_run(:adam, pg_temp.publish(:soil, :orga, :adam, :v1)), '42501',
  'a pictures layer has no view to publish');
select is(pg_temp.api_run(:adam, pg_temp.publish(:rail, :orga, :adam, :v1)), 'ok 1',
  'an admin publishes it');
select is(pg_temp.api_run(:adam, pg_temp.publish(:rail, :orga, :adam, :v2)), '23505',
  'a layer has one published view');
select is(pg_temp.api_run(:bob, pg_temp.part(:brail, :orgb, :bob, :v1)), 'ok 1',
  'org B''s admin adds a part of org B''s view');

-- Who reads them.
select is(pg_temp.api_count(:victor, 'select 1 from app.map_layer_overview_parts'), 1,
  'a viewer reads their organization''s parts and not another''s');
select is(pg_temp.api_count(:victor, 'select 1 from app.map_layer_overviews'), 1,
  'a viewer reads their organization''s view');
select is(pg_temp.api_count(:bob, format('select 1 from app.map_layer_overviews where layer_id = %L', :rail)), 0,
  'another organization''s admin does not read it');
select is(pg_temp.api_count(null, 'select 1 from app.map_layer_overview_parts'), 0,
  'nobody signed in reads nothing');

-- Replacing it, and dropping parts.
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v2)), 'ok 1',
  'an admin prepares it again');
select is(pg_temp.api_run(:adam, format($$update app.map_layer_overviews set version = %L,
    prepared_by = %L, prepared_at = now() where layer_id = %L$$, :v2, :adam, :rail)), 'ok 1',
  'and publishes the new preparation');
select is(pg_temp.api_run(:olivia, format($$update app.map_layer_overviews set version = %L,
    prepared_by = %L where layer_id = %L$$, :v1, :olivia, :rail)), 'ok 0',
  'operations cannot publish another');
select is(pg_temp.api_run(:bob, format($$delete from app.map_layer_overview_parts where layer_id = %L$$, :rail)),
  'ok 0', 'another organization''s admin cannot drop its parts');
select is(pg_temp.api_run(:adam, format($$delete from app.map_layer_overview_parts where layer_id = %L and version = %L$$, :rail, :v1)),
  'ok 1', 'an admin drops the earlier preparation''s parts');
select is(pg_temp.api_run(:adam, format($$delete from app.map_layer_overviews where layer_id = %L$$, :rail)),
  '42501', 'a published view cannot be deleted');

-- Audit trail.
select ok(exists (select 1 from app.audit_events where entity = 'map_layer_overviews' and action = 'insert'
  and organization_id = :orga::uuid), 'publishing a view is audited');
select ok(exists (select 1 from app.audit_events where entity = 'map_layer_overviews' and action = 'update'
  and 'version' = any(changed_fields)), 'publishing it again is audited');

select * from finish();
rollback;
