-- F-114 step 5c (part 1): email drafts Claude makes by itself (the owner's answers 25 to 34 in
-- docs/FEATURES.md; Codex's design review, docs/reviews/F-114-5c.md).
--
-- When Claude's reading of a call or of a received email says an email is wanted (the call asked
-- for one, or the email needs an answer), the reading's keep function adds a pending row to
-- app.email_auto_drafts in the same transaction. The 2-minute job claims pending rows (within the
-- organization's 200 Claude requests a day, now shared with the email readings), asks Claude for
-- the email and keeps it. The draft then waits on the company's Emails card and on Follow-ups,
-- for the person assigned or for anyone, until a person sends it (the usual form and Send) or
-- dismisses it. Nothing is ever sent by itself (AGENTS.md rule 8).
--
-- - Sent is not stored on the draft (D1-01): an outgoing email links it (app.emails.auto_draft_id);
--   a draft with a linked email sending or sent cannot be linked again or dismissed, a refused
--   (failed) one frees it.
-- - A row out of attempts becomes failed only once its last claim has lapsed (D1-03).
-- - The body of app.email_draft_context moves into app.email_draft_records (no member check,
--   callable only by these SECURITY DEFINER functions), which can pin the call to one recording.
-- - app.keep_call_reading and app.keep_email_reading gain the signal (two more arguments); the
--   old signatures pass none, for the seconds between this migration and the Worker's deploy.
-- - app.start_outgoing_email gains auto_draft; the 12-argument one passes none (the 10-argument
--   wrapper of step 5b calls it, unchanged).

create table app.email_auto_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  counterparty_id uuid not null,
  source text not null check (source in ('call', 'email')),
  call_id uuid,
  recording_id uuid unique,
  email_id uuid unique,
  -- What the email should cover, in Claude's words from the reading (never a check's source).
  about text not null check (length(about) between 1 and 200 and about !~ '[[:cntrl:]]'),
  -- The person it waits for; null: anyone on the team (the owner's answer 32).
  assigned_to uuid references auth.users (id),
  -- The assignee's own address when they have one, else the shared one (answer 31).
  from_choice text not null check (from_choice in ('own', 'shared')),
  state text not null default 'pending' check (state in ('pending', 'ready', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  claimed_at timestamptz,
  claim_token uuid,
  subject text check (length(subject) <= 200 and subject !~ '[\r\n]'),
  message text check (length(message) <= 8000),
  to_addresses app.email_address[] check (cardinality(to_addresses) <= 50),
  check_this jsonb check (jsonb_typeof(check_this) = 'array' and jsonb_array_length(check_this) <= 20
                          and pg_column_size(check_this) <= 4096),
  placeholders jsonb check (jsonb_typeof(placeholders) = 'array'
                            and jsonb_array_length(placeholders) <= 20
                            and pg_column_size(placeholders) <= 4096),
  model text check (model is null or model ~ '^[a-z0-9][a-z0-9.-]{0,79}$'),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  drafted_at timestamptz,
  -- What a person did with it: dismissed, or nothing (sent is its linked emails, D1-01).
  dismissed_by uuid references auth.users (id),
  dismissed_by_name app.label,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint email_auto_drafts_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id),
  constraint email_auto_drafts_call_fkey foreign key (organization_id, call_id)
    references app.calls (organization_id, id),
  constraint email_auto_drafts_recording_fkey foreign key (organization_id, recording_id)
    references app.call_recordings (organization_id, id),
  constraint email_auto_drafts_email_fkey foreign key (organization_id, email_id)
    references app.emails (organization_id, id),
  constraint email_auto_drafts_source_shape check (
    (source = 'call' and call_id is not null and recording_id is not null and email_id is null)
    or (source = 'email' and call_id is null and recording_id is null and email_id is not null)),
  constraint email_auto_drafts_ready_shape check (
    (state = 'ready') = (subject is not null and message is not null and to_addresses is not null
                         and check_this is not null and placeholders is not null
                         and drafted_at is not null and input_tokens is not null
                         and output_tokens is not null)),
  check (claim_token is null or state = 'pending'),
  check ((claim_token is null) = (claimed_at is null)),
  check ((dismissed_at is null) = (dismissed_by is null)),
  check ((dismissed_at is null) = (dismissed_by_name is null)),
  check (dismissed_at is null or state = 'ready')
);

create index email_auto_drafts_pending_idx on app.email_auto_drafts (organization_id, created_at)
  where state = 'pending';
create index email_auto_drafts_company_idx on app.email_auto_drafts (organization_id, counterparty_id)
  where state = 'ready' and dismissed_at is null;
create index email_auto_drafts_assigned_idx on app.email_auto_drafts (organization_id, assigned_to)
  where state = 'ready' and dismissed_at is null;

-- The cost ledger: one row per request claimed for Anthropic, as app.email_reading_requests.
create table app.email_auto_draft_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  auto_draft_id uuid not null,
  claim_token uuid not null unique,
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  refunded_at timestamptz,
  constraint email_auto_draft_requests_draft_fkey foreign key (organization_id, auto_draft_id)
    references app.email_auto_drafts (organization_id, id)
);

create index email_auto_draft_requests_day_idx
  on app.email_auto_draft_requests (organization_id, claimed_at) where refunded_at is null;

create trigger email_auto_drafts_touch_updated_at
  before update on app.email_auto_drafts
  for each row execute function app.touch_updated_at();
create trigger email_auto_drafts_keep
  before delete on app.email_auto_drafts
  for each row execute function app.keep_emails();
create trigger email_auto_drafts_no_truncate
  before truncate on app.email_auto_drafts
  for each statement execute function app.keep_emails();
create trigger email_auto_drafts_audit
  after insert or update on app.email_auto_drafts
  for each row execute function app.record_audit_event();
create trigger email_auto_draft_requests_keep
  before delete on app.email_auto_draft_requests
  for each row execute function app.keep_emails();
create trigger email_auto_draft_requests_no_truncate
  before truncate on app.email_auto_draft_requests
  for each statement execute function app.keep_emails();

alter table app.email_auto_drafts enable row level security;
alter table app.email_auto_draft_requests enable row level security;

-- Everyone on the team reads the drafts, as every email (the owner's answer 8). Writes go through
-- the functions below; the ledger is the job's own.
create policy email_auto_drafts_select_for_members on app.email_auto_drafts
  for select to app_api using (app.is_active_member(organization_id));

-- An outgoing email started from an automatic draft.
alter table app.emails
  add column auto_draft_id uuid,
  add constraint emails_auto_draft_fkey foreign key (organization_id, auto_draft_id)
    references app.email_auto_drafts (organization_id, id),
  add constraint emails_auto_draft_outgoing_only check (
    direction = 'outgoing' or auto_draft_id is null);

create index emails_auto_draft_idx on app.emails (auto_draft_id) where auto_draft_id is not null;

-- Whether a draft has a linked email being sent or sent (D1-01): then it is taken.
create function app.auto_draft_taken(draft uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.emails e
                  where e.auto_draft_id = draft and e.status in ('sending', 'sent'))
$$;

-- Whether a pending or ready draft's source still stands: its company not archived, and for an
-- email draft the email not removed.
create function app.auto_draft_source_stands(draft uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.email_auto_drafts d
      join app.counterparties c on c.organization_id = d.organization_id and c.id = d.counterparty_id
     where d.id = draft and c.archived_at is null
       and (d.email_id is null
            or not exists (select 1 from app.email_removals r where r.email_id = d.email_id)))
$$;

-- Whether a person already answered the draft's source by email, sent (D1-01: only sent mail
-- counts): a reply to its received email, or for a call any email to the company since the call.
create function app.auto_draft_answered(draft uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.email_auto_drafts d
      join app.emails e on e.organization_id = d.organization_id and e.direction = 'outgoing'
                       and e.status = 'sent'
                       and e.auto_draft_id is distinct from d.id
     left join app.calls c on c.id = d.call_id
     where d.id = draft
       and ((d.email_id is not null and e.reply_to_email_id = d.email_id)
            or (d.call_id is not null and e.counterparty_id = d.counterparty_id
                and e.occurred_at > c.created_at)))
$$;

-- The GSS person a received email is for: the sender of the GSS email it answers, else the
-- person whose own address it was sent to, while an active member (as in step 5a).
create function app.email_assignee(email uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.user_id
    from app.emails m
    cross join lateral (
      select o.sent_by as user_id, 0 as rank
        from app.emails o
       where o.organization_id = m.organization_id and o.direction = 'outgoing'
         and app.email_id_core(m.in_reply_to) is not null
         and (app.email_id_core(o.message_id) = app.email_id_core(m.in_reply_to)
              or app.email_id_core(o.provider_message_id) = app.email_id_core(m.in_reply_to))
      union all
      select m.gss_member, 1) u
    join app.organization_members om
      on om.organization_id = m.organization_id and om.user_id = u.user_id and om.status = 'active'
   where m.id = email
   order by u.rank
   limit 1
$$;

-- Adds the pending draft a reading asked for (called by the keep functions only). Nothing when not
-- wanted, the about line is empty, the company is archived, or the source already has one.
create function app.add_email_auto_draft(
  org uuid, company uuid, src_call uuid, src_recording uuid, src_email uuid, about_text text,
  assignee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  about_line text := left(btrim(regexp_replace(coalesce(about_text, ''), '[[:cntrl:]]+', ' ', 'g')), 200);
  person uuid := assignee;
begin
  if about_line = '' then
    return;
  end if;
  if not exists (select 1 from app.counterparties c
                  where c.organization_id = org and c.id = company and c.archived_at is null) then
    return;
  end if;
  if person is not null and not exists (
       select 1 from app.organization_members om
        where om.organization_id = org and om.user_id = person and om.status = 'active') then
    person := null;
  end if;
  insert into app.email_auto_drafts (organization_id, counterparty_id, source, call_id,
                                     recording_id, email_id, about, assigned_to, from_choice)
  values (org, company, case when src_email is null then 'call' else 'email' end, src_call, src_recording,
          src_email, about_line, person,
          case when person is not null and exists (
                 select 1 from app.member_email_addresses a
                  where a.organization_id = org and a.user_id = person)
               then 'own' else 'shared' end)
  on conflict do nothing;
end
$$;

-- What Claude is given to write an email to `company` (step 5b's context, without the member
-- check, for the SECURITY DEFINER functions only); `pinned` pins the call to one recording.
create function app.email_draft_records(org uuid, company uuid, answering uuid, pinned uuid)
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
             'from', e.from_address, 'fromName', e.from_name, 'to', to_jsonb(e.to_addresses),
             'subject', left(e.subject, 300), 'body', left(e.body_text, 12000),
             'automatic', e.automatic)
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
    -- The thread as context only (D1-02: the answered email is never among them): up to 7
    -- earlier emails when replying, else the last 5; not removed, not automatic, 90 days.
    'thread', coalesce((
      select jsonb_agg(t.item order by t.occurred_at, t.id)
        from (select e.id, e.occurred_at,
                     jsonb_build_object(
                       'id', e.id, 'direction', e.direction, 'occurredAt', e.occurred_at,
                       'from', e.from_address, 'fromName', e.from_name,
                       'subject', left(e.subject, 300), 'body', left(e.body_text, 12000)) as item
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

-- Step 5b's context for the Draft with Claude button: the same output, through the records.
create or replace function app.email_draft_context(org uuid, company uuid, answering uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when app.current_user_id() is null or not app.is_active_member(org) then null
           else app.email_draft_records(org, company, answering, null)
         end
$$;

-- The keep functions with the signal (an email is wanted, and what about). The rest is as in
-- 20261105020000_call_reading_claims.sql: the reading kept once, under its current claim.
create function app.keep_call_reading(
  recording uuid,
  claim uuid,
  model text,
  voicemail boolean,
  summary text,
  drafts jsonb,
  input_tokens integer,
  output_tokens integer,
  email_wanted boolean,
  email_about text
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
  select cr.id, cr.organization_id, cr.call_id, c.counterparty_id, c.placed_by into r
    from app.call_recordings cr
    join app.calls c on c.id = cr.call_id and c.organization_id = cr.organization_id
   where cr.id = recording and cr.read_at is null and cr.transcript is not null
     and cr.reading_claim_token = claim
   for update of cr;
  if not found then
    return false;
  end if;
  update app.call_recordings
     set read_at = now(), read_model = model, read_voicemail = voicemail, read_summary = summary,
         read_input_tokens = input_tokens, read_output_tokens = output_tokens,
         reading_claimed_at = null, reading_claim_token = null
   where id = r.id;
  for d in select value, ordinality - 1 as position from jsonb_array_elements(drafts) with ordinality
  loop
    draft_contact := null;
    if d.value ->> 'kind' = 'contact' and d.value ->> 'contactId' is not null then
      select k.id into draft_contact
        from app.counterparty_contacts k
       where k.organization_id = r.organization_id and k.counterparty_id = r.counterparty_id
         and k.id::text = d.value ->> 'contactId';
    end if;
    insert into app.call_drafts (organization_id, counterparty_id, call_id, recording_id, position,
                                 kind, fields, lines, contact_id)
    values (r.organization_id, r.counterparty_id, r.call_id, r.id, d.position,
            d.value ->> 'kind', d.value -> 'fields', d.value -> 'lines', draft_contact);
  end loop;
  if email_wanted is true then
    perform app.add_email_auto_draft(r.organization_id, r.counterparty_id, r.call_id, r.id, null,
                                     email_about, r.placed_by);
  end if;
  return true;
end
$$;

create or replace function app.keep_call_reading(
  recording uuid, claim uuid, model text, voicemail boolean, summary text, drafts jsonb,
  input_tokens integer, output_tokens integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select app.keep_call_reading(recording, claim, model, voicemail, summary, drafts,
                               input_tokens, output_tokens, false, null::text)
$$;

-- As in 20261113010000_email_readings.sql, with the signal.
create function app.keep_email_reading(
  email uuid,
  claim uuid,
  model text,
  summary text,
  lines jsonb,
  cut boolean,
  drafts jsonb,
  input_tokens integer,
  output_tokens integer,
  email_wanted boolean,
  email_about text
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
    if jsonb_array_length(drafts) > 0 or email_wanted is true then
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
  if email_wanted is true then
    perform app.add_email_auto_draft(r.organization_id, r.counterparty_id, null, null, email,
                                     email_about, app.email_assignee(email));
  end if;
  return true;
end
$$;

create or replace function app.keep_email_reading(
  email uuid, claim uuid, model text, summary text, lines jsonb, cut boolean, drafts jsonb,
  input_tokens integer, output_tokens integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select app.keep_email_reading(email, claim, model, summary, lines, cut, drafts, input_tokens,
                                output_tokens, false, null::text)
$$;

-- The organization's Claude requests of the jobs in the last 24 hours, unrefunded: the email
-- readings and the automatic email drafts, under one ceiling of 200 (the call readings are not
-- counted, as before).
create function app.job_claude_requests_today(org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select ((select count(*) from app.email_reading_requests q
            where q.organization_id = org and q.refunded_at is null
              and q.claimed_at > pg_catalog.clock_timestamp() - interval '24 hours')
        + (select count(*) from app.email_auto_draft_requests q
            where q.organization_id = org and q.refunded_at is null
              and q.claimed_at > pg_catalog.clock_timestamp() - interval '24 hours'))::integer
$$;

-- As in 20261113010000_email_readings.sql; the ceiling now counts both ledgers.
create or replace function app.claim_email_readings(most integer)
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
    used := app.job_claude_requests_today(org);
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

-- Claims up to `most` pending drafts (at most 10) for Claude to write now, oldest first, each
-- with a reserved request under the shared ceiling. The job only (no signed-in person). First:
-- a pending row whose source no longer stands, or that a person already answered by email, is
-- skipped; one out of attempts whose last claim has lapsed is failed (D1-03).
create function app.claim_email_auto_drafts(most integer)
returns table (draft_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted integer := greatest(least(most, 10), 0);
  org uuid;
  used integer;
  d record;
  token uuid;
begin
  if app.current_user_id() is not null then
    return;
  end if;
  update app.email_auto_drafts a
     set state = 'skipped', claimed_at = null, claim_token = null
   where a.state = 'pending'
     and (a.claimed_at is null or a.claimed_at < pg_catalog.clock_timestamp() - interval '10 minutes')
     and (not app.auto_draft_source_stands(a.id) or app.auto_draft_answered(a.id));
  update app.email_auto_drafts a
     set state = 'failed', claimed_at = null, claim_token = null
   where a.state = 'pending' and a.attempts >= 5
     and (a.claimed_at is null or a.claimed_at < pg_catalog.clock_timestamp() - interval '10 minutes');

  for org in
    select distinct a.organization_id from app.email_auto_drafts a where a.state = 'pending'
  loop
    exit when wanted <= 0;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('app.email_readings:' || org::text, 0));
    used := app.job_claude_requests_today(org);
    for d in
      select a.id
        from app.email_auto_drafts a
       where a.organization_id = org and a.state = 'pending' and a.attempts < 5
         and (a.claimed_at is null
              or a.claimed_at < pg_catalog.clock_timestamp() - interval '10 minutes')
       order by a.created_at, a.id
       limit greatest(least(wanted, 200 - used), 0)
       for update of a skip locked
    loop
      token := gen_random_uuid();
      update app.email_auto_drafts a
         set attempts = a.attempts + 1, claimed_at = pg_catalog.clock_timestamp(), claim_token = token
       where a.id = d.id;
      insert into app.email_auto_draft_requests (organization_id, auto_draft_id, claim_token)
      values (org, d.id, token);
      draft_id := d.id;
      claim_token := token;
      wanted := wanted - 1;
      return next;
    end loop;
  end loop;
end
$$;

-- Gives back a claim whose request Anthropic did not take: its attempt is not counted and its
-- request refunded. Only the claim given, and only while pending.
create function app.release_email_auto_draft(draft uuid, claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is not null then
    return;
  end if;
  update app.email_auto_drafts a
     set attempts = greatest(a.attempts - 1, 0), claimed_at = null, claim_token = null
   where a.id = draft and a.state = 'pending' and a.claim_token = claim;
  if found then
    update app.email_auto_draft_requests q
       set refunded_at = pg_catalog.clock_timestamp()
     where q.auto_draft_id = draft and q.claim_token = claim and q.refunded_at is null;
  end if;
end
$$;

-- What Claude is given to write a claimed draft: the company's records as for the button (the
-- call pinned to the draft's recording; the received email as the one answered), and:
-- - source, about and when the source happened;
-- - sender: the assignee's name and title (null when for anyone), and whether From is shared;
-- - offers: for a buyer, what GSS has (the owner's answer 27): live offers of other companies in
--   the commodities the buyer buys (all when none listed), at most 20, newest first, with
--   grain, grade, firmness, quantity, delivery period and area only: never a price, a currency,
--   a seller's name, a place's name or notes.
-- Null when the claim is not this one, or the source no longer stands or was answered.
create function app.email_auto_draft_context(draft uuid, claim uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a app.email_auto_drafts;
  records jsonb;
  happened timestamptz;
  is_buyer boolean;
begin
  if app.current_user_id() is not null then
    return null;
  end if;
  select * into a from app.email_auto_drafts d
   where d.id = draft and d.state = 'pending' and d.claim_token = claim;
  if not found or not app.auto_draft_source_stands(a.id) or app.auto_draft_answered(a.id) then
    return null;
  end if;
  records := app.email_draft_records(a.organization_id, a.counterparty_id, a.email_id,
                                     a.recording_id);
  if records is null then
    return null;
  end if;
  if a.source = 'call' then
    if records -> 'call' is null or jsonb_typeof(records -> 'call') = 'null' then
      return null;
    end if;
    select c.created_at into happened from app.calls c where c.id = a.call_id;
  else
    select e.occurred_at into happened from app.emails e where e.id = a.email_id;
  end if;
  select 'buyer' = any (c.types) into is_buyer
    from app.counterparties c where c.id = a.counterparty_id;
  return records || jsonb_build_object(
    'source', a.source,
    'about', a.about,
    'happenedAt', happened,
    'sender', (
      -- As app.member_name, which answers only a signed-in member (the job has none).
      select jsonb_build_object(
               'name', btrim(left(coalesce(
                 nullif(btrim(concat_ws(' ',
                   nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
                   nullif(btrim(u.raw_user_meta_data ->> 'last_name'), ''))), ''),
                 nullif(btrim(u.email::text), ''),
                 'GSS staff member'), 200)),
               'title', s.title)
        from app.organization_members om
        join auth.users u on u.id = om.user_id
        left join app.member_signature_details s
          on s.organization_id = om.organization_id and s.user_id = om.user_id
       where om.organization_id = a.organization_id and om.user_id = a.assigned_to
         and om.status = 'active'),
    'shared', a.from_choice = 'shared',
    'offers', case when not is_buyer then '[]'::jsonb else coalesce((
      select jsonb_agg(x.item order by x.created_at desc, x.id)
        from (select q.id, q.created_at,
                     jsonb_build_object(
                       'commodity', q.commodity_code, 'grade', r.grade, 'firmness', r.firmness,
                       'quantityMinMt', r.quantity_min_mt::text,
                       'quantityMaxMt', r.quantity_max_mt::text,
                       'deliveryStart', r.delivery_start, 'deliveryEnd', r.delivery_end,
                       'region', coalesce(f.region, ff.region),
                       'country', coalesce(f.country, ff.country, s.primary_country)) as item
                from app.quotes q
                join app.counterparties s
                  on s.organization_id = q.organization_id and s.id = q.counterparty_id
                join lateral (
                  select * from app.quote_revisions v
                   where v.quote_id = q.id order by v.revision_number desc limit 1
                ) r on true
                left join app.facilities f on f.id = q.facility_id
                left join lateral (
                  select g.region, g.country from app.facilities g
                   where g.organization_id = q.organization_id and g.counterparty_id = q.counterparty_id
                   order by g.created_at, g.id limit 1
                ) ff on q.facility_id is null
               where q.organization_id = a.organization_id and q.side = 'offer'
                 and q.counterparty_id <> a.counterparty_id
                 and q.withdrawn_at is null and r.valid_until > now()
                 and s.archived_at is null
                 and (not exists (select 1 from app.counterparty_commodities m
                                   where m.organization_id = a.organization_id
                                     and m.counterparty_id = a.counterparty_id
                                     and m.direction = 'buys')
                      or q.commodity_code in (select m.commodity_code
                                                from app.counterparty_commodities m
                                               where m.organization_id = a.organization_id
                                                 and m.counterparty_id = a.counterparty_id
                                                 and m.direction = 'buys'))
               order by q.created_at desc, q.id
               limit 20) x
    ), '[]'::jsonb) end
  );
end
$$;

-- Keeps Claude's draft, once, under its current claim, while its source stands and is not
-- answered (the company locked as archiving takes it): false otherwise. The recipients are the
-- database's: for an email draft the received email's Reply-To, else its From; for a call draft
-- the call's contact's address when it has one, else none (the person picks).
create function app.keep_email_auto_draft(
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
  if a.source = 'email' then
    select array[coalesce(e.reply_to, e.from_address)] into recipients
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

-- The drafts waiting for a person: ready, not dismissed, not taken by an email being sent or
-- sent, the source standing. `company` narrows to one company; `mine` to the person's own and
-- anyone's (no one assigned, or the assignee no longer an active member). Newest first, at most
-- 200, with whether the list was cut. Null for a non-member.
create function app.email_auto_draft_list(org uuid, company uuid, mine boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  items jsonb;
  total integer;
begin
  if uid is null or not app.is_active_member(org) then
    return null;
  end if;
  with waiting as (
    select a.*,
           exists (select 1 from app.organization_members om
                    where om.organization_id = a.organization_id and om.user_id = a.assigned_to
                      and om.status = 'active') as assignee_active
      from app.email_auto_drafts a
     where a.organization_id = org and a.state = 'ready' and a.dismissed_at is null
       and (company is null or a.counterparty_id = company)
       and app.auto_draft_source_stands(a.id) and not app.auto_draft_taken(a.id)
  ), chosen as (
    select * from waiting w
     where not coalesce(mine, false) or w.assigned_to = uid or not w.assignee_active
     order by w.drafted_at desc, w.id desc
     limit 201
  )
  select count(*)::integer,
         coalesce(jsonb_agg(item order by drafted_at desc, id desc)
                    filter (where n <= 200), '[]'::jsonb)
    into total, items
    from (
      select c.id, c.drafted_at, row_number() over (order by c.drafted_at desc, c.id desc) as n,
             jsonb_build_object(
               'id', c.id,
               'counterpartyId', c.counterparty_id,
               'counterpartyName', cp.legal_name,
               'source', c.source,
               'about', c.about,
               'callAt', cl.created_at,
               'callContactName', cl.contact_name,
               'callBy', cl.placed_by_name,
               'emailId', c.email_id,
               'emailFrom', coalesce(m.from_name, m.from_address),
               'emailSubject', m.subject,
               'emailAt', m.occurred_at,
               'assignedTo', case when c.assignee_active then c.assigned_to end,
               'assignedToName', case when c.assignee_active
                                      then app.member_name(c.organization_id, c.assigned_to) end,
               'fromChoice', c.from_choice,
               'to', to_jsonb(c.to_addresses),
               'subject', c.subject,
               'message', c.message,
               'checkThis', c.check_this,
               'placeholders', c.placeholders,
               'draftedAt', c.drafted_at,
               'answeredSince', (
                 select jsonb_build_object('by', e.sent_by_name, 'at', e.occurred_at)
                   from app.emails e
                  where e.organization_id = c.organization_id and e.direction = 'outgoing'
                    and e.status = 'sent' and e.auto_draft_id is distinct from c.id
                    and ((c.email_id is not null and e.reply_to_email_id = c.email_id)
                         or (c.call_id is not null and e.counterparty_id = c.counterparty_id
                             and e.occurred_at > cl.created_at))
                  order by e.occurred_at
                  limit 1)
             ) as item
        from chosen c
        join app.counterparties cp on cp.organization_id = c.organization_id and cp.id = c.counterparty_id
        left join app.calls cl on cl.id = c.call_id
        left join app.emails m on m.id = c.email_id
    ) listed;
  return jsonb_build_object('drafts', items, 'truncated', total > 200);
end
$$;

-- How many drafts wait for the signed-in person: their own and anyone's (the menu's number,
-- the owner's answer 34). Zero for a non-member.
create function app.email_auto_draft_count(org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.current_user_id() is null or not app.is_active_member(org) then 0 else (
    select count(*)::integer
      from app.email_auto_drafts a
     where a.organization_id = org and a.state = 'ready' and a.dismissed_at is null
       and (a.assigned_to = app.current_user_id()
            or not exists (select 1 from app.organization_members om
                            where om.organization_id = a.organization_id
                              and om.user_id = a.assigned_to and om.status = 'active'))
       and app.auto_draft_source_stands(a.id) and not app.auto_draft_taken(a.id)) end
$$;

-- A person dismisses a waiting draft: any active member (everyone may send email, answer 3).
-- Answers 'dismissed', 'not_found' (not the organization's, not ready, or its source gone),
-- 'already' (dismissed before) or 'taken' (an email from it is being sent or was sent, D1-01).
create function app.dismiss_email_auto_draft(org uuid, draft uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  a app.email_auto_drafts;
begin
  if uid is null or not app.is_active_member(org) then
    return 'not_found';
  end if;
  select * into a from app.email_auto_drafts d
   where d.organization_id = org and d.id = draft and d.state = 'ready'
   for update;
  if not found or not app.auto_draft_source_stands(a.id) then
    return 'not_found';
  end if;
  if a.dismissed_at is not null then
    return 'already';
  end if;
  if app.auto_draft_taken(a.id) then
    return 'taken';
  end if;
  update app.email_auto_drafts
     set dismissed_by = uid, dismissed_by_name = app.member_name(org, uid), dismissed_at = now()
   where id = a.id;
  return 'dismissed';
end
$$;

-- An outgoing email with its links, and the automatic draft it was started from (step 5c).
create function app.start_outgoing_email(
  org uuid, company uuid, contact uuid, from_local_part text, from_domain text,
  to_list text[], cc_list text[], subject_text text, body text, msg_id text,
  answering uuid, draft uuid, auto_draft uuid)
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
  -- The links are checked for a new email only: a retry of a send key already used reaches the
  -- insert, whose unique key answers with the earlier email, even if the answered email was
  -- deleted meanwhile (Codex's final review, F-114-5b-R2-01).
  if not exists (select 1 from app.emails e
                  where e.organization_id = org and e.direction = 'outgoing'
                    and e.message_id = msg_id) then
    if answering is not null and not app.answerable_email(org, company, answering) then
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
  return jsonb_build_object('status', 'started', 'id', new_id);
end
$$;

-- The 12-argument function of step 5b, for the Worker deployed before this migration: the same
-- email without an automatic draft.
create or replace function app.start_outgoing_email(
  org uuid, company uuid, contact uuid, from_local_part text, from_domain text,
  to_list text[], cc_list text[], subject_text text, body text, msg_id text,
  answering uuid, draft uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.start_outgoing_email(org, company, contact, from_local_part, from_domain,
                                  to_list, cc_list, subject_text, body, msg_id,
                                  answering, draft, null::uuid)
$$;

revoke all on app.email_auto_drafts, app.email_auto_draft_requests
  from public, anon, authenticated, service_role, app_api;
grant select on app.email_auto_drafts to app_api;

revoke all on function app.auto_draft_taken(uuid), app.auto_draft_source_stands(uuid),
  app.auto_draft_answered(uuid), app.email_assignee(uuid),
  app.add_email_auto_draft(uuid, uuid, uuid, uuid, uuid, text, uuid),
  app.email_draft_records(uuid, uuid, uuid, uuid), app.job_claude_requests_today(uuid),
  app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer, boolean, text),
  app.keep_email_reading(uuid, uuid, text, text, jsonb, boolean, jsonb, integer, integer, boolean, text),
  app.claim_email_auto_drafts(integer), app.release_email_auto_draft(uuid, uuid),
  app.email_auto_draft_context(uuid, uuid),
  app.keep_email_auto_draft(uuid, uuid, text, text, text, jsonb, jsonb, integer, integer),
  app.email_auto_draft_list(uuid, uuid, boolean), app.email_auto_draft_count(uuid),
  app.dismiss_email_auto_draft(uuid, uuid),
  app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, app_api;

grant execute on function
  app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer, boolean, text),
  app.keep_email_reading(uuid, uuid, text, text, jsonb, boolean, jsonb, integer, integer, boolean, text),
  app.claim_email_auto_drafts(integer), app.release_email_auto_draft(uuid, uuid),
  app.email_auto_draft_context(uuid, uuid),
  app.keep_email_auto_draft(uuid, uuid, text, text, text, jsonb, jsonb, integer, integer),
  app.email_auto_draft_list(uuid, uuid, boolean), app.email_auto_draft_count(uuid),
  app.dismiss_email_auto_draft(uuid, uuid),
  app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid, uuid)
  to app_api;
