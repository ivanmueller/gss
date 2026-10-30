-- Admins remove follow-ups (the owner's request of 2026-10-30, docs/DECISIONS.md).
--
-- Follow-ups are still never deleted (app.keep_follow_ups): a removed follow-up is kept
-- with who removed it and when, and the app leaves it out of every list and count. Only
-- org_admin members remove one, open or done, in their own name; the time is the
-- database's clock and the name comes from their login. A removed follow-up does not
-- change again. Every removal is audited by the existing trigger.

alter table app.follow_ups
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users (id),
  add column removed_by_name app.label,
  add constraint follow_ups_removed_check
    check ((removed_at is null) = (removed_by is null)
           and (removed_at is null) = (removed_by_name is null));

-- The checks of 20261029070000_counterparty_crm.sql, with removal first:
-- - a removed follow-up does not change;
-- - removing is only by an admin of its organization, in their own name, and changes
--   nothing else; it is allowed whether the follow-up is open or done, and whether its
--   counterparty is archived or not.
create or replace function app.check_follow_up()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  planning_changed boolean;
begin
  if tg_op = 'UPDATE' then
    if old.removed_by is not null then
      raise exception 'a removed follow-up does not change' using errcode = 'check_violation';
    end if;
    if new.removed_by is not null then
      if not app.is_org_admin(new.organization_id)
         or new.removed_by is distinct from app.current_user_id() then
        raise exception 'only an admin removes a follow-up, in their own name'
          using errcode = 'insufficient_privilege';
      end if;
      if (new.organization_id, new.counterparty_id, new.contact_log_entry_id, new.task,
          new.due_at, new.assigned_to, new.created_at, new.created_by, new.created_by_name,
          new.done_at, new.done_by, new.done_by_name)
         is distinct from
         (old.organization_id, old.counterparty_id, old.contact_log_entry_id, old.task,
          old.due_at, old.assigned_to, old.created_at, old.created_by, old.created_by_name,
          old.done_at, old.done_by, old.done_by_name) then
        raise exception 'removing a follow-up changes nothing else' using errcode = 'check_violation';
      end if;
      new.assigned_to_name := old.assigned_to_name;
      new.removed_at := now();
      new.removed_by_name := app.member_name(new.organization_id, new.removed_by);
      return new;
    end if;
    if old.done_at is not null then
      raise exception 'a follow-up that is done does not change' using errcode = 'check_violation';
    end if;
    if (new.organization_id, new.counterparty_id, new.contact_log_entry_id, new.created_at,
        new.created_by, new.created_by_name)
       is distinct from
       (old.organization_id, old.counterparty_id, old.contact_log_entry_id, old.created_at,
        old.created_by, old.created_by_name) then
      raise exception 'a follow-up stays with its counterparty and creator'
        using errcode = 'check_violation';
    end if;
    planning_changed := (new.task, new.due_at, new.assigned_to)
                        is distinct from (old.task, old.due_at, old.assigned_to);
    if not app.can_log_contacts(new.organization_id)
       and (planning_changed or new.done_at is null) then
      raise exception 'only traders, operations and admins change a follow-up; the person responsible marks it done'
        using errcode = 'insufficient_privilege';
    end if;
    if planning_changed and exists (
         select 1 from app.counterparties c
          where c.id = new.counterparty_id and c.archived_at is not null) then
      raise exception 'an archived counterparty''s follow-ups are not changed'
        using errcode = 'check_violation';
    end if;
    if new.assigned_to is not distinct from old.assigned_to then
      new.assigned_to_name := old.assigned_to_name;
      return new;
    end if;
  end if;
  new.assigned_to_name := app.member_name(new.organization_id, new.assigned_to);
  if new.assigned_to_name is null then
    raise exception 'the person responsible is an active member of the organization'
      using errcode = 'GS004';
  end if;
  return new;
end
$$;

revoke all on function app.check_follow_up() from public, anon, authenticated, service_role, app_api;

-- Removing goes through the update policy (admins plan follow-ups, so they pass it); the
-- trigger above limits it to admins. Its check let a done follow-up through only when done
-- by the person acting; a removal keeps someone else's done_by (the trigger refuses any
-- change to it), so a row removed in one's own name passes too.
drop policy follow_ups_update_for_loggers_and_assignee on app.follow_ups;
create policy follow_ups_update_for_loggers_and_assignee on app.follow_ups
  for update to app_api
  using (
    app.can_log_contacts(organization_id)
    or (assigned_to = app.current_user_id() and app.is_active_member(organization_id))
  )
  with check (
    (app.can_log_contacts(organization_id)
     or (assigned_to = app.current_user_id() and app.is_active_member(organization_id)))
    and (done_by is null or done_by = app.current_user_id()
         or removed_by = app.current_user_id())
  );

-- Only removed_by is granted: the time and name are filled in by the database.
grant update (removed_by) on app.follow_ups to app_api;
