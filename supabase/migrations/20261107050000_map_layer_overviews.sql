-- A zoomed-out view of a live ArcGIS map layer (the owner's request of 2026-11-07, F-134).
--
-- Zoomed out, a live layer is fetched one map square at a time, and a square holds at most what
-- the service sends at once (4,000 rail pieces for North American Rail Network Lines, where a
-- dense square has tens of thousands), so the map showed scattered pieces. An admin's browser
-- now reads the whole layer once through the Worker, joins each value's pieces into lines,
-- simplifies them and stores the result here; zoomed out, the map draws it instead of squares.
--
-- One view per layer, replaced when it is prepared again (it is derived from the service, not a
-- record of anyone's work): GeoJSON checked by the Worker, at most 5 MB and 50,000 features, the
-- field its lines are grouped by (the layer's colour field when prepared), how many pieces the
-- service gave, who prepared it and when. Read by every member, prepared by admins only, for a
-- live lines layer of their own organization that is not removed. Audited.

create table app.map_layer_overviews (
  -- Named in the audit trail.
  id uuid not null default gen_random_uuid() unique,
  layer_id uuid primary key,
  organization_id uuid not null,
  -- UTF-8 JSON text, starting with "{".
  geojson bytea not null check (
    octet_length(geojson) between 2 and 5242880 and substring(geojson from 1 for 1) = '\x7b'::bytea
  ),
  sha256 text generated always as (encode(sha256(geojson), 'hex')) stored,
  -- The field the lines are grouped by; null: all in one.
  colour_field text check (colour_field ~ '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$'),
  feature_count integer not null check (feature_count between 1 and 50000),
  -- How many pieces the service gave.
  source_count integer not null check (source_count between 1 and 2000000),
  prepared_by uuid not null references auth.users (id),
  prepared_at timestamptz not null default now(),
  foreign key (organization_id, layer_id) references app.map_layers (organization_id, id)
);

create trigger map_layer_overviews_audit
  after insert or update or delete on app.map_layer_overviews
  for each row execute function app.record_audit_event();

alter table app.map_layer_overviews enable row level security;

-- Whether the current user may prepare this layer's view: an admin of its organization, for a
-- live lines layer that is not removed.
create function app.can_prepare_map_overview(layer uuid, org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_admin(org) and exists (
    select 1 from app.map_layers l
    where l.id = layer and l.organization_id = org and l.kind = 'arcgis_features'
      and l.archived_at is null
  )
$$;

create policy map_layer_overviews_select_for_members on app.map_layer_overviews
  for select to app_api using (app.is_active_member(organization_id));
create policy map_layer_overviews_insert_for_admins on app.map_layer_overviews
  for insert to app_api
  with check (
    app.can_prepare_map_overview(layer_id, organization_id)
    and prepared_by = app.current_user_id()
  );
create policy map_layer_overviews_update_for_admins on app.map_layer_overviews
  for update to app_api
  using (app.can_prepare_map_overview(layer_id, organization_id))
  with check (
    app.can_prepare_map_overview(layer_id, organization_id)
    and prepared_by = app.current_user_id()
  );

-- Privileges: nothing for public or the Supabase API roles; app_api reads, adds, and replaces a
-- view's content (never its layer or organization). Nothing is deleted.
revoke all on app.map_layer_overviews from public, anon, authenticated, service_role;
revoke all on function app.can_prepare_map_overview(uuid, uuid)
  from public, anon, authenticated, service_role;
grant select, insert on app.map_layer_overviews to app_api;
grant update (geojson, colour_field, feature_count, source_count, prepared_by, prepared_at)
  on app.map_layer_overviews to app_api;
grant execute on function app.can_prepare_map_overview(uuid, uuid) to app_api;
