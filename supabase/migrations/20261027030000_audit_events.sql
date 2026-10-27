-- Minimal audit trail (GT-016), MASTER_PROJECT_SPECIFICATION.md sections 6 and 10.1.
--
-- A trigger writes one row per insert, update or delete on audited tables, in the
-- same transaction as the change. The API cannot read, write or skip it: app_api has
-- no privileges on app.audit_events and the trigger function runs as its owner.
-- Rows record who, what and when, and the names of changed columns, never the
-- values, so contact details and logos are not copied into the audit trail.

create table app.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app.organizations (id),
  -- The signed-in user from app.user_id; null for changes made outside the API.
  actor_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity text not null,
  entity_id uuid not null,
  -- Updates only: the columns whose values changed.
  changed_fields text[],
  -- The API's request id from app.request_id, to tie a change to its request log.
  request_id uuid,
  occurred_at timestamptz not null default now()
);

create index audit_events_entity_idx on app.audit_events (entity, entity_id, occurred_at desc);
create index audit_events_organization_idx on app.audit_events (organization_id, occurred_at desc);

-- Row level security with no policies: nothing reaches this table through RLS.
alter table app.audit_events enable row level security;

-- Audited tables have organization_id and either id or counterparty_id as their key.
create function app.record_audit_event()
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

revoke all on table app.audit_events from public, anon, authenticated, service_role, app_api;
revoke all on function app.record_audit_event() from public, anon, authenticated, service_role, app_api;
