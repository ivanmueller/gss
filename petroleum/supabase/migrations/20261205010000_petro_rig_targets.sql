-- What each rig is drilling for (F-283, docs/FEATURES_OIL_GAS.md; the owner, 2026-11-23: "just put
-- a little note in each rigs information for the play they're drilling for").
--
-- The rig list (ST49) does not say; the well licence does: its terminating zone, the formation the
-- well is licensed to reach (ST1). The daily ST1 lists give it for licences issued since they are
-- kept; for older licences the Worker reads the AER's free ST1 archives (yearly 2017 on, monthly
-- this year) only for the licences rigs are on, and keeps only each licence's zone and the date of
-- the list it came from. A licence in no archive is kept as not found and asked again after a
-- week, as a licence's location is (20261204010000_petro_rigs.sql).
--
-- Public data, owned by no organization, the same rules as the AER's other lists: written only by
-- the AER job, read by any member the Worker names; the AER's terms (docs/DECISIONS.md,
-- 2026-11-19): members only, never exported.

create table petro.aer_licence_targets (
  licence_number text primary key check (licence_number ~ '^[0-9]{7}$'),
  found boolean not null,
  -- As ST1 writes it ('SPIRIT RIVER FM'), and the date of the list it was read from: the newest
  -- list that names the licence (an amendment can change the zone).
  terminating_zone text check (char_length(terminating_zone) between 1 and 200),
  list_date date,
  tried_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts between 1 and 10000),
  check (
    (found and terminating_zone is not null and list_date is not null)
    or (not found and terminating_zone is null and list_date is null)
  )
);

-- A licence not found may be asked again after a week; a found one never changes.
create function petro.keep_aer_licence_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.found or old.tried_at > now() - interval '7 days' then
    raise exception 'A licence''s target is asked again only when not found for a week'
      using errcode = '23514';
  end if;
  if new.licence_number <> old.licence_number or new.attempts <> old.attempts + 1
     or new.tried_at < now() - interval '1 minute' then
    raise exception 'A retried licence target counts its attempt now' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger aer_licence_targets_keep
  before update on petro.aer_licence_targets
  for each row execute function petro.keep_aer_licence_target();

alter table petro.aer_licence_targets enable row level security;

create policy aer_licence_targets_read on petro.aer_licence_targets
  for select to petro_api using (petro.aer_may_read());
create policy aer_licence_targets_job on petro.aer_licence_targets
  for insert to petro_api with check (petro.aer_job_writing());
create policy aer_licence_targets_retry on petro.aer_licence_targets
  for update to petro_api
  using (petro.aer_job_writing()) with check (petro.aer_job_writing());

revoke all on petro.aer_licence_targets
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.aer_licence_targets to petro_api;
grant insert (licence_number, found, terminating_zone, list_date)
  on petro.aer_licence_targets to petro_api;
grant update (found, terminating_zone, list_date, tried_at, attempts)
  on petro.aer_licence_targets to petro_api;

revoke all on function petro.keep_aer_licence_target()
  from public, anon, authenticated, service_role, petro_api;

-- The rigs route and the job's targets step need this version (RIG_TARGETS_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 18
$$;
