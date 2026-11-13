-- F-114 step 7: files attached to an email sent from a company's page (docs/FEATURES.md F-114,
-- the owner's answer 4 and its answers of 2026-11-12; Codex's design review,
-- docs/reviews/F-114-7.md).
--
-- - app.email_attachments also lists a sent email's files: each kept in the private bucket at
--   `file_key` = sent/<email id>/<position>-<sha256>, a key the database writes itself.
-- - At most 10 files and 10 MiB of file bytes in all, PDFs and JPEG or PNG photos only (the
--   kind decided by the Worker from the file's first bytes), always as attachments.
-- - app.start_outgoing_email gains the list of files (a 14-argument version, the list required:
--   no default, so a 13-argument call is never ambiguous, D1-02); the 13-argument version stays
--   as a wrapper passing an empty list for the Worker deployed before this migration, to be
--   dropped by a later step.
-- - The rows are written only by that function (app_api keeps select only); never updated or
--   deleted, as before.

alter table app.email_attachments
  add column file_key text
    check (file_key ~ '^sent/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{1,2}-[0-9a-f]{64}$');

-- The largest total of a sent email's files.
create function app.sent_attachments_max_bytes()
returns integer
language sql
immutable
set search_path = ''
as $$ select 10485760 $$;

-- A received email's attachment has no file key (it is read from the original); a sent email's
-- has exactly the key derived from its email, position and checksum, while the email is being
-- sent, as an attachment of one of the three kinds and sizes.
create or replace function app.check_email_attachment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.file_key is null then
    if not exists (select 1 from app.emails e
                    where e.organization_id = new.organization_id and e.id = new.email_id
                      and e.direction = 'incoming') then
      raise exception 'attachments without a file are listed only on received email'
        using errcode = 'check_violation';
    end if;
  else
    if not exists (select 1 from app.emails e
                    where e.organization_id = new.organization_id and e.id = new.email_id
                      and e.direction = 'outgoing' and e.status = 'sending') then
      raise exception 'files are added only to a sent email being started'
        using errcode = 'check_violation';
    end if;
    if new.file_key is distinct from
         'sent/' || new.email_id || '/' || new.position || '-' || new.sha256
       or new.disposition <> 'attachment' or new.content_id is not null
       or new.content_type not in ('application/pdf', 'image/jpeg', 'image/png')
       or new.size_bytes not between 1 and app.sent_attachments_max_bytes()
       or new.file_name is null then
      raise exception 'not a file a sent email may carry' using errcode = 'check_violation';
    end if;
  end if;
  new.created_at := now();
  return new;
end
$$;

-- The files of a sent email as the Worker passes them: a JSON array of at most 10 objects with
-- exactly position (0 to n-1, each once), file_name, content_type, size_bytes and sha256, at most
-- 10 MiB in all. Raises check_violation otherwise (the Worker checks all of this first).
create function app.check_sent_attachments(files jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  n integer;
  total bigint := 0;
begin
  if files is null or jsonb_typeof(files) <> 'array' then
    raise exception 'the files are a list' using errcode = 'check_violation';
  end if;
  n := jsonb_array_length(files);
  if n > 10 then
    raise exception 'at most 10 files' using errcode = 'check_violation';
  end if;
  for item in select value from jsonb_array_elements(files) loop
    if jsonb_typeof(item) <> 'object'
       or (select count(*) from jsonb_object_keys(item)) <> 5
       or jsonb_typeof(item -> 'position') <> 'number'
       or jsonb_typeof(item -> 'size_bytes') <> 'number'
       or jsonb_typeof(item -> 'file_name') <> 'string'
       or jsonb_typeof(item -> 'content_type') <> 'string'
       or jsonb_typeof(item -> 'sha256') <> 'string'
       or (item ->> 'position') !~ '^[0-9]{1,2}$'
       or (item ->> 'size_bytes') !~ '^[0-9]{1,8}$' then
      raise exception 'a file is malformed' using errcode = 'check_violation';
    end if;
    total := total + (item ->> 'size_bytes')::bigint;
  end loop;
  if total > app.sent_attachments_max_bytes() then
    raise exception 'the files come to more than 10 MiB' using errcode = 'check_violation';
  end if;
  if (select array_agg((value ->> 'position')::integer order by (value ->> 'position')::integer)
        from jsonb_array_elements(files))
     is distinct from (select array_agg(g) from generate_series(0, n - 1) g) then
    raise exception 'the files are numbered 0 to n-1' using errcode = 'check_violation';
  end if;
end
$$;

-- As the 13-argument version (20261116010000_email_reminders.sql), with the email's files: they
-- are checked before anything is written, then listed with the email in the same transaction.
-- Answers, when started, the email's id and each file's storage key, by position.
create function app.start_outgoing_email(
  org uuid, company uuid, contact uuid, from_local_part text, from_domain text,
  to_list text[], cc_list text[], subject_text text, body text, msg_id text,
  answering uuid, draft uuid, auto_draft uuid, files jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  settings app.email_settings;
  own text;
  wanted text := lower(btrim(from_local_part));
  archived timestamptz;
  new_id uuid;
  item jsonb;
  keys jsonb := '[]'::jsonb;
  file_key text;
begin
  if uid is null or not app.is_active_member(org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  perform app.check_sent_attachments(files);
  select * into settings from app.email_settings s where s.organization_id = org;
  if not found then
    return jsonb_build_object('status', 'no_settings');
  end if;
  select a.local_part into own
    from app.member_email_addresses a where a.organization_id = org and a.user_id = uid;
  if wanted is distinct from settings.shared_local_part and wanted is distinct from own then
    return jsonb_build_object('status', 'from_not_allowed');
  end if;
  -- A share lock on the company: an archive waits for this email, or is seen by it.
  select c.archived_at into archived
    from app.counterparties c where c.organization_id = org and c.id = company for share;
  if not found then
    return jsonb_build_object('status', 'company_not_found');
  end if;
  if archived is not null then
    return jsonb_build_object('status', 'archived');
  end if;
  if contact is not null and not exists (
       select 1 from app.counterparty_contacts k
        where k.organization_id = org and k.counterparty_id = company and k.id = contact) then
    return jsonb_build_object('status', 'contact_not_found');
  end if;
  if coalesce(cardinality(to_list), 0) < 1
     or coalesce(cardinality(to_list), 0) + coalesce(cardinality(cc_list), 0) > 50 then
    return jsonb_build_object('status', 'bad_recipients');
  end if;
  -- The links are checked for a new email only: a retry of a send key already used reaches the
  -- insert, whose unique key answers with the earlier email, even if the answered email was
  -- deleted meanwhile (Codex's final review, F-114-5b-R2-01).
  if not exists (select 1 from app.emails e
                  where e.organization_id = org and e.direction = 'outgoing'
                    and e.message_id = msg_id) then
    if answering is not null and not app.answerable_email(org, company, answering)
       and not (auto_draft is not null and exists (
             select 1 from app.email_auto_drafts a
               join app.emails r on r.id = a.email_id
              where a.organization_id = org and a.id = auto_draft and a.counterparty_id = company
                and a.source = 'reminder' and a.email_id = answering
                and r.organization_id = org and r.counterparty_id = company
                and r.direction = 'outgoing' and r.status = 'sent'
                and not exists (select 1 from app.email_removals x where x.email_id = r.id))) then
      return jsonb_build_object('status', 'reply_not_found');
    end if;
    if draft is not null and not exists (
         select 1 from app.email_draft_requests d
          where d.organization_id = org and d.id = draft and d.user_id = uid
            and d.counterparty_id = company and d.status = 'drafted') then
      return jsonb_build_object('status', 'draft_not_found');
    end if;
    -- An automatic draft (F-114 step 5c): ready, of this company, its source standing, not
    -- dismissed, and no other email from it being sent or sent (D1-01: a refused one frees it).
    -- Locked, so two people sending it at once, or a send and a dismiss, go one after the other.
    if auto_draft is not null then
      perform 1 from app.email_auto_drafts a
       where a.organization_id = org and a.id = auto_draft and a.counterparty_id = company
         and a.state = 'ready'
         for update;
      if not found or not app.auto_draft_source_stands(auto_draft) then
        return jsonb_build_object('status', 'auto_draft_not_found');
      end if;
      if exists (select 1 from app.email_auto_drafts a
                  where a.id = auto_draft and a.dismissed_at is not null)
         or app.auto_draft_taken(auto_draft) then
        return jsonb_build_object('status', 'auto_draft_used');
      end if;
      -- A reminder whose silence ended while it was open is not sent: the company answered,
      -- another email went, or a contact was logged (Codex's final review, F-114-5c2-R1-01).
      if exists (select 1 from app.email_auto_drafts a
                  where a.id = auto_draft and a.source = 'reminder')
         and app.auto_draft_answered(auto_draft) then
        return jsonb_build_object('status', 'auto_draft_answered');
      end if;
    end if;
  end if;
  insert into app.emails (organization_id, direction, status, counterparty_id, contact_id,
                          sent_by, sent_by_name, from_address, from_name, to_addresses,
                          cc_addresses, subject, body_text, message_id, reply_to_email_id,
                          claude_draft_id, auto_draft_id)
  values (org, 'outgoing', 'sending', company, contact, uid, app.member_name(org, uid),
          wanted || '@' || lower(btrim(from_domain)), app.member_name(org, uid),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(to_list) t),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(cc_list) t),
          coalesce(subject_text, ''), body, msg_id, answering, draft, auto_draft)
  returning id into new_id;
  -- The column checks and app.check_email_attachment refuse a name, type, size or checksum that
  -- is not allowed; the key is written here from the new email's id, never by the Worker.
  for item in select value from jsonb_array_elements(files)
                order by (value ->> 'position')::integer loop
    file_key := 'sent/' || new_id || '/' || (item ->> 'position') || '-' || (item ->> 'sha256');
    insert into app.email_attachments (organization_id, email_id, position, file_name,
                                       content_type, size_bytes, sha256, disposition,
                                       content_id, file_key)
    values (org, new_id, (item ->> 'position')::integer, item ->> 'file_name',
            item ->> 'content_type', (item ->> 'size_bytes')::integer, item ->> 'sha256',
            'attachment', null, file_key);
    keys := keys || jsonb_build_array(file_key);
  end loop;
  return jsonb_build_object('status', 'started', 'id', new_id, 'file_keys', keys);
end
$$;

-- The 13-argument function of step 5c, for the Worker deployed before this migration: the same
-- email without files.
create or replace function app.start_outgoing_email(
  org uuid, company uuid, contact uuid, from_local_part text, from_domain text,
  to_list text[], cc_list text[], subject_text text, body text, msg_id text,
  answering uuid, draft uuid, auto_draft uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.start_outgoing_email(org, company, contact, from_local_part, from_domain,
                                  to_list, cc_list, subject_text, body, msg_id,
                                  answering, draft, auto_draft, '[]'::jsonb)
$$;

-- Privileges ----------------------------------------------------------------------------------

revoke all on function app.sent_attachments_max_bytes(), app.check_sent_attachments(jsonb),
  app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role, app_api;
grant execute on function
  app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid, jsonb)
  to app_api;
