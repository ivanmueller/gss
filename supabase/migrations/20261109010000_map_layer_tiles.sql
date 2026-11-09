-- ArcGIS layers of pre-drawn picture squares, and which of a map's layers it shows at first (the
-- owner's request of 2026-11-08, F-141, with the Government of Canada's "Spatial Density of Major
-- Crops in Canada" map).
--
-- Many ArcGIS maps, heat maps among them, are made of "tiled map services": pictures drawn ahead
-- of time in squares, which do not draw a picture on request (their "export" answers Page Not
-- Found). Such a layer is now its own kind, arcgis_tiles: the Worker passes on its own squares
-- (…/tile/{level}/{row}/{column}), only the standard web Mercator squares that Mapbox uses, and
-- only within the levels the service has (tile_min_level to tile_max_level), enlarged past its
-- last. A layer of an ArcGIS map also keeps whether the map shows it at first (map_visible), so
-- the map's switch on the Layers panel turns on the same layers as ArcGIS.
--
-- Set when a layer is added and never changed (no update grant), like the rest of its look.

alter table app.map_layers
  drop constraint map_layers_kind_check,
  add constraint map_layers_kind_check check (
    kind in ('arcgis_features', 'arcgis_image', 'arcgis_tiles', 'wms', 'file')
  ),
  add column tile_min_level integer check (tile_min_level between 0 and 23),
  add column tile_max_level integer check (tile_max_level between 0 and 23),
  add column map_visible boolean not null default true,
  add constraint map_layers_tile_levels check (
    (kind = 'arcgis_tiles') = (tile_min_level is not null and tile_max_level is not null)
    and (tile_min_level is null or tile_min_level <= tile_max_level)
    and (tile_min_level is null) = (tile_max_level is null)
  );

-- app_api already inserts every column (20261107040000_map_layers.sql) and is granted no update
-- of these.
