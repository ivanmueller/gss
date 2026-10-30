-- One counterparty import at a time per organization (Codex's review of ivanmueller/gss#88).
--
-- An import matches the file's companies against the list, then creates the new ones and adds
-- to the listed ones. Two imports run side by side could each find "Prairie Feeds Ltd." new
-- and create it twice, since a company not yet in the list has no row to lock. The API takes
-- this transaction-level lock first, then reads the list and writes in the same transaction,
-- so the second import waits and sees the first one's companies.
--
-- An advisory lock, as for contact log entries (20261029070000_counterparty_crm.sql), because
-- locking the organization's row would need an update grant on organizations. Only operations
-- and org_admin members of the organization, who may import, can take it.

create function app.lock_counterparty_import(org uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not app.can_edit_directory(org) then
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
