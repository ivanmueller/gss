-- Transcripts of calls, with the audio kept 24 hours (the owner's request and answers of
-- 2026-11-02, docs/DECISIONS.md): when the counterparty answers, Telnyx records both sides of
-- the call and transcribes the recording; the transcript is kept with the call, and everyone on
-- the team reads it and, for 24 hours, plays the audio from the call's entry in the contact
-- history. The audio stays at Telnyx (never in GSS's storage) and is deleted there 24 hours
-- after the call by the Worker's hourly job.
--
-- - call_commands: a new kind, record (start recording a call once it is connected).
-- - call_recordings: one row per Telnyx recording of a call: its Telnyx id, when it ran, its
--   transcript, and when its audio was deleted. Read by every active member of the
--   organization; written only through the functions below, which the Worker calls after
--   Telnyx's signature is checked (or from its scheduled job), so that a recording is kept and
--   deleted even when the caller has been suspended since. Never deleted.

alter table app.call_commands drop constraint call_commands_kind_check;
alter table app.call_commands
  add constraint call_commands_kind_check check (kind in ('confirm', 'dial_them', 'hang_up', 'record'));

create table app.call_recordings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  call_id uuid not null,
  telnyx_recording_id text not null unique check (length(telnyx_recording_id) between 1 and 200),
  recording_started_at timestamptz,
  recording_ended_at timestamptz,
  -- What Telnyx's transcription heard; null until it arrives.
  transcript text check (length(transcript) <= 200000),
  transcribed_at timestamptz,
  -- When the audio was deleted at Telnyx (24 hours after the call); null while it is kept.
  audio_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_recordings_call_fkey foreign key (organization_id, call_id)
    references app.calls (organization_id, id),
  check ((transcript is null) = (transcribed_at is null))
);

create index call_recordings_call_idx on app.call_recordings (call_id);
create index call_recordings_to_delete_idx on app.call_recordings (created_at)
  where audio_deleted_at is null;

create trigger call_recordings_touch_updated_at
  before update on app.call_recordings
  for each row execute function app.touch_updated_at();
create trigger call_recordings_no_delete
  before delete on app.call_recordings
  for each row execute function app.keep_calls();
create trigger call_recordings_no_truncate
  before truncate on app.call_recordings
  for each statement execute function app.keep_calls();

alter table app.call_recordings enable row level security;

-- Everyone on the team reads transcripts (the owner's answer of 2026-11-02).
create policy call_recordings_select_for_members on app.call_recordings
  for select to app_api using (app.is_active_member(organization_id));

-- When a recording's audio may be deleted: 24 hours after it ended (or was first kept).
create function app.recording_audio_until(r app.call_recordings)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select coalesce(r.recording_ended_at, r.created_at) + interval '24 hours'
$$;

-- Keeps a recording of a call (once per Telnyx recording; times filled in when known).
create function app.keep_call_recording(call uuid, recording text, started timestamptz, ended timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app.call_recordings (organization_id, call_id, telnyx_recording_id,
                                   recording_started_at, recording_ended_at)
  select c.organization_id, c.id, recording, started, ended from app.calls c where c.id = call
  on conflict (telnyx_recording_id) do update
    set recording_started_at = coalesce(app.call_recordings.recording_started_at, excluded.recording_started_at),
        recording_ended_at = coalesce(app.call_recordings.recording_ended_at, excluded.recording_ended_at)
    where app.call_recordings.call_id = excluded.call_id
$$;

-- Keeps the transcript of a call's recording (the recording is kept too if it was not yet).
create function app.keep_call_transcript(call uuid, recording text, words text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app.call_recordings (organization_id, call_id, telnyx_recording_id, transcript, transcribed_at)
  select c.organization_id, c.id, recording, words, now() from app.calls c where c.id = call
  on conflict (telnyx_recording_id) do update
    set transcript = excluded.transcript, transcribed_at = excluded.transcribed_at
    where app.call_recordings.call_id = excluded.call_id
      and app.call_recordings.transcript is null
$$;

-- Recordings whose audio is due to be deleted at Telnyx, oldest first.
create function app.recordings_to_delete(most integer)
returns table (telnyx_recording_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.telnyx_recording_id from app.call_recordings r
   where r.audio_deleted_at is null and app.recording_audio_until(r) <= now()
   order by r.created_at
   limit greatest(least(most, 500), 0)
$$;

-- Notes that a recording's audio was deleted at Telnyx (or was already gone there).
create function app.mark_recording_deleted(recording text)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.call_recordings set audio_deleted_at = now()
   where telnyx_recording_id = recording and audio_deleted_at is null
$$;

revoke all on app.call_recordings from public, anon, authenticated, service_role;
grant select on app.call_recordings to app_api;
revoke all on function app.recording_audio_until(app.call_recordings),
  app.keep_call_recording(uuid, text, timestamptz, timestamptz),
  app.keep_call_transcript(uuid, text, text), app.recordings_to_delete(integer),
  app.mark_recording_deleted(text)
  from public, anon, authenticated, service_role;
grant execute on function app.recording_audio_until(app.call_recordings),
  app.keep_call_recording(uuid, text, timestamptz, timestamptz),
  app.keep_call_transcript(uuid, text, text), app.recordings_to_delete(integer),
  app.mark_recording_deleted(text)
  to app_api;
