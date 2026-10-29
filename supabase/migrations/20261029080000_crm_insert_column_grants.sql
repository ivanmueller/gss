-- The CRM's insert grants limited to the columns a caller may set (Codex's review of
-- ivanmueller/gss#69, merged with 20261029070000_counterparty_crm.sql).
--
-- That migration granted app_api INSERT on the whole of app.contact_log_entries,
-- app.contact_log_revisions and app.follow_ups, so a caller could set created_at itself.
-- A revision's check that a contact is never more than five minutes after it was recorded
-- compares occurred_at with created_at, so a revision written with both in 2099 passed it,
-- and a recording time could be made up. The API never sends these columns; the database
-- now refuses them, so created_at and updated_at are always the database's own clock.
--
-- Left out of the follow-up's insert grant too: done_at, done_by and done_by_name (a
-- follow-up is planned open; the insert policy already required it), so a follow-up is
-- only ever finished by an update, in the finisher's own name.

revoke insert on app.contact_log_entries, app.contact_log_revisions, app.follow_ups
  from app_api;

grant insert (id, organization_id, counterparty_id, created_by)
  on app.contact_log_entries to app_api;

grant insert (id, organization_id, entry_id, revision_number, occurred_at, channel,
              contact_name, notes, recorded_by, recorded_by_name)
  on app.contact_log_revisions to app_api;

grant insert (id, organization_id, counterparty_id, contact_log_entry_id, task, due_at,
              assigned_to, assigned_to_name, created_by, created_by_name)
  on app.follow_ups to app_api;
