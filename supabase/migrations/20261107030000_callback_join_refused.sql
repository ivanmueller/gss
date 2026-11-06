-- Codex's third review of the callbacks (5e83ea7, after it reached main as ivanmueller/gss#164):
-- one P2. A join (bridge) that timed out went back to pending and was sent again; when Telnyx
-- refused that second sending before the caller's hang-up arrived, the call was ended as failed,
-- both legs hung up (possibly cutting off a conversation the first sending had joined) and the
-- call logged for good, so a later call.bridged could not correct it.
--
-- Now a join refused on a later sending changes nothing: Telnyx's call.bridged connects the call
-- (app.apply_callback_event, as before); a hang-up ends it with its log waiting for call.bridged
-- (app.callback_joined_late) or, five minutes after the end, for app.settle_late_callbacks. A join
-- refused on its only sending still ends the call as failed at once. Only the two functions
-- below change; 20261107020000_callbacks.sql is not edited.

create or replace function app.callback_end(call uuid, event text, how text, at timestamptz, cause text,
                                 gone text)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  a app.callback_attempts;
  made uuid[] := '{}';
  deferred boolean;
begin
  select * into c from app.calls where id = call;
  if c.status = 'ended' then
    return made;
  end if;
  -- Ended while the join was on its way to Telnyx: whether they talked is known only once it
  -- comes back (or Telnyx's call.bridged arrives), so the call is logged then (Codex's review of
  -- f7a0d73, finding 2).
  deferred := how = 'missed' and c.status = 'joining' and exists (
    select 1 from app.call_commands m
     where m.call_id = c.id and m.kind = 'bridge'
       -- On its way, or sent before with no clear answer (a timeout put it back to pending;
       -- Codex's review of 9d5e57b, finding 1).
       and (m.status = 'sending' or (m.status = 'pending' and m.attempts > 0)
            -- Refused when sent again: the earlier sending may have worked (Codex's review of
            -- 5e83ea7).
            or (m.status = 'failed' and m.attempts > 1)));
  update app.calls
     set status = 'ended', outcome = how::app.call_outcome,
         ended_at = greatest(at, coalesce(connected_at, at)),
         hangup_cause = case when cause ~ '^[a-z0-9_]{1,40}$' then cause end
   where id = c.id;
  update app.call_commands set status = 'cancelled'
   where call_id = c.id and kind <> 'hang_up' and status = 'pending';
  for a in select * from app.callback_attempts
            where call_id = c.id and status in ('ringing', 'confirming', 'accepted')
  loop
    if a.status in ('ringing', 'confirming') then
      update app.callback_attempts set status = 'cancelled', ended_at = at where id = a.id;
    end if;
    if a.leg is distinct from gone then
      made := made || app.callback_command(c.id, event, 'hang_up', a.leg, a.id);
    end if;
  end loop;
  if c.counterparty_call_control_id is distinct from gone then
    made := made || app.callback_command(c.id, event, 'hang_up', c.counterparty_call_control_id, null);
  end if;
  if not deferred then
    perform app.callback_record(c.id);
  end if;
  return array_remove(made, null);
end
$$;

create or replace function app.finish_callback_command(call uuid, command uuid, claim integer, outcome text,
                                            leg_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.calls;
  m app.call_commands;
  a app.callback_attempts;
  cur app.callback_attempts;
  ours boolean;
  made uuid[] := '{}';
begin
  if outcome not in ('done', 'failed', 'retry') or (leg_id is not null and length(leg_id) not between 1 and 200) then
    raise exception 'an outcome is done, failed or retry' using errcode = 'invalid_parameter_value';
  end if;
  select * into c from app.calls where id = call and direction = 'incoming' for update;
  if not found then
    return jsonb_build_object('commands', '[]'::jsonb);
  end if;
  select * into m from app.call_commands where id = command and call_id = c.id;
  if not found then
    return jsonb_build_object('commands', '[]'::jsonb);
  end if;
  select * into cur from app.callback_attempts where call_id = c.id order by position desc limit 1;
  if m.attempt_id is not null then
    select * into a from app.callback_attempts where id = m.attempt_id;
  end if;
  ours := m.status = 'sending' and m.attempts = claim;

  if not ours then
    if outcome <> 'done' then
      return jsonb_build_object('commands', '[]'::jsonb,
                                'unresolved', m.status in ('pending', 'sending'));
    end if;
    if m.status in ('pending', 'sending') then
      update app.call_commands set status = 'done' where id = m.id;
    end if;
  elsif outcome = 'retry' then
    update app.call_commands set status = 'pending' where id = m.id;
    return jsonb_build_object('commands', '[]'::jsonb);
  elsif outcome = 'failed' then
    update app.call_commands set status = 'failed' where id = m.id;
    if m.kind in ('dial_member', 'confirm') then
      if c.status in ('calling_you', 'confirming') and a.id = cur.id
         and a.status in ('ringing', 'confirming') then
        update app.callback_attempts set status = 'failed', ended_at = now() where id = a.id;
        made := made || app.callback_command(c.id, m.telnyx_event_id, 'hang_up', a.leg, a.id);
        made := made || app.callback_next(c.id, m.telnyx_event_id);
      end if;
    elsif m.kind = 'bridge' and m.attempts > 1 then
      -- Refused when sent again, after an earlier sending with no clear answer: that one may
      -- have joined them, so nothing is ended or hung up. Telnyx's call.bridged connects the
      -- call; a hang-up ends it, its log waiting for call.bridged, then for
      -- app.settle_late_callbacks (Codex's review of 5e83ea7).
      null;
    elsif m.kind in ('answer', 'bridge', 'greet', 'record_voicemail') then
      made := made || app.callback_end(c.id, m.telnyx_event_id,
                                       case when m.kind = 'bridge' then 'failed' else 'missed' end,
                                       now(), null, null);
      -- A join refused on its only sending, after the call ended, did not happen: logged as it
      -- ended. Refused when sent again, an earlier sending with no clear answer may have worked:
      -- left to Telnyx's call.bridged, then app.settle_late_callbacks (Codex's review of 9d5e57b,
      -- finding 1).
      if m.kind = 'bridge' and c.status = 'ended' and m.attempts = 1 then
        perform app.callback_record(c.id);
      end if;
    end if;
    return jsonb_build_object('commands', app.callback_commands_json(array_remove(made, null)));
  else
    update app.call_commands set status = 'done' where id = m.id;
  end if;

  -- The caller joined to who answered: connected now, and recorded on their leg, both sides, as
  -- calls placed from the platform are (the first channel theirs, the second the caller's).
  if m.kind = 'bridge' and c.status = 'joining' then
    update app.calls set status = 'connected', connected_at = now() where id = c.id;
    made := made || app.callback_command(c.id, m.telnyx_event_id, 'record', c.staff_call_control_id,
                                         m.attempt_id);
  elsif m.kind = 'bridge' and c.status = 'ended' then
    -- The join worked, but its answer came back after a hang-up ended the call: talked, from
    -- when the caller was answered (Codex's review of f7a0d73, finding 2).
    perform app.callback_joined_late(c.id, (
      select max(e.occurred_at) from app.call_events e
       where e.call_id = c.id and e.leg = 'them' and e.event_type = 'call.answered'));
  end if;

  -- A leg a dial returned: kept on its attempt while wanted, hung up otherwise.
  if m.kind = 'dial_member' and leg_id is not null then
    select * into c from app.calls where id = c.id;
    select * into a from app.callback_attempts where id = m.attempt_id;
    if c.status <> 'ended' and a.id = cur.id and a.status in ('ringing', 'confirming')
       and (a.leg is null or a.leg = leg_id) then
      update app.callback_attempts set leg = leg_id where id = a.id and leg is null;
    elsif a.leg is distinct from leg_id or c.status = 'ended'
          or a.status not in ('ringing', 'confirming', 'accepted') then
      made := made || app.callback_command(c.id, m.telnyx_event_id, 'hang_up', leg_id, a.id);
    end if;
  end if;
  return jsonb_build_object('commands', app.callback_commands_json(array_remove(made, null)));
end
$$;

revoke all on function app.callback_end(uuid, text, text, timestamptz, text, text),
  app.finish_callback_command(uuid, uuid, integer, text, text)
  from public, anon, authenticated, service_role;
revoke all on function app.callback_end(uuid, text, text, timestamptz, text, text) from app_api;
grant execute on function app.finish_callback_command(uuid, uuid, integer, text, text) to app_api;
