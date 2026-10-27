-- Private application schema and the least-privilege role the API Worker uses.
--
-- Access model (MASTER_PROJECT_SPECIFICATION.md section 4.3, docs/DECISIONS.md):
-- * Application tables live in `app`, which the Supabase Data API does not expose.
--   Browsers sign in with Supabase Auth but never read or write these tables directly.
-- * The Worker connects as `app_api`. After verifying the caller's Supabase JWT it
--   sets the user for the current transaction only:
--     select set_config('app.user_id', '<auth user uuid>', true);
--   Row level security policies read that value through app.current_user_id().
-- * `app_api` is created NOLOGIN. Each environment enables login with its own
--   password outside migrations, so no credential is ever committed.

create schema app;
revoke all on schema app from public;
revoke all on schema app from anon, authenticated, service_role;

do $$
begin
  if not exists (select from pg_roles where rolname = 'app_api') then
    create role app_api nologin noinherit;
  end if;
end
$$;

grant usage on schema app to app_api;

-- Postgres lets anyone execute a new function by default, and per-schema default
-- privileges cannot remove that. So every migration that adds functions or tables
-- to `app` ends by revoking them from public and the Supabase API roles, then
-- grants app_api exactly what it needs (see the end of each migration).

-- The signed-in user for this transaction, or null when none is set. An invalid
-- value raises an error, so a malformed context fails closed.
create function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

revoke all on function app.current_user_id() from public, anon, authenticated, service_role;
grant execute on function app.current_user_id() to app_api;

create function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function app.touch_updated_at() from public, anon, authenticated, service_role;
