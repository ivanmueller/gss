-- Codex's sixth review of the Telnyx calls (81f09c6), finding 2: when the person who placed a
-- call is suspended (or removed), row level security hides the call and its commands from
-- requests in their name, so Telnyx's events for it can no longer be applied or followed up.
-- The Worker then ends the call at Telnyx: it hangs up every leg it knows of, which it reads with
-- app.call_legs, and acknowledges the event only once Telnyx has taken each hang-up (or said the
-- leg is gone).
--
-- app.call_legs(call): Telnyx's ids for the call's legs: the caller's, the counterparty's, and
-- those of hang-ups still pending or being sent (a stray leg of a dial). SECURITY DEFINER
-- because the caller cannot see the call any more; like app.call_placer, it reveals nothing
-- but leg ids to someone who already holds the call's id (only Telnyx's signed events and the
-- caller have it). Read only.

create function app.call_legs(call uuid)
returns table (call_control_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.staff_call_control_id from app.calls c
   where c.id = call and c.staff_call_control_id is not null
  union
  select c.counterparty_call_control_id from app.calls c
   where c.id = call and c.counterparty_call_control_id is not null
  union
  select m.call_control_id from app.call_commands m
   where m.call_id = call and m.kind = 'hang_up' and m.status in ('pending', 'sending')
$$;

revoke all on function app.call_legs(uuid) from public, anon, authenticated, service_role;
grant execute on function app.call_legs(uuid) to app_api;
