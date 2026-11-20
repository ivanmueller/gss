-- Every Alberta well, loaded from the province's public "Well Surface" service (F-243 part 3,
-- docs/FEATURES_OIL_GAS.md; review register docs/reviews/F-243-3.md). Its data comes from the
-- AER and is used on the owner's decision (docs/DECISIONS.md, 2026-11-19): members only, never
-- exported.
--
-- A reference copy of the province's current list, refreshed monthly by the Worker's job, page
-- by page under a size guard (the free plan's limit is shared with grain's database). Rows are
-- updated in place: keeping every monthly copy would not fit the free plan.
--
-- Loads are numbered; each refreshes the wells it sees. No well is retired automatically: a
-- well once listed stays, with its latest values (the AER's list keeps abandoned and suspended
-- wells, with their status). Proving that a well left the source, while the source changes
-- during a load, kept failing review (F-243-3-R1-01 to R3-02); retiring wells is left for a
-- later, separate step.

-- The scheduled jobs' names: the AER lists and the wells.
create or replace function petro.current_job()
returns text
language sql
stable
set search_path = ''
as $$
  select j
  from (select nullif(current_setting('petro.job', true), '') as j) s
  where j in ('aer_lists', 'wells')
$$;

-- The wells job is writing: its name is set and no member is.
create function petro.wells_job_writing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(petro.current_job() = 'wells', false)
     and petro.current_user_id() is null
     and petro.current_organization_id() is null
     and petro.current_member_role() is null
$$;

-- Who may read the wells: a member the Worker named, or the wells job.
create function petro.wells_may_read()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (petro.current_user_id() is not null
          and petro.current_organization_id() is not null
          and petro.current_member_role() is not null)
      or petro.wells_job_writing()
$$;

create table petro.well_loads (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'done', 'done_unclean', 'stopped_size', 'failed')),
  -- The keyset cursor: the highest source OBJECTID written so far.
  last_object_id bigint not null default 0 check (last_object_id >= 0),
  rows_saved integer not null default 0 check (rows_saved >= 0),
  rows_unidentified integer not null default 0 check (rows_unidentified >= 0),
  rows_invalid integer not null default 0 check (rows_invalid >= 0),
  check ((status = 'running') = (finished_at is null))
);
-- At most one load runs at a time.
create unique index well_loads_one_running on petro.well_loads ((true)) where status = 'running';

create table petro.wells (
  uwi text primary key check (uwi ~ '^[0-9A-Z]{13,16}$'),
  source_object_id bigint not null check (source_object_id > 0),
  well_name text not null check (char_length(well_name) <= 200),
  operator_code text not null check (char_length(operator_code) <= 20),
  operator_name text not null check (char_length(operator_name) <= 200),
  well_type text not null check (char_length(well_type) <= 200),
  status_code text not null check (char_length(status_code) <= 20),
  status text not null check (char_length(status) <= 200),
  final_drill_date date,
  -- Null when the source never gave a usable location for this well.
  longitude numeric(9, 6),
  latitude numeric(8, 6),
  -- The load that last saw this well.
  load_id bigint not null references petro.well_loads (id),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (longitude is null and latitude is null)
    or (longitude between -120.1 and -109.9 and latitude between 48.9 and 60.1)
  )
);
create index wells_by_load on petro.wells (load_id);
create index wells_by_operator on petro.wells (operator_code);
create index wells_by_status on petro.wells (status);

-- A load's row changes only forward: its cursor never moves back, and a finished load stays
-- finished (F-243-3-D1-03).
create function petro.keep_well_load()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'running' then
    raise exception 'A finished well load does not change' using errcode = '23514';
  end if;
  if new.id <> old.id or new.started_at <> old.started_at
     or new.last_object_id < old.last_object_id
     or new.rows_saved < old.rows_saved or new.rows_unidentified < old.rows_unidentified
     or new.rows_invalid < old.rows_invalid then
    raise exception 'A well load only moves forward' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger well_loads_keep
  before update on petro.well_loads
  for each row execute function petro.keep_well_load();

-- The wells shown: every well the loads have seen (none is retired automatically).
create view petro.current_wells with (security_invoker = true) as
  select w.* from petro.wells w;

-- Each policy calls its rule once per query, not once per row: (select …) (550,000 wells).
alter table petro.well_loads enable row level security;
alter table petro.wells enable row level security;

create policy well_loads_read on petro.well_loads
  for select to petro_api using ((select petro.wells_may_read()));
create policy well_loads_job_insert on petro.well_loads
  for insert to petro_api with check ((select petro.wells_job_writing()));
create policy well_loads_job_update on petro.well_loads
  for update to petro_api
  using ((select petro.wells_job_writing())) with check ((select petro.wells_job_writing()));
create policy wells_read on petro.wells
  for select to petro_api using ((select petro.wells_may_read()));
create policy wells_job_insert on petro.wells
  for insert to petro_api with check ((select petro.wells_job_writing()));
create policy wells_job_update on petro.wells
  for update to petro_api
  using ((select petro.wells_job_writing())) with check ((select petro.wells_job_writing()));

-- Privileges: nothing for public or the Supabase API roles; petro_api reads, the job inserts and
-- updates only the columns it writes. Nothing is deleted.
revoke all on petro.well_loads, petro.wells, petro.current_wells
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.well_loads, petro.wells, petro.current_wells to petro_api;
grant insert (status) on petro.well_loads to petro_api;
grant update (finished_at, status, last_object_id, rows_saved, rows_unidentified, rows_invalid)
  on petro.well_loads to petro_api;
grant insert (uwi, source_object_id, well_name, operator_code, operator_name, well_type,
  status_code, status, final_drill_date, longitude, latitude, load_id)
  on petro.wells to petro_api;
grant update (source_object_id, well_name, operator_code, operator_name, well_type, status_code,
  status, final_drill_date, longitude, latitude, load_id, updated_at)
  on petro.wells to petro_api;

revoke all on function petro.wells_job_writing(), petro.wells_may_read(), petro.keep_well_load()
  from public, anon, authenticated, service_role, petro_api;
grant execute on function petro.wells_job_writing(), petro.wells_may_read() to petro_api;

-- The Worker's wells job and route need this version (PETROLEUM_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 4
$$;
