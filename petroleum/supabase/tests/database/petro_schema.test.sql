-- The oil and gas database's schema, role and context functions (F-247-1): who may use them,
-- what the context functions read, and the closed default for new functions (F-247-1-D1-06).
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(22);

-- The role.
select ok(exists (select 1 from pg_roles where rolname = 'petro_api'), 'petro_api exists');
select ok(
  (select not rolcanlogin from pg_roles where rolname = 'petro_api'),
  'petro_api has no login from migrations'
);
select ok(
  (select not (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)
   from pg_roles where rolname = 'petro_api'),
  'petro_api holds no special privileges'
);

-- The schema.
select ok(has_schema_privilege('petro_api', 'petro', 'usage'), 'petro_api uses the petro schema');
select ok(not has_schema_privilege('public', 'petro', 'usage'), 'public cannot use the petro schema');
select ok(not has_schema_privilege('anon', 'petro', 'usage'), 'anon cannot use the petro schema');
select ok(not has_schema_privilege('authenticated', 'petro', 'usage'), 'authenticated cannot use the petro schema');
select ok(not has_schema_privilege('service_role', 'petro', 'usage'), 'service_role cannot use the petro schema');
select ok(not has_schema_privilege('petro_api', 'petro', 'create'), 'petro_api cannot create in the petro schema');

-- The functions: petro_api only.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'petro'
     and (has_function_privilege('public', p.oid, 'execute')
       or has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or has_function_privilege('service_role', p.oid, 'execute'))),
  0,
  'no petro function is executable by public, anon, authenticated or service_role'
);
select ok(has_function_privilege('petro_api', 'petro.current_organization_id()', 'execute'),
  'petro_api runs petro.current_organization_id()');
select ok(has_function_privilege('petro_api', 'petro.ready()', 'execute'), 'petro_api runs petro.ready()');

-- A function created after the migration, by the migration role, is not executable by public
-- (the default privilege), even outside the petro schema.
create function public.f247_later_function() returns int language sql as $$ select 1 $$;
select ok(
  not has_function_privilege('public', 'public.f247_later_function()', 'execute'),
  'a later function is not executable by public by default'
);
select ok(
  not has_function_privilege('anon', 'public.f247_later_function()', 'execute'),
  'nor by anon through public'
);

-- The context functions, run as petro_api (which cannot use pgTAP's schema), read back as the
-- test role.
-- The test role (postgres, which ran the migrations) may switch to petro_api inside this
-- rolled-back transaction only.
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

select is(pg_temp.as_petro('select petro.current_user_id()::text'), null, 'no user without the setting');
select is(pg_temp.as_petro('select petro.current_organization_id()::text'), null,
  'no organization without the setting');
select is(pg_temp.as_petro('select petro.current_member_role()'), null, 'no role without the setting');
select is(pg_temp.as_petro('select petro.ready()::text'), 'true', 'ready');

select set_config('petro.user_id', '00000000-0000-4000-8000-0000000000a1', true),
       set_config('petro.organization_id', '00000000-0000-4000-8000-0000000000b1', true),
       set_config('petro.member_role', 'org_admin', true);
select is(pg_temp.as_petro('select petro.current_organization_id()::text'),
  '00000000-0000-4000-8000-0000000000b1', 'the organization set for the transaction');
select is(pg_temp.as_petro('select petro.current_member_role()'), 'org_admin',
  'the role set for the transaction');

select set_config('petro.member_role', 'superuser', true);
select is(pg_temp.as_petro('select petro.current_member_role()'), null,
  'a role outside the list reads as null');

select set_config('petro.user_id', 'not-a-uuid', true);
select throws_ok($$select pg_temp.as_petro('select petro.current_user_id()::text')$$, '22P02', null,
  'a malformed user id fails closed');

select * from finish();
rollback;
