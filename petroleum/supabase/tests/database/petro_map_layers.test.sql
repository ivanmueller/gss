-- Oil and gas map layers (F-247 part 2, 20261119010000_petro_map_layers.sql): who reads and
-- writes them, what never changes, the history, the checks and the ceiling.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(65);

-- Privileges.
select ok(
  has_table_privilege('petro_api', 'petro.map_layers', 'select')
  and has_table_privilege('petro_api', 'petro.map_layers', 'insert'),
  'petro_api reads and adds map layers'
);
select ok(
  not has_table_privilege('petro_api', 'petro.map_layers', 'delete')
  and not has_table_privilege('petro_api', 'petro.map_layers', 'truncate')
  and not has_table_privilege('petro_api', 'petro.map_layers', 'update'),
  'petro_api cannot delete or truncate map layers, nor update every column'
);
select ok(
  has_column_privilege('petro_api', 'petro.map_layers', 'name', 'update')
  and has_column_privilege('petro_api', 'petro.map_layers', 'shown_by_default', 'update')
  and has_column_privilege('petro_api', 'petro.map_layers', 'removed_at', 'update'),
  'petro_api changes a layer''s name and default, and marks it removed'
);
select ok(
  not has_column_privilege('petro_api', 'petro.map_layers', 'organization_id', 'update')
  and not has_column_privilege('petro_api', 'petro.map_layers', 'kind', 'update')
  and not has_column_privilege('petro_api', 'petro.map_layers', 'source_url', 'update')
  and not has_column_privilege('petro_api', 'petro.map_layers', 'created_by', 'update')
  and not has_column_privilege('petro_api', 'petro.map_layers', 'updated_at', 'update'),
  'petro_api cannot change a layer''s organization, kind, address, creator or version'
);
select ok(
  not has_table_privilege('petro_api', 'petro.map_layer_history', 'select')
  and not has_table_privilege('petro_api', 'petro.map_layer_history', 'insert')
  and not has_table_privilege('petro_api', 'petro.map_layer_history', 'update')
  and not has_table_privilege('petro_api', 'petro.map_layer_history', 'delete'),
  'the history is out of petro_api''s reach'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.map_layers', 'petro.map_layer_history']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'public, anon, authenticated and service_role hold nothing on either table'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.map_layers'::regclass, 'petro.map_layer_history'::regclass)),
  'row level security is on for both tables'
);
select ok(
  not has_function_privilege('petro_api', 'petro.record_map_layer_history()', 'execute')
  and not has_function_privilege('petro_api', 'petro.keep_map_layer()', 'execute')
  and not has_function_privilege('petro_api', 'petro.guard_map_layer_count()', 'execute'),
  'petro_api cannot call the trigger functions itself'
);

-- Everything below runs as petro_api with the context the Worker would set.
grant petro_api to current_user;

create function pg_temp.as_petro(query text) returns text
language plpgsql as $fn$
declare
  result text;
begin
  set local role petro_api;
  execute query into result;
  reset role;
  return result;
end
$fn$;

create function pg_temp.be(usr text, org text, member_role text) returns void
language sql as $fn$
  select set_config('petro.user_id', usr, true),
         set_config('petro.organization_id', org, true),
         set_config('petro.member_role', member_role, true),
         set_config('petro.request_id', 'test-request', true);
$fn$;

-- insert ... returning id, as text.
create function pg_temp.adding(org text, usr text, layer_name text) returns text
language sql as $fn$
  select format(
    'insert into petro.map_layers (organization_id, name, kind, source_url, source_name,
       terms_url, terms_note, colour, created_by, updated_by)
     values (%L, %L, ''arcgis_features'',
       ''https://services.example.com/rest/services/Land/MapServer/8'', ''Synthetic publisher'',
       ''https://example.com/terms'', ''Open licence.'', ''#2f6baa'', %L, %L)
     returning id::text',
    org, layer_name, usr, usr)
$fn$;

create function pg_temp.changing(what text, layer_id text) returns text
language sql as $fn$
  select format(
    'with u as (update petro.map_layers set %s where id = %L returning 1)
     select count(*)::text from u', what, layer_id)
$fn$;

\set user_a '00000000-0000-4000-8000-0000000000a1'
\set user_b '00000000-0000-4000-8000-0000000000a2'
\set org_a '00000000-0000-4000-8000-0000000000b1'
\set org_b '00000000-0000-4000-8000-0000000000b2'
\set org_c '00000000-0000-4000-8000-0000000000b3'

-- Without a context nothing is added.
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.adding(:'org_a', :'user_a', 'No context')),
  '42501', null, 'no layer is added without a context'
);

-- An admin adds a layer.
select pg_temp.be(:'user_a', :'org_a', 'org_admin');
create temp table added (id text);
grant select on added to petro_api;
insert into added select pg_temp.as_petro(pg_temp.adding(:'org_a', :'user_a', 'Agreements'));
select ok((select id from added) is not null, 'an admin adds a layer');
select is(
  (select action || ' by ' || changed_by::text || ' in ' || request_id
   from petro.map_layer_history where layer_id = (select id::uuid from added)),
  'added by ' || :'user_a' || ' in test-request',
  'the addition is kept in the history with who and which request'
);
select is(
  (select shown_by_default from petro.map_layers where id = (select id::uuid from added)),
  false, 'a layer is off when the map opens unless an admin says otherwise'
);

select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.adding(:'org_a', :'user_b', 'Someone else')),
  '42501', null, 'an admin adds a layer only in their own name'
);
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.adding(:'org_b', :'user_a', 'Elsewhere')),
  '42501', null, 'an admin adds no layer to another organization'
);

-- Every member reads; only admins write.
select pg_temp.be(:'user_b', :'org_a', 'viewer');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '1', 'a viewer reads the layers');
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.adding(:'org_a', :'user_b', 'By a viewer')),
  '42501', null, 'a viewer adds nothing'
);
select is(pg_temp.as_petro(pg_temp.changing('name = ''Renamed''', (select id from added))), '0',
  'a viewer changes nothing');
select pg_temp.be(:'user_b', :'org_a', 'analyst');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '1', 'an analyst reads the layers');
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.adding(:'org_a', :'user_b', 'By an analyst')),
  '42501', null, 'an analyst adds nothing'
);
select pg_temp.be(:'user_b', :'org_a', 'trader');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '1', 'a trader reads the layers');
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.adding(:'org_a', :'user_b', 'By a trader')),
  '42501', null, 'a trader adds nothing'
);
select is(pg_temp.as_petro(pg_temp.changing('removed_at = now(), removed_by = ''' || :'user_b' || '''',
  (select id from added))), '0', 'a trader removes nothing');
select pg_temp.be(:'user_b', :'org_a', 'operations');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '1', 'operations reads the layers');
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.adding(:'org_a', :'user_b', 'By operations')),
  '42501', null, 'operations adds nothing'
);

-- An incomplete or foreign context reads nothing.
select pg_temp.be(:'user_b', :'org_a', 'superuser');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '0',
  'a role outside the list reads nothing');
select pg_temp.be(:'user_b', :'org_a', '');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '0', 'no role reads nothing');
select pg_temp.be('', :'org_a', 'viewer');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '0',
  'an organization and a role without a person read nothing (F-247-2-D1-01)');
select pg_temp.be('', :'org_a', 'org_admin');
select is(pg_temp.as_petro(pg_temp.changing('name = ''Renamed''', (select id from added))), '0',
  'an admin role without a person changes nothing');
select pg_temp.be(:'user_b', '', 'org_admin');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '0',
  'no organization reads nothing');

-- Another organization's admin neither sees nor changes it.
select pg_temp.be(:'user_b', :'org_b', 'org_admin');
select is(pg_temp.as_petro('select count(*)::text from petro.map_layers'), '0',
  'another organization''s admin reads nothing of it');
select is(pg_temp.as_petro(pg_temp.changing('name = ''Taken''', (select id from added))), '0',
  'another organization''s admin changes nothing of it');
select is(pg_temp.as_petro(pg_temp.changing(
  'removed_at = now(), removed_by = ''' || :'user_b' || '''', (select id from added))), '0',
  'another organization''s admin removes nothing of it');

-- An admin changes a layer: a new version each time, kept in the history.
select pg_temp.be(:'user_a', :'org_a', 'org_admin');
create temp table versions as
  select updated_at as before from petro.map_layers where id = (select id::uuid from added);
select is(pg_temp.as_petro(pg_temp.changing(
  'name = ''Crown agreements'', shown_by_default = true, updated_by = ''' || :'user_a' || '''',
  (select id from added))), '1', 'an admin changes a layer''s name and default');
select ok(
  (select updated_at > (select before from versions) from petro.map_layers
   where id = (select id::uuid from added)),
  'each change gets a later version'
);
select is(
  (select array_agg(action || ':' || (snapshot ->> 'name') order by id)
   from petro.map_layer_history where layer_id = (select id::uuid from added)),
  array['added:Agreements', 'changed:Crown agreements'],
  'the change is kept in the history as the layer stood after it'
);
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.changing(
    'name = ''Again'', updated_by = ''' || :'user_b' || '''', (select id from added))),
  '42501', null, 'an admin changes a layer only in their own name'
);
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.changing(
    'source_url = ''https://other.example.com/rest/services/X/MapServer/1''',
    (select id from added))),
  '42501', null, 'petro_api cannot change a layer''s address'
);
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.changing(
    'removed_at = now(), removed_by = ''' || :'user_b' || ''', updated_by = ''' || :'user_a' || '''',
    (select id from added))),
  '42501', null, 'an admin removes a layer only in their own name'
);
select throws_ok(
  format('select pg_temp.as_petro(%L)',
    'delete from petro.map_layers where id = ''' || (select id from added) || ''' returning 1'),
  '42501', null, 'nobody deletes a layer'
);
select throws_ok(
  $$select pg_temp.as_petro('select count(*)::text from petro.map_layer_history')$$,
  '42501', null, 'petro_api cannot read the history'
);

-- What never changes, whoever asks (the trigger, tried as the tables' owner).
select throws_ok(
  format('update petro.map_layers set kind = ''arcgis_image'' where id = %L', (select id from added)),
  '23514', null, 'a layer keeps its kind'
);
select throws_ok(
  format('update petro.map_layers set organization_id = %L where id = %L', :'org_b', (select id from added)),
  '23514', null, 'a layer keeps its organization'
);
select throws_ok(
  format('update petro.map_layers set source_url = ''https://other.example.com/x'' where id = %L',
    (select id from added)),
  '23514', null, 'a layer keeps its address'
);
select throws_ok(
  format('update petro.map_layers set created_by = %L where id = %L', :'user_b', (select id from added)),
  '23514', null, 'a layer keeps who added it'
);

-- Removing marks the layer; it stays removed and unchanged.
select is(pg_temp.as_petro(pg_temp.changing(
  'removed_at = now(), removed_by = ''' || :'user_a' || ''', updated_by = ''' || :'user_a' || '''',
  (select id from added))), '1', 'an admin removes a layer');
select is(
  (select action from petro.map_layer_history
   where layer_id = (select id::uuid from added) order by id desc limit 1),
  'removed', 'the removal is kept in the history'
);
select is(
  (select count(*)::int from petro.map_layers where id = (select id::uuid from added)),
  1, 'a removed layer is kept'
);
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.changing(
    'name = ''Back'', updated_by = ''' || :'user_a' || '''', (select id from added))),
  '23514', null, 'a removed layer is not changed'
);
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.changing(
    'removed_at = null, removed_by = null, updated_by = ''' || :'user_a' || '''',
    (select id from added))),
  '23514', null, 'a removed layer is not brought back'
);

-- The checks (as the tables' owner, so only the constraints answer).
create function pg_temp.row_with(col text, val text) returns text
language sql as $fn$
  select format(
    'insert into petro.map_layers (organization_id, name, kind, source_url, source_name,
       terms_url, terms_note, colour, created_by, updated_by, %s)
     values (''00000000-0000-4000-8000-0000000000b2'', ''Checked'', ''arcgis_features'',
       ''https://services.example.com/rest/services/Land/MapServer/8'', ''Synthetic publisher'',
       ''https://example.com/terms'', ''Open licence.'', ''#2f6baa'',
       ''00000000-0000-4000-8000-0000000000a1'', ''00000000-0000-4000-8000-0000000000a1'', %s)',
    col, val)
$fn$;
select lives_ok(pg_temp.row_with('opacity', '0.5'), 'a well-formed layer passes the checks');
select throws_ok(
  $$insert into petro.map_layers (organization_id, name, kind, source_url, source_name,
      terms_url, terms_note, colour, created_by, updated_by)
    values ('00000000-0000-4000-8000-0000000000b2', 'A WMS', 'wms',
      'https://maps.example.com/wms', 'Synthetic publisher', 'https://example.com/terms',
      'Open licence.', '#2f6baa', '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000a1')$$,
  '23514', null, 'only ArcGIS kinds are kept'
);
select throws_ok(
  $$insert into petro.map_layers (organization_id, name, kind, source_url, source_name,
      terms_url, terms_note, colour, created_by, updated_by)
    values ('00000000-0000-4000-8000-0000000000b2', 'Plain http', 'arcgis_features',
      'http://services.example.com/rest/services/Land/MapServer/8', 'Synthetic publisher',
      'https://example.com/terms', 'Open licence.', '#2f6baa',
      '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1')$$,
  '23514', null, 'an address is https only'
);
select throws_ok(pg_temp.row_with('line_width', '0'), '23514', null, 'a line width is positive');
select throws_ok(pg_temp.row_with('colours', '''[["A", "#ffffff"]]'''), '23514', null,
  'colours by value need the field they colour by');
select throws_ok(pg_temp.row_with('min_zoom, max_zoom', '9, 4'), '23514', null,
  'the zoom range is in order');
select throws_ok(pg_temp.row_with('tile_min_level, tile_max_level', '0, 5'), '23514', null,
  'only a pre-drawn layer has levels');
select throws_ok(pg_temp.row_with('definition_expression', '''A = 1; drop'''), '23514', null,
  'a filter holds no statement separator');
select throws_ok(pg_temp.row_with('definition_expression', '''(A = 1'''), '23514', null,
  'a filter closes its brackets');
select throws_ok(pg_temp.row_with('only_values', 'array[''M'']'), '23514', null,
  'values to keep need their field');
select throws_ok(pg_temp.row_with('removed_at', 'now()'), '23514', null,
  'a removal names who removed it');

-- The ceiling: 200 layers not removed per organization.
insert into petro.map_layers (organization_id, name, kind, source_url, source_name, terms_url,
  terms_note, colour, created_by, updated_by)
select :'org_c', 'Layer ' || n, 'arcgis_features',
  'https://services.example.com/rest/services/Land/MapServer/8', 'Synthetic publisher',
  'https://example.com/terms', 'Open licence.', '#2f6baa', :'user_a', :'user_a'
from generate_series(1, 200) as n;
select is(
  (select count(*)::int from petro.map_layers where organization_id = :'org_c'),
  200, 'an organization keeps 200 layers'
);
select pg_temp.be(:'user_a', :'org_c', 'org_admin');
select throws_ok(
  format('select pg_temp.as_petro(%L)', pg_temp.adding(:'org_c', :'user_a', 'One too many')),
  'PT001', null, 'the 201st layer is refused'
);
select pg_temp.be(:'user_a', :'org_a', 'org_admin');
select ok(
  pg_temp.as_petro(pg_temp.adding(:'org_a', :'user_a', 'Elsewhere is not full')) is not null,
  'another organization''s ceiling is its own'
);
update petro.map_layers set removed_at = now(), removed_by = :'user_a'
where organization_id = :'org_c' and name = 'Layer 1';
select pg_temp.be(:'user_a', :'org_c', 'org_admin');
select ok(
  pg_temp.as_petro(pg_temp.adding(:'org_c', :'user_a', 'In the freed place')) is not null,
  'a removed layer frees its place'
);

select is(pg_temp.as_petro('select petro.schema_version()::text'), '2', 'schema version 2');

select * from finish();
rollback;
