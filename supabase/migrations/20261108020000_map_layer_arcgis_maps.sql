-- Map layers presented as on ArcGIS, and layers added from an ArcGIS map (the owner's request and
-- answers of 2026-11-08, F-138).
--
-- An admin pastes an ArcGIS map's link; each of its layers is added as a GSS layer with ArcGIS's
-- own drawing: its colours, the width of its lines, how see-through it is, the zooms it shows at,
-- the publisher's filter on its features, and whether values without a symbol of their own are
-- drawn. Layers from one map are kept together under the map's title, in the map's order.
--
-- These are set when a layer is added and never changed afterwards (no update grant): a layer
-- presented differently is removed and added again. Changing them on GSS is left for later (the
-- owner: "some map customization… can always be added later").

-- Whether a filter's parentheses and quotes are balanced (parentheses inside quoted text not
-- counted; '' is a quote within quoted text), so wrapped in parentheses it stays one condition and
-- cannot undo the layer's own limit ("1=1) OR (1=1"; Codex's review of 1f328f9). The same check as
-- balancedFilter in @grain/domain.
create function app.balanced_filter(filter text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  depth int := 0;
  quoted boolean := false;
  i int := 1;
  c text;
begin
  while i <= length(filter) loop
    c := substr(filter, i, 1);
    if quoted then
      if c = '''' then
        if substr(filter, i + 1, 1) = '''' then
          i := i + 1;
        else
          quoted := false;
        end if;
      end if;
    elsif c = '''' then
      quoted := true;
    elsif c = '(' then
      depth := depth + 1;
    elsif c = ')' then
      depth := depth - 1;
      if depth < 0 then
        return false;
      end if;
    end if;
    i := i + 1;
  end loop;
  return depth = 0 and not quoted;
end
$$;

revoke all on function app.balanced_filter(text) from public, anon, authenticated, service_role;
grant execute on function app.balanced_filter(text) to app_api;

alter table app.map_layers
  -- Line width in points, as ArcGIS gives it; null: GSS's usual width.
  add column line_width double precision check (line_width > 0 and line_width <= 50),
  -- 1 is solid; the layer's opacity times its transparency and its symbol's.
  add column opacity double precision not null default 1 check (opacity > 0 and opacity <= 1),
  -- The zooms (Mapbox's) it shows between, from ArcGIS's scale range; null: no limit.
  add column min_zoom double precision check (min_zoom >= 0 and min_zoom <= 24),
  add column max_zoom double precision check (max_zoom >= 0 and max_zoom <= 24),
  -- The publisher's filter on a live layer's features (an ArcGIS where clause), sent only to the
  -- layer's own service, with the layer's limit. No statement separators or comments.
  add column definition_expression text check (
    length(definition_expression) between 1 and 2000
    -- Control characters, C0 and C1 alike, as the API's \p{Cc} (Codex's review of 1f328f9).
    and definition_expression !~ '[\x01-\x1f\x7f-\x9f;]'
    and position('--' in definition_expression) = 0
    and position('/*' in definition_expression) = 0
    and app.balanced_filter(definition_expression)
  ),
  -- Whether values without a colour of their own are drawn (ArcGIS draws none when its symbols
  -- have no default).
  add column others_shown boolean not null default true,
  -- The ArcGIS map it came from: its item id and title.
  add column map_item_id text check (map_item_id ~ '^[0-9a-f]{32}$'),
  add column map_title text check (
    length(map_title) between 1 and 200 and map_title !~ '[\x01-\x1f\x7f-\x9f]'
  ),
  add constraint map_layers_zoom_range check (
    min_zoom is null or max_zoom is null or min_zoom < max_zoom
  ),
  add constraint map_layers_definition_live_only check (
    definition_expression is null or kind = 'arcgis_features'
  ),
  add constraint map_layers_map_whole check ((map_item_id is null) = (map_title is null));

-- app_api already inserts every column (20261107040000_map_layers.sql) and is granted no update
-- of these.
