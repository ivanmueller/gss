-- Codex's reviews of the call readings (c9222d3, merged as ivanmueller/gss#140, and 1485b23),
-- after 20261105010000_call_readings.sql reached main:
--
-- - Each claim of a recording for reading has its own token (call_recordings.reading_claim_token),
--   which giving it back, reading the call's context and keeping the reading need, so a run
--   whose claim lapsed and was taken by another run can change nothing (finding 5 of c9222d3).
--   A kept reading clears its claim. Claims made before this migration are let go: none is in
--   flight (the Anthropic key is not set on staging yet), and read recordings kept theirs.
-- - A new-contact draft is accepted only with a contact the deciding person added themselves
--   (finding 3 of c9222d3); a listed contact's new details only with that contact.

alter table app.call_recordings add column reading_claim_token uuid;
update app.call_recordings set reading_claimed_at = null where reading_claimed_at is not null;
alter table app.call_recordings
  add constraint call_recordings_reading_claim
    check ((reading_claimed_at is null) = (reading_claim_token is null));

drop function app.claim_call_readings(integer);
drop function app.release_call_reading(uuid);
drop function app.call_reading_context(uuid);
drop function app.keep_call_reading(uuid, text, boolean, text, jsonb, integer, integer);

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

revoke all on function app.claim_call_readings(integer), app.release_call_reading(uuid, uuid),
  app.call_reading_context(uuid, uuid),
  app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer),
  app.decide_call_draft(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.claim_call_readings(integer), app.release_call_reading(uuid, uuid),
  app.call_reading_context(uuid, uuid),
  app.keep_call_reading(uuid, uuid, text, boolean, text, jsonb, integer, integer),
  app.decide_call_draft(uuid, text, uuid)
  to app_api;
