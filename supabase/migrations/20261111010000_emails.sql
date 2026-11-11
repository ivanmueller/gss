-- Email through the platform, step 2: emails stored (F-114; the owner's decisions of 2026-11-10
-- in docs/DECISIONS.md and the answers recorded in docs/FEATURES.md). Database only: the Worker
-- sends (step 3) and receives (step 4) through the functions below.
--
-- - app.email_settings: per organization, the shared address's local part (info@) and the one
--   team signature; written by admins only. The domain itself is never stored or chosen here:
--   the Worker's configuration names it and the organization it receives for (Codex's design
--   review, F-114-2-D1-01), so no admin can claim another organization's mail.
-- - app.member_email_addresses: each person's own local part (name@), set by admins.
-- - app.emails: every email sent or received, read by every active member of its organization
--   (the owner: everyone reads everyone's email); never edited or deleted. A sent email moves
--   once from sending to sent or failed; a received one with no company is linked to one once.
-- - app.email_removals: an email hidden from every list (the row is kept), never undone. Mail
--   on no company: any active member; mail on a company: admins, as contact history removals.
--
-- Every write goes through the SECURITY DEFINER functions at the end; app_api only reads the
-- tables. Times are the database's clock; names come from the person's login.

create type app.email_direction as enum ('outgoing', 'incoming');
create type app.email_status as enum ('sending', 'sent', 'failed', 'received');

-- An address as kept: lowercase, one @, no spaces or control characters, at most 254.
create domain app.email_address as text
  check (value = lower(value) and length(value) <= 254
         and value ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$');

-- The part before the @ of a GSS address (info, a person's name).
create domain app.email_local_part as text
  check (value ~ '^[a-z0-9][a-z0-9._-]{0,63}$');

-- A Message-ID or another header token: no spaces or control characters, at most 998.
create domain app.email_header_token as text
  check (length(value) between 1 and 998 and value !~ '[[:space:][:cntrl:]]');

create table app.email_settings (
  -- Its own id, which the audit trail records; one per organization.
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references app.organizations (id),
  shared_local_part app.email_local_part not null default 'info',
  -- The team signature, with {name}, {title}, {phone} and {email} filled in when sending.
  signature text check (length(signature) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users (id),
  updated_by_name app.label not null
);

create table app.member_email_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  local_part app.email_local_part not null,
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, local_part),
  constraint member_email_addresses_member_fkey foreign key (organization_id, user_id)
    references app.organization_members (organization_id, user_id)
);

create table app.emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  direction app.email_direction not null,
  status app.email_status not null,
  -- The company it is on: always for a sent email; for a received one when matched or linked.
  counterparty_id uuid,
  -- One of that company's contacts (not a key, as for calls: the email keeps the name).
  contact_id uuid,
  contact_name app.label,
  -- Sent: the person who sent it.
  sent_by uuid references auth.users (id),
  sent_by_name app.label,
  -- Received: the address it was delivered to, and the person whose own address that is.
  envelope_to app.email_address,
  gss_member uuid references auth.users (id),
  from_address app.email_address not null,
  from_name text check (length(from_name) <= 200 and from_name !~ '[[:cntrl:]]'),
  to_addresses app.email_address[] not null default '{}',
  cc_addresses app.email_address[] not null default '{}',
  reply_to app.email_address,
  subject text not null default '' check (length(subject) <= 998 and subject !~ '[\r\n]'),
  body_text text not null check (length(body_text) <= 500000),
  -- The Worker cut a longer body to the limit.
  body_truncated boolean not null default false,
  message_id app.email_header_token not null,
  in_reply_to app.email_header_token,
  reference_ids app.email_header_token[] not null default '{}'
    check (cardinality(reference_ids) <= 50),
  -- The sending service's own id, once it accepted the email.
  provider_message_id app.email_header_token,
  -- Received: the sender's domain passed DMARC (from the receiving service's results).
  auth_passed boolean,
  failure text check (length(failure) between 1 and 1000),
  -- Sent: when it was sent (or started); received: when the Worker received it.
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  linked_by uuid references auth.users (id),
  linked_by_name app.label,
  linked_at timestamptz,
  unique (organization_id, id),
  -- The same message delivered to two GSS addresses, or delivered again, is kept once.
  unique (organization_id, direction, message_id),
  constraint emails_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id),
  constraint emails_outgoing_shape check (
    direction <> 'outgoing' or (
      status in ('sending', 'sent', 'failed')
      and counterparty_id is not null and sent_by is not null and sent_by_name is not null
      and envelope_to is null and gss_member is null and auth_passed is null
      and linked_by is null and linked_at is null
      -- Cloudflare's sending limit: at most 50 recipients, at least one in To.
      and cardinality(to_addresses) >= 1
      and cardinality(to_addresses) + cardinality(cc_addresses) <= 50)),
  constraint emails_incoming_shape check (
    direction <> 'incoming' or (
      status = 'received' and sent_by is null and sent_by_name is null
      and envelope_to is not null and failure is null and provider_message_id is null
      -- Received headers may name nobody (Bcc) or many; kept, within bounds.
      and cardinality(to_addresses) <= 500 and cardinality(cc_addresses) <= 500)),
  constraint emails_failure_shape check ((status = 'failed') = (failure is not null)),
  constraint emails_linked_shape check (
    (linked_by is null and linked_by_name is null and linked_at is null)
    or (linked_by is not null and linked_by_name is not null and linked_at is not null
        and counterparty_id is not null)),
  constraint emails_contact_shape check (contact_id is null or counterparty_id is not null)
);

create index emails_counterparty_idx on app.emails (organization_id, counterparty_id, occurred_at desc);
create index emails_unmatched_idx on app.emails (organization_id, occurred_at desc)
  where counterparty_id is null;

create table app.email_removals (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null unique,
  organization_id uuid not null references app.organizations (id),
  removed_at timestamptz not null default now(),
  removed_by uuid not null references auth.users (id),
  removed_by_name app.label not null,
  constraint email_removals_email_fkey foreign key (organization_id, email_id)
    references app.emails (organization_id, id)
);

create index email_removals_organization_idx on app.email_removals (organization_id);

-- The name of a contact of that company and organization; an error for any other contact
-- (Codex's design review, F-114-2-D1-03).
create function app.email_contact_name(org uuid, company uuid, contact uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  found_name text;
begin
  select k.name into found_name
    from app.counterparty_contacts k
   where k.organization_id = org and k.counterparty_id = company and k.id = contact;
  if not found then
    raise exception 'the contact is not one of the email''s company' using errcode = 'foreign_key_violation';
  end if;
  return found_name;
end
$$;

-- Everything about an email is set once. Afterwards only: a sent email from sending to sent or
-- failed; a received email with no company linked to one, once.
create function app.check_email()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  moving text[];
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if new.direction = 'outgoing' then
      if new.status <> 'sending' or new.provider_message_id is not null then
        raise exception 'a sent email starts as sending' using errcode = 'check_violation';
      end if;
      new.occurred_at := now();
    end if;
    if new.contact_id is not null then
      new.contact_name := app.email_contact_name(new.organization_id, new.counterparty_id, new.contact_id);
    end if;
    return new;
  end if;

  if old.direction = 'outgoing' then
    moving := array['status', 'provider_message_id', 'failure', 'occurred_at'];
  else
    moving := array['counterparty_id', 'contact_id', 'contact_name', 'linked_by', 'linked_by_name', 'linked_at'];
  end if;
  if (to_jsonb(new) - moving) is distinct from (to_jsonb(old) - moving) then
    raise exception 'an email is never edited' using errcode = 'insufficient_privilege';
  end if;
  if old.direction = 'outgoing' then
    if old.status <> 'sending' or new.status not in ('sent', 'failed') then
      raise exception 'a sent email moves once, from sending to sent or failed'
        using errcode = 'check_violation';
    end if;
  else
    if old.counterparty_id is not null or new.counterparty_id is null then
      raise exception 'a received email is linked to a company once' using errcode = 'check_violation';
    end if;
    if new.contact_id is not null then
      new.contact_name := app.email_contact_name(new.organization_id, new.counterparty_id, new.contact_id);
    end if;
  end if;
  return new;
end
$$;

create function app.keep_emails()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'emails and their removals are never deleted, changed or undone'
    using errcode = 'insufficient_privilege';
end
$$;

-- A removal: mail on no company by any active member, mail on a company by an admin; in their
-- own name.
create function app.check_email_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  company uuid;
begin
  select m.counterparty_id into company
    from app.emails m where m.organization_id = new.organization_id and m.id = new.email_id;
  if new.removed_by is distinct from app.current_user_id()
     or not app.is_active_member(new.organization_id)
     or (company is not null and not app.is_org_admin(new.organization_id)) then
    raise exception 'mail on a company is removed by an admin, other mail by a member, in their own name'
      using errcode = 'insufficient_privilege';
  end if;
  new.removed_at := now();
  new.removed_by_name := app.member_name(new.organization_id, new.removed_by);
  if new.removed_by_name is null then
    raise exception 'only an active member removes an email' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger emails_check
  before insert or update on app.emails
  for each row execute function app.check_email();
create trigger emails_keep
  before delete on app.emails
  for each row execute function app.keep_emails();
create trigger emails_no_truncate
  before truncate on app.emails
  for each statement execute function app.keep_emails();
create trigger email_removals_check
  before insert on app.email_removals
  for each row execute function app.check_email_removal();
create trigger email_removals_keep
  before update or delete on app.email_removals
  for each row execute function app.keep_emails();
create trigger email_removals_no_truncate
  before truncate on app.email_removals
  for each statement execute function app.keep_emails();

create trigger email_settings_audit
  after insert or update or delete on app.email_settings
  for each row execute function app.record_audit_event();
create trigger member_email_addresses_audit
  after insert or update or delete on app.member_email_addresses
  for each row execute function app.record_audit_event();
create trigger emails_audit
  after insert or update on app.emails
  for each row execute function app.record_audit_event();
create trigger email_removals_audit
  after insert on app.email_removals
  for each row execute function app.record_audit_event();

alter table app.email_settings enable row level security;
alter table app.member_email_addresses enable row level security;
alter table app.emails enable row level security;
alter table app.email_removals enable row level security;

create policy email_settings_select_for_members on app.email_settings
  for select to app_api using (app.is_active_member(organization_id));
create policy member_email_addresses_select_for_members on app.member_email_addresses
  for select to app_api using (app.is_active_member(organization_id));
create policy emails_select_for_members on app.emails
  for select to app_api using (app.is_active_member(organization_id));
create policy email_removals_select_for_members on app.email_removals
  for select to app_api using (app.is_active_member(organization_id));

-- Admins: the shared address's local part and the team signature. Refused when the shared
-- local part is a person's own.
create function app.save_email_settings(org uuid, new_shared_local_part text, new_signature text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  shared text := lower(btrim(new_shared_local_part));
  sig text := nullif(btrim(new_signature), '');
begin
  if uid is null or not app.is_org_admin(org) then
    return 'forbidden';
  end if;
  -- One settings row per organization, locked so an address saved at the same time is seen.
  perform 1 from app.organizations o where o.id = org for update;
  if exists (select 1 from app.member_email_addresses a
              where a.organization_id = org and a.local_part = shared) then
    return 'address_taken';
  end if;
  insert into app.email_settings (organization_id, shared_local_part, signature, updated_by, updated_by_name)
  values (org, shared, sig, uid, app.member_name(org, uid))
  on conflict (organization_id) do update
    set shared_local_part = excluded.shared_local_part, signature = excluded.signature,
        updated_at = now(), updated_by = excluded.updated_by,
        updated_by_name = excluded.updated_by_name;
  return 'saved';
end
$$;

-- Admins: a member's own local part, or none (null). Refused when it is the shared one or
-- another person's.
create function app.save_member_email_address(org uuid, member uuid, new_local_part text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  wanted text := lower(btrim(new_local_part));
begin
  if uid is null or not app.is_org_admin(org) then
    return 'forbidden';
  end if;
  perform 1 from app.organizations o where o.id = org for update;
  if not exists (select 1 from app.organization_members m
                  where m.organization_id = org and m.user_id = member) then
    return 'not_a_member';
  end if;
  if wanted is null or wanted = '' then
    delete from app.member_email_addresses a where a.organization_id = org and a.user_id = member;
    return 'saved';
  end if;
  if wanted = coalesce((select s.shared_local_part from app.email_settings s where s.organization_id = org), 'info')
     or exists (select 1 from app.member_email_addresses a
                 where a.organization_id = org and a.local_part = wanted and a.user_id <> member) then
    return 'address_taken';
  end if;
  insert into app.member_email_addresses (organization_id, user_id, local_part)
  values (org, member, wanted)
  on conflict (organization_id, user_id) do update
    set local_part = excluded.local_part, updated_at = now();
  return 'saved';
end
$$;

-- A person starts sending an email from a company's page (any active member: everyone sends).
-- From is their own address or the shared one, on the domain the Worker's configuration names.
-- Answers {"status": "started", "id": …} or {"status": <refusal>}.
create function app.start_outgoing_email(
  org uuid, company uuid, contact uuid, from_local_part text, from_domain text,
  to_list text[], cc_list text[], subject_text text, body text, msg_id text)
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
begin
  if uid is null or not app.is_active_member(org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
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
  insert into app.emails (organization_id, direction, status, counterparty_id, contact_id,
                          sent_by, sent_by_name, from_address, from_name, to_addresses,
                          cc_addresses, subject, body_text, message_id)
  values (org, 'outgoing', 'sending', company, contact, uid, app.member_name(org, uid),
          wanted || '@' || lower(btrim(from_domain)), app.member_name(org, uid),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(to_list) t),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(cc_list) t),
          coalesce(subject_text, ''), body, msg_id)
  returning id into new_id;
  return jsonb_build_object('status', 'started', 'id', new_id);
end
$$;

-- What the sending service answered, as the person who sent it; once.
create function app.finish_outgoing_email(email uuid, ok boolean, provider_id text, failure_text text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  m app.emails;
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
       set status = 'sent', provider_message_id = provider_id, occurred_at = now()
     where e.id = m.id;
  else
    update app.emails e
       set status = 'failed', failure = coalesce(nullif(left(btrim(failure_text), 1000), ''), 'not sent')
     where e.id = m.id;
  end if;
  return 'done';
end
$$;

-- A received email, from the Worker's email handler (nobody signed in). The organization and
-- domain come from the Worker's configuration, never from the message. Kept once per
-- Message-ID; put on a company when it answers an email GSS sent, or when its sender passed
-- DMARC and is a contact of exactly one company; otherwise left to link by hand.
-- Answers {"status": "received", "id", "counterparty_id", "duplicate"} or
-- {"status": "unknown_organization"}.
create function app.receive_email(
  org uuid, envelope text, sender text, sender_name text, to_list text[], cc_list text[],
  reply_address text, subject_text text, body text, truncated boolean, message text,
  answers text, refs text[], dmarc_passed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope_address text := lower(btrim(envelope));
  sender_address text := lower(btrim(sender));
  member uuid;
  company uuid;
  person uuid;
  existing app.emails;
  new_id uuid;
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

  select a.user_id into member
    from app.member_email_addresses a
   where a.organization_id = org and a.local_part = split_part(envelope_address, '@', 1);

  -- 1. A reply to an email GSS sent: In-Reply-To first, then the latest of its References.
  select e.counterparty_id, e.contact_id into company, person
    from app.emails e
    join app.counterparties c on c.organization_id = e.organization_id and c.id = e.counterparty_id
   where e.organization_id = org and e.direction = 'outgoing' and c.archived_at is null
     and (e.message_id = answers or e.message_id = any (coalesce(refs, '{}')))
   order by (e.message_id = answers) desc nulls last, e.created_at desc
   limit 1;

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

  -- A share lock on the company, then its state seen again: archived or deleted since it was
  -- matched, the mail is left to link by hand (Codex's review of F-114-2, finding R1-03).
  if company is not null then
    perform 1 from app.counterparties c
     where c.organization_id = org and c.id = company and c.archived_at is null
       for share;
    if not found then
      company := null;
      person := null;
    end if;
  end if;
  -- The contact only while it is still one of that company's (a contact removed since GSS's
  -- email was sent leaves the reply on the company alone; Codex's review, finding R1-01).
  if person is not null and not exists (
       select 1 from app.counterparty_contacts k
        where k.organization_id = org and k.counterparty_id = company and k.id = person) then
    person := null;
  end if;

  insert into app.emails (organization_id, direction, status, counterparty_id, contact_id,
                          envelope_to, gss_member, from_address, from_name, to_addresses,
                          cc_addresses, reply_to, subject, body_text, body_truncated, message_id,
                          in_reply_to, reference_ids, auth_passed)
  values (org, 'incoming', 'received', company, person, envelope_address, member, sender_address,
          nullif(left(regexp_replace(btrim(sender_name), '[[:cntrl:]]', ' ', 'g'), 200), ''),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(to_list) t),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(cc_list) t),
          nullif(lower(btrim(reply_address)), ''),
          coalesce(subject_text, ''), body, coalesce(truncated, false), message, answers,
          coalesce(refs, '{}'), dmarc_passed)
  on conflict (organization_id, direction, message_id) do nothing
  returning id into new_id;

  if new_id is null then
    -- Delivered twice at the same moment: the other delivery kept it.
    select * into existing from app.emails e
     where e.organization_id = org and e.direction = 'incoming' and e.message_id = message;
    return jsonb_build_object('status', 'received', 'id', existing.id,
                              'counterparty_id', existing.counterparty_id, 'duplicate', true);
  end if;
  return jsonb_build_object('status', 'received', 'id', new_id, 'counterparty_id', company,
                            'duplicate', false);
end
$$;

-- Anyone on the team links a received email on no company to a company (and optionally one of
-- its contacts).
create function app.link_email(email uuid, company uuid, contact uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  m app.emails;
begin
  select * into m from app.emails e where e.id = email and e.direction = 'incoming' for update;
  if not found or uid is null or not app.is_active_member(m.organization_id) then
    return 'not_found';
  end if;
  if exists (select 1 from app.email_removals x where x.email_id = m.id) then
    return 'removed';
  end if;
  if m.counterparty_id is not null then
    return 'already_linked';
  end if;
  perform 1 from app.counterparties c
   where c.organization_id = m.organization_id and c.id = company and c.archived_at is null
   for share;
  if not found then
    return 'company_not_found';
  end if;
  if contact is not null and not exists (
       select 1 from app.counterparty_contacts k
        where k.organization_id = m.organization_id and k.counterparty_id = company and k.id = contact) then
    return 'company_not_found';
  end if;
  update app.emails e
     set counterparty_id = company, contact_id = contact, linked_by = uid,
         linked_by_name = app.member_name(m.organization_id, uid), linked_at = now()
   where e.id = m.id;
  return 'done';
end
$$;

-- An email hidden from every list: on no company by anyone on the team, on a company by an
-- admin. Never undone.
create function app.remove_email(email uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  m app.emails;
begin
  select * into m from app.emails e where e.id = email for update;
  if not found or uid is null or not app.is_active_member(m.organization_id) then
    return 'not_found';
  end if;
  if exists (select 1 from app.email_removals x where x.email_id = m.id) then
    return 'already_removed';
  end if;
  if m.counterparty_id is not null and not app.is_org_admin(m.organization_id) then
    return 'forbidden';
  end if;
  insert into app.email_removals (email_id, organization_id, removed_by)
  values (m.id, m.organization_id, uid);
  return 'done';
end
$$;

-- Company summaries: an email kept, sent, linked or removed is new activity (Codex's design
-- review, F-114-2-D1-04). Otherwise as in 20261105030000_counterparty_summaries.sql.
create or replace function app.counterparty_activity_at(org uuid, company uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(
    (select max(r.created_at)
       from app.contact_log_entries e
       join app.contact_log_revisions r on r.entry_id = e.id
      where e.organization_id = org and e.counterparty_id = company),
    (select max(x.removed_at)
       from app.contact_log_entries e
       join app.contact_log_removals x on x.entry_id = e.id
      where e.organization_id = org and e.counterparty_id = company),
    (select max(greatest(cr.read_at, cr.voicemail_corrected_at))
       from app.calls c
       join app.call_recordings cr on cr.call_id = c.id
      where c.organization_id = org and c.counterparty_id = company),
    (select max(greatest(qr.created_at, q.withdrawn_at))
       from app.quotes q
       join app.quote_revisions qr on qr.quote_id = q.id
      where q.organization_id = org and q.counterparty_id = company),
    (select max(greatest(f.created_at, f.done_at, f.removed_at))
       from app.follow_ups f
      where f.organization_id = org and f.counterparty_id = company),
    (select max(greatest(m.created_at, m.linked_at))
       from app.emails m
      where m.organization_id = org and m.counterparty_id = company),
    (select max(x.removed_at)
       from app.emails m
       join app.email_removals x on x.email_id = m.id
      where m.organization_id = org and m.counterparty_id = company)
  )
$$;

-- Privileges: nothing for public or the Supabase API roles; app_api reads the four tables and
-- calls the functions it needs. The triggers' functions are called by nobody directly.
revoke all on app.email_settings, app.member_email_addresses, app.emails, app.email_removals
  from public, anon, authenticated, service_role, app_api;
revoke all on function
  app.email_contact_name(uuid, uuid, uuid), app.check_email(), app.keep_emails(),
  app.check_email_removal(), app.save_email_settings(uuid, text, text),
  app.save_member_email_address(uuid, uuid, text),
  app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text),
  app.finish_outgoing_email(uuid, boolean, text, text),
  app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text, text[], boolean),
  app.link_email(uuid, uuid, uuid), app.remove_email(uuid)
  from public, anon, authenticated, service_role, app_api;
grant select on app.email_settings, app.member_email_addresses, app.emails, app.email_removals to app_api;
grant execute on function
  app.save_email_settings(uuid, text, text),
  app.save_member_email_address(uuid, uuid, text),
  app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text),
  app.finish_outgoing_email(uuid, boolean, text, text),
  app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text, text[], boolean),
  app.link_email(uuid, uuid, uuid), app.remove_email(uuid)
  to app_api;
