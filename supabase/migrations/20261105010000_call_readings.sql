-- Claude reads each call's transcript and drafts what was said (the owner's request and answers
-- of 2026-11-05, docs/DECISIONS.md): a few lines of notes, whether it was a voicemail, and drafts
-- of bids and offers, follow-ups and contact details. Nothing is saved as a bid, offer, follow-up
-- or contact until a person opens a draft in the usual form and saves it; a draft can also be
-- dismissed. Missing details stay blank, never guessed. Calls already transcribed are read too.
--
-- - call_recordings: Claude's reading of the transcript (claimed by the Worker's job every 2
--   minutes, at most 5 attempts, a claim lapsing after 10 minutes, each claim with its own token
--   so that a run whose claim lapsed can neither give back nor complete a newer one; given back
--   without counting when Anthropic did not take the request): when it was read, by which
--   model, whether it was a voicemail, the notes, and the tokens it took; and a person's
--   correction of "voicemail", with who made it and when (audited).
-- - call_drafts: the drafts of a reading, each with the transcript lines it came from, open
--   until a person accepts it (naming the bid or offer, follow-up or contact they saved) or
--   dismisses it. Read by every active member of the organization; written only through the
--   functions below. Never deleted.

alter table app.call_recordings
  add constraint call_recordings_organization_key unique (organization_id, id),
  add column reading_attempts integer not null default 0 check (reading_attempts between 0 and 5),
  add column reading_claimed_at timestamptz,
  add column reading_claim_token uuid,
  add column read_at timestamptz,
  -- The model that read it, e.g. claude-opus-5-5 (or the one Anthropic fell back to).
  add column read_model text check (read_model ~ '^[a-z0-9][a-z0-9.-]{0,79}$'),
  add column read_voicemail boolean,
  add column read_summary text
    check (read_summary = btrim(read_summary) and length(read_summary) between 1 and 2000),
  add column read_input_tokens integer check (read_input_tokens between 0 and 10000000),
  add column read_output_tokens integer check (read_output_tokens between 0 and 10000000),
  -- A person's answer to "was it a voicemail?", over Claude's.
  add column voicemail_corrected boolean,
  add column voicemail_corrected_by uuid references auth.users (id),
  add column voicemail_corrected_by_name app.label,
  add column voicemail_corrected_at timestamptz,
  add constraint call_recordings_read_together check (
    (read_at is null) = (read_model is null)
    and (read_at is null) = (read_voicemail is null)
    and (read_at is not null
         or (read_summary is null and read_input_tokens is null and read_output_tokens is null))
  ),
  add constraint call_recordings_reading_claim
    check ((reading_claimed_at is null) = (reading_claim_token is null)),
  add constraint call_recordings_read_after_transcript
    check (read_at is null or transcript is not null),
  add constraint call_recordings_voicemail_correction check (
    (voicemail_corrected is null) = (voicemail_corrected_by is null)
    and (voicemail_corrected is null) = (voicemail_corrected_by_name is null)
    and (voicemail_corrected is null) = (voicemail_corrected_at is null)
    and (voicemail_corrected is null or read_at is not null)
  );

create index call_recordings_to_read_idx on app.call_recordings (created_at desc)
  where read_at is null and transcript is not null;

-- A person's voicemail correction is audited (the job's own updates are not).
create trigger call_recordings_voicemail_audit
  after update of voicemail_corrected on app.call_recordings
  for each row execute function app.record_audit_event();

create table app.call_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  counterparty_id uuid not null,
  call_id uuid not null,
  recording_id uuid not null,
  -- Its place among the reading's drafts, from 0.
  position integer not null check (position between 0 and 99),
  kind text not null check (kind in ('quote', 'follow_up', 'contact')),
  -- What the form opens with: for a quote {"side", "commodity", "values"}, for a follow-up and a
  -- contact {"values"}; checked again by the API and by the form when a person saves it.
  fields jsonb not null check (jsonb_typeof(fields) = 'object' and pg_column_size(fields) <= 16384),
  -- The transcript lines it came from (their numbers, from 0).
  lines jsonb not null
    check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 20),
  -- For a change to a contact already listed; null for a new contact. Not a foreign key: a
  -- contact can be removed later.
  contact_id uuid,
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
  decided_by uuid references auth.users (id),
  decided_by_name app.label,
  decided_at timestamptz,
  -- The bid or offer, follow-up or contact the person saved from it.
  result_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recording_id, position),
  constraint call_drafts_call_fkey foreign key (organization_id, call_id)
    references app.calls (organization_id, id),
  constraint call_drafts_counterparty_fkey foreign key (organization_id, counterparty_id)
    references app.counterparties (organization_id, id),
  constraint call_drafts_recording_fkey foreign key (organization_id, recording_id)
    references app.call_recordings (organization_id, id),
  check ((status = 'open') = (decided_by is null)),
  check ((status = 'open') = (decided_by_name is null)),
  check ((status = 'open') = (decided_at is null)),
  check ((status = 'accepted') = (result_id is not null)),
  check (contact_id is null or kind = 'contact')
);

create index call_drafts_counterparty_idx on app.call_drafts (counterparty_id, created_at desc);
create index call_drafts_recording_idx on app.call_drafts (recording_id, position);
-- One bid or offer, or one follow-up, accepts one draft.
create unique index call_drafts_one_result_idx on app.call_drafts (kind, result_id)
  where status = 'accepted' and kind in ('quote', 'follow_up');

create trigger call_drafts_touch_updated_at
  before update on app.call_drafts
  for each row execute function app.touch_updated_at();
create trigger call_drafts_no_delete
  before delete on app.call_drafts
  for each row execute function app.keep_calls();
create trigger call_drafts_no_truncate
  before truncate on app.call_drafts
  for each statement execute function app.keep_calls();
create trigger call_drafts_audit
  after insert or update on app.call_drafts
  for each row execute function app.record_audit_event();

alter table app.call_drafts enable row level security;

-- Everyone on the team reads the drafts, like the transcripts they come from.
create policy call_drafts_select_for_members on app.call_drafts
  for select to app_api using (app.is_active_member(organization_id));

-- Claims up to `most` recordings for Claude to read now, newest first (so a new call is not held
-- behind the calls read for the first time): a transcript with words, not read yet, fewer than
-- 5 attempts, and no claim in the last 10 minutes. Rows another claim holds are skipped. Each
-- claim has a new token, which giving it back, reading the context and keeping the reading need.
create function app.claim_call_readings(most integer)
returns table (recording_id uuid, claim_token uuid)
language sql
security definer
set search_path = ''
as $$
  update app.call_recordings r
     set reading_attempts = r.reading_attempts + 1,
         reading_claimed_at = pg_catalog.clock_timestamp(),
         reading_claim_token = gen_random_uuid()
   where r.id in (
     select q.id from app.call_recordings q
      where q.read_at is null and q.transcript is not null and pg_catalog.btrim(q.transcript) <> ''
        and q.reading_attempts < 5
        and (q.reading_claimed_at is null
             or q.reading_claimed_at < pg_catalog.clock_timestamp() - interval '10 minutes')
      order by q.created_at desc
      limit greatest(least(most, 10), 0)
      for update skip locked
   )
  returning r.id, r.reading_claim_token
$$;

-- Gives a claim back without counting its attempt: for a request Anthropic did not take (a wrong
-- key, the spend limit reached, an overload, no connection), so such failures never use up a
-- recording's 5 attempts and it is read once the problem is fixed. Only the claim given
-- (Codex's review of c9222d3, finding 5): a run whose claim lapsed and was taken again releases
-- nothing.
create function app.release_call_reading(recording uuid, claim uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.call_recordings
     set reading_attempts = greatest(reading_attempts - 1, 0), reading_claimed_at = null,
         reading_claim_token = null
   where id = recording and read_at is null and reading_claim_token = claim
$$;

-- What Claude is given to read a claimed recording: the transcript, who called whom and when,
-- and the company's name, kinds and contacts. Only for the recording's current claim, not read.
create function app.call_reading_context(recording uuid, claim uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recordingId', r.id,
    'callId', c.id,
    'counterpartyId', c.counterparty_id,
    'counterpartyName', cp.legal_name,
    'counterpartyTypes', to_jsonb(cp.types::text[]),
    'contactName', c.contact_name,
    'callerId', c.placed_by,
    'callerName', c.placed_by_name,
    'calledAt', coalesce(c.connected_at, c.created_at),
    'lines', r.transcript_lines,
    'transcript', r.transcript,
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'role', k.role,
                                          'email', k.email, 'phone', k.phone)
                       order by k.name, k.id)
        from app.counterparty_contacts k
       where k.organization_id = c.organization_id and k.counterparty_id = c.counterparty_id
    ), '[]'::jsonb)
  )
  from app.call_recordings r
  join app.calls c on c.id = r.call_id and c.organization_id = r.organization_id
  join app.counterparties cp on cp.organization_id = c.organization_id and cp.id = c.counterparty_id
  where r.id = recording and r.read_at is null and r.reading_claim_token = claim
    and r.transcript is not null
$$;

-- Keeps Claude's reading of a recording and its drafts, once, under its current claim: false
-- when it was read already or the claim is no longer this one (it lapsed and was taken again).
-- A contact draft naming a contact not of the call's company becomes a new contact.
create function app.keep_call_reading(
  recording uuid,
  claim uuid,
  model text,
  voicemail boolean,
  summary text,
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
  select cr.id, cr.organization_id, cr.call_id, c.counterparty_id into r
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
  return true;
end
$$;

-- A person accepts a draft (naming what they saved from it) or dismisses it. Answers 'decided',
-- 'not_found', 'forbidden' (their role cannot save that kind), 'already_decided', or
-- 'result_not_found' (no such bid or offer, follow-up or new contact of theirs, or listed contact
-- the draft is about, of the company).
create function app.decide_call_draft(draft uuid, decision text, result uuid)
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
           -- A listed contact's new details: that contact. A new person: a contact the person
           -- added themselves (Codex's review of c9222d3, finding 3).
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

-- A person corrects whether a read call was a voicemail. Answers 'saved', 'not_found',
-- 'forbidden' (their role cannot log contacts) or 'not_read' (Claude has not read it yet).
create function app.correct_call_voicemail(recording uuid, voicemail boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := app.current_user_id();
  r app.call_recordings;
begin
  if uid is null or voicemail is null then
    return 'not_found';
  end if;
  select * into r from app.call_recordings where id = recording for update;
  if not found or not app.is_active_member(r.organization_id) then
    return 'not_found';
  end if;
  if not app.can_log_contacts(r.organization_id) then
    return 'forbidden';
  end if;
  if r.read_at is null then
    return 'not_read';
  end if;
  update app.call_recordings
     set voicemail_corrected = voicemail, voicemail_corrected_by = uid,
         voicemail_corrected_by_name = app.member_name(r.organization_id, uid),
         voicemail_corrected_at = now()
   where id = r.id;
  return 'saved';
end
$$;

revoke all on app.call_drafts from public, anon, authenticated, service_role;
grant select on app.call_drafts to app_api;
revoke all on function app.claim_call_readings(integer), app.release_call_reading(uuid, uuid),
  app.call_reading_context(uuid, uuid),
  app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer),
  app.decide_call_draft(uuid, text, uuid), app.correct_call_voicemail(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function app.claim_call_readings(integer), app.release_call_reading(uuid, uuid),
  app.call_reading_context(uuid, uuid),
  app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer),
  app.decide_call_draft(uuid, text, uuid), app.correct_call_voicemail(uuid, boolean)
  to app_api;
