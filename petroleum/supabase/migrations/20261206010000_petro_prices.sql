-- Alberta's royalty prices (F-285, docs/FEATURES_OIL_GAS.md; the owner, 2026-11-23: "All three
-- products", "load everything since 1994"): the monthly prices the province sets to value the
-- Crown's royalty share, every month it publishes, each with the address it was read from.
--
--   * Gas: the gas reference price, $/GJ, every month since January 1994, from the price archive
--     of https://www.alberta.ca/alberta-natural-gas-reference-price.
--   * Gas liquids and sulphur: the reference, par and floor prices of ethane, propane, butanes
--     and pentanes plus, and sulphur's default price, from the monthly reference price
--     calculations on https://open.alberta.ca (1994 on; 1995 is not published there, 2002 and
--     2010 only in part). Older and newer names are kept apart (PRICE_SERIES, packages/domain/src/prices.ts).
--   * Oil: the par prices of light, medium, heavy and ultra heavy oil, $/m3, from the monthly
--     information letters linked from https://www.alberta.ca/oil-par-prices (January 2012 on).
--
-- Public data of the Government of Alberta, owned by no organization. Loaded by the GitHub
-- workflow "Load prices" (.github/workflows/load-prices.yml), by hand and once a month, which
-- connects as the database's owner and replaces the whole copy in one transaction under the
-- shared 400 MB size guard. The Worker only reads: petro_api has select and nothing else.

-- Each load: when, how many prices and months it kept, and the files it could not read.
create table petro.price_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  prices integer not null check (prices >= 0),
  first_month date,
  last_month date,
  -- The addresses of files that could not be fetched or read; their months are simply missing.
  unread text[] not null default '{}' check (cardinality(unread) <= 1000),
  check ((first_month is null) = (last_month is null) and first_month <= last_month)
);

create table petro.reference_prices (
  -- As petro.price_series lists them (packages/domain/src/prices.ts, PRICE_SERIES).
  series text not null check (series ~ '^[a-z][a-z_]{2,39}$'),
  -- The production month the price is for, as its first day.
  month date not null check (extract(day from month) = 1 and month >= date '1994-01-01'),
  -- Canadian dollars as the province writes them, never a float.
  price numeric(12, 4) not null check (price between -100000 and 100000),
  unit text not null check (unit in ('$/GJ', '$/m3', '$/tonne')),
  source_url text not null check (
    source_url ~ '^https://(www\.alberta\.ca|open\.alberta\.ca|inform\.energy\.gov\.ab\.ca)/'
  ),
  primary key (series, month)
);

alter table petro.price_loads enable row level security;
alter table petro.reference_prices enable row level security;

-- Members the Worker named read, as they read the wells (petro.st37_may_read).
create policy price_loads_read on petro.price_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy reference_prices_read on petro.reference_prices
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.price_loads, petro.reference_prices
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.price_loads, petro.reference_prices to petro_api;

-- The Worker's prices route needs this version (PRICES_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 19
$$;
