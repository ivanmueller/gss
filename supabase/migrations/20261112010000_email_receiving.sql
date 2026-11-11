-- Email through the platform, step 4a: mail received by the Worker (F-114; the owner's answers
-- 13 to 15 of 2026-11-11 in docs/FEATURES.md; register docs/reviews/F-114-4a.md).
--
-- The Worker's email handler keeps each message's raw bytes in a private R2 bucket (the durable
-- record: attachments are read from it, never stored apart) and keeps here:
-- - on app.emails: whether the message is automatic (an out-of-office reply, a report, a
--   mailing), whether it could not be parsed, and the raw object's key and size;
-- - app.email_attachments: one row per attachment listed in the message (name, type, size,
--   hash), never changed or deleted.
--
-- app.admit_email answers, before anything is stored, whether a delivery is new, a duplicate,
-- GSS's own copy of an email it sent, or over the flood limits (Codex's design reviews D1-03 and
-- D2-01: limits are applied only before the message is accepted). The new app.receive_email
-- replaces step 2's: it never refuses a message for volume; it matches a reply on the sending
-- service's id as well as GSS's own (Cloudflare sets the Message-ID itself); and it puts mail on
-- a company only when it was sent to the shared address or a person's own (D1-05, the owner's
-- answer 15: mail to an address of nobody stays on no company).

alter table app.emails
  add column automatic boolean not null default false,
  add column parse_failed boolean not null default false,
  add column raw_key text check (raw_key ~ '^raw/[0-9a-f-]{36}/[0-9a-f]{64}\.eml$'),
  add column raw_size integer check (raw_size between 0 and 26214400);

-- Sent email has none of them; mail received from now on always has its raw object. NOT VALID:
-- the rule is for new rows (no received mail existed before this step).
alter table app.emails
  add constraint emails_outgoing_receiving_shape check (
    direction <> 'outgoing'
    or (not automatic and not parse_failed and raw_key is null and raw_size is null)),
  add constraint emails_incoming_raw_shape check (
    direction <> 'incoming' or (raw_key is not null and raw_size is not null)) not valid;

-- The flood limits count a sender's and the organization's received mail by time.
create index emails_incoming_sender_idx on app.emails (organization_id, from_address, occurred_at)
  where direction = 'incoming';
-- Own copies: a received message whose Message-ID is a sent email's.
create index emails_outgoing_provider_idx on app.emails (organization_id, provider_message_id)
  where direction = 'outgoing';

create table app.email_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  email_id uuid not null,
  -- The attachment's place in the message (0 first), as the Worker's parser lists them.
  position integer not null check (position between 0 and 99),
  file_name text check (length(file_name) between 1 and 255 and file_name !~ '[[:cntrl:]]'),
  content_type text not null
    check (length(content_type) <= 255 and content_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'),
  size_bytes integer not null check (size_bytes between 0 and 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  disposition text not null check (disposition in ('attachment', 'inline')),
  content_id app.email_header_token check (length(content_id) <= 255),
  created_at timestamptz not null default now(),
  unique (email_id, position),
  constraint email_attachments_email_fkey foreign key (organization_id, email_id)
    references app.emails (organization_id, id)
);

create index email_attachments_organization_idx on app.email_attachments (organization_id);

create function app.check_email_attachment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from app.emails e
                  where e.organization_id = new.organization_id and e.id = new.email_id
                    and e.direction = 'incoming') then
    raise exception 'attachments are listed only on received email' using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end
$$;

create trigger email_attachments_check
  before insert on app.email_attachments
  for each row execute function app.check_email_attachment();
create trigger email_attachments_keep
  before update or delete on app.email_attachments
  for each row execute function app.keep_emails();
create trigger email_attachments_no_truncate
  before truncate on app.email_attachments
  for each statement execute function app.keep_emails();
create trigger email_attachments_audit
  after insert on app.email_attachments
  for each row execute function app.record_audit_event();

alter table app.email_attachments enable row level security;
create policy email_attachments_select_for_members on app.email_attachments
  for select to app_api using (app.is_active_member(organization_id));

-- A Message-ID or a sending service's id compared without its angle brackets.
create function app.email_id_core(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(value, '<> '), '')
$$;

-- GSS's own copy of an email it sent: the received Message-ID is the sending service's id of a
-- sent email, from the same address.
create function app.is_own_email_copy(org uuid, sender text, message text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from app.emails e
     where e.organization_id = org and e.direction = 'outgoing'
       and e.provider_message_id is not null
       and app.email_id_core(e.provider_message_id) = app.email_id_core(message)
       and e.from_address = lower(btrim(sender)))
$$;

-- Before anything is stored (the Worker's email handler, nobody signed in): 'admit', or
-- 'duplicate' (kept already), 'own_copy' (GSS's own sent email), 'too_many' (the sender sent
-- 100 in the last hour, or the organization received 2,000 in the last day), or
-- 'unknown_organization' / 'forbidden'. Limits are counted on kept mail only; a burst admitted
-- together may pass them by a few (each delivery admitted is then kept).
create function app.admit_email(org uuid, sender text, message text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sender_address text := lower(btrim(sender));
begin
  if app.current_user_id() is not null then
    return 'forbidden';
  end if;
  if not exists (select 1 from app.organizations o where o.id = org) then
    return 'unknown_organization';
  end if;
  if exists (select 1 from app.emails e
              where e.organization_id = org and e.direction = 'incoming' and e.message_id = message) then
    return 'duplicate';
  end if;
  if app.is_own_email_copy(org, sender_address, message) then
    return 'own_copy';
  end if;
  if (select count(*) from app.emails e
       where e.organization_id = org and e.direction = 'incoming'
         and e.from_address = sender_address and e.occurred_at > now() - interval '1 hour') >= 100
     or (select count(*) from app.emails e
          where e.organization_id = org and e.direction = 'incoming'
            and e.occurred_at > now() - interval '1 day') >= 2000 then
    return 'too_many';
  end if;
  return 'admit';
end
$$;

drop function app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean,
                                text, text, text[], boolean);

-- A received email, from the Worker's email handler (nobody signed in), after its raw message
-- is stored. The organization comes from the Worker's configuration, never from the message.
-- Kept once per Message-ID and never refused for volume (admission did that). Put on a company
-- only when it was sent to the shared address or a person's own: when it answers an email GSS
-- sent (In-Reply-To first, then the latest reference, on GSS's id or the sending service's), or
-- when its sender passed DMARC and is a contact of exactly one company. Answers
-- {"status": "received", "id", "counterparty_id", "duplicate"}, {"status": "own_copy"},
-- {"status": "unknown_organization"} or {"status": "forbidden"}.
create function app.receive_email(
  org uuid, envelope text, sender text, sender_name text, to_list text[], cc_list text[],
  reply_address text, subject_text text, body text, truncated boolean, message text,
  answers text, refs text[], dmarc_passed boolean, is_automatic boolean, failed_parse boolean,
  stored_key text, stored_size integer, attachments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope_address text := lower(btrim(envelope));
  sender_address text := lower(btrim(sender));
  recipient_part text := split_part(lower(btrim(envelope)), '@', 1);
  shared text;
  member uuid;
  gss_address boolean;
  company uuid;
  person uuid;
  existing app.emails;
  new_id uuid;
  item jsonb;
  wanted text;
begin
  if app.current_user_id() is not null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if not exists (select 1 from app.organizations o where o.id = org) then
    return jsonb_build_object('status', 'unknown_organization');
  end if;

  select * into existing from app.emails e
   where e.organization_id = org and e.direction = 'incoming' and e.message_id = message;
  if found then
    return jsonb_build_object('status', 'received', 'id', existing.id,
                              'counterparty_id', existing.counterparty_id, 'duplicate', true);
  end if;
  if app.is_own_email_copy(org, sender_address, message) then
    return jsonb_build_object('status', 'own_copy');
  end if;

  select coalesce((select s.shared_local_part from app.email_settings s where s.organization_id = org),
                  'info') into shared;
  select a.user_id into member
    from app.member_email_addresses a
   where a.organization_id = org and a.local_part = recipient_part;
  gss_address := member is not null or recipient_part = shared;

  if gss_address then
    -- 1. A reply to an email GSS sent: In-Reply-To first, then its References from the latest,
    -- each on GSS's own id or the sending service's.
    foreach wanted in array array_prepend(answers, (select coalesce(array_agg(r order by i desc), '{}')
                                                      from unnest(coalesce(refs, '{}')) with ordinality as x(r, i))) loop
      continue when app.email_id_core(wanted) is null;
      select e.counterparty_id, e.contact_id into company, person
        from app.emails e
        join app.counterparties c on c.organization_id = e.organization_id and c.id = e.counterparty_id
       where e.organization_id = org and e.direction = 'outgoing' and c.archived_at is null
         and (app.email_id_core(e.message_id) = app.email_id_core(wanted)
              or app.email_id_core(e.provider_message_id) = app.email_id_core(wanted))
       order by e.created_at desc
       limit 1;
      exit when company is not null;
    end loop;

    -- 2. A sender who passed DMARC and is a contact of exactly one company.
    if company is null and dmarc_passed is true then
      select min(k.counterparty_id::text)::uuid into company
        from app.counterparty_contacts k
        join app.counterparties c on c.organization_id = k.organization_id and c.id = k.counterparty_id
       where k.organization_id = org and lower(k.email) = sender_address and c.archived_at is null
      having count(distinct k.counterparty_id) = 1;
      if company is not null then
        select min(k.id::text)::uuid into person
          from app.counterparty_contacts k
         where k.organization_id = org and k.counterparty_id = company and lower(k.email) = sender_address
        having count(*) = 1;
      end if;
    end if;
  end if;

  -- A share lock on the company, then its state seen again: archived or deleted since it was
  -- matched, the mail is left to link by hand (as in step 2).
  if company is not null then
    perform 1 from app.counterparties c
     where c.organization_id = org and c.id = company and c.archived_at is null
       for share;
    if not found then
      company := null;
      person := null;
    end if;
  end if;
  if person is not null and not exists (
       select 1 from app.counterparty_contacts k
        where k.organization_id = org and k.counterparty_id = company and k.id = person) then
    person := null;
  end if;

  insert into app.emails (organization_id, direction, status, counterparty_id, contact_id,
                          envelope_to, gss_member, from_address, from_name, to_addresses,
                          cc_addresses, reply_to, subject, body_text, body_truncated, message_id,
                          in_reply_to, reference_ids, auth_passed, automatic, parse_failed,
                          raw_key, raw_size)
  values (org, 'incoming', 'received', company, person, envelope_address, member, sender_address,
          nullif(left(regexp_replace(btrim(sender_name), '[[:cntrl:]]', ' ', 'g'), 200), ''),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(to_list) t),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(cc_list) t),
          nullif(lower(btrim(reply_address)), ''),
          coalesce(subject_text, ''), body, coalesce(truncated, false), message, answers,
          coalesce(refs, '{}'), coalesce(dmarc_passed, false), coalesce(is_automatic, false),
          coalesce(failed_parse, false), stored_key, stored_size)
  on conflict (organization_id, direction, message_id) do nothing
  returning id into new_id;

  if new_id is null then
    -- Delivered twice at the same moment: the other delivery kept it.
    select * into existing from app.emails e
     where e.organization_id = org and e.direction = 'incoming' and e.message_id = message;
    return jsonb_build_object('status', 'received', 'id', existing.id,
                              'counterparty_id', existing.counterparty_id, 'duplicate', true);
  end if;

  if jsonb_typeof(attachments) = 'array' then
    if jsonb_array_length(attachments) > 100 then
      raise exception 'at most 100 attachments are listed' using errcode = 'check_violation';
    end if;
    for item in select value from jsonb_array_elements(attachments) loop
      insert into app.email_attachments (organization_id, email_id, position, file_name,
                                         content_type, size_bytes, sha256, disposition, content_id)
      values (org, new_id, (item ->> 'position')::integer, item ->> 'file_name',
              item ->> 'content_type', (item ->> 'size_bytes')::integer, item ->> 'sha256',
              item ->> 'disposition', item ->> 'content_id');
    end loop;
  end if;

  return jsonb_build_object('status', 'received', 'id', new_id, 'counterparty_id', company,
                            'duplicate', false);
end
$$;

-- Privileges: nothing for public or the Supabase API roles; app_api reads the attachments and
-- calls admission and receiving. The helpers and the trigger function are called by nobody.
revoke all on app.email_attachments from public, anon, authenticated, service_role, app_api;
revoke all on function
  app.check_email_attachment(), app.email_id_core(text), app.is_own_email_copy(uuid, text, text),
  app.admit_email(uuid, text, text),
  app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text,
                    text[], boolean, boolean, boolean, text, integer, jsonb)
  from public, anon, authenticated, service_role, app_api;
grant select on app.email_attachments to app_api;
grant execute on function
  app.admit_email(uuid, text, text),
  app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text,
                    text[], boolean, boolean, boolean, text, integer, jsonb)
  to app_api;
