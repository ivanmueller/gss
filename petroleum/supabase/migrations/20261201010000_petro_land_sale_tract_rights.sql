-- A Crown land sale parcel's rights tract by tract (F-276, docs/FEATURES_OIL_GAS.md; the
-- owner, 2026-11-22: the parcel's panel as on the reference picture, which lists the rights of
-- each tract, its lines joined by "; "). `zone` keeps each clause once over the whole parcel
-- (what "Rights include" reads); this keeps each tract's wording as its sale's notice writes
-- it, a wording once however many tracts share it, in the notice's order. From the same public
-- files as the parcels (20261127010000_petro_land_sales.sql; docs/DECISIONS.md, 2026-11-21).
--
-- Written by the manual "Load land sales" workflow, as the rest of the copy; the Worker only
-- reads (petro_api keeps select and nothing else on the table). Empty until that workflow has
-- run once more.

alter table petro.land_sale_parcels
  -- ["PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE EXAMPLE GRP; TO BASEMENT", ...]
  add column tract_rights jsonb
    check (
      jsonb_typeof(tract_rights) = 'array'
      and jsonb_array_length(tract_rights) between 1 and 40
      and not jsonb_path_exists(tract_rights, '$[*] ? (@.type() != "string")')
      and char_length(tract_rights::text) <= 9000
    );

-- The Worker's land sales route needs this version (LAND_SALES_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 14
$$;
