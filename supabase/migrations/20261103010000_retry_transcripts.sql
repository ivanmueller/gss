-- Transcripts tried again (staging, 2026-11-03): Telnyx answered 400 to every transcription,
-- because the recording was passed as a link; the Worker now uploads the audio. The recordings
-- that ran out of attempts while their audio is still kept (24 hours after the call) get their
-- attempts back, once. A claim is left as it is (Codex's review of 5c72810, finding 3): one
-- being transcribed keeps it, and one that has lapsed is claimable as before. Recordings with a
-- transcript, or whose audio was deleted, are left as they are.
update app.call_recordings
   set transcribe_attempts = 0
 where transcript is null and audio_deleted_at is null;
