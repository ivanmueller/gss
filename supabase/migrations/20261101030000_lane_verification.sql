-- Verified lanes (the owner's request of 2026-11-01, docs/DECISIONS.md): "when a lane is
-- imported via csv make it unverified like the commodity type so when our reps call the
-- company they can verify where they go."
--
-- A lane from a spreadsheet is unverified until someone who keeps lanes (a trader,
-- operations or an admin) verifies it on the carrier's page; one added or changed by hand is
-- verified by whoever did it. Every lane so far was entered by hand, so each is verified by
-- whoever entered it, when they did. A verified lane stays verified: it is removed, not
-- unverified.
--
-- verified_by is always the person acting (the insert policy and the trigger below) and
-- verified_at the database's clock (the trigger), so neither can be made up by a caller.

alter table app.carrier_lanes
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users (id),
  add constraint carrier_lanes_verified_check check ((verified_at is null) = (verified_by is null));

update app.carrier_lanes set verified_by = created_by, verified_at = created_at;

-- Stamps the time of a verification. A lane is verified once, in the name of the person
-- verifying it, and never unverified (SQLSTATE GS006); a change that leaves verified_by as it
-- was keeps verified_at as it was. SECURITY INVOKER; it reads nothing.
create function app.stamp_lane_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.verified_at := case when new.verified_by is null then null else now() end;
    return new;
  end if;
  if new.verified_by is distinct from old.verified_by then
    if old.verified_by is not null or new.verified_by is distinct from app.current_user_id() then
      raise exception 'a lane is verified once, by the person verifying it, and never unverified'
        using errcode = 'GS006';
    end if;
    new.verified_at := now();
  else
    new.verified_at := old.verified_at;
  end if;
  return new;
end
$$;

create trigger carrier_lanes_verification
  before insert or update on app.carrier_lanes
  for each row execute function app.stamp_lane_verification();

-- Adding: a lane added as verified is verified by the person adding it.
drop policy carrier_lanes_insert_for_entrants on app.carrier_lanes;
create policy carrier_lanes_insert_for_entrants on app.carrier_lanes
  for insert to app_api
  with check (
    app.can_enter_freight(organization_id) and created_by = app.current_user_id()
    and (verified_by is null or verified_by = app.current_user_id())
  );

revoke all on function app.stamp_lane_verification()
  from public, anon, authenticated, service_role, app_api;
grant insert (verified_by), update (verified_by) on app.carrier_lanes to app_api;
