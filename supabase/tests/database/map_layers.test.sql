-- Map layers (F-107): who may add, change and remove them, cross-organization denials, the
-- values the database refuses, file layers and the audit trail. Runs in one transaction that
-- is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(47);

-- Fixtures ------------------------------------------------------------------
-- Org A: adam (org_admin), olivia (operations), tom (trader), victor (viewer).
-- Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
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

-- A service layer for org A added by the given user, with the given id and address.
create function pg_temp.add_service(id text, org text, uid text, url text default 'https://services.example.com/rest/services/Rail/FeatureServer/0')
returns text
language sql as $fn$
  select format($$insert into app.map_layers
      (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
       colour_field, colours, created_by, updated_by)
    values (%L, %L, 'Rail lines', 'arcgis_features', %L, 'Synthetic publisher',
            'https://example.com/terms', 'Public domain.', '#2f6baa', 'OWNER',
            '[["AAA", "#e6194b"], ["BBB", "#3cb44b"]]', %L, %L)$$, id, org, url, uid, uid)
$fn$;

\set adam '''00000000-0000-4000-8000-0000000022aa'''
\set olivia '''00000000-0000-4000-8000-0000000011aa'''
\set tom '''00000000-0000-4000-8000-0000000044aa'''
\set victor '''00000000-0000-4000-8000-0000000033aa'''
\set bob '''00000000-0000-4000-8000-0000000011bb'''
\set orga '''00000000-0000-4000-8000-0000000000aa'''
\set orgb '''00000000-0000-4000-8000-0000000000bb'''
\set layer1 '''00000000-0000-4000-8000-0000000a1a01'''
\set layer2 '''00000000-0000-4000-8000-0000000a1a02'''
\set filelayer '''00000000-0000-4000-8000-0000000a1a03'''
\set blayer '''00000000-0000-4000-8000-0000000b1b01'''

-- Structure and privileges ---------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'app.map_layers'::regclass),
  'map_layers has row level security');
select ok((select relrowsecurity from pg_class where oid = 'app.map_layer_files'::regclass),
  'map_layer_files has row level security');
select ok(not has_table_privilege('anon', 'app.map_layers', 'select')
  and not has_table_privilege('authenticated', 'app.map_layers', 'select')
  and not has_table_privilege('service_role', 'app.map_layers', 'select'),
  'the Supabase API roles cannot read map layers');
select ok(not has_table_privilege('anon', 'app.map_layer_files', 'select')
  and not has_table_privilege('authenticated', 'app.map_layer_files', 'select')
  and not has_table_privilege('service_role', 'app.map_layer_files', 'select'),
  'the Supabase API roles cannot read layer files');
select ok(not has_table_privilege('app_api', 'app.map_layers', 'delete')
  and not has_table_privilege('app_api', 'app.map_layer_files', 'delete')
  and not has_table_privilege('app_api', 'app.map_layer_files', 'update'),
  'app_api cannot delete layers or change files');
select ok(not has_column_privilege('app_api', 'app.map_layers', 'source_url', 'update')
  and not has_column_privilege('app_api', 'app.map_layers', 'kind', 'update')
  and not has_column_privilege('app_api', 'app.map_layers', 'organization_id', 'update'),
  'app_api cannot change a layer''s address, kind or organization');

-- Who may add layers ---------------------------------------------------------
select is(pg_temp.api_run(:adam, pg_temp.add_service(:layer1, :orga, :adam)), 'ok 1',
  'an admin adds a layer');
select is(pg_temp.api_run(:olivia, pg_temp.add_service(:layer2, :orga, :olivia)), '42501',
  'operations cannot add a layer');
select is(pg_temp.api_run(:tom, pg_temp.add_service(:layer2, :orga, :tom)), '42501',
  'a trader cannot add a layer');
select is(pg_temp.api_run(:victor, pg_temp.add_service(:layer2, :orga, :victor)), '42501',
  'a viewer cannot add a layer');
select is(pg_temp.api_run(:bob, pg_temp.add_service(:layer2, :orga, :bob)), '42501',
  'an admin of another organization cannot add a layer to this one');
select is(pg_temp.api_run(:adam, pg_temp.add_service(:layer2, :orga, :victor)), '42501',
  'an admin adds a layer only in their own name');
select is(pg_temp.api_run(:bob, pg_temp.add_service(:blayer, :orgb, :bob)), 'ok 1',
  'org B''s admin adds a layer to org B');

-- Who sees them --------------------------------------------------------------
select is(pg_temp.api_count(:victor, 'select 1 from app.map_layers'), 1,
  'a viewer sees their organization''s layer and not another''s');
select is(pg_temp.api_count(:tom, format('select 1 from app.map_layers where id = %L', :layer1)), 1,
  'a trader sees the layer');
select is(pg_temp.api_count(:bob, format('select 1 from app.map_layers where id = %L', :layer1)), 0,
  'another organization''s admin does not see it');
select is(pg_temp.api_count(null, 'select 1 from app.map_layers'), 0,
  'nobody signed in sees nothing');

-- Values refused ---------------------------------------------------------------
select is(pg_temp.api_run(:adam, pg_temp.add_service(:layer2, :orga, :adam, 'http://services.example.com/x/FeatureServer/0')),
  '23514', 'an address that is not https is refused');
select is(pg_temp.api_run(:adam, pg_temp.add_service(:layer2, :orga, :adam, 'https://services.example.com/x/FeatureServer/0?token=abc')),
  '23514', 'an address with a query is refused');
select is(pg_temp.api_run(:adam, pg_temp.add_service(:layer2, :orga, :adam, 'https://127.0.0.1/x/FeatureServer/0')),
  '23514', 'a number address is refused');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layers
    (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
     created_by, updated_by)
  values (%L, %L, 'No address', 'arcgis_image', null, 'P', 'https://example.com/t', 'T', '#000000', %L, %L)$$,
  :layer2, :orga, :adam, :adam)), '23514', 'a web service needs its address');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layers
    (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
     created_by, updated_by)
  values (%L, %L, 'WMS', 'wms', 'https://maps.example.com/wms', 'P', 'https://example.com/t', 'T', '#000000', %L, %L)$$,
  :layer2, :orga, :adam, :adam)), '23514', 'a WMS layer needs its layer names');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layers
    (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
     created_by, updated_by)
  values (%L, %L, 'Rail', 'arcgis_features', 'https://maps.example.com/x/FeatureServer/0', 'P', 'https://example.com/t', 'T', 'red', %L, %L)$$,
  :layer2, :orga, :adam, :adam)), '23514', 'a colour that is not #rrggbb is refused');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layers
    (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
     colours, created_by, updated_by)
  values (%L, %L, 'Rail', 'arcgis_features', 'https://maps.example.com/x/FeatureServer/0', 'P', 'https://example.com/t', 'T', '#000000', '[["A","#111111"]]', %L, %L)$$,
  :layer2, :orga, :adam, :adam)), '23514', 'colours by value need the field they come from');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layers
    (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
     created_by, updated_by)
  values (%L, %L, 'Rail', 'arcgis_features', 'https://maps.example.com/x/FeatureServer/0', 'P', 'javascript:alert(1)', 'T', '#000000', %L, %L)$$,
  :layer2, :orga, :adam, :adam)), '23514', 'terms must be a web address');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layers
    (id, organization_id, name, kind, source_url, source_name, terms_url, colour,
     created_by, updated_by)
  values (%L, %L, 'Rail', 'arcgis_features', 'https://maps.example.com/x/FeatureServer/0', 'P', 'https://example.com/t', '#000000', %L, %L)$$,
  :layer2, :orga, :adam, :adam)), '23502', 'a layer is not added without what its terms allow');

-- File layers -------------------------------------------------------------------
select is(pg_temp.api_run(:adam, format($$
  insert into app.map_layers (id, organization_id, name, kind, source_name, terms_url,
    terms_note, colour, created_by, updated_by)
  values (%L, %L, 'Elevators', 'file', 'Synthetic publisher', 'https://example.com/terms',
    'Open licence.', '#123456', %L, %L);
  insert into app.map_layer_files (layer_id, organization_id, file_name, geojson, feature_count)
  values (%L, %L, 'elevators.geojson',
    convert_to('{"type":"FeatureCollection","features":[]}', 'UTF8'), 1)$$,
  :filelayer, :orga, :adam, :adam, :filelayer, :orga)), 'ok 1', 'an admin adds a file layer with its file');
select is(pg_temp.api_count(:victor, format('select 1 from app.map_layer_files where layer_id = %L', :filelayer)), 1,
  'a member reads the file');
select is(pg_temp.api_count(:bob, format('select 1 from app.map_layer_files where layer_id = %L', :filelayer)), 0,
  'another organization''s admin does not read it');
select is(pg_temp.api_run(:bob, format($$insert into app.map_layer_files (layer_id, organization_id, file_name, geojson, feature_count)
  values (%L, %L, 'x.geojson', convert_to('{}', 'UTF8'), 1)$$, :filelayer, :orga)), '42501',
  'another organization''s admin cannot add a file to it');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layer_files (layer_id, organization_id, file_name, geojson, feature_count)
  values (%L, %L, 'x.geojson', convert_to('{}', 'UTF8'), 1)$$, :layer1, :orga)), '42501',
  'a web service layer cannot be given a file');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layer_files (layer_id, organization_id, file_name, geojson, feature_count)
  values (%L, %L, 'x.geojson', convert_to('{}', 'UTF8'), 1)$$, :filelayer, :orga)), '23505',
  'a file layer has one file');
select is(pg_temp.api_run(:adam, format($$insert into app.map_layer_files (layer_id, organization_id, file_name, geojson, feature_count)
  values (%L, %L, 'x.geojson', convert_to('[1]', 'UTF8'), 1)$$, :filelayer, :orga)), '23514',
  'a file must be a JSON object');

-- A file layer without its file is refused when the transaction ends.
select is(pg_temp.api_run(:adam, format($$insert into app.map_layers (id, organization_id, name,
    kind, source_name, terms_url, terms_note, colour, created_by, updated_by)
  values (%L, %L, 'Empty', 'file', 'P', 'https://example.com/t', 'T', '#000000', %L, %L)$$,
  :layer2, :orga, :adam, :adam)), 'ok 1', 'a file layer is written first');
select throws_ok('set constraints all immediate', '23514', 'A file layer needs its file',
  'and refused without its file at the end of the transaction');

-- Changing and removing ----------------------------------------------------------
select is(pg_temp.api_run(:adam, format($$update app.map_layers set name = 'Railways', updated_by = %L,
  colours = '[["AAA", "#000000"]]' where id = %L$$, :adam, :layer1)), 'ok 1',
  'an admin renames a layer and changes its colours');
select is(pg_temp.api_run(:olivia, format($$update app.map_layers set name = 'X', updated_by = %L where id = %L$$,
  :olivia, :layer1)), 'ok 0', 'operations cannot change a layer');
select is(pg_temp.api_run(:bob, format($$update app.map_layers set name = 'X', updated_by = %L where id = %L$$,
  :bob, :layer1)), 'ok 0', 'another organization''s admin cannot change it');
select is(pg_temp.api_run(:adam, format($$update app.map_layers set source_url = 'https://other.example.com/x/MapServer' where id = %L$$,
  :layer1)), '42501', 'a layer''s address cannot be changed');
select is(pg_temp.api_run(:adam, format($$delete from app.map_layers where id = %L$$, :layer1)), '42501',
  'a layer cannot be deleted');
select is(pg_temp.api_run(:bob, format($$update app.map_layers set archived_at = now(), archived_by = %L, updated_by = %L where id = %L$$,
  :bob, :bob, :layer1)), 'ok 0', 'another organization''s admin cannot remove it');
select is(pg_temp.api_run(:adam, format($$update app.map_layers set archived_at = now(), archived_by = %L, updated_by = %L where id = %L$$,
  :victor, :adam, :layer1)), '42501', 'an admin removes a layer only in their own name');
select is(pg_temp.api_run(:adam, format($$update app.map_layers set archived_at = now(), archived_by = %L, updated_by = %L where id = %L$$,
  :adam, :adam, :layer1)), 'ok 1', 'an admin removes a layer');
select is(pg_temp.api_run(:adam, format($$update app.map_layers set name = 'Back', updated_by = %L where id = %L$$,
  :adam, :layer1)), '23514', 'a removed layer stays removed');
select is(pg_temp.api_count(:victor, format('select 1 from app.map_layers where id = %L and archived_at is not null', :layer1)), 1,
  'a removed layer is kept');

-- Audit trail ----------------------------------------------------------------------
select ok(exists (select 1 from app.audit_events where entity = 'map_layers' and entity_id = :layer1::uuid
  and action = 'insert'), 'adding a layer is audited');
select ok(exists (select 1 from app.audit_events where entity = 'map_layers' and entity_id = :layer1::uuid
  and action = 'update' and 'archived_at' = any(changed_fields)), 'removing a layer is audited');

select * from finish();
rollback;
