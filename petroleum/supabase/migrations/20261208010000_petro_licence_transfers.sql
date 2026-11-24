-- Licence transfers (F-295, docs/FEATURES_OIL_GAS.md; the owner, 2026-11-23: option A, "record
-- transfers quietly now"): who holds every well, facility and pipeline licence in Alberta, read
-- each day from the AER's three licence lists (packages/domain/src/licenceHolders.ts), and each
-- licence that moved from one company to another since the day before. The AER publishes no
-- free list of transfers, so the record starts with the first load: the first load only records
-- who holds what, and the transfers begin the day after.
--
-- The AER's data, on the owner's decision for its lists (docs/DECISIONS.md, 2026-11-19): members
-- only, non-commercial, the AER named as the source. Loaded by the GitHub workflow "Load licence
-- transfers" (.github/workflows/load-licences.yml) as the database's owner, in one transaction
-- under the shared 400 MB size guard. The Worker only reads: petro_api has select and nothing
-- else.
--
-- Space: 574,830 licences on 2026-11-23. One row a licence would take 35 to 50 MB of the
-- 70 MB or so left under the guard, so the holdings are kept one row a company and kind, its
-- licences as one compressed list: a few MB.

-- Each day's load. Loads form one chain: each names the load it compared with, and no two loads
-- compare with the same one, so two runs at once can never both record the same day's changes.
create table petro.licence_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  -- The day in Alberta the lists were read.
  alberta_day date not null,
  -- The load compared with; null only for the first, which records no transfers.
  previous_load_id bigint unique references petro.licence_loads (id),
  -- Licences read today, by kind.
  wells integer not null check (wells >= 0),
  facilities integer not null check (facilities >= 0),
  pipelines integer not null check (pipelines >= 0),
  -- Licences new since the load compared with, and those that changed company.
  added integer not null check (added >= 0),
  transfers integer not null check (transfers >= 0),
  -- Lines that could not be read, and licences listed under two companies (left out).
  skipped integer not null check (skipped >= 0),
  ambiguous integer not null check (ambiguous >= 0),
  check (previous_load_id is not null or transfers = 0)
);
-- Only one first load.
create unique index licence_loads_one_first on petro.licence_loads ((true))
  where previous_load_id is null;

-- Each company's latest name, by the AER's four-character business associate code.
create table petro.licence_companies (
  ba_code text primary key check (ba_code ~ '^[0-9A-Z]{4}$'),
  name text not null check (char_length(name) between 1 and 200),
  updated_at timestamptz not null default now()
);

-- Who holds each licence as last read: one row a kind and company. A licence missing from a
-- day's lists keeps its last holder (never read as a transfer).
create table petro.licence_holdings (
  kind text not null check (kind in ('well', 'facility', 'pipeline')),
  ba_code text not null check (ba_code ~ '^[0-9A-Z]{4}$'),
  licences text[] not null check (cardinality(licences) > 0),
  primary key (kind, ba_code)
);

-- Each licence that moved to another company, found by comparing a day's lists with the load
-- before: it moved on or before the load's day and after the previous load's. The names are as
-- the lists wrote them then. Kept, never changed or removed.
create table petro.licence_transfers (
  id bigint generated always as identity primary key,
  load_id bigint not null references petro.licence_loads (id),
  kind text not null check (kind in ('well', 'facility', 'pipeline')),
  licence text not null check (licence ~ '^[WFP][ A-Z]?[0-9]{1,8}[A-Z]?$'),
  from_ba text not null check (from_ba ~ '^[0-9A-Z]{4}$'),
  from_name text check (char_length(from_name) between 1 and 200),
  to_ba text not null check (to_ba ~ '^[0-9A-Z]{4}$'),
  to_name text not null check (char_length(to_name) between 1 and 200),
  check (from_ba <> to_ba)
);
create index licence_transfers_by_load on petro.licence_transfers (load_id);
create index licence_transfers_by_from on petro.licence_transfers (from_ba);
create index licence_transfers_by_to on petro.licence_transfers (to_ba);
create index licence_transfers_by_licence on petro.licence_transfers (licence);

-- The record of loads and transfers is kept: nobody changes or removes it, the owner included.
create function petro.keep_licence_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The licence transfer record is kept: % on % is refused', tg_op, tg_table_name
    using errcode = '23514';
end
$$;
create trigger licence_loads_kept before update or delete on petro.licence_loads
  for each row execute function petro.keep_licence_record();
create trigger licence_loads_not_truncated before truncate on petro.licence_loads
  for each statement execute function petro.keep_licence_record();
create trigger licence_transfers_kept before update or delete on petro.licence_transfers
  for each row execute function petro.keep_licence_record();
create trigger licence_transfers_not_truncated before truncate on petro.licence_transfers
  for each statement execute function petro.keep_licence_record();
revoke all on function petro.keep_licence_record() from public, anon, authenticated, service_role, petro_api;

alter table petro.licence_loads enable row level security;
alter table petro.licence_companies enable row level security;
alter table petro.licence_holdings enable row level security;
alter table petro.licence_transfers enable row level security;

-- Members the Worker named read, as they read the wells (petro.st37_may_read).
create policy licence_loads_read on petro.licence_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy licence_companies_read on petro.licence_companies
  for select to petro_api using ((select petro.st37_may_read()));
create policy licence_holdings_read on petro.licence_holdings
  for select to petro_api using ((select petro.st37_may_read()));
create policy licence_transfers_read on petro.licence_transfers
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.licence_loads, petro.licence_companies, petro.licence_holdings,
  petro.licence_transfers
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.licence_loads, petro.licence_companies, petro.licence_holdings,
  petro.licence_transfers to petro_api;

create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 21
$$;
