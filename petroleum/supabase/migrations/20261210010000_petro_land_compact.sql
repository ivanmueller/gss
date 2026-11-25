-- Land kept in less room (F-310; the owner, 2026-11-25: "go ahead with compacting the land"):
-- the three land tables and the sale parcels held about 190 MB of the oil and gas database,
-- most of it their shapes as JSON. A shape is now kept as whole numbers, as the pipelines are
-- (20261203010000_petro_pipelines.sql: JSON took about three times the room): `path`, every
-- point's longitude and latitude in hundred-thousandths of a degree, each ring without the
-- point that closes it, and `rings`, for each polygon its count of rings and then each ring's
-- count of points, empty for one polygon of one ring (packLandShape in packages/domain/src/
-- land.ts).
--
-- Nothing is rewritten here: adding a column with no default, or a constant one, and dropping
-- NOT NULL touch only the catalogue, so the database does not grow while it is near the
-- shared guard. The rows loaded before keep their JSON shape until "Load land" and "Load land
-- sales" run again; each load empties its table (truncate) and writes the new form only, which
-- is what frees the room. Every row holds exactly one of the two forms. A later migration drops
-- `shape` once both loads have run.

alter table petro.land_agreements
  alter column shape drop not null,
  add column path integer[],
  add column rings integer[] not null default '{}';
alter table petro.land_offsets
  alter column shape drop not null,
  add column path integer[],
  add column rings integer[] not null default '{}';
alter table petro.land_freehold
  alter column shape drop not null,
  add column path integer[],
  add column rings integer[] not null default '{}';
alter table petro.land_sale_parcels
  alter column shape drop not null,
  add column path integer[],
  add column rings integer[] not null default '{}';

-- One form a row; a path of whole pairs, at least one ring of three points; the counts a list.
alter table petro.land_agreements
  add constraint land_agreements_one_shape check ((shape is null) <> (path is null)),
  add constraint land_agreements_path check (
    path is null or (array_ndims(path) = 1 and cardinality(path) >= 6 and cardinality(path) % 2 = 0)),
  add constraint land_agreements_rings check (cardinality(rings) = 0 or array_ndims(rings) = 1);
alter table petro.land_offsets
  add constraint land_offsets_one_shape check ((shape is null) <> (path is null)),
  add constraint land_offsets_path check (
    path is null or (array_ndims(path) = 1 and cardinality(path) >= 6 and cardinality(path) % 2 = 0)),
  add constraint land_offsets_rings check (cardinality(rings) = 0 or array_ndims(rings) = 1);
alter table petro.land_freehold
  add constraint land_freehold_one_shape check ((shape is null) <> (path is null)),
  add constraint land_freehold_path check (
    path is null or (array_ndims(path) = 1 and cardinality(path) >= 6 and cardinality(path) % 2 = 0)),
  add constraint land_freehold_rings check (cardinality(rings) = 0 or array_ndims(rings) = 1);
alter table petro.land_sale_parcels
  add constraint land_sale_parcels_one_shape check ((shape is null) <> (path is null)),
  add constraint land_sale_parcels_path check (
    path is null or (array_ndims(path) = 1 and cardinality(path) >= 6 and cardinality(path) % 2 = 0)),
  add constraint land_sale_parcels_rings check (cardinality(rings) = 0 or array_ndims(rings) = 1);

-- The Worker's land and land sales routes read the new columns from this version on
-- (LAND_SCHEMA_VERSION, LAND_SALES_SCHEMA_VERSION). The grants are the tables' own: petro_api
-- reads every column, writes none.
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 23
$$;
