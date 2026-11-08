-- A railroad's lines as on ArcGIS: shared track and trackage rights (the owner's request and
-- answers of 2026-11-08, F-137).
--
-- A live lines layer coloured by a field (RROWNER1, the first owner) can also count the values of
-- other fields (RROWNER2, RROWNER3, TRKRGHTS1 to 9), so a railroad's lines include track it
-- co-owns or has the right to run on, as the publisher's own railroad views do; and it can be
-- limited to features whose field has one of a few values (NET is M or I: main lines and industry
-- track, without yards and sidings). The Worker asks the service only for those features.
--
-- A zoomed-out view records the settings it was built with (grouping), checked again when it is
-- published and by the map, so a view built under other settings is never shown for the layer.

-- Whether every item of a list matches a pattern (each item checked on its own).
create function app.every_match(items text[], pattern text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(item ~ pattern), true) from unnest(items) as item
$$;

alter table app.map_layers
  add column also_fields text[] not null default '{}' check (
    cardinality(also_fields) <= 16
    and array_position(also_fields, null) is null
    and app.every_match(also_fields, '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$')
  ),
  add column only_field text check (only_field ~ '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$'),
  add column only_values text[] not null default '{}' check (
    cardinality(only_values) <= 20
    and array_position(only_values, null) is null
    and app.every_match(only_values, '^[A-Za-z0-9 _.-]{1,50}$')
  ),
  add constraint map_layers_only_values check ((only_field is null) = (cardinality(only_values) = 0)),
  add constraint map_layers_also_with_colour check (
    cardinality(also_fields) = 0 or colour_field is not null
  ),
  add constraint map_layers_shared_live_only check (
    (cardinality(also_fields) = 0 and only_field is null) or kind = 'arcgis_features'
  );

-- The settings a view was built with, as the Worker writes them (groupingOf in @grain/domain);
-- empty for views built before this.
alter table app.map_layer_overviews
  add column grouping text not null default '' check (length(grouping) <= 4000);

revoke all on function app.every_match(text[], text) from public, anon, authenticated, service_role;
grant execute on function app.every_match(text[], text) to app_api;
grant update (also_fields, only_field, only_values) on app.map_layers to app_api;
grant update (grouping) on app.map_layer_overviews to app_api;
