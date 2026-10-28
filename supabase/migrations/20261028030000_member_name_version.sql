-- A name change moves the membership's version (Codex's review of member management,
-- 2026-10-28). app.set_member_name wrote only the login's names, so the membership's
-- updated_at, which an edit's version is checked against, did not move: a second admin's
-- edit of the same version was applied over the first instead of being refused.
--
-- app.set_member_name now also touches the membership row; the API locks that row before
-- comparing versions, so the second edit waits and then sees the new version. The audit
-- trigger stops recording updates that change nothing but updated_at, so this bump adds
-- no empty audit event (the name change stays audited as 'member_names').

create or replace function app.set_member_name(org uuid, member uuid, first_name text, last_name text)
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
  -- The names live on the login, but a name change is a change to the membership too:
  -- moving its updated_at (by the touch trigger) moves the version an edit is checked
  -- against, so a second admin's edit of the same version is refused, not applied over it.
  update app.organization_members set updated_at = now() where id = member;
  insert into app.audit_events
    (organization_id, actor_id, action, entity, entity_id, changed_fields, request_id)
  values (org, app.current_user_id(), 'update', 'member_names', member,
          array['first_name', 'last_name'],
          nullif(current_setting('app.request_id', true), '')::uuid);
  return true;
end
$$;

-- An update that changes nothing but updated_at records no audit event of its own; the
-- change it stands for is audited where it is made.
create or replace function app.record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  after_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  before_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  current_row jsonb := coalesce(after_row, before_row);
  changed text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into changed
      from jsonb_each(after_row)
     where key <> 'updated_at' and value is distinct from before_row -> key;
    if changed is null then
      return null;
    end if;
  end if;

  insert into app.audit_events
    (organization_id, actor_id, action, entity, entity_id, changed_fields, request_id)
  values (
    (current_row ->> 'organization_id')::uuid,
    app.current_user_id(),
    lower(tg_op),
    tg_table_name,
    coalesce(current_row ->> 'id', current_row ->> 'counterparty_id')::uuid,
    changed,
    nullif(current_setting('app.request_id', true), '')::uuid
  );
  return null;
end
$$;

-- Replacing a function keeps its privileges; restated so this file reads on its own.
revoke all on function app.set_member_name(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function app.set_member_name(uuid, uuid, text, text) to app_api;
revoke all on function app.record_audit_event()
  from public, anon, authenticated, service_role, app_api;
