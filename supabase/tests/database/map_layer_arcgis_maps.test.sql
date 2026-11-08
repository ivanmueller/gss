-- Layers from an ArcGIS map with ArcGIS's drawing (F-138): who may add them, the values the
-- database refuses, that they are never changed afterwards, and cross-organization denials. Runs
-- in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

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

-- A live layer from an ArcGIS map, with ArcGIS's drawing; extra columns and values as SQL text.
create function pg_temp.add_from_map(id text, org text, uid text, cols text, vals text)
returns text
language sql as $fn$
  select format($q$insert into app.map_layers
      (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
       created_by, updated_by, %s)
    values (%L, %L, 'CPKC', 'arcgis_features',
            'https://services.example.com/rest/services/Rail/FeatureServer/0', 'Synthetic publisher',
            'https://example.com/terms', 'Public domain.', '#ff73df', %L, %L, %s)$q$,
    cols, id, org, uid, uid, vals)
$fn$;

\set adam '''00000000-0000-4000-8000-0000000022aa'''
\set olivia '''00000000-0000-4000-8000-0000000011aa'''
\set bob '''00000000-0000-4000-8000-0000000011bb'''
\set orga '''00000000-0000-4000-8000-0000000000aa'''
\set orgb '''00000000-0000-4000-8000-0000000000bb'''
\set layer1 '''00000000-0000-4000-8000-0000000a2a01'''
\set layer2 '''00000000-0000-4000-8000-0000000a2a02'''
\set layer3 '''00000000-0000-4000-8000-0000000a2a03'''
\set full_cols '''line_width, opacity, min_zoom, max_zoom, definition_expression, others_shown, map_item_id, map_title'''
\set full_vals '''0.998, 0.8, 3, 18, ''''NET IN (''''''''M'''''''',''''''''I'''''''')'''', false, ''''96ec03e4fc8546bd8a864e39a2c3fc41'''', ''''Synthetic rail map'''''''

select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer1, :orga, :adam, :full_cols, :full_vals)),
  'ok 1', 'an admin adds a layer from an ArcGIS map with its drawing');
select is((select row(line_width, opacity, min_zoom, max_zoom, definition_expression, others_shown,
    map_item_id, map_title)::text from app.map_layers where id = :layer1::uuid),
  '(0.998,0.8,3,18,"NET IN (''M'',''I'')",f,96ec03e4fc8546bd8a864e39a2c3fc41,"Synthetic rail map")',
  'its drawing and map are kept');
select is(pg_temp.api_run(:olivia, pg_temp.add_from_map(:layer2, :orga, :olivia, :full_cols, :full_vals)),
  '42501', 'operations cannot add one');
select is(pg_temp.api_run(:bob, pg_temp.add_from_map(:layer2, :orga, :bob, :full_cols, :full_vals)),
  '42501', 'another organization''s admin cannot add one to org A');
select is(pg_temp.api_run(:bob, format('select 1 from app.map_layers where id = %L', :layer1)),
  'ok 0', 'another organization''s admin does not see it');

-- Set when added, never changed.
select is(pg_temp.api_run(:adam, format('update app.map_layers set line_width = 3 where id = %L', :layer1)),
  '42501', 'its line width is not changed afterwards');
select is(pg_temp.api_run(:adam, format('update app.map_layers set definition_expression = null where id = %L', :layer1)),
  '42501', 'its filter is not changed afterwards');
select is(pg_temp.api_run(:adam, format('update app.map_layers set map_item_id = null, map_title = null where id = %L', :layer1)),
  '42501', 'its map is not changed afterwards');

-- Values the database refuses.
select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer2, :orga, :adam, 'opacity', '0')),
  '23514', 'a layer is not wholly see-through');
select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer2, :orga, :adam, 'line_width', '0')),
  '23514', 'a line has a width');
select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer2, :orga, :adam, 'min_zoom, max_zoom', '9, 4')),
  '23514', 'its zoom range is in order');
select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer2, :orga, :adam, 'definition_expression',
  $$'1=1; drop table app.map_layers'$$)), '23514', 'a filter with a statement separator is refused');
select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer2, :orga, :adam, 'definition_expression',
  $$'1=1 -- x'$$)), '23514', 'a filter with a comment is refused');
select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer2, :orga, :adam, 'map_item_id', $$'96ec03e4fc8546bd8a864e39a2c3fc41'$$)),
  '23514', 'a map is kept with its title');
select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer2, :orga, :adam, 'map_item_id, map_title',
  $$'../items/x', 'M'$$)), '23514', 'a map''s id is 32 hexadecimal digits');
select is(pg_temp.api_run(:adam, format($q$insert into app.map_layers (id, organization_id, name, kind,
    source_name, terms_url, terms_note, colour, definition_expression, created_by, updated_by)
  values (%L, %L, 'F', 'file', 'P', 'https://example.com/t', 'T', '#000000', '1=1', %L, %L)$q$,
  :layer3, :orga, :adam, :adam)), '23514', 'a file layer has no filter');

-- Defaults for a layer added by hand, privileges.
select is(pg_temp.api_run(:adam, pg_temp.add_from_map(:layer2, :orga, :adam, 'opacity', 'default')),
  'ok 1', 'a layer added by hand');
select is((select row(line_width, opacity, min_zoom, max_zoom, others_shown, map_item_id)::text
  from app.map_layers where id = :layer2::uuid), '(,1,,,t,)', 'takes GSS''s usual drawing');
select ok(not has_column_privilege('app_api', 'app.map_layers', 'opacity', 'update')
  and not has_column_privilege('app_api', 'app.map_layers', 'map_title', 'update')
  and not has_column_privilege('app_api', 'app.map_layers', 'others_shown', 'update'),
  'app_api changes none of the new columns');
select ok(not has_table_privilege('anon', 'app.map_layers', 'select')
  and not has_table_privilege('authenticated', 'app.map_layers', 'insert'),
  'the Supabase API roles still read and write nothing');

select * from finish();
rollback;
