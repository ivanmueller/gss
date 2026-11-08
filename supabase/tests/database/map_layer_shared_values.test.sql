-- A map layer's shared fields and its limit to some features (F-137): who may set them, the
-- values the database refuses, cross-organization denials, file layers, a view's grouping and
-- the audit trail. Runs in one transaction that is rolled back. All fixtures are synthetic.
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

-- A live layer coloured by OWNER, added by the given user.
create function pg_temp.add_service(id text, org text, uid text)
returns text
language sql as $fn$
  select format($q$insert into app.map_layers
      (id, organization_id, name, kind, source_url, source_name, terms_url, terms_note, colour,
       colour_field, colours, created_by, updated_by)
    values (%L, %L, 'Rail lines', 'arcgis_features',
            'https://services.example.com/rest/services/Rail/FeatureServer/0', 'Synthetic publisher',
            'https://example.com/terms', 'Public domain.', '#9ca3af', 'OWNER',
            '[["AAA", "#e6194b"], ["BBB", "#3cb44b"]]', %L, %L)$q$, id, org, uid, uid)
$fn$;

-- Sets a layer's shared fields and limit, given as SQL array expressions.
create function pg_temp.set_shared(id text, uid text, also text, only_field text, only_values text)
returns text
language sql as $fn$
  select format($q$update app.map_layers set also_fields = %s, only_field = %s, only_values = %s,
      updated_by = %L where id = %L$q$,
    also, coalesce(quote_literal(only_field), 'null'), only_values, uid, id)
$fn$;

\set adam '''00000000-0000-4000-8000-0000000022aa'''
\set olivia '''00000000-0000-4000-8000-0000000011aa'''
\set bob '''00000000-0000-4000-8000-0000000011bb'''
\set orga '''00000000-0000-4000-8000-0000000000aa'''
\set orgb '''00000000-0000-4000-8000-0000000000bb'''
\set layer1 '''00000000-0000-4000-8000-0000000a1a01'''
\set filelayer '''00000000-0000-4000-8000-0000000a1a09'''
\set blayer '''00000000-0000-4000-8000-0000000b1b01'''

select is(pg_temp.api_run(:adam, pg_temp.add_service(:layer1, :orga, :adam)), 'ok 1', 'a live layer');
select is(pg_temp.api_run(:bob, pg_temp.add_service(:blayer, :orgb, :bob)), 'ok 1', 'org B''s layer');

select is(pg_temp.api_run(:adam, pg_temp.set_shared(:layer1, :adam,
  'array[''RROWNER2'',''RROWNER3'',''TRKRGHTS1'']', 'NET', 'array[''M'',''I'']')), 'ok 1',
  'an admin counts shared fields and limits the layer to main lines and industry track');
select is((select also_fields from app.map_layers where id = :layer1::uuid),
  array['RROWNER2','RROWNER3','TRKRGHTS1'], 'the shared fields are kept in order');
select is(pg_temp.api_run(:olivia, pg_temp.set_shared(:layer1, :olivia, '''{}''::text[]', null, '''{}''::text[]')),
  'ok 0', 'operations cannot change them');
select is(pg_temp.api_run(:bob, pg_temp.set_shared(:layer1, :bob, '''{}''::text[]', null, '''{}''::text[]')),
  'ok 0', 'another organization''s admin cannot change them');
select is(pg_temp.api_run(:adam, pg_temp.set_shared(:layer1, :adam, 'array[''bad|field'']', null, '''{}''::text[]')),
  '23514', 'a field name with a separator is refused');
select is(pg_temp.api_run(:adam, pg_temp.set_shared(:layer1, :adam, 'array[null]::text[]', null, '''{}''::text[]')),
  '23514', 'an empty field is refused');
select is(pg_temp.api_run(:adam, pg_temp.set_shared(:layer1, :adam, '''{}''::text[]', 'NET', '''{}''::text[]')),
  '23514', 'a limit needs its values');
select is(pg_temp.api_run(:adam, pg_temp.set_shared(:layer1, :adam, '''{}''::text[]', 'NET', 'array[''M'''' OR 1=1'']')),
  '23514', 'a value that could change the service''s query is refused');
select is(pg_temp.api_run(:adam, pg_temp.set_shared(:layer1, :adam,
  '(select array_agg(''F'' || g) from generate_series(1, 17) g)', null, '''{}''::text[]')),
  '23514', 'at most 16 shared fields');
select is(pg_temp.api_run(:adam, format($q$update app.map_layers set colour_field = null, colours = '[]',
  updated_by = %L where id = %L$q$, :adam, :layer1)), '23514',
  'shared fields need the field they add to');

-- A file layer takes none of this.
select is(pg_temp.api_run(:adam, format($q$insert into app.map_layers (id, organization_id, name, kind,
    source_name, terms_url, terms_note, colour, colour_field, colours, also_fields, created_by, updated_by)
  values (%L, %L, 'F', 'file', 'P', 'https://example.com/t', 'T', '#000000', 'OWNER', '[["A","#111111"]]',
    array['OWNER2'], %L, %L)$q$, :filelayer, :orga, :adam, :adam)), '23514',
  'a file layer has no shared fields');

-- Privileges and the audit trail.
select ok(has_column_privilege('app_api', 'app.map_layer_overviews', 'grouping', 'update')
  and has_column_privilege('app_api', 'app.map_layers', 'also_fields', 'update')
  and has_column_privilege('app_api', 'app.map_layers', 'only_values', 'update'),
  'app_api sets the new columns');
select ok(not has_table_privilege('anon', 'app.map_layers', 'select')
  and not has_table_privilege('authenticated', 'app.map_layer_overviews', 'select'),
  'the Supabase API roles still read nothing');
select ok(exists (select 1 from app.audit_events where entity = 'map_layers' and entity_id = :layer1::uuid
  and 'also_fields' = any(changed_fields)), 'changing the shared fields is audited');

select * from finish();
rollback;
