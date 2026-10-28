-- Tenant isolation for organizations and memberships.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- Fixtures ------------------------------------------------------------------
-- Users: alice (active trader in A, active viewer in inactive org C),
-- bob (active admin in B), carol (suspended in A), dave (invited to B).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a11c', 'alice@example.test'),
  ('00000000-0000-4000-8000-000000000b0b', 'bob@example.test'),
  ('00000000-0000-4000-8000-0000000ca201', 'carol@example.test'),
  ('00000000-0000-4000-8000-00000000da7e', 'dave@example.test');

insert into app.organizations (id, display_name, active) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A', true),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B', true),
  ('00000000-0000-4000-8000-0000000000cc', 'Synthetic Org C (inactive)', false);

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a11c', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca201', 'viewer', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-000000000b0b', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000da7e', 'analyst', 'invited', null),
  ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-00000000a11c', 'viewer', 'active', now());

-- Test-only setup, rolled back with the transaction. Supabase's `postgres` is not a
-- superuser, and since Postgres 16 creating a role grants ADMIN on it but not the
-- right to SET ROLE to it, so grant that here.
grant app_api to current_user;

-- Helpers (session temp schema). They switch to app_api only around the query
-- itself, so every pgTAP assertion runs as the test owner and app_api never needs
-- access to the extensions schema where pgTAP lives.
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

create function pg_temp.api_count(uid text, query text) returns int
language sql as $fn$
  select jsonb_array_length(pg_temp.api_rows(uid, query))
$fn$;

create function pg_temp.api_exec(uid text, statement text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute statement;
  reset role;
  perform set_config('app.user_id', '', true);
end
$fn$;

-- Structure and privileges ---------------------------------------------------
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'every table in app has row level security enabled'
);
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon cannot use the app schema');
select ok(not has_schema_privilege('authenticated', 'app', 'usage'), 'authenticated cannot use the app schema');
select ok(not has_schema_privilege('service_role', 'app', 'usage'), 'service_role cannot use the app schema');
select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'app' and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  0,
  'no table in app is granted to public or the Supabase API roles'
);
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute'))),
  0,
  'no function in app is executable by the Supabase API roles'
);
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proacl is null),
  0,
  'every function in app has explicit privileges (none left on the public default)'
);
select ok(
  (select not rolsuper and not rolbypassrls from pg_roles where rolname = 'app_api'),
  'app_api is not superuser and cannot bypass RLS'
);
select ok(
  (select not rolcanlogin from pg_roles where rolname = 'app_api'),
  'migrations do not give app_api a login (each environment enables it separately)'
);
select ok(
  (select not rolcreaterole and not rolcreatedb and not rolreplication from pg_roles where rolname = 'app_api'),
  'app_api cannot create roles or databases or replicate'
);
select is(
  (select count(*)::int from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'app_api'),
  0,
  'app_api is not a member of any other role'
);
select ok(not has_schema_privilege('app_api', 'auth', 'usage'), 'app_api cannot use the auth schema');
select ok(
  not has_table_privilege('app_api', 'app.organizations', 'insert, update, delete, truncate'),
  'app_api cannot write organizations'
);
select ok(
  not has_table_privilege('app_api', 'app.organization_members', 'insert, update, delete, truncate'),
  'app_api cannot write memberships'
);
select ok(
  not has_function_privilege('public', 'app.is_active_member(uuid)', 'execute'),
  'public cannot call app.is_active_member'
);
select ok(
  has_function_privilege('app_api', 'app.is_active_member(uuid)', 'execute'),
  'app_api can call app.is_active_member'
);
select ok(
  has_table_privilege('app_api', 'app.organizations', 'select')
    and has_table_privilege('app_api', 'app.organization_members', 'select'),
  'app_api can read organizations and memberships'
);
select ok(
  not has_function_privilege('app_api', 'app.touch_updated_at()', 'execute'),
  'app_api cannot call the updated_at trigger function directly'
);

-- Constraints -------------------------------------------------------------------
select throws_ok(
  $$insert into app.organization_members (organization_id, user_id, role, status, joined_at)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a11c', 'viewer', 'active', now())$$,
  '23505', null, 'a user can be a member of an organization only once'
);
select throws_ok(
  $$insert into app.organization_members (organization_id, user_id, role, status, joined_at)
    values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000ca201', 'viewer', 'invited', now())$$,
  '23514', null, 'an invited member cannot have a joined_at'
);
select throws_ok(
  $$insert into app.organization_members (organization_id, user_id, role, status)
    values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000ca201', 'viewer', 'active')$$,
  '23514', null, 'an active member must have a joined_at'
);
select throws_ok(
  $$insert into app.organization_members (organization_id, user_id, role, status, joined_at)
    values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000ca201', 'owner', 'active', now())$$,
  '22P02', null, 'roles outside the specification are rejected'
);
select throws_ok(
  $$insert into app.organizations (display_name) values ('   ')$$,
  '23514', null, 'an organization needs a non-blank name'
);

-- As the API role ------------------------------------------------------------------
-- alice 00000000-0000-4000-8000-00000000a11c, bob 00000000-0000-4000-8000-000000000b0b, carol 00000000-0000-4000-8000-0000000ca201, dave 00000000-0000-4000-8000-00000000da7e.

select is(pg_temp.api_count(null, 'select 1 from app.organizations'), 0, 'no user context: no organizations');
select is(pg_temp.api_count(null, 'select 1 from app.organization_members'), 0, 'no user context: no memberships');

-- alice: active in A; also active in C, but C is inactive.
select is(
  pg_temp.api_rows('00000000-0000-4000-8000-00000000a11c', 'select display_name from app.organizations'),
  '[{"display_name": "Synthetic Org A"}]'::jsonb,
  'alice sees only organization A'
);
select is(
  pg_temp.api_rows('00000000-0000-4000-8000-00000000a11c', 'select distinct organization_id from app.organization_members'),
  '[{"organization_id": "00000000-0000-4000-8000-0000000000aa"}]'::jsonb,
  'alice sees memberships of organization A only'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-00000000a11c', 'select 1 from app.organization_members'),
  2,
  'alice sees both members of A (herself and suspended carol)'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-00000000a11c', $$select 1 from app.organizations where id = '00000000-0000-4000-8000-0000000000bb'$$),
  0,
  'alice cannot read organization B by guessing its id'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-00000000a11c', $$select 1 from app.organizations where id = '00000000-0000-4000-8000-0000000000cc'$$),
  0,
  'alice cannot read inactive organization C'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-00000000a11c', $$insert into app.organizations (display_name) values ('Sneaky Org')$$)$q$,
  '42501', null, 'alice cannot create organizations through the API role'
);
select lives_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-00000000a11c', $$update app.organization_members set role = 'org_admin' where user_id = '00000000-0000-4000-8000-00000000a11c'$$)$q$,
  'alice''s attempt to make herself an admin runs (member_management.test.sql covers who may change roles)'
);
select is(
  (select string_agg(role::text, ',' order by organization_id) from app.organization_members
    where user_id = '00000000-0000-4000-8000-00000000a11c'),
  'trader,viewer',
  'alice cannot change her own role through the API role: it is unchanged'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-00000000a11c', 'delete from app.organization_members')$q$,
  '42501', null, 'alice cannot delete memberships through the API role'
);

-- bob: active admin in B.
select is(
  pg_temp.api_rows('00000000-0000-4000-8000-000000000b0b', 'select display_name from app.organizations'),
  '[{"display_name": "Synthetic Org B"}]'::jsonb,
  'bob sees only organization B'
);
select is(
  pg_temp.api_rows('00000000-0000-4000-8000-000000000b0b', 'select distinct organization_id from app.organization_members'),
  '[{"organization_id": "00000000-0000-4000-8000-0000000000bb"}]'::jsonb,
  'bob sees memberships of organization B only'
);

-- carol: suspended in A.
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000ca201', 'select 1 from app.organizations'), 0, 'a suspended member sees no organizations');
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000ca201', 'select 1 from app.organization_members'), 0, 'a suspended member sees no memberships');

-- dave: invited to B, not yet joined.
select is(pg_temp.api_count('00000000-0000-4000-8000-00000000da7e', 'select 1 from app.organizations'), 0, 'an invited member sees no organizations');
select is(
  pg_temp.api_count('00000000-0000-4000-8000-00000000da7e', 'select 1 from app.organization_members'),
  0,
  'an invited member sees no memberships, not even their own'
);

-- A signed-in user with no memberships.
select is(
  pg_temp.api_count('00000000-0000-4000-8000-00000000ffff', 'select 1 from app.organizations'),
  0,
  'a user without memberships sees no organizations'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-00000000ffff', 'select 1 from app.organization_members'),
  0,
  'a user without memberships sees no memberships'
);

-- A malformed user id fails closed.
select throws_ok(
  $q$select pg_temp.api_count('not-a-uuid', 'select 1 from app.organizations')$q$,
  '22P02', null, 'a malformed user context raises an error instead of returning rows'
);
select throws_ok(
  $q$select pg_temp.api_count('not-a-uuid', 'select 1 from app.organization_members')$q$,
  '22P02', null, 'a malformed user context raises an error on memberships too'
);

-- Inactivating an organization removes access at once.
update app.organizations set active = false where id = '00000000-0000-4000-8000-0000000000bb';
select is(pg_temp.api_count('00000000-0000-4000-8000-000000000b0b', 'select 1 from app.organizations'), 0, 'bob loses access when organization B is inactivated');
select is(
  pg_temp.api_count('00000000-0000-4000-8000-000000000b0b', 'select 1 from app.organization_members'),
  0,
  'bob loses membership visibility when organization B is inactivated'
);

select * from finish();
rollback;
