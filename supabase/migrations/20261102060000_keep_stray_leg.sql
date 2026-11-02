-- Codex's seventh review of the Telnyx calls (358b727), P2: a caller suspended while Telnyx was
-- dialing the counterparty can no longer write to their call, so the leg Telnyx just returned
-- was not kept anywhere and was missed when the call was ended at Telnyx.
--
-- app.keep_stray_leg(command, leg): keeps the leg a dial returned as a pending hang-up of the
-- same call and event, once, so that app.call_legs lists it and every later delivery hangs it
-- up until Telnyx has taken it. SECURITY DEFINER because the caller can no longer write to the
-- call; it only ever adds a hang-up, for a dial command that exists, and nothing else.

create function app.keep_stray_leg(command uuid, leg text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if leg is null or length(leg) not between 1 and 200 then
    raise exception 'a leg id is 1 to 200 characters' using errcode = 'invalid_parameter_value';
  end if;
  -- One at a time per call, so that two deliveries keeping the same leg add it once (Codex's
  -- eighth review).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'app.call_commands:' || coalesce((select m.call_id::text from app.call_commands m
                                       where m.id = command), ''), 0));
  insert into app.call_commands (organization_id, call_id, telnyx_event_id, kind, call_control_id)
  select m.organization_id, m.call_id, m.telnyx_event_id, 'hang_up', leg
    from app.call_commands m
   where m.id = command and m.kind = 'dial_them'
     and not exists (
       select 1 from app.call_commands h
        where h.call_id = m.call_id and h.kind = 'hang_up' and h.call_control_id = leg
          and h.status <> 'failed'
     );
end
$$;

revoke all on function app.keep_stray_leg(uuid, text) from public, anon, authenticated, service_role;
grant execute on function app.keep_stray_leg(uuid, text) to app_api;
