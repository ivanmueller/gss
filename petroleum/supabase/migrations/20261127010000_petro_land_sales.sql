-- Crown land sales (F-242, docs/FEATURES_OIL_GAS.md): the parcels of Alberta Energy and
-- Minerals' public offerings of petroleum and natural gas rights, from each sale's notice
-- (contract, hectares, land, rights) and its results (status, bonus, price per hectare,
-- buyers), since 2003, for one area at a time (the Duvernay's wells first; the owner,
-- 2026-11-21). Read from the department's own page; its notices and accepted offers are also
-- published on the province's open data portal under the Open Government Licence - Alberta
-- (docs/DECISIONS.md, 2026-11-21).
--
-- Loaded by hand by the manual GitHub workflow "Load land sales"
-- (.github/workflows/load-land-sales.yml), which connects as the database's owner (as
-- migrations do) and replaces the whole copy in one transaction under the shared 400 MB size
-- guard. The Worker only reads: petro_api has select and nothing else.
--
-- A parcel's shape is its land placed on the province's grid of sections, each piece as one
-- polygon of a GeoJSON MultiPolygon's coordinates; quarters and legal subdivisions are an even
-- division of their section, so an edge can be a few metres off the surveyed one.

create table petro.land_sale_loads (
  id bigint generated always as identity primary key,
  loaded_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://content2\.energy\.alberta\.ca/'),
  first_sale date not null,
  last_sale date not null,
  west numeric(9, 6) not null,
  south numeric(8, 6) not null,
  east numeric(9, 6) not null,
  north numeric(8, 6) not null,
  -- How many sales were read, and how many of their parcels lie in the area and are kept.
  sales integer not null check (sales >= 0),
  parcels integer not null check (parcels >= 0),
  check (first_sale <= last_sale),
  check (west < east and south < north)
);

create table petro.land_sale_parcels (
  id bigint generated always as identity primary key,
  sale_date date not null,
  -- The contract's number in its sale: A0001 (a lease), B0018 (a licence).
  contract_no text not null check (contract_no ~ '^[A-Z][0-9]{4}$'),
  contract_type text check (char_length(contract_type) <= 20),
  region text check (char_length(region) <= 40),
  hectares numeric(12, 4) check (hectares >= 0),
  -- The rights, worded as the zones of agreements are: "... FROM SURFACE TO THE BASE OF ...".
  zone text check (char_length(zone) <= 1000),
  -- The land keys as published, separated by spaces.
  land text not null check (char_length(land) between 1 and 8000),
  -- Whether some of its land is only a portion or by metes and bounds, or lies outside the
  -- area loaded: the shape then shows more, or less, than the parcel.
  inexact boolean not null default false,
  -- The result as published (ACCEPTED, NO OFFERS ...); null until the sale has results.
  status text check (char_length(status) <= 40),
  bonus numeric(14, 2) check (bonus >= 0),
  dollars_per_hectare numeric(12, 2) check (dollars_per_hectare >= 0),
  -- Each buyer with its share, as published: "EXAMPLE LAND LTD. 100%".
  buyers text check (char_length(buyers) <= 2000),
  bounds box not null,
  shape jsonb not null check (jsonb_typeof(shape) = 'array' and jsonb_array_length(shape) >= 1),
  unique (sale_date, contract_no)
);
create index land_sale_parcels_by_place on petro.land_sale_parcels using gist (bounds);

alter table petro.land_sale_loads enable row level security;
alter table petro.land_sale_parcels enable row level security;

-- Members the Worker named read, as they read the wells (petro.st37_may_read).
create policy land_sale_loads_read on petro.land_sale_loads
  for select to petro_api using ((select petro.st37_may_read()));
create policy land_sale_parcels_read on petro.land_sale_parcels
  for select to petro_api using ((select petro.st37_may_read()));

revoke all on petro.land_sale_loads, petro.land_sale_parcels
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.land_sale_loads, petro.land_sale_parcels to petro_api;

-- The Worker's land sales route needs this version (LAND_SALES_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 10
$$;
