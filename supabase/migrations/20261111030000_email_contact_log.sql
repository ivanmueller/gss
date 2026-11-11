-- Email, step 3: an email sent is logged in the company's contact history (F-114 build plan,
-- step 3; Codex's review of F-114-3, finding R1-03). app.finish_outgoing_email
-- (20261111010000_emails.sql) is replaced: when the sending service accepted the email, the same
-- transaction that marks it sent writes one contact history entry (channel email, by the
-- person who sent it, at the time it was sent). An email moves from sending to sent only once
-- (the row is locked and its status checked), so it is logged once; a refused or unconfirmed
-- email is not logged, and neither is one sent by a role that does not log contacts (viewers,
-- analysts). The entry is an ordinary one: corrected or removed as any other.

create or replace function app.finish_outgoing_email(email uuid, ok boolean, provider_id text, failure_text text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  m app.emails;
  entry uuid;
  sent_at timestamptz := now();
begin
  select * into m from app.emails e where e.id = email and e.direction = 'outgoing' for update;
  if not found or uid is null or m.sent_by is distinct from uid then
    return 'not_found';
  end if;
  if m.status <> 'sending' then
    return 'already_finished';
  end if;
  if ok then
    update app.emails e
       set status = 'sent', provider_message_id = provider_id, occurred_at = sent_at
     where e.id = m.id;
    -- Only roles that log contacts write the contact history (app.number_contact_log_revision);
    -- an email sent by a viewer or analyst is kept and shown with the company's emails, and is
    -- not put in the history, so finishing it never fails after it was sent (Codex's review of
    -- F-114-3, R2-01).
    if not app.can_log_contacts(m.organization_id) then
      return 'done';
    end if;
    insert into app.contact_log_entries (organization_id, counterparty_id, created_by)
    values (m.organization_id, m.counterparty_id, uid)
    returning id into entry;
    insert into app.contact_log_revisions
      (organization_id, entry_id, revision_number, occurred_at, channel, contact_name, notes,
       recorded_by, recorded_by_name)
    values (m.organization_id, entry, 1, sent_at, 'email',
            -- The contact written to, or else the first address in To.
            coalesce(m.contact_name, left(m.to_addresses[1], 200)),
            left(btrim('Email sent: ' || coalesce(nullif(m.subject, ''), '(no subject)')), 5000),
            uid, m.sent_by_name);
  else
    update app.emails e
       set status = 'failed', failure = coalesce(nullif(left(btrim(failure_text), 1000), ''), 'not sent')
     where e.id = m.id;
  end if;
  return 'done';
end
$$;

revoke all on function app.finish_outgoing_email(uuid, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function app.finish_outgoing_email(uuid, boolean, text, text) to app_api;
