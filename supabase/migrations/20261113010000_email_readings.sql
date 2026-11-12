-- F-114 step 5a: Claude reads each received email on a company, as it reads call transcripts,
-- and drafts bids and offers, follow-ups and contact details that a person verifies.
--
-- - app.email_readings: one row per received email Claude reads or skips (its claim, attempts,
--   the lines Claude saw and the result). Mail existing before this migration is skipped.
-- - app.email_reading_requests: one row per request claimed for Anthropic, the daily cost guard
--   (Codex's design review, F-114-5a-D1-02): at most 200 a day per organization, counted when
--   claimed, refunded only for a request Anthropic did not take.
-- - app.call_drafts gains an email source: a draft comes from a call's recording or an email.
--
-- Read: received mail on a company, not automatic, readable, whose sender checks passed
-- (auth_passed true; the owner's answer 20), not removed, its company not archived.
-- Every write goes through the SECURITY DEFINER functions below, called by the Worker's job
-- without a signed-in person; app_api only reads the tables.

create table app.email_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  email_id uuid not null unique,
  state text not null check (state in ('skipped', 'pending', 'read')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  claimed_at timestamptz,
  claim_token uuid,
  read_at timestamptz,
  read_model text check (read_model is null or length(read_model) <= 100),
  read_input_tokens integer check (read_input_tokens is null or read_input_tokens >= 0),
  read_output_tokens integer check (read_output_tokens is null or read_output_tokens >= 0),
  read_summary text check (read_summary is null or length(read_summary) <= 2000),
  -- The exact lines Claude saw (line 0 the subject), so a draft's cited lines show later even if
  -- the cutting rules change.
  text_read jsonb check (text_read is null or (jsonb_typeof(text_read) = 'array'
                                               and pg_column_size(text_read) <= 65536)),
  text_cut boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_readings_email_fkey foreign key (organization_id, email_id)
    references app.emails (organization_id, id),
  check ((state = 'read') = (read_at is not null)),
  check ((state = 'read') = (text_read is not null)),
  check (claim_token is null or state = 'pending'),
  check ((claim_token is null) = (claimed_at is null))
);

create index email_readings_pending_idx on app.email_readings (organization_id)
  where state = 'pending';

create table app.email_reading_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  email_id uuid not null,
  claim_token uuid not null unique,
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  refunded_at timestamptz,
  constraint email_reading_requests_email_fkey foreign key (organization_id, email_id)
    references app.emails (organization_id, id)
);

create index email_reading_requests_day_idx on app.email_reading_requests (organization_id, claimed_at)
  where refunded_at is null;

-- A draft from an email: no call or recording, the email instead.
alter table app.call_drafts alter column call_id drop not null;
alter table app.call_drafts alter column recording_id drop not null;
alter table app.call_drafts add column email_id uuid;
alter table app.call_drafts
  add constraint call_drafts_email_fkey foreign key (organization_id, email_id)
    references app.emails (organization_id, id),
  add constraint call_drafts_one_source check (
    (call_id is not null and recording_id is not null and email_id is null)
    or (call_id is null and recording_id is null and email_id is not null)),
  add constraint call_drafts_email_position_key unique (email_id, position);

create trigger email_readings_touch_updated_at
  before update on app.email_readings
  for each row execute function app.touch_updated_at();
create trigger email_readings_keep
  before delete on app.email_readings
  for each row execute function app.keep_emails();
create trigger email_readings_no_truncate
  before truncate on app.email_readings
  for each statement execute function app.keep_emails();
create trigger email_reading_requests_keep
  before delete on app.email_reading_requests
  for each row execute function app.keep_emails();
create trigger email_reading_requests_no_truncate
  before truncate on app.email_reading_requests
  for each statement execute function app.keep_emails();
create trigger email_readings_audit
  after insert or update on app.email_readings
  for each row execute function app.record_audit_event();

alter table app.email_readings enable row level security;
alter table app.email_reading_requests enable row level security;

-- Everyone on the team reads the readings, like the emails they come from. The requests are
-- the job's own count; nobody reads them through the API.
create policy email_readings_select_for_members on app.email_readings
  for select to app_api using (app.is_active_member(organization_id));

-- Mail existing now is never read (the plan: only mail received after 5a goes live).
insert into app.email_readings (organization_id, email_id, state)
select e.organization_id, e.id, 'skipped'
  from app.emails e
 where e.direction = 'incoming';

-- Whether an email may be read now: received, on a company that is not archived, not
-- automatic, readable, its sender checks passed, not removed.
create function app.email_readable(email uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from app.emails e
      join app.counterparties c on c.organization_id = e.organization_id and c.id = e.counterparty_id
     where e.id = email and e.direction = 'incoming' and c.archived_at is null
       and not e.automatic and not e.parse_failed and e.auth_passed is true
       and not exists (select 1 from app.email_removals r where r.email_id = e.id))
$$;

-- Claims up to `most` emails (at most 10) for Claude to read now, newest first, each with a
-- reserved request (D1-02): first a reading row for each received email on a company that has
-- none (pending when it may be read, else skipped for good: automatic, unreadable, sender
-- checks not passed); removed mail still pending is skipped. Then, per organization under an
-- advisory lock, no more than 200 requests in the last 24 hours, counting every unrefunded
-- claim, kept or not.
create function app.claim_email_readings(most integer)
returns table (email_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted integer := greatest(least(most, 10), 0);
  org uuid;
  used integer;
  e record;
  token uuid;
begin
  if app.current_user_id() is not null then
    return;
  end if;
  insert into app.email_readings (organization_id, email_id, state)
  select m.organization_id, m.id,
         case when not m.automatic and not m.parse_failed and m.auth_passed is true
              then 'pending' else 'skipped' end
    from app.emails m
   where m.direction = 'incoming' and m.counterparty_id is not null
     and not exists (select 1 from app.email_readings r where r.email_id = m.id)
  on conflict on constraint email_readings_email_id_key do nothing;

  update app.email_readings r
     set state = 'skipped', claimed_at = null, claim_token = null
   where r.state = 'pending'
     and exists (select 1 from app.email_removals x where x.email_id = r.email_id);

  for org in
    select distinct r.organization_id from app.email_readings r where r.state = 'pending'
  loop
    exit when wanted <= 0;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('app.email_readings:' || org::text, 0));
    select count(*) into used
      from app.email_reading_requests q
     where q.organization_id = org and q.refunded_at is null
       and q.claimed_at > pg_catalog.clock_timestamp() - interval '24 hours';
    for e in
      select r.email_id
        from app.email_readings r
        join app.emails m on m.id = r.email_id
       where r.organization_id = org and r.state = 'pending' and r.attempts < 5
         and (r.claimed_at is null
              or r.claimed_at < pg_catalog.clock_timestamp() - interval '10 minutes')
         and app.email_readable(r.email_id)
       order by m.occurred_at desc, r.email_id
       limit greatest(least(wanted, 200 - used), 0)
       for update of r skip locked
    loop
      token := gen_random_uuid();
      update app.email_readings r
         set attempts = r.attempts + 1, claimed_at = pg_catalog.clock_timestamp(), claim_token = token
       where r.email_id = e.email_id;
      insert into app.email_reading_requests (organization_id, email_id, claim_token)
      values (org, e.email_id, token);
      email_id := e.email_id;
      claim_token := token;
      wanted := wanted - 1;
      return next;
    end loop;
  end loop;
end
$$;

-- Gives back a claim whose request Anthropic did not take (a wrong key, the spend limit, an
-- overload, no connection): its attempt is not counted and its request refunded. Only the
-- claim given, and only while not read.
create function app.release_email_reading(email uuid, claim uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.email_reading_requests
     set refunded_at = pg_catalog.clock_timestamp()
   where email_id = email and claim_token = claim and refunded_at is null
     and exists (select 1 from app.email_readings r
                  where r.email_id = email and r.state = 'pending' and r.claim_token = claim);
  update app.email_readings
     set attempts = greatest(attempts - 1, 0), claimed_at = null, claim_token = null
   where email_id = email and state = 'pending' and claim_token = claim;
$$;

-- What Claude is given to read a claimed email: its subject and text, who sent it and when,
-- the company's name, kinds and contacts, and the GSS person a follow-up goes to (the sender
-- of the email it answers, else the person whose address it was sent to, while an active
-- member). Null when the claim is not this one or the email may no longer be read.
create function app.email_reading_context(email uuid, claim uuid)
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
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'role', k.role,
                                          'email', k.email, 'phone', k.phone)
                       order by k.name, k.id)
        from app.counterparty_contacts k
       where k.organization_id = m.organization_id and k.counterparty_id = m.counterparty_id
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
            select m.gss_member, 1) u
      join app.organization_members om
        on om.organization_id = m.organization_id and om.user_id = u.user_id and om.status = 'active'
     order by u.rank
     limit 1
  ) a on true
  where r.email_id = email and r.state = 'pending' and r.claim_token = claim
    and app.email_readable(r.email_id)
$$;

-- Keeps Claude's reading of an email and its drafts, once, under its current claim, while the
-- email may still be read: false otherwise. A contact draft naming a contact not of the
-- email's company becomes a new contact. `lines` are the lines Claude saw (none sent when the
-- email had no text of its own: then no drafts, no model and no tokens).
create function app.keep_email_reading(
  email uuid,
  claim uuid,
  model text,
  summary text,
  lines jsonb,
  cut boolean,
  drafts jsonb,
  input_tokens integer,
  output_tokens integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  d record;
  draft_contact uuid;
begin
  if jsonb_typeof(drafts) is distinct from 'array' or jsonb_array_length(drafts) > 30 then
    raise exception 'drafts must be an array of at most 30' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(lines) is distinct from 'array' then
    raise exception 'lines must be an array' using errcode = 'check_violation';
  end if;
  select er.email_id, m.organization_id, m.counterparty_id into r
    from app.email_readings er
    join app.emails m on m.id = er.email_id
   where er.email_id = email and er.state = 'pending' and er.claim_token = claim
   for update of er;
  if not found then
    return false;
  end if;
  -- The company locked (as archiving takes it), then the email's state seen again.
  perform 1 from app.counterparties c
   where c.organization_id = r.organization_id and c.id = r.counterparty_id for share;
  if not app.email_readable(email) then
    return false;
  end if;
  update app.email_readings
     set state = 'read', read_at = now(), read_model = model, read_summary = summary,
         read_input_tokens = input_tokens, read_output_tokens = output_tokens,
         text_read = lines, text_cut = coalesce(cut, false), claimed_at = null, claim_token = null
   where email_id = email;
  -- Nothing was sent to Claude (no text of its own): its reserved request is refunded.
  if model is null then
    if jsonb_array_length(drafts) > 0 then
      raise exception 'drafts need a model' using errcode = 'check_violation';
    end if;
    update app.email_reading_requests
       set refunded_at = pg_catalog.clock_timestamp()
     where email_id = email and claim_token = claim and refunded_at is null;
  end if;
  for d in select value, ordinality - 1 as position from jsonb_array_elements(drafts) with ordinality
  loop
    draft_contact := null;
    if d.value ->> 'kind' = 'contact' and d.value ->> 'contactId' is not null then
      select k.id into draft_contact
        from app.counterparty_contacts k
       where k.organization_id = r.organization_id and k.counterparty_id = r.counterparty_id
         and k.id::text = d.value ->> 'contactId';
    end if;
    insert into app.call_drafts (organization_id, counterparty_id, email_id, position, kind,
                                 fields, lines, contact_id)
    values (r.organization_id, r.counterparty_id, email, d.position, d.value ->> 'kind',
            d.value -> 'fields', d.value -> 'lines', draft_contact);
  end loop;
  return true;
end
$$;

-- As in 20261105020000_call_reading_claims.sql, and a draft from an email removed since is not
-- found: it is no longer listed, and is neither verified nor dismissed.
create or replace function app.decide_call_draft(draft uuid, decision text, result uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  d app.call_drafts;
begin
  if uid is null or decision not in ('accepted', 'dismissed') then
    return 'not_found';
  end if;
  select * into d from app.call_drafts where id = draft for update;
  if not found or not app.is_active_member(d.organization_id) then
    return 'not_found';
  end if;
  if d.email_id is not null
     and exists (select 1 from app.email_removals x where x.email_id = d.email_id) then
    return 'not_found';
  end if;
  if not (case d.kind
             when 'quote' then app.can_enter_quotes(d.organization_id)
             when 'follow_up' then app.can_log_contacts(d.organization_id)
             else app.can_edit_directory(d.organization_id)
           end) then
    return 'forbidden';
  end if;
  if d.status <> 'open' then
    return 'already_decided';
  end if;
  if decision = 'dismissed' then
    result := null;
  elsif result is null or not (case d.kind
      when 'quote' then exists (
        select 1 from app.quotes q
         where q.id = result and q.organization_id = d.organization_id
           and q.counterparty_id = d.counterparty_id and q.created_by = uid)
      when 'follow_up' then exists (
        select 1 from app.follow_ups f
         where f.id = result and f.organization_id = d.organization_id
           and f.counterparty_id = d.counterparty_id and f.created_by = uid)
      else exists (
        select 1 from app.counterparty_contacts k
         where k.id = result and k.organization_id = d.organization_id
           and k.counterparty_id = d.counterparty_id
           and (k.id = d.contact_id or (d.contact_id is null and k.created_by = uid)))
    end) then
    return 'result_not_found';
  elsif d.kind in ('quote', 'follow_up') and exists (
      select 1 from app.call_drafts o
       where o.kind = d.kind and o.result_id = result and o.status = 'accepted') then
    return 'result_not_found';
  end if;
  update app.call_drafts
     set status = decision, decided_by = uid,
         decided_by_name = app.member_name(d.organization_id, uid),
         decided_at = now(), result_id = result
   where id = d.id;
  return 'decided';
end
$$;

revoke all on app.email_readings, app.email_reading_requests
  from public, anon, authenticated, service_role, app_api;
grant select on app.email_readings to app_api;
revoke all on function app.email_readable(uuid), app.claim_email_readings(integer),
  app.release_email_reading(uuid, uuid), app.email_reading_context(uuid, uuid),
  app.keep_email_reading(uuid, uuid, text, text, jsonb, boolean, jsonb, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function app.claim_email_readings(integer),
  app.release_email_reading(uuid, uuid), app.email_reading_context(uuid, uuid),
  app.keep_email_reading(uuid, uuid, text, text, jsonb, boolean, jsonb, integer, integer)
  to app_api;
