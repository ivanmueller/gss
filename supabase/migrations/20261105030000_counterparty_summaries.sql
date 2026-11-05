-- A summary of each company, written by Claude, at the top of its page (the owner's request and
-- answers of 2026-11-05, docs/DECISIONS.md). Written automatically by the Worker's job after
-- something new happens with the company (a note logged or corrected, a call read, a bid or
-- offer entered, revised or withdrawn, a follow-up planned or done), at most once an hour per
-- company, or soon after a person asks for one (Refresh). Imports, geocoding and edits of a
-- company's details do not start one by themselves, so a large import costs nothing; the
-- summary says what changed in the details when it is next written. For reading only: nothing
-- is saved from it.
--
-- Companies listed before this migration start with nothing to summarize: their summary is
-- written once something new happens, or when a person asks for it, never all at once.

create table app.counterparty_summaries (
  counterparty_id uuid primary key,
  organization_id uuid not null,
  -- Claude's summary: a few short lines, plain text.
  summary text check (summary = btrim(summary) and length(summary) between 1 and 2000),
  model text check (model ~ '^[a-z0-9][a-z0-9.-]{0,79}$'),
  written_at timestamptz,
  input_tokens integer check (input_tokens between 0 and 10000000),
  output_tokens integer check (output_tokens between 0 and 10000000),
  -- The latest activity the summary covers (see app.counterparty_activity_at); null for none.
  source_at timestamptz,
  -- A person asked for a new summary (Refresh); cleared once one is written after it.
  requested_at timestamptz,
  requested_by uuid references auth.users (id),
  requested_by_name app.label,
  -- Tries since the last summary written or asked for; the job stops at 5 until something new.
  attempts integer not null default 0 check (attempts between 0 and 5),
  -- The latest activity when the job last claimed it.
  activity_at timestamptz,
  claimed_at timestamptz,
  claim_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Removed with its company (an admin's deletion of an archived company, or Undo an import).
  constraint counterparty_summaries_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id) on delete cascade,
  check ((summary is null) = (written_at is null)),
  check ((summary is null) = (model is null)),
  check ((requested_at is null) = (requested_by is null)),
  check ((requested_at is null) = (requested_by_name is null)),
  check ((claimed_at is null) = (claim_token is null))
);

create index counterparty_summaries_organization_idx
  on app.counterparty_summaries (organization_id);

create trigger counterparty_summaries_touch_updated_at
  before update on app.counterparty_summaries
  for each row execute function app.touch_updated_at();

alter table app.counterparty_summaries enable row level security;

-- Everyone on the team reads the summaries, like the records they come from.
create policy counterparty_summaries_select_for_members on app.counterparty_summaries
  for select to app_api using (app.is_active_member(organization_id));

-- Nothing to summarize yet for the companies already listed (see the top).
insert into app.counterparty_summaries (counterparty_id, organization_id, source_at)
select id, organization_id, now() from app.counterparties;

-- The latest thing that happened with a company that starts a new summary: a note logged or
-- corrected or removed, a call read or its voicemail label corrected, a bid or offer entered,
-- revised or withdrawn, a follow-up planned, done or removed. Null when nothing has.
create function app.counterparty_activity_at(org uuid, company uuid)
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
      where f.organization_id = org and f.counterparty_id = company)
  )
$$;

-- Claims up to `most` companies whose summary is due, each with a new claim token: one a person
-- asked for (first), or one with something new since its summary, written more than an hour
-- ago, once things have been quiet for 3 minutes and no call of the last hour is still being
-- transcribed or read (so the summary has the call). Fewer than 5 attempts, unless something
-- newer happened since the last one. Not for archived companies; no claim in the last 10 minutes.
create function app.claim_counterparty_summaries(most integer)
returns table (counterparty_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  stamp timestamptz := pg_catalog.clock_timestamp();
  due record;
  token uuid;
  taken integer := 0;
begin
  if most is null or most < 1 then
    return;
  end if;
  for due in
    select cp.organization_id, cp.id, a.activity_at, s.requested_at
      from app.counterparties cp
      left join app.counterparty_summaries s on s.counterparty_id = cp.id
      cross join lateral (
        select app.counterparty_activity_at(cp.organization_id, cp.id) as activity_at
      ) a
     where cp.archived_at is null
       and (s.claimed_at is null or s.claimed_at < stamp - interval '10 minutes')
       and (
         (s.requested_at is not null and s.attempts < 5)
         or (a.activity_at is not null
             and a.activity_at > coalesce(s.source_at, '-infinity')
             and (s.written_at is null or s.written_at < stamp - interval '1 hour')
             and a.activity_at < stamp - interval '3 minutes'
             and (coalesce(s.attempts, 0) < 5 or a.activity_at > s.activity_at)
             and not exists (
               select 1
                 from app.calls c
                 join app.call_recordings cr on cr.call_id = c.id
                where c.organization_id = cp.organization_id and c.counterparty_id = cp.id
                  and cr.read_at is null and cr.reading_attempts < 5
                  and cr.created_at > stamp - interval '1 hour'
                  and (cr.transcript is null or pg_catalog.btrim(cr.transcript) <> '')))
       )
     order by s.requested_at nulls last, a.activity_at desc
  loop
    token := null;
    insert into app.counterparty_summaries as s
      (counterparty_id, organization_id, attempts, activity_at, claimed_at, claim_token)
    values (due.id, due.organization_id, 1, due.activity_at, stamp, gen_random_uuid())
    on conflict on constraint counterparty_summaries_pkey do update
      set attempts = case
            when s.requested_at is null and excluded.activity_at > coalesce(s.activity_at, '-infinity')
              then 1
            else least(s.attempts + 1, 5)
          end,
          activity_at = excluded.activity_at,
          claimed_at = excluded.claimed_at,
          claim_token = excluded.claim_token
      where s.claimed_at is null or s.claimed_at < stamp - interval '10 minutes'
    returning s.claim_token into token;
    if token is not null then
      counterparty_id := due.id;
      claim_token := token;
      return next;
      taken := taken + 1;
      exit when taken >= least(most, 10);
    end if;
  end loop;
end
$$;

-- Gives a claim back without counting its attempt: for a request Anthropic did not take (a wrong
-- key, the spend limit reached, an overload, no connection). Only the claim given.
create function app.release_counterparty_summary(company uuid, claim uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.counterparty_summaries
     set attempts = greatest(attempts - 1, 0), claimed_at = null, claim_token = null
   where counterparty_id = company and claim_token = claim
$$;

-- What Claude is given to summarize a claimed company: its details, contacts (names and roles
-- only), what it buys or sells, its locations, the latest 15 contact history entries with
-- Claude's notes of their calls, its live bids and offers, its open follow-ups and the last 5
-- done, the drafts waiting, and the changes to its details in the last 60 days. Only for the
-- company's current claim.
create function app.counterparty_summary_context(company uuid, claim uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'counterpartyId', cp.id,
    'name', cp.legal_name,
    'types', to_jsonb(cp.types::text[]),
    'country', cp.primary_country,
    'tier', cp.tier,
    'markets', to_jsonb(cp.markets),
    'grainTypes', to_jsonb(cp.grain_types),
    'sellerKind', cp.seller_kind,
    'annualTonnes', cp.annual_tonnes,
    'organicCertifiedUntil', cp.organic_certified_until,
    'equipment', to_jsonb(cp.equipment),
    'notes', left(cp.notes, 1500),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('name', k.name, 'role', k.role, 'main', k.is_main)
                       order by k.is_main desc, k.name, k.id)
        from app.counterparty_contacts k
       where k.organization_id = cp.organization_id and k.counterparty_id = cp.id
    ), '[]'::jsonb),
    'commodities', coalesce((
      select jsonb_agg(jsonb_build_object('code', m.commodity_code, 'direction', m.direction,
                                          'verified', m.verified_at is not null)
                       order by m.direction, m.commodity_code)
        from app.counterparty_commodities m
       where m.organization_id = cp.organization_id and m.counterparty_id = cp.id
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object('name', f.name, 'type', f.facility_type, 'city', f.city,
                                          'region', f.region, 'country', f.country,
                                          'access', f.transport_access)
                       order by f.country, f.region, f.city, f.id)
        from app.facilities f
       where f.organization_id = cp.organization_id and f.counterparty_id = cp.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.item order by h.occurred_at desc)
        from (
          select r.occurred_at,
                 jsonb_build_object(
                   'occurredAt', r.occurred_at, 'channel', r.channel,
                   'contactName', r.contact_name, 'by', r.recorded_by_name,
                   'notes', left(r.notes, 1500),
                   'claudeNotes', (
                     select left(string_agg(cr.read_summary, ' ' order by cr.created_at), 1500)
                       from app.calls c
                       join app.call_recordings cr on cr.call_id = c.id
                      where c.contact_log_entry_id = e.id and cr.read_summary is not null),
                   'voicemail', (
                     select bool_or(coalesce(cr.voicemail_corrected, cr.read_voicemail))
                       from app.calls c
                       join app.call_recordings cr on cr.call_id = c.id
                      where c.contact_log_entry_id = e.id and cr.read_at is not null)
                 ) as item
            from app.contact_log_entries e
            join lateral (
              select * from app.contact_log_revisions v
               where v.entry_id = e.id order by v.revision_number desc limit 1
            ) r on true
           where e.organization_id = cp.organization_id and e.counterparty_id = cp.id
             and not exists (select 1 from app.contact_log_removals x where x.entry_id = e.id)
           order by r.occurred_at desc
           limit 15
        ) h
    ), '[]'::jsonb),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'side', q.side, 'commodity', q.commodity_code, 'firmness', r.firmness,
               'price', r.price::text, 'currency', r.currency, 'priceUnit', r.price_unit,
               'grade', r.grade, 'deliveryBasis', r.delivery_basis,
               'basisLocation', r.basis_location,
               'quantityMinMt', r.quantity_min_mt::text, 'quantityMaxMt', r.quantity_max_mt::text,
               'deliveryStart', r.delivery_start, 'deliveryEnd', r.delivery_end,
               'validUntil', r.valid_until, 'enteredBy', r.recorded_by_name)
             order by r.valid_until)
        from app.quotes q
        join lateral (
          select * from app.quote_revisions v
           where v.quote_id = q.id order by v.revision_number desc limit 1
        ) r on true
       where q.organization_id = cp.organization_id and q.counterparty_id = cp.id
         and q.withdrawn_at is null and r.valid_until > now()
    ), '[]'::jsonb),
    'followUps', coalesce((
      select jsonb_agg(jsonb_build_object('task', f.task, 'dueAt', f.due_at,
                                          'assignedTo', f.assigned_to_name)
                       order by f.due_at)
        from app.follow_ups f
       where f.organization_id = cp.organization_id and f.counterparty_id = cp.id
         and f.done_at is null and f.removed_at is null
    ), '[]'::jsonb),
    'doneFollowUps', coalesce((
      select jsonb_agg(d.item order by d.done_at desc)
        from (
          select f.done_at,
                 jsonb_build_object('task', f.task, 'doneAt', f.done_at, 'by', f.done_by_name)
                   as item
            from app.follow_ups f
           where f.organization_id = cp.organization_id and f.counterparty_id = cp.id
             and f.done_at is not null and f.removed_at is null
           order by f.done_at desc
           limit 5
        ) d
    ), '[]'::jsonb),
    'draftsWaiting', (
      select count(*) from app.call_drafts d
       where d.organization_id = cp.organization_id and d.counterparty_id = cp.id
         and d.status = 'open'
    ),
    'changes', coalesce((
      select jsonb_agg(c.item order by c.occurred_at desc)
        from (
          select a.occurred_at,
                 jsonb_build_object(
                   'occurredAt', a.occurred_at, 'what', a.entity, 'action', a.action,
                   'fields', to_jsonb(array(
                     select field from unnest(a.changed_fields) field
                      where field not in ('updated_at', 'version'))),
                   'by', coalesce(app.member_name(a.organization_id, a.actor_id), 'the system')
                 ) as item
            from app.audit_events a
           where a.organization_id = cp.organization_id
             and a.occurred_at > now() - interval '60 days'
             and (
               (a.entity = 'counterparties' and a.entity_id = cp.id)
               or (a.entity = 'counterparty_contacts' and a.entity_id in (
                     select k.id from app.counterparty_contacts k
                      where k.organization_id = cp.organization_id and k.counterparty_id = cp.id))
               or (a.entity = 'facilities' and a.entity_id in (
                     select f.id from app.facilities f
                      where f.organization_id = cp.organization_id and f.counterparty_id = cp.id))
             )
           order by a.occurred_at desc
           limit 15
        ) c
    ), '[]'::jsonb)
  )
  from app.counterparties cp
  join app.counterparty_summaries s on s.counterparty_id = cp.id
   and s.organization_id = cp.organization_id
  where cp.id = company and s.claim_token = claim
$$;

-- Keeps Claude's summary of a company under its current claim: false when the claim is no
-- longer this one (it lapsed and was taken again). A request made while it was being written
-- stays, so a new summary follows.
create function app.keep_counterparty_summary(
  company uuid,
  claim uuid,
  model text,
  summary text,
  input_tokens integer,
  output_tokens integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update app.counterparty_summaries s
     set summary = keep_counterparty_summary.summary,
         model = keep_counterparty_summary.model,
         written_at = now(),
         input_tokens = keep_counterparty_summary.input_tokens,
         output_tokens = keep_counterparty_summary.output_tokens,
         source_at = s.activity_at,
         requested_at = case when s.requested_at <= s.claimed_at then null else s.requested_at end,
         requested_by = case when s.requested_at <= s.claimed_at then null else s.requested_by end,
         requested_by_name = case
           when s.requested_at <= s.claimed_at then null else s.requested_by_name
         end,
         attempts = 0, claimed_at = null, claim_token = null
   where s.counterparty_id = company and s.claim_token = claim;
  return found;
end
$$;

-- A person asks for a new summary (Refresh): written at the job's next run. Answers
-- 'requested', 'not_found', 'forbidden' (traders, operations and admins ask; viewers read),
-- 'archived', or 'too_soon' (one was written in the last 10 minutes).
create function app.request_counterparty_summary(company uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  cp record;
  s app.counterparty_summaries;
begin
  if uid is null then
    return 'not_found';
  end if;
  select c.id, c.organization_id, c.archived_at into cp
    from app.counterparties c where c.id = company;
  if not found or not app.is_active_member(cp.organization_id) then
    return 'not_found';
  end if;
  if not app.can_log_contacts(cp.organization_id) then
    return 'forbidden';
  end if;
  if cp.archived_at is not null then
    return 'archived';
  end if;
  select * into s from app.counterparty_summaries where counterparty_id = cp.id for update;
  if found and s.written_at > now() - interval '10 minutes' then
    return 'too_soon';
  end if;
  insert into app.counterparty_summaries as t
    (counterparty_id, organization_id, requested_at, requested_by, requested_by_name)
  values (cp.id, cp.organization_id, now(), uid, app.member_name(cp.organization_id, uid))
  on conflict on constraint counterparty_summaries_pkey do update
    set requested_at = excluded.requested_at, requested_by = excluded.requested_by,
        requested_by_name = excluded.requested_by_name, attempts = 0;
  return 'requested';
end
$$;

revoke all on app.counterparty_summaries from public, anon, authenticated, service_role;
grant select on app.counterparty_summaries to app_api;
revoke all on function app.counterparty_activity_at(uuid, uuid),
  app.claim_counterparty_summaries(integer), app.release_counterparty_summary(uuid, uuid),
  app.counterparty_summary_context(uuid, uuid),
  app.keep_counterparty_summary(uuid, uuid, text, text, integer, integer),
  app.request_counterparty_summary(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.claim_counterparty_summaries(integer),
  app.release_counterparty_summary(uuid, uuid), app.counterparty_summary_context(uuid, uuid),
  app.keep_counterparty_summary(uuid, uuid, text, text, integer, integer),
  app.request_counterparty_summary(uuid)
  to app_api;
