-- More of each Crown land sale parcel (F-265, docs/FEATURES_OIL_GAS.md; the owner, 2026-11-22):
-- the codes of the restrictions that apply to it and of its deeper rights reversion zones, as
-- its sale's notice lists them, and, for each sale, the department's own links to the notice
-- and the results as PDF files. All from the same public files and page as the parcels
-- (20261127010000_petro_land_sales.sql; docs/DECISIONS.md, 2026-11-21).
--
-- Written by the manual "Load land sales" workflow, as the rest of the copy; the Worker only
-- reads (petro_api keeps select and nothing else on both tables). The columns are empty until
-- that workflow has run once more.

alter table petro.land_sale_parcels
  -- The restriction codes, each once, separated by spaces: "SHA010301 SHA010401".
  add column restrictions text
    check (restrictions ~ '^[A-Z0-9]{2,12}( [A-Z0-9]{2,12}){0,59}$'),
  -- The deeper rights reversion zone codes, the same way: "D00039 D00004".
  add column reversion_zones text
    check (reversion_zones ~ '^[A-Z0-9]{2,12}( [A-Z0-9]{2,12}){0,119}$');

-- Each sale's documents as the department's page links them, by sale date:
-- {"2026-08-19": {"notice": "/download/?s=png&id=20260819PON&ft=.pdf", "results": "..."}}.
-- Paths on the department's site only; the loader and the Worker both check their form.
alter table petro.land_sale_loads
  add column documents jsonb not null default '{}'::jsonb
    check (jsonb_typeof(documents) = 'object');

-- The Worker's land sales route needs this version (LAND_SALES_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 11
$$;
