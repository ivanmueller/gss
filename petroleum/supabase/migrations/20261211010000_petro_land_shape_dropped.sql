-- The land's JSON shapes dropped (F-310 cleanup; the owner, 2026-11-25: "go ahead with ... F-310",
-- after "Load land" and "Load land sales" both ran green on staging that day): since
-- 20261210010000_petro_land_compact.sql every load writes a shape only as whole numbers (`path`
-- and `rings`), and both loads have emptied their tables and written that form, so `shape` is
-- empty on every row. It goes, with the rule that a row holds one form or the other, and `path`
-- becomes required. Dropping a column touches only the catalogue (the room was freed by the
-- loads); the NOT NULL check reads each table once.

alter table petro.land_agreements drop constraint land_agreements_one_shape;
alter table petro.land_offsets drop constraint land_offsets_one_shape;
alter table petro.land_freehold drop constraint land_freehold_one_shape;
alter table petro.land_sale_parcels drop constraint land_sale_parcels_one_shape;

alter table petro.land_agreements drop column shape, alter column path set not null;
alter table petro.land_offsets drop column shape, alter column path set not null;
alter table petro.land_freehold drop column shape, alter column path set not null;
alter table petro.land_sale_parcels drop column shape, alter column path set not null;

-- The Worker's land and land sales routes stop reading `shape` from this version on
-- (LAND_SCHEMA_VERSION, LAND_SALES_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 24
$$;
