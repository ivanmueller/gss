-- Rigs on the oil and gas map, all of Alberta (F-282, docs/FEATURES_OIL_GAS.md; the owner,
-- 2026-11-23: "Active rigs now and the last 30 and 90 days, all of Alberta, before F-253").
--
-- 1. The AER's monthly archives of its daily rig list (ST49): one zip a month, one file a day,
--    each read as a daily file is. Each day's file in a zip is kept as an edition of its own
--    address: the zip's address with the file's name after a '#'.
-- 2. Where each rig's licence is: the AER's list of every well licence in Alberta
--    (WellLicenceAllAB.csv) gives each licence's surface location with its latitude and
--    longitude. The Worker reads it only for the licences rigs are on that have no location yet,
--    and keeps only those. A licence not in the list is kept as not found and asked again after a
--    week, as a township grid point is.
--
-- Public data, owned by no organization, the same rules as the daily lists
-- (20261120010000_petro_aer_daily_lists.sql): written only by the AER job, read by any member the
-- Worker names; the AER's terms (docs/DECISIONS.md, 2026-11-19): members only, never exported.

-- 1. The archive addresses beside the 14 daily ones.
alter table petro.aer_list_editions drop constraint aer_list_editions_source_url_check;
alter table petro.aer_list_editions add constraint aer_list_editions_source_url_check check (
  source_url ~ (
    '^https://static\.aer\.ca/prd/data/('
    || 'well-lic/WELLS(MON|TUE|WED|THU|FRI|SAT|SUN)\.TXT'
    || '|wells/SPUD(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.txt'
    || '|wells/spud[0-9]{4}-(0[1-9]|1[0-2])\.zip#[Ss][Pp][Uu][Dd][0-9]{4}\.(txt|TXT))$'));

-- 2. Each rig licence's surface location, from the AER's list of every licence.
create table petro.aer_licence_locations (
  licence_number text primary key check (licence_number ~ '^[0-9]{7}$'),
  found boolean not null,
  -- As the list writes them: the surface legal subdivision, the licensee with its code, the
  -- licence's status.
  surface_location text check (
    surface_location ~ '^[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]$'),
  licensee text check (char_length(licensee) <= 200),
  licence_status text check (char_length(licence_status) <= 60),
  longitude numeric(9, 6),
  latitude numeric(8, 6),
  tried_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts between 1 and 10000),
  -- Found: a point inside Alberta's box and its subdivision; not found: nothing.
  check (
    (found and longitude between -120.1 and -109.9 and latitude between 48.9 and 60.1
      and surface_location is not null)
    or (not found and longitude is null and latitude is null and surface_location is null
      and licensee is null and licence_status is null)
  )
);

-- A licence not found may be asked again after a week; a found one never changes.
create function petro.keep_aer_licence_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.found or old.tried_at > now() - interval '7 days' then
    raise exception 'A licence''s location is asked again only when not found for a week'
      using errcode = '23514';
  end if;
  if new.licence_number <> old.licence_number or new.attempts <> old.attempts + 1
     or new.tried_at < now() - interval '1 minute' then
    raise exception 'A retried licence location counts its attempt now' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger aer_licence_locations_keep
  before update on petro.aer_licence_locations
  for each row execute function petro.keep_aer_licence_location();

alter table petro.aer_licence_locations enable row level security;

create policy aer_licence_locations_read on petro.aer_licence_locations
  for select to petro_api using (petro.aer_may_read());
create policy aer_licence_locations_job on petro.aer_licence_locations
  for insert to petro_api with check (petro.aer_job_writing());
create policy aer_licence_locations_retry on petro.aer_licence_locations
  for update to petro_api
  using (petro.aer_job_writing()) with check (petro.aer_job_writing());

revoke all on petro.aer_licence_locations
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.aer_licence_locations to petro_api;
grant insert (licence_number, found, surface_location, licensee, licence_status, longitude,
  latitude)
  on petro.aer_licence_locations to petro_api;
grant update (found, surface_location, licensee, licence_status, longitude, latitude, tried_at,
  attempts)
  on petro.aer_licence_locations to petro_api;

revoke all on function petro.keep_aer_licence_location()
  from public, anon, authenticated, service_role, petro_api;

-- The rigs route and the job's new steps need this version (RIGS_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 17
$$;
