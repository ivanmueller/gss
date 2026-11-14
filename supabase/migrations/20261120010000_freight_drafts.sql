-- F-235 part 2: Claude drafts freight rates from calls and email (docs/FEATURES.md F-235).
--
-- - app.call_drafts gains the kind 'freight': a rate a company quoted, with its route as written
--   ("Morris MB" to "Muncie IN"), saved as a freight quote only when a person verifies it.
-- - One freight quote accepts one draft, as a bid or offer and a follow-up do.
-- - app.decide_call_draft: a freight draft is decided by a person who may enter freight rates,
--   and accepted with a freight quote of the draft's company that this person entered.
-- The drafts are written by app.keep_call_reading and app.keep_email_reading, unchanged: they
-- insert each draft's kind as the Worker checked it, which the new check admits.

alter table app.call_drafts
  drop constraint call_drafts_kind_check,
  add constraint call_drafts_kind_check
    check (kind in ('quote', 'follow_up', 'contact', 'freight'));

drop index app.call_drafts_one_result_idx;
create unique index call_drafts_one_result_idx on app.call_drafts (kind, result_id)
  where status = 'accepted' and kind in ('quote', 'follow_up', 'freight');

-- As in 20261113010000_email_readings.sql, with freight drafts.
create or replace function app.decide_call_draft(draft uuid, decision text, result uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  d app.call_drafts;
begin
  if uid is null or decision not in ('accepted', 'dismissed') then
    return 'not_found';
  end if;
  select * into d from app.call_drafts where id = draft for update;
  if not found or not app.is_active_member(d.organization_id) then
    return 'not_found';
  end if;
  if d.email_id is not null
     and exists (select 1 from app.email_removals x where x.email_id = d.email_id) then
    return 'not_found';
  end if;
  if not (case d.kind
             when 'quote' then app.can_enter_quotes(d.organization_id)
             when 'follow_up' then app.can_log_contacts(d.organization_id)
             when 'freight' then app.can_enter_freight(d.organization_id)
             else app.can_edit_directory(d.organization_id)
           end) then
    return 'forbidden';
  end if;
  if d.status <> 'open' then
    return 'already_decided';
  end if;
  if decision = 'dismissed' then
    result := null;
  elsif result is null or not (case d.kind
      when 'quote' then exists (
        select 1 from app.quotes q
         where q.id = result and q.organization_id = d.organization_id
           and q.counterparty_id = d.counterparty_id and q.created_by = uid)
      when 'follow_up' then exists (
        select 1 from app.follow_ups f
         where f.id = result and f.organization_id = d.organization_id
           and f.counterparty_id = d.counterparty_id and f.created_by = uid)
      when 'freight' then exists (
        select 1 from app.freight_quotes q
         where q.id = result and q.organization_id = d.organization_id
           and q.carrier_id = d.counterparty_id and q.created_by = uid)
      else exists (
        select 1 from app.counterparty_contacts k
         where k.id = result and k.organization_id = d.organization_id
           and k.counterparty_id = d.counterparty_id
           and (k.id = d.contact_id or (d.contact_id is null and k.created_by = uid)))
    end) then
    return 'result_not_found';
  elsif d.kind in ('quote', 'follow_up', 'freight') and exists (
      select 1 from app.call_drafts o
       where o.kind = d.kind and o.result_id = result and o.status = 'accepted') then
    return 'result_not_found';
  end if;
  update app.call_drafts
     set status = decision, decided_by = uid,
         decided_by_name = app.member_name(d.organization_id, uid),
         decided_at = now(), result_id = result
   where id = d.id;
  return 'decided';
end
$$;

revoke all on function app.decide_call_draft(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.decide_call_draft(uuid, text, uuid) to app_api;
