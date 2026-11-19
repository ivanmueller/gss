-- The oil and gas database (petroleum-staging, F-247): its private schema and the
-- least-privilege role the API Worker uses.
--
-- Access model (docs/DECISIONS.md, 2026-11-18; docs/FEATURES_OIL_GAS.md, F-247):
-- * This database has no users and no sign-in. People sign in through grain's Supabase
--   project; the Worker verifies the session and loads the person's active membership and
--   role there, then opens a transaction here and sets, for that transaction only:
--     select set_config('petro.user_id', '<uuid>', true),
--            set_config('petro.organization_id', '<uuid>', true),
--            set_config('petro.member_role', '<role>', true),
--            set_config('petro.request_id', '<id>', true);
--   Row level security and the write functions read them through the functions below.
--   The values come only from the verified session and membership, never from a request.
-- * Tables live in `petro`, which the Supabase Data API does not expose.
-- * `petro_api` is created NOLOGIN. Each environment enables login with its own password
--   outside migrations, so no credential is ever committed.

-- Present on Supabase; absent in a bare local database (CI), where pgTAP is installed in it.
create schema if not exists extensions;

-- Postgres lets anyone execute a new function by default. Remove that default for every
-- function this migration role creates from now on, in every schema (F-247-1-D1-06); each
-- migration still revokes and grants its own functions explicitly.
alter default privileges revoke execute on functions from public;

create schema petro;
revoke all on schema petro from public;
revoke all on schema petro from anon, authenticated, service_role;

-- Create petro_api, or refuse to continue if a role by that name already holds more than it
-- should. LOGIN is allowed because environments enable it separately.
do $$
declare
  existing pg_roles%rowtype;
begin
  select * into existing from pg_roles where rolname = 'petro_api';
  if not found then
    create role petro_api nologin noinherit;
  elsif existing.rolsuper or existing.rolbypassrls or existing.rolcreaterole
     or existing.rolcreatedb or existing.rolreplication
     or exists (select 1 from pg_auth_members where member = existing.oid) then
    raise exception 'role petro_api already exists with privileges it must not have '
      '(superuser, bypassrls, createrole, createdb, replication or role memberships); '
      'remove them or drop the role before applying this migration';
  end if;
end
$$;

grant usage on schema petro to petro_api;

-- The signed-in person, their organization and their role for this transaction, or null when
-- none is set. An invalid uuid raises an error, so a malformed context fails closed; a role
-- outside the list reads as null.
create function petro.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('petro.user_id', true), '')::uuid
$$;

create function petro.current_organization_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('petro.organization_id', true), '')::uuid
$$;

create function petro.current_member_role()
returns text
language sql
stable
set search_path = ''
as $$
  select r
  from (select nullif(current_setting('petro.member_role', true), '') as r) s
  where r in ('viewer', 'analyst', 'trader', 'operations', 'org_admin')
$$;

-- The schema's version: each later migration that the Worker's code depends on replaces this
-- function with the next number, and the Worker refuses its oil and gas routes ("not ready")
-- while the database is behind the version its code needs (F-247-1-R3-01). Reads nothing.
create function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 1
$$;

revoke all on function petro.current_user_id(), petro.current_organization_id(),
  petro.current_member_role(), petro.schema_version()
  from public, anon, authenticated, service_role;
grant execute on function petro.current_user_id(), petro.current_organization_id(),
  petro.current_member_role(), petro.schema_version()
  to petro_api;
