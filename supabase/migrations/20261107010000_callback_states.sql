-- Callbacks to GSS's number (the owner's request and answers of 2026-11-06, docs/DECISIONS.md,
-- F-132): the states and outcomes a call to GSS's number needs, added on their own so that the
-- next migration, which uses them, runs after they are committed.
--
-- - joining: the person whose cell rang pressed 1; the caller's call is being answered and
--   joined to theirs.
-- - voicemail: nobody took the call; the caller hears the voicemail message and leaves one.
-- - outcome voicemail: the caller left a voicemail.
-- - outcome missed: the caller hung up before anyone took the call (or before leaving a
--   voicemail).

alter type app.call_status add value if not exists 'joining' after 'calling_them';
alter type app.call_status add value if not exists 'voicemail' after 'connected';
alter type app.call_outcome add value if not exists 'voicemail';
alter type app.call_outcome add value if not exists 'missed';
