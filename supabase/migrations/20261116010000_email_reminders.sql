-- F-114 step 5c (part 2): reminder drafts, thread context for the email readings, and the end of
-- part 1's deploy window (docs/FEATURES.md F-114, the owner's answers 26, 28 and 33; Codex's
-- design review, docs/reviews/F-114-5c2.md).
--
-- - A reminder (answer 33, as chosen): 3 business days (Monday to Friday, Alberta time, UTC-6;
--   holidays not counted) after a GSS email was sent, when nothing has come since (no answer, no
--   other email to the company, no logged contact), the job adds a pending draft of source
--   'reminder' for that email. Claude decides whether the email asked for something; if not, the
--   draft is skipped; if so, Claude writes a short reminder, kept as part 1's drafts are, for a
--   person to open, send as a reply in the same thread, or dismiss. Never a reminder of a
--   reminder. Nothing is ever sent by itself (AGENTS.md rule 8).
-- - A ready reminder whose silence ended is no longer listed or counted.
-- - The email readings get the earlier emails with the company as context (answer 26).
-- - The wrappers kept for part 1's deploy window are dropped (the Worker uses the new ones, and
--   migrations run before the Worker deploys).

-- Reminders ------------------------------------------------------------------

alter table app.email_auto_drafts
  drop constraint email_auto_drafts_source_check,
  drop constraint email_auto_drafts_source_shape,
  add constraint email_auto_drafts_source_check check (source in ('call', 'email', 'reminder')),
  add constraint email_auto_drafts_source_shape check (
    (source = 'call' and call_id is not null and recording_id is not null and email_id is null)
    or (source in ('email', 'reminder') and call_id is null and recording_id is null
        and email_id is not null));

-- `days` business days (Monday to Friday) after `sent`, in Alberta time (UTC-6 all year): a
-- weekend start moves to the next Monday 00:00. Holidays are not skipped. At most 10 days.
create function app.add_business_days(sent timestamptz, days integer)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  t timestamp;
  remaining integer := least(greatest(coalesce(days, 0), 0), 10);
begin
  if sent is null then
    return null;
  end if;
  t := sent at time zone interval '-06:00';
  if extract(isodow from t) >= 6 then
    t := date_trunc('day', t) + make_interval(days => 8 - extract(isodow from t)::integer);
  end if;
  while remaining > 0 loop
    t := t + interval '1 day';
    if extract(isodow from t) < 6 then
      remaining := remaining - 1;
    end if;
  end loop;
  return t at time zone interval '-06:00';
end
$$;

-- Whether nothing has come since the GSS email `email` was sent: on its company, strictly after
-- it, no received email that is not automatic (an out-of-office is no answer; a removed or
-- suspicious one still counts, the safe side), no other outgoing email being sent or sent, and no
-- contact history entry not removed whose latest revision happened later. The email's own history
-- entry happened at its sending instant exactly, so it is not later. False for an email not sent.
create function app.email_quiet_since(email uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.emails m
     where m.id = email and m.direction = 'outgoing' and m.status = 'sent'
       and m.counterparty_id is not null
       and not exists (
         select 1 from app.emails o
          where o.organization_id = m.organization_id and o.counterparty_id = m.counterparty_id
            and o.id <> m.id and o.occurred_at > m.occurred_at
            and ((o.direction = 'incoming' and not o.automatic)
                 or (o.direction = 'outgoing' and o.status in ('sending', 'sent'))))
       and not exists (
         select 1 from app.contact_log_entries e
          cross join lateral (
            select v.occurred_at from app.contact_log_revisions v
             where v.entry_id = e.id order by v.revision_number desc limit 1) r
          where e.organization_id = m.organization_id and e.counterparty_id = m.counterparty_id
            and r.occurred_at > m.occurred_at
            and not exists (select 1 from app.contact_log_removals x where x.entry_id = e.id)))
$$;

-- The first GSS email that may be reminded: none sent before the feature (2026-11-13 UTC). A
-- function of its own, so a database test can move it inside its rolled-back transaction.
create function app.email_reminders_since()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select timestamptz '2026-11-13 00:00:00+00'
$$;

-- Adds the pending reminders now due (called by the job's claim only): for each GSS email sent
-- since the feature began (2026-11-13), within the last 14 days, 3 business days old, not
-- removed, its company not archived, not itself sent from a reminder, without a draft of its own
-- yet (F-114-5c2-D1-03: excluded before the limit, so later ones are reached), and quiet. At most
-- 50 a call, oldest first. For the person who sent it while an active member, else for anyone;
-- From as part 1 (their own address when they have one). The about line is fixed text built from
-- the subject, never Claude's words.
create function app.add_email_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.email_auto_drafts (organization_id, counterparty_id, source, email_id, about,
                                     assigned_to, from_choice)
  select d.organization_id, d.counterparty_id, 'reminder', d.id,
         case when d.bare = '' then
                'No answer to the email of '
                  || to_char(d.occurred_at at time zone interval '-06:00', 'YYYY-MM-DD')
              else left('No answer to "' || d.bare, 199) || '"' end,
         d.person,
         case when d.person is not null and exists (
                select 1 from app.member_email_addresses a
                 where a.organization_id = d.organization_id and a.user_id = d.person)
              then 'own' else 'shared' end
    from (
      select m.id, m.organization_id, m.counterparty_id, m.occurred_at,
             btrim(regexp_replace(coalesce(m.subject, ''), '[[:cntrl:]]+', ' ', 'g')) as bare,
             case when exists (
                    select 1 from app.organization_members om
                     where om.organization_id = m.organization_id and om.user_id = m.sent_by
                       and om.status = 'active')
                  then m.sent_by end as person
        from app.emails m
        join app.counterparties c on c.organization_id = m.organization_id and c.id = m.counterparty_id
       where m.direction = 'outgoing' and m.status = 'sent'
         and m.occurred_at >= app.email_reminders_since()
         and m.occurred_at > now() - interval '14 days'
         and app.add_business_days(m.occurred_at, 3) <= now()
         and c.archived_at is null
         and not exists (select 1 from app.email_removals x where x.email_id = m.id)
         and not exists (select 1 from app.email_auto_drafts a where a.email_id = m.id)
         and not exists (select 1 from app.email_auto_drafts a
                          where a.id = m.auto_draft_id and a.source = 'reminder')
         and app.email_quiet_since(m.id)
       order by m.occurred_at, m.id
       limit 50
    ) d
  on conflict do nothing;
end
$$;

-- Whether a person already answered the draft's source: as in part 1 for a call or a received
-- email; for a reminder, whether its silence ended (an answer, another email, a logged contact).
create or replace function app.auto_draft_answered(draft uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
             when d.source = 'reminder' then not app.email_quiet_since(d.email_id)
             else exists (
               select 1 from app.emails e
                 left join app.calls c on c.id = d.call_id
                where e.organization_id = d.organization_id and e.direction = 'outgoing'
                  and e.status = 'sent' and e.auto_draft_id is distinct from d.id
                  and ((d.email_id is not null and e.reply_to_email_id = d.email_id)
                       or (d.call_id is not null and e.counterparty_id = d.counterparty_id
                           and e.occurred_at > c.created_at)))
           end
      from app.email_auto_drafts d
     where d.id = draft), false)
$$;

-- As in part 1, with the reminders now due added first.
create or replace function app.claim_email_auto_drafts(most integer)
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
  perform app.add_email_reminders();
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

-- Claude found that the reminded email asked for nothing: the reminder is put away under its
-- current claim (the job only). Its request stays counted, as Claude was asked.
create function app.skip_email_auto_draft(draft uuid, claim uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_user_id() is not null then
    return false;
  end if;
  update app.email_auto_drafts a
     set state = 'skipped', claimed_at = null, claim_token = null
   where a.id = draft and a.state = 'pending' and a.claim_token = claim and a.source = 'reminder';
  return found;
end
$$;

-- The person a draft is for, as Claude is told: name and title (as app.member_name, which
-- answers only a signed-in member; the job has none). Null when for anyone.
create function app.auto_draft_sender(org uuid, person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
   where om.organization_id = org and om.user_id = person and om.status = 'active'
$$;

-- As in part 1; for a reminder, a small context of its own: the company's name and types, the
-- sender, and the reminded email (subject, text, recipients, contact, who sent it). No records,
-- quotes, offers, notes or other emails: a reminder only asks again.
create or replace function app.email_auto_draft_context(draft uuid, claim uuid)
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
  if a.source = 'reminder' then
    return (
      select jsonb_build_object(
               'source', 'reminder',
               'about', a.about,
               'happenedAt', m.occurred_at,
               'name', c.legal_name,
               'types', to_jsonb(c.types::text[]),
               'sender', app.auto_draft_sender(a.organization_id, a.assigned_to),
               'shared', a.from_choice = 'shared',
               'reminded', jsonb_build_object(
                 'subject', left(m.subject, 300),
                 'body', left(m.body_text, 12000),
                 'to', to_jsonb(m.to_addresses),
                 'contactName', m.contact_name,
                 'sentByName', m.sent_by_name))
        from app.emails m
        join app.counterparties c on c.organization_id = m.organization_id and c.id = m.counterparty_id
       where m.id = a.email_id);
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
    'sender', app.auto_draft_sender(a.organization_id, a.assigned_to),
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

-- As in part 1; a reminder goes to the reminded email's To.
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

-- As in part 1; a ready reminder whose silence ended is no longer listed (a reminder after an
-- answer is wrong to send), and a reminder has no "answered since".
create or replace function app.email_auto_draft_list(org uuid, company uuid, mine boolean)
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
       and not (a.source = 'reminder' and app.auto_draft_answered(a.id))
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
               'answeredSince', case when c.source = 'reminder' then null else (
                 select jsonb_build_object('by', e.sent_by_name, 'at', e.occurred_at)
                   from app.emails e
                  where e.organization_id = c.organization_id and e.direction = 'outgoing'
                    and e.status = 'sent' and e.auto_draft_id is distinct from c.id
                    and ((c.email_id is not null and e.reply_to_email_id = c.email_id)
                         or (c.call_id is not null and e.counterparty_id = c.counterparty_id
                             and e.occurred_at > cl.created_at))
                  order by e.occurred_at
                  limit 1) end
             ) as item
        from chosen c
        join app.counterparties cp on cp.organization_id = c.organization_id and cp.id = c.counterparty_id
        left join app.calls cl on cl.id = c.call_id
        left join app.emails m on m.id = c.email_id
    ) listed;
  return jsonb_build_object('drafts', items, 'truncated', total > 200);
end
$$;

-- As in part 1, without the reminders whose silence ended.
create or replace function app.email_auto_draft_count(org uuid)
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
       and app.auto_draft_source_stands(a.id) and not app.auto_draft_taken(a.id)
       and not (a.source = 'reminder' and app.auto_draft_answered(a.id))) end
$$;

-- As in part 1; a reminder is sent as a reply to the GSS email it reminds: `answering` may name
-- that outgoing email only with its reminder draft (of this organization and company, the email
-- sent and not removed). Any other `answering` is a received email, as before.
create or replace function app.start_outgoing_email(
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

-- Thread context for the email readings (answer 26) ----------------------------------------

-- As in 20261113010000_email_readings.sql, with `thread`: up to 4 earlier emails with the same
-- company, oldest first, strictly before the read email and within 90 days of it, not removed,
-- not automatic; sent ones only of GSS's, and received ones only those that passed the sender
-- checks and were read whole (answer 20). Context only: the Worker never numbers them, so no
-- draft can cite them.
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
                     jsonb_build_object(
                       'direction', o.direction, 'fromName', o.from_name, 'from', o.from_address,
                       'at', o.occurred_at, 'subject', left(o.subject, 300),
                       'body', left(o.body_text, 6000)) as item
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
            select m.gss_member, 1) u
      join app.organization_members om
        on om.organization_id = m.organization_id and om.user_id = u.user_id and om.status = 'active'
     order by u.rank
     limit 1
  ) a on true
  where r.email_id = email and r.state = 'pending' and r.claim_token = claim
    and app.email_readable(r.email_id)
$$;

-- The end of part 1's deploy window -------------------------------------------------------

drop function app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text);
drop function app.start_outgoing_email(uuid, uuid, uuid, text, text, text[], text[], text, text, text, uuid, uuid);
drop function app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer);
drop function app.keep_email_reading(uuid, uuid, text, text, jsonb, boolean, jsonb, integer, integer);

-- Privileges ----------------------------------------------------------------------------------

revoke all on function app.add_business_days(timestamptz, integer), app.email_quiet_since(uuid),
  app.email_reminders_since(),
  app.add_email_reminders(), app.skip_email_auto_draft(uuid, uuid),
  app.auto_draft_sender(uuid, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function app.skip_email_auto_draft(uuid, uuid) to app_api;
