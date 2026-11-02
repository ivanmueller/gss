-- The transcript split by side (the owner's request and choice of 2026-11-02): after each call,
-- the Worker has Telnyx's speech-to-text (Deepgram Nova-3) transcribe the recording's two
-- channels separately (the caller's leg on the first, the counterparty on the second) and keeps
-- each line with its side and time, so the transcript reads as a conversation. Telnyx's own
-- transcription of the recording is no longer asked for (it would be paid twice).
--
-- - call_recordings.transcript_lines: the lines, oldest first, each
--   {"side": "caller" | "counterparty" | null, "start": seconds, "text": "..."}; the plain
--   transcript column keeps the same words, one line per turn, for reading and searching.
-- - transcribe_attempts and transcribe_claimed_at: the Worker's job (every 2 minutes) claims
--   the recordings still without a transcript, one claim at a time per recording (a claim
--   lapses after 10 minutes), at most 5 attempts each; a recording whose audio was deleted is
--   no longer tried.

alter table app.call_recordings
  add column transcript_lines jsonb
    check (jsonb_typeof(transcript_lines) = 'array' and jsonb_array_length(transcript_lines) <= 20000),
  add column transcribe_attempts integer not null default 0 check (transcribe_attempts between 0 and 5),
  add column transcribe_claimed_at timestamptz,
  add constraint call_recordings_lines_with_transcript
    check (transcript_lines is null or transcript is not null);

-- Claims up to `most` recordings to transcribe now: no transcript yet, audio still kept, fewer
-- than 5 attempts, and no claim in the last 10 minutes. Rows another claim holds are skipped.
create function app.claim_recordings_to_transcribe(most integer)
returns table (telnyx_recording_id text)
language sql
security definer
set search_path = ''
as $$
  update app.call_recordings r
     set transcribe_attempts = r.transcribe_attempts + 1,
         transcribe_claimed_at = pg_catalog.clock_timestamp()
   where r.id in (
     select q.id from app.call_recordings q
      where q.transcript is null and q.audio_deleted_at is null and q.transcribe_attempts < 5
        and (q.transcribe_claimed_at is null
             or q.transcribe_claimed_at < pg_catalog.clock_timestamp() - interval '10 minutes')
      order by q.created_at
      limit greatest(least(most, 50), 0)
      for update skip locked
   )
  returning r.telnyx_recording_id
$$;

-- Keeps a recording's transcript by side (the first one kept; never replaced).
create function app.keep_call_transcript_lines(recording text, lines jsonb, words text)
returns void
language sql
security definer
set search_path = ''
as $$
  update app.call_recordings
     set transcript_lines = lines, transcript = words, transcribed_at = now()
   where telnyx_recording_id = recording and transcript is null
$$;

revoke all on function app.claim_recordings_to_transcribe(integer),
  app.keep_call_transcript_lines(text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function app.claim_recordings_to_transcribe(integer),
  app.keep_call_transcript_lines(text, jsonb, text)
  to app_api;
