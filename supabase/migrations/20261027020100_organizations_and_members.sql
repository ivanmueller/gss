-- Organizations and memberships (GT-013), MASTER_PROJECT_SPECIFICATION.md sections 2.1 and 6.
-- Read-only for the API in this migration: organizations are provisioned by operators,
-- and member management arrives with the admin API.

create type app.member_role as enum ('viewer', 'analyst', 'trader', 'operations', 'org_admin');
create type app.member_status as enum ('invited', 'active', 'suspended');

create table app.organizations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  brand_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(brand_settings) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create table app.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  user_id uuid not null references auth.users (id),
  role app.member_role not null,
  status app.member_status not null default 'invited',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (organization_id, user_id),
  -- Invited members have not joined yet; active and suspended members have.
  check ((status = 'invited') = (joined_at is null))
);

create index organization_members_user_id_idx on app.organization_members (user_id);

create trigger organizations_touch_updated_at
  before update on app.organizations
  for each row execute function app.touch_updated_at();

create trigger organization_members_touch_updated_at
  before update on app.organization_members
  for each row execute function app.touch_updated_at();

-- True when the current user is an active member of an active organization.
-- SECURITY DEFINER so policies on organization_members can call it without
-- recursing into their own row level security; it only ever answers for the
-- user set in app.user_id.
create function app.is_active_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.organization_members m
    join app.organizations o on o.id = m.organization_id
    where m.organization_id = org
      and m.user_id = app.current_user_id()
      and m.status = 'active'
      and o.active
  )
$$;

alter table app.organizations enable row level security;
alter table app.organization_members enable row level security;

create policy organizations_select_for_members on app.organizations
  for select to app_api
  using (app.is_active_member(id));

create policy organization_members_select_same_org on app.organization_members
  for select to app_api
  using (app.is_active_member(organization_id));

-- Privileges: nothing for public or the Supabase API roles; read-only for app_api.
revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all functions in schema app from public, anon, authenticated, service_role;
grant select on app.organizations, app.organization_members to app_api;
grant execute on function app.current_user_id(), app.is_active_member(uuid) to app_api;
