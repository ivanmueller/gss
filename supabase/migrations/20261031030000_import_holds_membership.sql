-- An import holds its importer's membership until it is done (Codex's review of
-- ivanmueller/gss#95).
--
-- app.lock_counterparty_import (20261030080000_counterparty_import_lock.sql) checked that the
-- person may import, then took the organization's import lock. Their role could still change
-- while the import ran: row level security then skipped the updates to companies already
-- listed, yet the import was recorded. It now also locks the person's own membership, active
-- operations or org_admin, in share mode, so a change of their role or status waits until the
-- import is done, and one made just before is seen and refused. SECURITY DEFINER: only admins
-- pass the members update policy that locking a row needs. It reads and locks only the
-- caller's own row in the organization asked for.

create or replace function app.lock_counterparty_import(org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from app.organization_members m
    join app.organizations o on o.id = m.organization_id
   where m.organization_id = org
     and m.user_id = app.current_user_id()
     and m.status = 'active'
     and m.role in ('operations', 'org_admin')
     and o.active
   for share of m;
  if not found then
    raise exception 'only operations and admin members import counterparties'
      using errcode = 'insufficient_privilege';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('app.counterparty_import:' || org::text, 0));
end
$$;

revoke all on function app.lock_counterparty_import(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.lock_counterparty_import(uuid) to app_api;
