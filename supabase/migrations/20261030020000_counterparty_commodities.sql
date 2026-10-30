-- What each counterparty buys and sells (the owner's request and answers of 2026-10-30,
-- docs/DECISIONS.md): a list kept by hand on its page, or filled from a spreadsheet's
-- Commodities column, from the shared list of commodities (app.commodities).
--
-- One row per counterparty, commodity and direction ('buys' or 'sells'); a counterparty that
-- both buys and sells canola has two rows. Rows are added and removed, never changed.
--
-- Anyone on the team may change the list (the owner's answer): every active member of the
-- organization, whatever their role, through the policies below. Nothing changes on an
-- archived counterparty (SQLSTATE GS005). The check locks the counterparty in share mode,
-- so a change and archiving it happen one after the other: archiving takes the row's
-- no-key-update lock, which waits for the change, and the change waits for an archiving
-- already under way. Every addition and removal is audited by the existing trigger.

create table app.counterparty_commodities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  counterparty_id uuid not null,
  commodity_code text not null references app.commodities (code),
  direction text not null check (direction in ('buys', 'sells')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  unique (counterparty_id, commodity_code, direction),
  -- The tenant-matching key: a row belongs to a counterparty of its own organization.
  foreign key (organization_id, counterparty_id) references app.counterparties (organization_id, id)
);

create index counterparty_commodities_organization_idx
  on app.counterparty_commodities (organization_id, commodity_code);

-- Refuses a change to an archived counterparty's list, after waiting for any archiving or
-- restoring of it under way (the share lock). SECURITY DEFINER: members who are not
-- directory editors cannot lock a counterparty themselves, as its update policy is theirs.
create function app.check_counterparty_commodity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.counterparty_id else new.counterparty_id end;
  archived boolean;
begin
  select c.archived_at is not null into archived
    from app.counterparties c where c.id = target
    for share;
  if archived then
    raise exception 'an archived counterparty''s commodities cannot be changed'
      using errcode = 'GS005';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger counterparty_commodities_check
  before insert or delete on app.counterparty_commodities
  for each row execute function app.check_counterparty_commodity();

create trigger counterparty_commodities_audit
  after insert or update or delete on app.counterparty_commodities
  for each row execute function app.record_audit_event();

alter table app.counterparty_commodities enable row level security;

create policy counterparty_commodities_select_for_members on app.counterparty_commodities
  for select to app_api using (app.is_active_member(organization_id));
create policy counterparty_commodities_insert_for_members on app.counterparty_commodities
  for insert to app_api
  with check (app.is_active_member(organization_id) and created_by = app.current_user_id());
create policy counterparty_commodities_delete_for_members on app.counterparty_commodities
  for delete to app_api using (app.is_active_member(organization_id));

-- Privileges: reading, adding (only the columns a caller sets, so created_at is always the
-- database's clock) and removing; never changing a row.
revoke all on table app.counterparty_commodities from public, anon, authenticated, service_role;
revoke all on function app.check_counterparty_commodity()
  from public, anon, authenticated, service_role, app_api;
grant select, delete on app.counterparty_commodities to app_api;
grant insert (organization_id, counterparty_id, commodity_code, direction, created_by)
  on app.counterparty_commodities to app_api;
