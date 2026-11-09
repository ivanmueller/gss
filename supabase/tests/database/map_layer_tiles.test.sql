-- Pre-drawn ArcGIS picture layers and which of a map's layers it shows at first (F-141): who may
-- add them, the values the database refuses, that they are never changed afterwards, and
-- cross-organization denials. Runs in one transaction that is rolled back. All fixtures are
-- synthetic.
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

-- A picture layer of the given kind, with extra columns and values as SQL text.
create function pg_temp.add_picture(id text, org text, uid text, kind text, cols text, vals text)
returns text
language sql as $fn$
  select format($q$insert into app.map_layers
      (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
       created_by, updated_by, %s)
    values (%L, %L, 'Crop density', %L,
            'https://tiles.example.com/tiles/x/arcgis/rest/services/Crops/MapServer',
            'Synthetic publisher', 'https://example.com/terms', 'Open licence.', '#2f6baa',
            %L, %L, %s)$q$,
    cols, id, org, kind, uid, uid, vals)
$fn$;

\set adam '''00000000-0000-4000-8000-0000000022aa'''
\set olivia '''00000000-0000-4000-8000-0000000011aa'''
\set bob '''00000000-0000-4000-8000-0000000011bb'''
\set orga '''00000000-0000-4000-8000-0000000000aa'''
\set orgb '''00000000-0000-4000-8000-0000000000bb'''
\set tiles1 '''00000000-0000-4000-8000-0000000a3a01'''
\set tiles2 '''00000000-0000-4000-8000-0000000a3a02'''
\set image1 '''00000000-0000-4000-8000-0000000a3a03'''

select is(pg_temp.api_run(:adam, pg_temp.add_picture(:tiles1, :orga, :adam, 'arcgis_tiles',
  'tile_min_level, tile_max_level, map_visible', '3, 10, false')), 'ok 1',
  'an admin adds a pre-drawn layer with its levels, off at first');
select is((select row(kind, tile_min_level, tile_max_level, map_visible)::text
  from app.map_layers where id = :tiles1::uuid), '(arcgis_tiles,3,10,f)', 'its levels are kept');
select is(pg_temp.api_run(:olivia, pg_temp.add_picture(:tiles2, :orga, :olivia, 'arcgis_tiles',
  'tile_min_level, tile_max_level', '3, 10')), '42501', 'operations cannot add one');
select is(pg_temp.api_run(:bob, pg_temp.add_picture(:tiles2, :orga, :bob, 'arcgis_tiles',
  'tile_min_level, tile_max_level', '3, 10')), '42501',
  'another organization''s admin cannot add one to org A');
select is(pg_temp.api_run(:bob, format('select 1 from app.map_layers where id = %L', :tiles1)),
  'ok 0', 'another organization''s admin does not see it');

-- Values the database refuses.
select is(pg_temp.api_run(:adam, pg_temp.add_picture(:tiles2, :orga, :adam, 'arcgis_tiles',
  'map_visible', 'true')), '23514', 'a pre-drawn layer has its levels');
select is(pg_temp.api_run(:adam, pg_temp.add_picture(:tiles2, :orga, :adam, 'arcgis_tiles',
  'tile_min_level, tile_max_level', '10, 3')), '23514', 'its levels are in order');
select is(pg_temp.api_run(:adam, pg_temp.add_picture(:tiles2, :orga, :adam, 'arcgis_tiles',
  'tile_min_level, tile_max_level', '3, 24')), '23514', 'its levels are those of web maps');
select is(pg_temp.api_run(:adam, pg_temp.add_picture(:tiles2, :orga, :adam, 'arcgis_tiles',
  'tile_min_level', '3')), '23514', 'both levels or neither');
select is(pg_temp.api_run(:adam, pg_temp.add_picture(:image1, :orga, :adam, 'arcgis_image',
  'tile_min_level, tile_max_level', '3, 10')), '23514', 'only a pre-drawn layer has levels');
select is(pg_temp.api_run(:adam, pg_temp.add_picture(:image1, :orga, :adam, 'arcgis_image',
  'map_visible', 'true')), 'ok 1', 'a picture layer drawn on request still takes no levels');
select is(pg_temp.api_run(:adam, pg_temp.add_picture(:tiles2, :orga, :adam, 'vector_tiles',
  'map_visible', 'true')), '23514', 'only the kinds GSS draws');

-- Set when added, never changed.
select is(pg_temp.api_run(:adam, format('update app.map_layers set tile_max_level = 12 where id = %L', :tiles1)),
  '42501', 'its levels are not changed afterwards');
select is(pg_temp.api_run(:adam, format('update app.map_layers set map_visible = true where id = %L', :tiles1)),
  '42501', 'nor whether its map shows it at first');
select is(pg_temp.api_run(:adam, format($q$update app.map_layers set name = 'Renamed', updated_by = %L
  where id = %L$q$, :adam, :tiles1)), 'ok 1', 'its name is still changed');
select ok(not has_table_privilege('anon', 'app.map_layers', 'select')
  and not has_table_privilege('authenticated', 'app.map_layers', 'insert'),
  'the Supabase API roles still read and write nothing');

select * from finish();
rollback;
