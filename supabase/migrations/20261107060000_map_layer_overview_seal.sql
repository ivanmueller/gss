-- A published zoomed-out view is sealed (Codex's review of d35ac90, after
-- 20261107050000_map_layer_overviews.sql reached main; F-134).
--
-- Parts could still be added to, replaced in or dropped from a preparation after it was
-- published, so the published view changed while its version (and the browser's cached copy)
-- stayed the same. Now every change to a part first takes a share lock on its layer, which waits
-- for a publication in progress (it holds the layer FOR UPDATE until it commits), and then refuses
-- (SQLSTATE GS007) any change to a part of the layer's published preparation. Publishing a new
-- preparation still drops the parts of the old one: by then the old one is no longer published.

create function app.guard_map_overview_part()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  part app.map_layer_overview_parts := coalesce(new, old);
begin
  -- Waits for a publication of this layer in progress, then sees it.
  perform 1 from app.map_layers where id = part.layer_id for share;
  if exists (
    select 1 from app.map_layer_overviews o
    where o.layer_id = part.layer_id and o.version = part.version
  ) then
    raise exception 'This zoomed-out view is published; prepare it again to change it'
      using errcode = 'GS007';
  end if;
  return coalesce(new, old);
end
$$;

create trigger map_layer_overview_parts_sealed
  before insert or delete on app.map_layer_overview_parts
  for each row execute function app.guard_map_overview_part();

revoke all on function app.guard_map_overview_part()
  from public, anon, authenticated, service_role, app_api;
