-- Forwarded email (F-233; the owner's answers of 2026-11-13 in docs/FEATURES.md; register
-- docs/reviews/F-233.md). A team member forwards, from a personal address they confirmed, an
-- email they received elsewhere to GSS's domain; the platform files it under the original
-- sender's company, Claude reads the forwarded message, and Reply answers the original sender.
--
-- - app.member_forwarding_addresses: each member's own personal addresses (the owner's answer 2),
--   confirmed by a code emailed to them before they count. Never deleted: removal is marked.
-- - app.forwarding_code_sends: one row per code email, reserved before the Worker sends it, so
--   the limits hold even for requests at the same moment (Codex's design review, D1-03).
-- - app.emails: the forward's original sender, subject and date as written, and where the
--   forwarded block and its text start in body_text, in code points (D1-01), at a quote depth
--   (D1-02). app.receive_email honours a forward only from a confirmed address of an active
--   member whose sender checks passed.

-- Forwarding addresses -------------------------------------------------------------------------

create table app.member_forwarding_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  address app.email_address not null,
  -- SHA-256 (hex) of the code and the row's id; the code itself is never stored.
  code_hash text check (code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at timestamptz,
  code_attempts integer not null default 0 check (code_attempts between 0 and 5),
  confirmed_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_forwarding_addresses_member_fkey foreign key (organization_id, user_id)
    references app.organization_members (organization_id, user_id),
  constraint member_forwarding_addresses_code_shape check ((code_hash is null) = (code_expires_at is null)),
  constraint member_forwarding_addresses_confirmed_shape check (confirmed_at is null or code_hash is null)
);

-- One live owner per address in an organization, pending or confirmed.
create unique index member_forwarding_addresses_live_idx
  on app.member_forwarding_addresses (organization_id, address) where removed_at is null;
create index member_forwarding_addresses_member_idx
  on app.member_forwarding_addresses (organization_id, user_id);

create table app.forwarding_code_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  address_id uuid not null references app.member_forwarding_addresses (id),
  outcome text not null default 'reserved' check (outcome in ('reserved', 'sent', 'failed')),
  reserved_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((outcome = 'reserved') = (finished_at is null))
);

create index forwarding_code_sends_member_idx
  on app.forwarding_code_sends (organization_id, user_id, reserved_at);
create index forwarding_code_sends_address_idx on app.forwarding_code_sends (address_id);

-- Rows are never deleted. An address row changes only its code, confirmation and removal; a
-- send row only from reserved to its outcome.
create function app.keep_forwarding_rows()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'forwarding addresses and code sends are never deleted'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'member_forwarding_addresses' then
    if new.id <> old.id or new.organization_id <> old.organization_id or new.user_id <> old.user_id
       or new.address <> old.address or new.created_at <> old.created_at
       or (old.removed_at is not null)
       or (old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at) then
      raise exception 'only the code, the confirmation and the removal change'
        using errcode = 'insufficient_privilege';
    end if;
  elsif new.id <> old.id or new.organization_id <> old.organization_id
        or new.user_id <> old.user_id or new.address_id <> old.address_id
        or new.reserved_at <> old.reserved_at or old.outcome <> 'reserved' then
    raise exception 'a code send changes only once, from reserved to its outcome'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger member_forwarding_addresses_keep
  before update or delete on app.member_forwarding_addresses
  for each row execute function app.keep_forwarding_rows();
create trigger member_forwarding_addresses_no_truncate
  before truncate on app.member_forwarding_addresses
  for each statement execute function app.keep_emails();
create trigger member_forwarding_addresses_audit
  after insert or update on app.member_forwarding_addresses
  for each row execute function app.record_audit_event();
create trigger forwarding_code_sends_keep
  before update or delete on app.forwarding_code_sends
  for each row execute function app.keep_forwarding_rows();
create trigger forwarding_code_sends_no_truncate
  before truncate on app.forwarding_code_sends
  for each statement execute function app.keep_emails();
create trigger forwarding_code_sends_audit
  after insert or update on app.forwarding_code_sends
  for each row execute function app.record_audit_event();

alter table app.member_forwarding_addresses enable row level security;
alter table app.forwarding_code_sends enable row level security;
-- A member sees only their own rows; every change goes through the functions below.
create policy member_forwarding_addresses_select_own on app.member_forwarding_addresses
  for select to app_api
  using (user_id = app.current_user_id() and app.is_active_member(organization_id));
create policy forwarding_code_sends_select_own on app.forwarding_code_sends
  for select to app_api
  using (user_id = app.current_user_id() and app.is_active_member(organization_id));

-- The caller's membership row, locked: adds and code sends of one member go one at a time.
create function app.lock_own_membership(org uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from app.organization_members om
   where om.organization_id = org and om.user_id = app.current_user_id() and om.status = 'active'
   for update;
  return found;
end
$$;

-- Adds one of the caller's own addresses (any role: the owner's answer 1). Answers
-- {"status": "added" | "exists", "id", "confirmed"}, or "invalid", "on_own_domain", "taken",
-- "too_many", "forbidden". A pending address of another member whose last code expired more than
-- a day ago (or that never got one, a day after it was added) is taken over: marked removed, so
-- one person's typo cannot block another for good. At most 5 live addresses per member.
create function app.add_forwarding_address(org uuid, address_text text, own_domain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  wanted text := lower(btrim(address_text));
  existing app.member_forwarding_addresses;
  new_id uuid;
begin
  if uid is null or not app.lock_own_membership(org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if wanted is null or length(wanted) > 254
     or wanted !~ '^[^@[:space:][:cntrl:]<>()",;:]+@[^@[:space:][:cntrl:]<>()",;:]+\.[^@[:space:][:cntrl:]<>()",;:.]+$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if split_part(wanted, '@', 2) = lower(btrim(coalesce(own_domain, ''))) then
    return jsonb_build_object('status', 'on_own_domain');
  end if;
  select * into existing from app.member_forwarding_addresses f
   where f.organization_id = org and f.address = wanted and f.removed_at is null
   for update;
  if found then
    if existing.user_id = uid then
      return jsonb_build_object('status', 'exists', 'id', existing.id,
                                'confirmed', existing.confirmed_at is not null);
    end if;
    if existing.confirmed_at is not null
       or coalesce(existing.code_expires_at, existing.created_at) > now() - interval '1 day' then
      return jsonb_build_object('status', 'taken');
    end if;
    update app.member_forwarding_addresses
       set removed_at = now(), code_hash = null, code_expires_at = null
     where id = existing.id;
  end if;
  if (select count(*) from app.member_forwarding_addresses f
       where f.organization_id = org and f.user_id = uid and f.removed_at is null) >= 5 then
    return jsonb_build_object('status', 'too_many');
  end if;
  insert into app.member_forwarding_addresses (organization_id, user_id, address)
  values (org, uid, wanted)
  returning id into new_id;
  return jsonb_build_object('status', 'added', 'id', new_id, 'confirmed', false);
end
$$;

-- Reserves one code email for the caller's pending address, before the Worker sends it (D1-03):
-- under the caller's membership lock, every reservation counts whatever became of it: at most
-- one a minute and 10 a day per member, 5 per address. Answers {"status": "reserved", "sendId",
-- "address"}, or "too_soon", "too_many", "not_found", "already_confirmed", "forbidden".
create function app.reserve_forwarding_code(org uuid, address_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  target app.member_forwarding_addresses;
  send_id uuid;
begin
  if uid is null or not app.lock_own_membership(org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into target from app.member_forwarding_addresses f
   where f.organization_id = org and f.id = address_id and f.user_id = uid and f.removed_at is null;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if target.confirmed_at is not null then
    return jsonb_build_object('status', 'already_confirmed');
  end if;
  if exists (select 1 from app.forwarding_code_sends s
              where s.organization_id = org and s.user_id = uid
                and s.reserved_at > now() - interval '1 minute') then
    return jsonb_build_object('status', 'too_soon');
  end if;
  if (select count(*) from app.forwarding_code_sends s where s.address_id = target.id) >= 5
     or (select count(*) from app.forwarding_code_sends s
          where s.organization_id = org and s.user_id = uid
            and s.reserved_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('status', 'too_many');
  end if;
  insert into app.forwarding_code_sends (organization_id, user_id, address_id)
  values (org, uid, target.id)
  returning id into send_id;
  return jsonb_build_object('status', 'reserved', 'sendId', send_id, 'address', target.address);
end
$$;

-- After the code email was sent: the reservation marked sent, and the code (its hash) kept on the
-- address for 30 minutes, with its tries reset, only when this is the address's newest
-- reservation (an older one finishing late never replaces a newer code). 'done' or 'not_found'.
create function app.finish_forwarding_code(org uuid, send uuid, hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  s app.forwarding_code_sends;
begin
  if uid is null or not app.is_active_member(org) or hash !~ '^[0-9a-f]{64}$' then
    return 'not_found';
  end if;
  select * into s from app.forwarding_code_sends x
   where x.organization_id = org and x.id = send and x.user_id = uid and x.outcome = 'reserved'
   for update;
  if not found then
    return 'not_found';
  end if;
  update app.forwarding_code_sends set outcome = 'sent', finished_at = now() where id = s.id;
  update app.member_forwarding_addresses f
     set code_hash = hash, code_expires_at = now() + interval '30 minutes', code_attempts = 0
   where f.id = s.address_id and f.removed_at is null and f.confirmed_at is null
     and not exists (select 1 from app.forwarding_code_sends n
                      where n.address_id = s.address_id and n.id <> s.id
                        and (n.reserved_at, n.id) > (s.reserved_at, s.id));
  return 'done';
end
$$;

-- The code email could not be sent: the reservation marked failed (still counted).
create function app.fail_forwarding_code(org uuid, send uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is null or not app.is_active_member(org) then
    return 'not_found';
  end if;
  update app.forwarding_code_sends
     set outcome = 'failed', finished_at = now()
   where organization_id = org and id = send and user_id = app.current_user_id()
     and outcome = 'reserved';
  return case when found then 'done' else 'not_found' end;
end
$$;

-- The caller types the code: 'confirmed' (also when it already was), 'wrong', 'expired' (no
-- code, past its 30 minutes, or 5 wrong tries: a new code is needed), 'not_found', 'forbidden'.
create function app.confirm_forwarding_address(org uuid, address_id uuid, hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  target app.member_forwarding_addresses;
begin
  if uid is null or not app.is_active_member(org) then
    return 'forbidden';
  end if;
  select * into target from app.member_forwarding_addresses f
   where f.organization_id = org and f.id = address_id and f.user_id = uid and f.removed_at is null
   for update;
  if not found then
    return 'not_found';
  end if;
  if target.confirmed_at is not null then
    return 'confirmed';
  end if;
  if target.code_hash is null or target.code_expires_at <= now() or target.code_attempts >= 5 then
    return 'expired';
  end if;
  if target.code_hash = hash then
    update app.member_forwarding_addresses
       set confirmed_at = now(), code_hash = null, code_expires_at = null
     where id = target.id;
    return 'confirmed';
  end if;
  update app.member_forwarding_addresses set code_attempts = code_attempts + 1 where id = target.id;
  return 'wrong';
end
$$;

-- The caller removes one of their addresses: 'done' or 'not_found'.
create function app.remove_forwarding_address(org uuid, address_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is null or not app.is_active_member(org) then
    return 'not_found';
  end if;
  update app.member_forwarding_addresses
     set removed_at = now(), code_hash = null, code_expires_at = null
   where organization_id = org and id = address_id and user_id = app.current_user_id()
     and removed_at is null;
  return case when found then 'done' else 'not_found' end;
end
$$;

-- The caller's live addresses, oldest first.
create function app.my_forwarding_addresses(org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.current_user_id() is null or not app.is_active_member(org) then null else
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'address', f.address, 'confirmedAt', f.confirmed_at,
               'codeExpiresAt', f.code_expires_at, 'createdAt', f.created_at)
             order by f.created_at, f.id)
        from app.member_forwarding_addresses f
       where f.organization_id = org and f.user_id = app.current_user_id()
         and f.removed_at is null), '[]'::jsonb) end
$$;

-- Forwards on received email ---------------------------------------------------------------------

alter table app.emails
  add column forwarded_by uuid references auth.users (id),
  add column original_from_address app.email_address,
  add column original_from_name text
    check (length(original_from_name) <= 200 and original_from_name !~ '[[:cntrl:]]'),
  add column original_subject text
    check (length(original_subject) <= 998 and original_subject !~ '[[:cntrl:]]'),
  add column original_date_text text
    check (length(original_date_text) <= 200 and original_date_text !~ '[[:cntrl:]]'),
  -- In code points, PostgreSQL's unit for length and substr (D1-01).
  add column forward_offset integer,
  add column forward_text_offset integer,
  add column forward_depth smallint;

alter table app.emails
  add constraint emails_forward_shape check (
    (forwarded_by is null and original_from_address is null and original_from_name is null
     and original_subject is null and original_date_text is null and forward_offset is null
     and forward_text_offset is null and forward_depth is null)
    or (direction = 'incoming' and forwarded_by is not null and original_from_address is not null
        and original_subject is not null and forward_offset is not null
        and forward_text_offset is not null and forward_depth between 0 and 5
        and forward_offset >= 0 and forward_offset < forward_text_offset
        and forward_text_offset <= length(body_text)));

-- The 20-argument app.receive_email of step 4a stays for the deploy window (the Worker before
-- this change still calls it while the new one deploys); a later migration drops it.

-- As in 20261112010000_email_receiving.sql, with the forward the Worker found (all fwd_ null when
-- none). The forward is honoured only when the mail was delivered to a GSS address, its sender
-- passed DMARC, it is neither automatic nor unreadable, its sender is a confirmed, not removed
-- forwarding address of an active member, its original sender is not on GSS's own domain, and
-- the offsets fit the kept body; otherwise the email is kept exactly as before. A forward is
-- matched on the original sender (a contact of exactly one company); the forwarding member
-- stays its sender of record.
create function app.receive_email(
  org uuid, envelope text, sender text, sender_name text, to_list text[], cc_list text[],
  reply_address text, subject_text text, body text, truncated boolean, message text,
  answers text, refs text[], dmarc_passed boolean, is_automatic boolean, failed_parse boolean,
  stored_key text, stored_size integer, attachments jsonb, received_at timestamptz,
  fwd_from text, fwd_name text, fwd_subject text, fwd_date text, fwd_offset integer,
  fwd_text_offset integer, fwd_depth integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  envelope_address text := lower(btrim(envelope));
  sender_address text := lower(btrim(sender));
  recipient_part text := split_part(lower(btrim(envelope)), '@', 1);
  original text := lower(btrim(fwd_from));
  shared text;
  member uuid;
  gss_address boolean;
  forwarder uuid;
  matched_on text;
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

  -- A forward from a member's confirmed address (F-233).
  if gss_address and dmarc_passed is true and not coalesce(is_automatic, false)
     and not coalesce(failed_parse, false) and original is not null
     and length(original) <= 254
     and original ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'
     and split_part(original, '@', 2) <> split_part(envelope_address, '@', 2)
     and original <> sender_address
     and fwd_depth between 0 and 5
     and fwd_offset >= 0 and fwd_offset < fwd_text_offset
     and fwd_text_offset <= length(coalesce(body, '')) then
    select f.user_id into forwarder
      from app.member_forwarding_addresses f
      join app.organization_members om
        on om.organization_id = f.organization_id and om.user_id = f.user_id and om.status = 'active'
     where f.organization_id = org and f.address = sender_address
       and f.confirmed_at is not null and f.removed_at is null;
  end if;
  matched_on := case when forwarder is not null then original else sender_address end;

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

    -- 2. A sender (for a forward, the original sender) who passed DMARC (for a forward, the
    -- forwarding member did) and is a contact of exactly one company.
    if company is null and dmarc_passed is true then
      select min(k.counterparty_id::text)::uuid into company
        from app.counterparty_contacts k
        join app.counterparties c on c.organization_id = k.organization_id and c.id = k.counterparty_id
       where k.organization_id = org and lower(k.email) = matched_on and c.archived_at is null
      having count(distinct k.counterparty_id) = 1;
      if company is not null then
        select min(k.id::text)::uuid into person
          from app.counterparty_contacts k
         where k.organization_id = org and k.counterparty_id = company and lower(k.email) = matched_on
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
                          raw_key, raw_size, occurred_at, forwarded_by, original_from_address,
                          original_from_name, original_subject, original_date_text,
                          forward_offset, forward_text_offset, forward_depth)
  values (org, 'incoming', 'received', company, person, envelope_address, member, sender_address,
          nullif(left(regexp_replace(btrim(sender_name), '[[:cntrl:]]', ' ', 'g'), 200), ''),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(to_list) t),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(cc_list) t),
          nullif(lower(btrim(reply_address)), ''),
          coalesce(subject_text, ''), body, coalesce(truncated, false), message, answers,
          coalesce(refs, '{}'), coalesce(dmarc_passed, false), coalesce(is_automatic, false),
          coalesce(failed_parse, false), stored_key, stored_size,
          -- When the Worker accepted it (mail kept after an outage keeps its own time), never
          -- in the future nor before the outage could have started (30 days of waiting at most).
          case when received_at between now() - interval '30 days' and now() then received_at
               else now() end,
          forwarder,
          case when forwarder is not null then original end,
          case when forwarder is not null
               then nullif(left(btrim(regexp_replace(coalesce(fwd_name, ''), '[[:cntrl:]]', ' ', 'g')), 200), '') end,
          case when forwarder is not null
               then left(btrim(regexp_replace(coalesce(fwd_subject, ''), '[[:cntrl:]]', ' ', 'g')), 998) end,
          case when forwarder is not null
               then nullif(left(btrim(regexp_replace(coalesce(fwd_date, ''), '[[:cntrl:]]', ' ', 'g')), 200), '') end,
          case when forwarder is not null then fwd_offset end,
          case when forwarder is not null then fwd_text_offset end,
          case when forwarder is not null then fwd_depth end)
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
                            'duplicate', false, 'forwarded', forwarder is not null);
end
$$;

-- A forwarding member's name for Claude (the Worker's jobs act for nobody, so app.member_name,
-- which answers members only, gives none): first and last name, never their login address.
create function app.forwarder_name(member_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select nullif(btrim(left(concat_ws(' ',
             nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
             nullif(btrim(u.raw_user_meta_data ->> 'last_name'), '')), 200)), '')
      from auth.users u where u.id = member_user_id), 'A GSS staff member')
$$;

-- An email as Claude is shown it: for a forward, the original sender, subject and the text from
-- the forwarded block on (its quote depth for the Worker to remove), with who forwarded it and
-- their note above it (context only); otherwise as before.
create function app.email_as_shown(e app.emails, body_max integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when e.forwarded_by is null then
    jsonb_build_object('from', e.from_address, 'fromName', e.from_name,
                       'subject', left(e.subject, 300), 'body', left(e.body_text, body_max))
  else
    jsonb_build_object('from', e.original_from_address, 'fromName', e.original_from_name,
                       'subject', left(e.original_subject, 300),
                       'body', left(substr(e.body_text, e.forward_text_offset + 1), body_max),
                       'forward', jsonb_build_object(
                         'depth', e.forward_depth,
                         'byName', app.forwarder_name(e.forwarded_by),
                         'byAddress', e.from_address,
                         'note', left(e.body_text, least(e.forward_offset, 2000)),
                         'dateText', e.original_date_text))
  end
$$;

-- As in 20261115010000_email_auto_drafts.sql, with the answered email and the thread as shown
-- (a forward from its original sender, F-233).
create or replace function app.email_draft_records(org uuid, company uuid, answering uuid, pinned uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cp app.counterparties;
  latest_call jsonb;
  answer jsonb;
begin
  select * into cp from app.counterparties c
   where c.organization_id = org and c.id = company and c.archived_at is null;
  if not found then
    return null;
  end if;
  if answering is not null then
    if not app.answerable_email(org, company, answering) then
      return null;
    end if;
    select jsonb_build_object(
             'id', e.id, 'direction', e.direction, 'occurredAt', e.occurred_at,
             'to', to_jsonb(e.to_addresses), 'automatic', e.automatic)
           || app.email_as_shown(e, 12000)
      into answer
      from app.emails e where e.id = answering;
  end if;

  -- The latest call with a transcript in the last 7 days (the owner's answer 16), or the call of
  -- the recording pinned (an automatic draft after that call, step 5c).
  select jsonb_build_object(
           'at', c.created_at, 'by', c.placed_by_name, 'contactName', c.contact_name,
           'transcript', left(coalesce(
             (select string_agg(
                       case l.value ->> 'side'
                         when 'caller' then c.placed_by_name
                         when 'counterparty' then c.contact_name
                         else 'Unknown speaker' end || ': ' || (l.value ->> 'text'),
                       E'\n' order by l.n)
                from jsonb_array_elements(r.transcript_lines) with ordinality l(value, n)),
             r.transcript), 12000))
    into latest_call
    from app.calls c
    join app.call_recordings r on r.organization_id = c.organization_id and r.call_id = c.id
   where c.organization_id = org and c.counterparty_id = company
     and r.transcript is not null
     and case when pinned is null then c.created_at > now() - interval '7 days'
              else r.id = pinned end
   order by c.created_at desc, r.created_at desc
   limit 1;

  return jsonb_build_object(
    'name', cp.legal_name,
    'types', to_jsonb(cp.types::text[]),
    'country', cp.primary_country,
    'notes', left(cp.notes, 1500),
    'contacts', coalesce((
      select jsonb_agg(k.item order by k.n)
        from (select row_number() over (order by c.is_main desc, c.name, c.id) as n,
                     jsonb_build_object('id', c.id, 'name', left(c.name, 200),
                                        'role', left(c.role, 200), 'email', c.email,
                                        'main', c.is_main) as item
                from app.counterparty_contacts c
               where c.organization_id = org and c.counterparty_id = company
               order by c.is_main desc, c.name, c.id
               limit 30) k
    ), '[]'::jsonb),
    'commodities', coalesce((
      select jsonb_agg(m.item order by m.n)
        from (select row_number() over (order by c.direction, c.commodity_code) as n,
                     jsonb_build_object('code', c.commodity_code, 'direction', c.direction) as item
                from app.counterparty_commodities c
               where c.organization_id = org and c.counterparty_id = company
               order by c.direction, c.commodity_code
               limit 40) m
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(f.item order by f.n)
        from (select row_number() over (order by c.country, c.region, c.city, c.id) as n,
                     jsonb_build_object('name', left(c.name, 200), 'city', left(c.city, 200),
                                        'region', c.region, 'country', c.country) as item
                from app.facilities c
               where c.organization_id = org and c.counterparty_id = company
               order by c.country, c.region, c.city, c.id
               limit 15) f
    ), '[]'::jsonb),
    'quotes', coalesce((
      select jsonb_agg(x.item order by x.valid_until, x.id)
        from (select q.id, r.valid_until,
                     jsonb_build_object(
                       'side', q.side, 'commodity', q.commodity_code, 'firmness', r.firmness,
                       'price', r.price::text, 'currency', r.currency, 'priceUnit', r.price_unit,
                       'grade', r.grade, 'deliveryBasis', r.delivery_basis,
                       'basisLocation', left(r.basis_location, 200),
                       'quantityMinMt', r.quantity_min_mt::text,
                       'quantityMaxMt', r.quantity_max_mt::text,
                       'deliveryStart', r.delivery_start, 'deliveryEnd', r.delivery_end,
                       'validUntil', r.valid_until) as item
                from app.quotes q
                join lateral (
                  select * from app.quote_revisions v
                   where v.quote_id = q.id order by v.revision_number desc limit 1
                ) r on true
               where q.organization_id = org and q.counterparty_id = company
                 and q.withdrawn_at is null and r.valid_until > now()
               order by r.valid_until, q.id
               limit 20) x
    ), '[]'::jsonb),
    'followUps', coalesce((
      select jsonb_agg(x.item order by x.due_at, x.id)
        from (select f.id, f.due_at,
                     jsonb_build_object('task', left(f.task, 300), 'dueAt', f.due_at,
                                        'assignedTo', f.assigned_to_name) as item
                from app.follow_ups f
               where f.organization_id = org and f.counterparty_id = company
                 and f.done_at is null and f.removed_at is null
               order by f.due_at, f.id
               limit 15) x
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.item order by h.occurred_at desc)
        from (
          select r.occurred_at,
                 jsonb_build_object(
                   'occurredAt', r.occurred_at, 'channel', r.channel,
                   'contactName', r.contact_name, 'by', r.recorded_by_name,
                   'notes', left(r.notes, 800),
                   'claudeNotes', (
                     select left(string_agg(cr.read_summary, ' ' order by cr.created_at), 800)
                       from app.calls c
                       join app.call_recordings cr on cr.call_id = c.id
                      where c.contact_log_entry_id = e.id and cr.read_summary is not null)
                 ) as item
            from app.contact_log_entries e
            join lateral (
              select * from app.contact_log_revisions v
               where v.entry_id = e.id order by v.revision_number desc limit 1
            ) r on true
           where e.organization_id = org and e.counterparty_id = company
             and not exists (select 1 from app.contact_log_removals x where x.entry_id = e.id)
           order by r.occurred_at desc
           limit 8
        ) h
    ), '[]'::jsonb),
    'call', latest_call,
    'answer', answer,
    -- The thread as context only (D1-02 of F-114-5b: the answered email is never among them):
    -- up to 7 earlier emails when replying, else the last 5; not removed, not automatic, 90 days.
    'thread', coalesce((
      select jsonb_agg(t.item order by t.occurred_at, t.id)
        from (select e.id, e.occurred_at,
                     jsonb_build_object(
                       'id', e.id, 'direction', e.direction, 'occurredAt', e.occurred_at)
                     || app.email_as_shown(e, 12000) as item
                from app.emails e
               where e.organization_id = org and e.counterparty_id = company
                 and (answering is null or e.id <> answering)
                 and (answer is null or e.occurred_at <= (answer ->> 'occurredAt')::timestamptz)
                 and not e.automatic
                 and (e.direction = 'incoming' or e.status = 'sent')
                 and e.occurred_at > now() - interval '90 days'
                 and not exists (select 1 from app.email_removals x where x.email_id = e.id)
               order by e.occurred_at desc, e.id desc
               limit case when answering is null then 5 else 7 end) t
    ), '[]'::jsonb)
  );
end
$$;

-- As in 20261116010000_email_reminders.sql, with the email as shown (a forward from its original
-- sender, its forwarding person and note as context) and the thread as shown.
create or replace function app.email_reading_context(email uuid, claim uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'emailId', m.id,
    'counterpartyId', m.counterparty_id,
    'counterpartyName', cp.legal_name,
    'counterpartyTypes', to_jsonb(cp.types::text[]),
    'fromName', m.from_name,
    'fromAddress', m.from_address,
    'contactId', m.contact_id,
    'subject', m.subject,
    'body', m.body_text,
    'receivedAt', m.occurred_at,
    'assigneeId', a.user_id,
    'forward', case when m.forwarded_by is null then null else jsonb_build_object(
      'byName', app.forwarder_name(m.forwarded_by),
      'byAddress', m.from_address,
      'fromAddress', m.original_from_address,
      'fromName', m.original_from_name,
      'subject', m.original_subject,
      'dateText', m.original_date_text,
      'offset', m.forward_offset,
      'textOffset', m.forward_text_offset,
      'depth', m.forward_depth) end,
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'role', k.role,
                                          'email', k.email, 'phone', k.phone)
                       order by k.name, k.id)
        from app.counterparty_contacts k
       where k.organization_id = m.organization_id and k.counterparty_id = m.counterparty_id
    ), '[]'::jsonb),
    'thread', coalesce((
      select jsonb_agg(t.item order by t.occurred_at, t.id)
        from (select o.id, o.occurred_at,
                     jsonb_build_object('direction', o.direction, 'at', o.occurred_at)
                     || app.email_as_shown(o, 6000) as item
                from app.emails o
               where o.organization_id = m.organization_id and o.counterparty_id = m.counterparty_id
                 and o.id <> m.id
                 and o.occurred_at < m.occurred_at
                 and o.occurred_at > m.occurred_at - interval '90 days'
                 and not o.automatic
                 and ((o.direction = 'outgoing' and o.status = 'sent')
                      or (o.direction = 'incoming' and o.auth_passed is true and not o.parse_failed))
                 and not exists (select 1 from app.email_removals x where x.email_id = o.id)
               order by o.occurred_at desc, o.id desc
               limit 4) t
    ), '[]'::jsonb)
  )
  from app.email_readings r
  join app.emails m on m.id = r.email_id
  join app.counterparties cp on cp.organization_id = m.organization_id and cp.id = m.counterparty_id
  left join lateral (
    select u.user_id
      from (select o.sent_by as user_id, 0 as rank
              from app.emails o
             where o.organization_id = m.organization_id and o.direction = 'outgoing'
               and app.email_id_core(m.in_reply_to) is not null
               and (app.email_id_core(o.message_id) = app.email_id_core(m.in_reply_to)
                    or app.email_id_core(o.provider_message_id) = app.email_id_core(m.in_reply_to))
            union all
            -- A forward is assigned to the person who forwarded it (F-233).
            select m.forwarded_by, 1
            union all
            select m.gss_member, 2) u
      join app.organization_members om
        on om.organization_id = m.organization_id and om.user_id = u.user_id and om.status = 'active'
     order by u.rank
     limit 1
  ) a on true
  where r.email_id = email and r.state = 'pending' and r.claim_token = claim
    and app.email_readable(r.email_id)
$$;

-- As in 20261116010000_email_reminders.sql; a reply draft to a forward goes to its original
-- sender (F-233).
create or replace function app.keep_email_auto_draft(
  draft uuid, claim uuid, model_name text, subject_text text, message_text text,
  check_list jsonb, placeholder_list jsonb, input_count integer, output_count integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  a app.email_auto_drafts;
  recipients app.email_address[];
begin
  if app.current_user_id() is not null then
    return false;
  end if;
  select * into a from app.email_auto_drafts d
   where d.id = draft and d.state = 'pending' and d.claim_token = claim
   for update;
  if not found then
    return false;
  end if;
  perform 1 from app.counterparties c
   where c.organization_id = a.organization_id and c.id = a.counterparty_id for share;
  if not app.auto_draft_source_stands(a.id) or app.auto_draft_answered(a.id) then
    return false;
  end if;
  if a.source = 'reminder' then
    select e.to_addresses into recipients from app.emails e where e.id = a.email_id;
  elsif a.source = 'email' then
    select array[coalesce(e.original_from_address, e.reply_to, e.from_address)] into recipients
      from app.emails e where e.id = a.email_id;
  else
    select coalesce(array_agg(k.email), '{}') into recipients
      from app.calls c
      join app.counterparty_contacts k
        on k.organization_id = c.organization_id and k.counterparty_id = c.counterparty_id
       and k.id = c.contact_id
     where c.id = a.call_id and k.email is not null;
  end if;
  update app.email_auto_drafts
     set state = 'ready', subject = subject_text, message = message_text,
         to_addresses = recipients, check_this = check_list, placeholders = placeholder_list,
         model = case when model_name ~ '^[a-z0-9][a-z0-9.-]{0,79}$' then model_name end,
         input_tokens = greatest(input_count, 0), output_tokens = greatest(output_count, 0),
         drafted_at = now(), claimed_at = null, claim_token = null
   where id = a.id;
  return true;
end
$$;

-- Privileges ----------------------------------------------------------------------------------

revoke all on app.member_forwarding_addresses, app.forwarding_code_sends
  from public, anon, authenticated, service_role, app_api;
revoke all on function
  app.keep_forwarding_rows(), app.lock_own_membership(uuid),
  app.add_forwarding_address(uuid, text, text), app.reserve_forwarding_code(uuid, uuid),
  app.finish_forwarding_code(uuid, uuid, text), app.fail_forwarding_code(uuid, uuid),
  app.confirm_forwarding_address(uuid, uuid, text), app.remove_forwarding_address(uuid, uuid),
  app.my_forwarding_addresses(uuid), app.email_as_shown(app.emails, integer), app.forwarder_name(uuid),
  app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text,
                    text[], boolean, boolean, boolean, text, integer, jsonb, timestamptz, text,
                    text, text, text, integer, integer, integer)
  from public, anon, authenticated, service_role, app_api;
grant execute on function
  app.add_forwarding_address(uuid, text, text), app.reserve_forwarding_code(uuid, uuid),
  app.finish_forwarding_code(uuid, uuid, text), app.fail_forwarding_code(uuid, uuid),
  app.confirm_forwarding_address(uuid, uuid, text), app.remove_forwarding_address(uuid, uuid),
  app.my_forwarding_addresses(uuid),
  app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text,
                    text[], boolean, boolean, boolean, text, integer, jsonb, timestamptz, text,
                    text, text, text, integer, integer, integer)
  to app_api;
