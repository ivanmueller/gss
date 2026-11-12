-- F-114 step 5b: Draft with Claude on the email form, and Reply on a received email.
--
-- - app.email_draft_requests: one row per Draft with Claude request (who, which company, which
--   email it answers, the model and tokens): what each draft cost, never its text (the draft is
--   the person's until Send). No limit on how many (the owner's answer 23); at most one pending
--   per person at a time, so a double click never pays twice; a pending row older than
--   2 minutes is a lost answer, marked failed by that person's next request.
-- - app.emails gains reply_to_email_id (the received email an outgoing email answers) and
--   claude_draft_id (the request whose draft it started from), both on outgoing mail only.
-- - app.email_draft_context: the company's records, its latest call in 7 days and the thread,
--   each collection limited by rows and characters (Codex's design review, F-114-5b-D1-01); the
--   answered email always included, whatever its age or kind (D1-02).
-- - app.start_outgoing_email gains an overload with the two links, written at insert (an email
--   is never edited); the old one becomes a wrapper passing none, for the seconds between the
--   migration and the Worker's deploy, to be dropped later.

create table app.email_draft_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  user_id uuid not null references auth.users (id),
  counterparty_id uuid not null,
  reply_to_email_id uuid,
  draft_key uuid not null,
  status text not null default 'pending' check (status in ('pending', 'drafted', 'failed')),
  model text check (model is null or model ~ '^[a-z0-9][a-z0-9.-]{0,79}$'),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  finished_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, user_id, draft_key),
  constraint email_draft_requests_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id),
  constraint email_draft_requests_reply_fkey foreign key (organization_id, reply_to_email_id)
    references app.emails (organization_id, id),
  check ((status = 'pending') = (finished_at is null))
);

create index email_draft_requests_pending_idx on app.email_draft_requests (organization_id, user_id)
  where status = 'pending';

create trigger email_draft_requests_keep
  before delete on app.email_draft_requests
  for each row execute function app.keep_emails();
create trigger email_draft_requests_no_truncate
  before truncate on app.email_draft_requests
  for each statement execute function app.keep_emails();

alter table app.email_draft_requests enable row level security;

-- Everyone on the team may see what drafting cost; writes go through the functions below.
create policy email_draft_requests_select_for_members on app.email_draft_requests
  for select to app_api using (app.is_active_member(organization_id));

alter table app.emails
  add column reply_to_email_id uuid,
  add column claude_draft_id uuid,
  add constraint emails_reply_to_fkey foreign key (organization_id, reply_to_email_id)
    references app.emails (organization_id, id),
  add constraint emails_claude_draft_fkey foreign key (organization_id, claude_draft_id)
    references app.email_draft_requests (organization_id, id),
  add constraint emails_links_outgoing_only check (
    direction = 'outgoing' or (reply_to_email_id is null and claude_draft_id is null));

-- Whether `email` is a received email of `company` in `org` that may be answered: incoming,
-- not removed. Its age and kind do not matter (D1-02).
create function app.answerable_email(org uuid, company uuid, email uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.emails e
     where e.organization_id = org and e.counterparty_id = company and e.id = email
       and e.direction = 'incoming'
       and not exists (select 1 from app.email_removals r where r.email_id = e.id))
$$;

-- A person asks Claude for a draft. Answers {"status": "started", "id": …} or
-- {"status": "forbidden" | "not_found" | "archived" | "reply_not_found" | "already" |
-- "in_progress"}.
create function app.start_email_draft(org uuid, company uuid, answering uuid, key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  archived timestamptz;
  new_id uuid;
begin
  if uid is null or not app.is_active_member(org) then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select c.archived_at into archived
    from app.counterparties c where c.organization_id = org and c.id = company;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if archived is not null then
    return jsonb_build_object('status', 'archived');
  end if;
  if answering is not null and not app.answerable_email(org, company, answering) then
    return jsonb_build_object('status', 'reply_not_found');
  end if;
  -- One person's requests one at a time.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('email_draft:' || org::text || ':' || uid::text, 0));
  if exists (select 1 from app.email_draft_requests d
              where d.organization_id = org and d.user_id = uid and d.draft_key = key) then
    return jsonb_build_object('status', 'already');
  end if;
  -- A lost answer: pending for over 2 minutes.
  update app.email_draft_requests d
     set status = 'failed', finished_at = pg_catalog.clock_timestamp()
   where d.organization_id = org and d.user_id = uid and d.status = 'pending'
     and d.created_at <= pg_catalog.clock_timestamp() - interval '2 minutes';
  if exists (select 1 from app.email_draft_requests d
              where d.organization_id = org and d.user_id = uid and d.status = 'pending') then
    return jsonb_build_object('status', 'in_progress');
  end if;
  insert into app.email_draft_requests (organization_id, user_id, counterparty_id,
                                        reply_to_email_id, draft_key)
  values (org, uid, company, answering, key)
  returning id into new_id;
  return jsonb_build_object('status', 'started', 'id', new_id);
end
$$;

-- What came of a request, by the person who asked, once. Answers 'done' or 'not_found'.
create function app.finish_email_draft(
  request uuid, drafted boolean, model_name text, input_count integer, output_count integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
begin
  update app.email_draft_requests d
     set status = case when drafted then 'drafted' else 'failed' end,
         model = case when model_name ~ '^[a-z0-9][a-z0-9.-]{0,79}$' then model_name end,
         input_tokens = greatest(input_count, 0),
         output_tokens = greatest(output_count, 0),
         finished_at = pg_catalog.clock_timestamp()
   where d.id = request and d.user_id = uid and d.status = 'pending'
     and app.is_active_member(d.organization_id);
  return case when found then 'done' else 'not_found' end;
end
$$;

-- What Claude is given to draft an email to `company`, as jsonb; null when the person is not
-- an active member, the company is not the organization's or is archived, or `answering` is not
-- an answerable email of the company. Every collection is limited (D1-01); the Worker trims
-- the whole to its budget.
create function app.email_draft_context(org uuid, company uuid, answering uuid)
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
  if app.current_user_id() is null or not app.is_active_member(org) then
    return null;
  end if;
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

  -- The latest call with a transcript in the last 7 days (the owner's answer 16).
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
     and c.created_at > now() - interval '7 days'
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

-- An outgoing email with its links (F-114 step 5b). The same as the 10-argument function, and:
-- answering must be an answerable received email of the same company ('reply_not_found');
-- draft must be the sender's own drafted request for the same company ('draft_not_found').
create function app.start_outgoing_email(
  org uuid, company uuid, contact uuid, from_local_part text, from_domain text,
  to_list text[], cc_list text[], subject_text text, body text, msg_id text,
  answering uuid, draft uuid)
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
  if answering is not null and not app.answerable_email(org, company, answering) then
    return jsonb_build_object('status', 'reply_not_found');
  end if;
  if draft is not null and not exists (
       select 1 from app.email_draft_requests d
        where d.organization_id = org and d.id = draft and d.user_id = uid
          and d.counterparty_id = company and d.status = 'drafted') then
    return jsonb_build_object('status', 'draft_not_found');
  end if;
  insert into app.emails (organization_id, direction, status, counterparty_id, contact_id,
                          sent_by, sent_by_name, from_address, from_name, to_addresses,
                          cc_addresses, subject, body_text, message_id, reply_to_email_id,
                          claude_draft_id)
  values (org, 'outgoing', 'sending', company, contact, uid, app.member_name(org, uid),
          wanted || '@' || lower(btrim(from_domain)), app.member_name(org, uid),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(to_list) t),
          (select coalesce(array_agg(lower(btrim(t))), '{}') from unnest(cc_list) t),
          coalesce(subject_text, ''), body, msg_id, answering, draft)
  returning id into new_id;
  return jsonb_build_object('status', 'started', 'id', new_id);
end
$$;

-- The 10-argument function, kept for the Worker deployed before this migration: the same
-- email without links.
create or replace function app.start_outgoing_email(
  org uuid, company uuid, contact uuid, from_local_part text, from_domain text,
  to_list text[], cc_list text[], subject_text text, body text, msg_id text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.start_outgoing_email(org, company, contact, from_local_part, from_domain,
                                  to_list, cc_list, subject_text, body, msg_id,
                                  null::uuid, null::uuid)
$$;

revoke all on app.email_draft_requests from public, anon, authenticated, service_role;
grant select on app.email_draft_requests to app_api;
revoke all on function app.answerable_email(uuid, uuid, uuid),
  app.start_email_draft(uuid, uuid, uuid, uuid),
  app.finish_email_draft(uuid, boolean, text, integer, integer),
  app.email_draft_context(uuid, uuid, uuid),
  app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.start_email_draft(uuid, uuid, uuid, uuid),
  app.finish_email_draft(uuid, boolean, text, integer, integer),
  app.email_draft_context(uuid, uuid, uuid),
  app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid)
  to app_api;
