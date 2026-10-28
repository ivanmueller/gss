-- Member management (GT-013), MASTER_PROJECT_SPECIFICATION.md section 2.1 ("Manage
-- users/config": Org Admin only); the owner's request of 2026-10-28 (docs/DECISIONS.md).
--
-- An org_admin adds a person who already has a login (created in the Supabase dashboard)
-- to the organization with a role, changes their role, suspends or reactivates them, and
-- sets the first and last name the app shows. Memberships are never deleted: suspending
-- keeps the history. An organization always keeps at least one active admin.
--
-- app_api still cannot read the auth schema. Three SECURITY DEFINER functions, each of
-- which first checks that the caller is an active org_admin of the organization, read
-- the few auth.users fields needed (email, names) and write only the two name fields.

-- True when the current user is an active org_admin of the organization.
create function app.is_org_admin(org uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_role(org, array['org_admin']::app.member_role[])
$$;

-- Admins add members: active from now, recorded as added by themselves.
create policy organization_members_insert_for_admins on app.organization_members
  for insert to app_api
  with check (
    app.is_org_admin(organization_id)
    and created_by = app.current_user_id()
    and status = 'active'
    and joined_at is not null
  );

-- Admins change a member's role and status (active or suspended, never back to invited).
create policy organization_members_update_for_admins on app.organization_members
  for update to app_api
  using (app.is_org_admin(organization_id))
  with check (app.is_org_admin(organization_id) and status in ('active', 'suspended'));

-- Every change to a membership is audited (who, when, which columns).
create trigger organization_members_audit
  after insert or update or delete on app.organization_members
  for each row execute function app.record_audit_event();

-- An organization always keeps at least one active admin, so it can never lock itself out
-- through the app. (app_api cannot delete memberships at all; deleting one by hand in the
-- database, for example to remove a whole organization, is not stopped.) The
-- organization's row is locked first, so two admins cannot demote each other at once.
-- SECURITY DEFINER so the check sees every member whatever the caller may read.
create function app.keep_an_active_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'org_admin' and old.status = 'active'
     and (new.role <> 'org_admin' or new.status <> 'active') then
    perform 1 from app.organizations where id = old.organization_id for update;
    if not exists (
      select 1 from app.organization_members m
      where m.organization_id = old.organization_id and m.id <> old.id
        and m.role = 'org_admin' and m.status = 'active'
    ) then
      raise exception 'an organization keeps at least one active admin'
        using errcode = 'GS001';
    end if;
  end if;
  return new;
end
$$;

create trigger organization_members_keep_an_active_admin
  before update of role, status on app.organization_members
  for each row execute function app.keep_an_active_admin();

-- The login with this email (ignoring case), for an admin adding it to the organization;
-- null for anyone else or when no one has that login.
create function app.find_login(org uuid, wanted_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where app.is_org_admin(org) and lower(u.email) = lower(btrim(wanted_email))
  order by u.created_at
  limit 1
$$;

-- The organization's members with the email and names of their logins, for its admins
-- only (no rows for anyone else). `version` is the membership's last change time.
create function app.member_directory(org uuid)
returns table (
  id uuid,
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  role app.member_role,
  status app.member_status,
  joined_at timestamptz,
  version text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.user_id, u.email::text,
         nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
         nullif(btrim(u.raw_user_meta_data ->> 'last_name'), ''),
         m.role, m.status, m.joined_at,
         to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  from app.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = org and app.is_org_admin(org)
  order by lower(coalesce(u.raw_user_meta_data ->> 'first_name', u.email)), u.email, m.id
$$;

-- Sets the first and last name shown for a member of the organization (null removes one).
-- For its admins only; false when not allowed or not a member. Audited as 'member_names'.
create function app.set_member_name(org uuid, member uuid, first_name text, last_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if not app.is_org_admin(org) then
    return false;
  end if;
  select m.user_id into target
    from app.organization_members m
   where m.id = member and m.organization_id = org;
  if target is null then
    return false;
  end if;
  if (first_name is not null and (first_name <> btrim(first_name) or length(first_name) not between 1 and 100
                                  or first_name ~ '[[:cntrl:]]'))
     or (last_name is not null and (last_name <> btrim(last_name) or length(last_name) not between 1 and 100
                                    or last_name ~ '[[:cntrl:]]')) then
    raise exception 'a name is 1 to 100 characters, trimmed, without control characters'
      using errcode = 'check_violation';
  end if;
  update auth.users
     set raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'first_name' - 'last_name')
                              || jsonb_strip_nulls(jsonb_build_object('first_name', first_name,
                                                                      'last_name', last_name))
   where id = target;
  insert into app.audit_events
    (organization_id, actor_id, action, entity, entity_id, changed_fields, request_id)
  values (org, app.current_user_id(), 'update', 'member_names', member,
          array['first_name', 'last_name'],
          nullif(current_setting('app.request_id', true), '')::uuid);
  return true;
end
$$;

-- Privileges: inserting a membership and changing its role and status, through the
-- policies above; the functions only for app_api.
grant insert (organization_id, user_id, role, status, joined_at, created_by)
  on app.organization_members to app_api;
grant update (role, status) on app.organization_members to app_api;

revoke all on function app.is_org_admin(uuid), app.keep_an_active_admin(),
  app.find_login(uuid, text), app.member_directory(uuid),
  app.set_member_name(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function app.keep_an_active_admin() from app_api;
grant execute on function app.is_org_admin(uuid), app.find_login(uuid, text),
  app.member_directory(uuid), app.set_member_name(uuid, uuid, text, text) to app_api;
