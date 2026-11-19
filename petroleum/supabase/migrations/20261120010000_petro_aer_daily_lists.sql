-- The Alberta Energy Regulator's daily licence (ST1) and rig activity (ST49) lists, kept as
-- published, read, and located on the township grid (F-243 part 1, docs/FEATURES_OIL_GAS.md;
-- review register docs/reviews/F-243-1.md).
--
-- Public data, owned by no organization: one copy, read by any member the Worker names. Written
-- only by the Worker's scheduled job, which sets `petro.job` for its own transaction and no member
-- context. The AER's data is not under an open licence; it is used on the owner's decision
-- (docs/DECISIONS.md, 2026-11-19): members only, never exported.
--
-- Files, editions and readings are kept apart (F-243-1-D1-01, D1-02):
-- * a file is a content, stored once;
-- * an edition is each time an address is seen with a content other than its last one
--   (A, B, then A again are three editions);
-- * a reading is what one version of the Worker's reader made of a file: read, partial or
--   unreadable. Only a list read whole (`read`: every record read) is ever served, by its
--   highest-version such reading, so a reader upgrade or a failed re-reading never hides a list
--   that was usable, and a list with any record the reader could not read never replaces one
--   (F-243-1-R2-02). Partial and unreadable readings are kept for the record and the logs.
-- Everything is append-only, except a township grid point not found, which may be asked again
-- after a week.

-- The scheduled job's name for this transaction, or null. Only known jobs are named.
create function petro.current_job()
returns text
language sql
stable
set search_path = ''
as $$
  select j
  from (select nullif(current_setting('petro.job', true), '') as j) s
  where j in ('aer_lists')
$$;

-- The AER job is writing: its name is set and no member is (F-243-1 plan: a member request can
-- never write, even if it also sets the job's name).
create function petro.aer_job_writing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(petro.current_job() = 'aer_lists', false)
     and petro.current_user_id() is null
     and petro.current_organization_id() is null
     and petro.current_member_role() is null
$$;

-- Who may read the AER's lists: a member the Worker named, or the job itself.
create function petro.aer_may_read()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (petro.current_user_id() is not null
          and petro.current_organization_id() is not null
          and petro.current_member_role() is not null)
      or petro.aer_job_writing()
$$;

create table petro.aer_list_files (
  id uuid primary key default gen_random_uuid(),
  report text not null check (report in ('st1', 'st49')),
  body text not null check (char_length(body) between 1 and 2000000),
  -- The SHA-256 of the body's UTF-8 encoding, checked on insert.
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  stored_at timestamptz not null default now(),
  unique (report, body_sha256)
);

create table petro.aer_list_editions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references petro.aer_list_files (id),
  -- One of the AER's 14 fixed addresses.
  source_url text not null check (source_url ~ (
    '^https://static\.aer\.ca/prd/data/('
    || 'well-lic/WELLS(MON|TUE|WED|THU|FRI|SAT|SUN)\.TXT'
    || '|wells/SPUD(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.txt)$')),
  seen_at timestamptz not null default now()
);
create index aer_list_editions_by_address on petro.aer_list_editions (source_url, seen_at desc, id);
create index aer_list_editions_by_file on petro.aer_list_editions (file_id, seen_at desc, id);

create table petro.aer_list_reads (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references petro.aer_list_files (id),
  reader_version integer not null check (reader_version between 1 and 1000),
  status text not null check (status in ('read', 'partial', 'unreadable')),
  list_date date,
  rows_read integer not null check (rows_read between 0 and 100000),
  rows_skipped integer not null check (rows_skipped between 0 and 100000),
  read_at timestamptz not null default now(),
  unique (file_id, reader_version),
  check (status = 'unreadable' or list_date is not null),
  check (status <> 'unreadable' or rows_read = 0),
  check (status <> 'read' or rows_skipped = 0),
  check (status <> 'partial' or rows_skipped > 0)
);
create index aer_list_reads_by_date on petro.aer_list_reads (list_date);

create table petro.aer_licences (
  read_id uuid not null references petro.aer_list_reads (id),
  line_no integer not null check (line_no between 1 and 100000),
  licence_number text not null check (licence_number ~ '^[0-9]{7}$'),
  well_name text not null check (char_length(well_name) <= 200),
  mineral_rights text not null check (char_length(mineral_rights) <= 200),
  ground_elevation text not null check (char_length(ground_elevation) <= 200),
  uwi text not null check (char_length(uwi) <= 200),
  surface_offsets text not null check (char_length(surface_offsets) <= 200),
  field_centre text not null check (char_length(field_centre) <= 200),
  projected_depth text not null check (char_length(projected_depth) <= 200),
  classification text not null check (char_length(classification) <= 200),
  field text not null check (char_length(field) <= 200),
  terminating_zone text not null check (char_length(terminating_zone) <= 200),
  drilling_operation text not null check (char_length(drilling_operation) <= 200),
  well_purpose text not null check (char_length(well_purpose) <= 200),
  well_type text not null check (char_length(well_type) <= 200),
  substance text not null check (char_length(substance) <= 200),
  licensee text not null check (char_length(licensee) <= 200),
  surface_location text not null check (
    surface_location ~ '^[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]$'),
  lsd smallint not null check (lsd between 1 and 16),
  section smallint not null check (section between 1 and 36),
  township smallint not null check (township between 1 and 126),
  range smallint not null check (range between 1 and 34),
  meridian smallint not null check (meridian between 4 and 6),
  primary key (read_id, line_no),
  -- The parsed subdivision is the published text's.
  check (surface_location = lpad(lsd::text, 2, '0') || '-' || lpad(section::text, 2, '0') || '-'
    || lpad(township::text, 3, '0') || '-' || lpad(range::text, 2, '0') || 'W' || meridian::text)
);
create index aer_licences_by_number on petro.aer_licences (licence_number);

create table petro.aer_rig_activities (
  read_id uuid not null references petro.aer_list_reads (id),
  line_no integer not null check (line_no between 1 and 100000),
  well_id text not null check (well_id ~ '^[0-9A-Z]{2}/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]/[0-9]$'),
  well_name text not null check (char_length(well_name) <= 200),
  licence_number text not null check (licence_number ~ '^[0-9]{7}$'),
  contractor_ba_id text not null check (char_length(contractor_ba_id) <= 200),
  contractor_name text not null check (char_length(contractor_name) <= 200),
  rig_number text not null check (char_length(rig_number) <= 200),
  activity_local text not null check (char_length(activity_local) <= 200),
  -- Alberta wall-clock time with seconds, and the same instant converted by the platform's
  -- Alberta rule (F-243-1-D1-04).
  activity_wall_time text not null check (
    activity_wall_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'),
  activity_at timestamptz not null,
  field_centre text not null check (char_length(field_centre) <= 200),
  licensee_ba_id text not null check (char_length(licensee_ba_id) <= 200),
  licensee_name text not null check (char_length(licensee_name) <= 200),
  new_projected_depth text not null check (char_length(new_projected_depth) <= 200),
  activity_type text not null check (char_length(activity_type) <= 200),
  -- The well ID's subdivision: the bottom hole, kept but never used to place the rig
  -- (F-243-1-D1-03).
  bottom_lsd smallint not null check (bottom_lsd between 1 and 16),
  bottom_section smallint not null check (bottom_section between 1 and 36),
  bottom_township smallint not null check (bottom_township between 1 and 126),
  bottom_range smallint not null check (bottom_range between 1 and 34),
  bottom_meridian smallint not null check (bottom_meridian between 4 and 6),
  primary key (read_id, line_no)
);
create index aer_rig_activities_by_licence on petro.aer_rig_activities (licence_number);

create table petro.ats_lsd_points (
  meridian smallint not null check (meridian between 4 and 6),
  range smallint not null check (range between 1 and 34),
  township smallint not null check (township between 1 and 126),
  section smallint not null check (section between 1 and 36),
  lsd smallint not null check (lsd between 1 and 16),
  longitude numeric(9, 6),
  latitude numeric(8, 6),
  found boolean not null,
  tried_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts between 1 and 10000),
  -- The placing code's version (AER_PLACEMENT_VERSION): a correction raises it, and every
  -- subdivision is placed again, its earlier points kept (F-243-1-R3-02).
  placement_version integer not null default 1 check (placement_version between 1 and 1000),
  primary key (meridian, range, township, section, lsd, placement_version),
  -- Found: a point inside Alberta's box; not found: no point.
  check (
    (found and longitude between -120.1 and -109.9 and latitude between 48.9 and 60.1)
    or (not found and longitude is null and latitude is null)
  )
);

-- A file's hash is its body's, so a caller cannot store a body under another content's hash.
create function petro.check_aer_list_file()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body_sha256 <> encode(sha256(convert_to(new.body, 'UTF8')), 'hex') then
    raise exception 'An AER list file''s hash must be its body''s' using errcode = '23514';
  end if;
  return new;
end
$$;

-- An edition records a change: its address's report matches its file's, and its file differs
-- from the address's latest edition. Serialized per address, so two runs seeing the same change
-- record it once (F-243-1-D2-05).
create function petro.check_aer_list_edition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  file_report text;
  latest uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('petro.aer_list_editions:' || new.source_url, 0));
  select report into file_report from petro.aer_list_files where id = new.file_id;
  if file_report is distinct from
     (case when new.source_url like '%/well-lic/%' then 'st1' else 'st49' end) then
    raise exception 'An AER edition''s address and file are of different reports'
      using errcode = '23514';
  end if;
  select file_id into latest from petro.aer_list_editions
    where source_url = new.source_url order by seen_at desc, id desc limit 1;
  if latest = new.file_id then
    raise exception 'An AER edition must change its address''s contents' using errcode = '23514';
  end if;
  new.seen_at := clock_timestamp();
  return new;
end
$$;

-- A point not found may be asked again after a week; a found point never changes.
create function petro.keep_ats_lsd_point()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.found or old.tried_at > now() - interval '7 days' then
    raise exception 'A township grid point is asked again only when not found for a week'
      using errcode = '23514';
  end if;
  if new.attempts <> old.attempts + 1 or new.tried_at < now() - interval '1 minute' then
    raise exception 'A retried township grid point counts its attempt now' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger aer_list_files_check
  before insert on petro.aer_list_files
  for each row execute function petro.check_aer_list_file();
create trigger aer_list_editions_check
  before insert on petro.aer_list_editions
  for each row execute function petro.check_aer_list_edition();
create trigger ats_lsd_points_keep
  before update on petro.ats_lsd_points
  for each row execute function petro.keep_ats_lsd_point();

-- What is served (security invoker: row level security applies to whoever reads).
--
-- Each file's usable reading: its highest-version `read` reading, every record read. Partial and
-- unreadable readings are never usable (F-243-1-D2-03, F-243-1-R2-02).
create view petro.aer_usable_reads with (security_invoker = true) as
  select distinct on (r.file_id)
         r.id, r.file_id, r.reader_version, r.status, r.list_date, r.rows_read, r.rows_skipped
  from petro.aer_list_reads r
  where r.status = 'read'
  order by r.file_id, r.reader_version desc;

-- For each report and list date, one reading: among the files with a usable reading for that
-- date, the file whose latest edition is newest. A partial, unreadable or unread file never
-- displaces anything.
create view petro.aer_served_reads with (security_invoker = true) as
  select distinct on (f.report, u.list_date)
         u.id as read_id, u.file_id, f.report, u.list_date, u.status, e.seen_at
  from petro.aer_usable_reads u
  join petro.aer_list_files f on f.id = u.file_id
  join lateral (
    select e.seen_at, e.id from petro.aer_list_editions e
    where e.file_id = u.file_id order by e.seen_at desc, e.id desc limit 1
  ) e on true
  order by f.report, u.list_date, e.seen_at desc, e.id desc;

-- Each subdivision's current point: its highest-version found point (F-243-1-R3-02).
create view petro.ats_lsd_current_points with (security_invoker = true) as
  select distinct on (p.meridian, p.range, p.township, p.section, p.lsd)
         p.meridian, p.range, p.township, p.section, p.lsd, p.longitude, p.latitude,
         p.placement_version
  from petro.ats_lsd_points p
  where p.found
  order by p.meridian, p.range, p.township, p.section, p.lsd, p.placement_version desc;

-- Each licence once, from the served ST1 readings, its latest list date first: the licences
-- route and the placing of rigs both read this, so they agree on a licence's location
-- (F-243-1-D2-06).
create view petro.aer_served_licences with (security_invoker = true) as
  select distinct on (l.licence_number)
         l.*, s.list_date, s.seen_at as edition_seen_at
  from petro.aer_licences l
  join petro.aer_served_reads s on s.read_id = l.read_id and s.report = 'st1'
  order by l.licence_number, s.list_date desc, s.seen_at desc, l.line_no desc;

alter table petro.aer_list_files enable row level security;
alter table petro.aer_list_editions enable row level security;
alter table petro.aer_list_reads enable row level security;
alter table petro.aer_licences enable row level security;
alter table petro.aer_rig_activities enable row level security;
alter table petro.ats_lsd_points enable row level security;

create policy aer_list_files_read on petro.aer_list_files
  for select to petro_api using (petro.aer_may_read());
create policy aer_list_files_job on petro.aer_list_files
  for insert to petro_api with check (petro.aer_job_writing());
create policy aer_list_editions_read on petro.aer_list_editions
  for select to petro_api using (petro.aer_may_read());
create policy aer_list_editions_job on petro.aer_list_editions
  for insert to petro_api with check (petro.aer_job_writing());
create policy aer_list_reads_read on petro.aer_list_reads
  for select to petro_api using (petro.aer_may_read());
create policy aer_list_reads_job on petro.aer_list_reads
  for insert to petro_api with check (petro.aer_job_writing());
create policy aer_licences_read on petro.aer_licences
  for select to petro_api using (petro.aer_may_read());
create policy aer_licences_job on petro.aer_licences
  for insert to petro_api with check (petro.aer_job_writing());
create policy aer_rig_activities_read on petro.aer_rig_activities
  for select to petro_api using (petro.aer_may_read());
create policy aer_rig_activities_job on petro.aer_rig_activities
  for insert to petro_api with check (petro.aer_job_writing());
create policy ats_lsd_points_read on petro.ats_lsd_points
  for select to petro_api using (petro.aer_may_read());
create policy ats_lsd_points_job on petro.ats_lsd_points
  for insert to petro_api with check (petro.aer_job_writing());
create policy ats_lsd_points_retry on petro.ats_lsd_points
  for update to petro_api
  using (petro.aer_job_writing()) with check (petro.aer_job_writing());

-- Privileges: nothing for public or the Supabase API roles. petro_api reads, and inserts only the
-- columns the job writes (ids and times are the database's); it updates only a retried point's
-- result. Nothing is deleted.
revoke all on petro.aer_list_files, petro.aer_list_editions, petro.aer_list_reads,
  petro.aer_licences, petro.aer_rig_activities, petro.ats_lsd_points,
  petro.aer_usable_reads, petro.aer_served_reads, petro.aer_served_licences,
  petro.ats_lsd_current_points
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.aer_list_files, petro.aer_list_editions, petro.aer_list_reads,
  petro.aer_licences, petro.aer_rig_activities, petro.ats_lsd_points,
  petro.aer_usable_reads, petro.aer_served_reads, petro.aer_served_licences,
  petro.ats_lsd_current_points
  to petro_api;
grant insert (report, body, body_sha256) on petro.aer_list_files to petro_api;
grant insert (file_id, source_url) on petro.aer_list_editions to petro_api;
grant insert (file_id, reader_version, status, list_date, rows_read, rows_skipped)
  on petro.aer_list_reads to petro_api;
grant insert (read_id, line_no, licence_number, well_name, mineral_rights, ground_elevation, uwi,
  surface_offsets, field_centre, projected_depth, classification, field, terminating_zone,
  drilling_operation, well_purpose, well_type, substance, licensee, surface_location, lsd,
  section, township, range, meridian)
  on petro.aer_licences to petro_api;
grant insert (read_id, line_no, well_id, well_name, licence_number, contractor_ba_id,
  contractor_name, rig_number, activity_local, activity_wall_time, activity_at, field_centre,
  licensee_ba_id, licensee_name, new_projected_depth, activity_type, bottom_lsd, bottom_section,
  bottom_township, bottom_range, bottom_meridian)
  on petro.aer_rig_activities to petro_api;
grant insert (meridian, range, township, section, lsd, longitude, latitude, found,
  placement_version)
  on petro.ats_lsd_points to petro_api;
grant update (longitude, latitude, found, tried_at, attempts) on petro.ats_lsd_points to petro_api;

revoke all on function petro.current_job(), petro.aer_job_writing(), petro.aer_may_read(),
  petro.check_aer_list_file(), petro.check_aer_list_edition(), petro.keep_ats_lsd_point()
  from public, anon, authenticated, service_role, petro_api;
grant execute on function petro.current_job(), petro.aer_job_writing(), petro.aer_may_read()
  to petro_api;

-- The Worker's AER routes and job need this version (PETROLEUM_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 3
$$;
