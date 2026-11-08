-- A published zoomed-out view is sealed (F-134, Codex's review of d35ac90): its parts are not
-- added to, replaced or dropped; other preparations' parts are; publishing a new one drops the
-- old one's. Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

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

select ok(not has_function_privilege('app_api', 'app.guard_map_overview_part()', 'execute')
  and not has_function_privilege('anon', 'app.guard_map_overview_part()', 'execute'),
  'nobody calls the guard directly');

select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v1, 0)), 'ok 1',
  'parts are added while preparing');
select is(pg_temp.api_run(:adam, pg_temp.publish(:rail, :orga, :adam, :v1)), 'ok 1',
  'the preparation is published');
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v1, 1)), 'GS007',
  'no part is added to a published view');
select is(pg_temp.api_run(:adam, format($$delete from app.map_layer_overview_parts
    where layer_id = %L and version = %L$$, :rail, :v1)), 'GS007',
  'no part of a published view is dropped (nor replaced)');
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v2, 0)), 'ok 1',
  'a new preparation''s parts are added');
select is(pg_temp.api_run(:adam, format($$update app.map_layer_overviews set version = %L,
    prepared_by = %L, prepared_at = now() where layer_id = %L$$, :v2, :adam, :rail)), 'ok 1',
  'the new preparation is published');
select is(pg_temp.api_run(:adam, format($$delete from app.map_layer_overview_parts
    where layer_id = %L and version <> %L$$, :rail, :v2)), 'ok 1',
  'the old preparation''s parts are dropped once it is no longer published');
select is(pg_temp.api_run(:adam, pg_temp.part(:rail, :orga, :adam, :v2, 1)), 'GS007',
  'and the new one is sealed in turn');

select * from finish();
rollback;
