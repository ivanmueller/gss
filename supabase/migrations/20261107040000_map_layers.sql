-- Map layers from ArcGIS, the Government of Canada and files (the owner's request of
-- 2026-10-29, widened and answered 2026-11-07; docs/DECISIONS.md, F-107, GT-026).
--
-- One list of layers per organization, kept by its admins: a live web service (an ArcGIS
-- FeatureServer or MapServer layer, an ArcGIS MapServer or ImageServer drawn as pictures, or a
-- WMS service) or a file (GeoJSON, from GeoJSON, KML or a zipped shapefile turned into GeoJSON
-- in the browser and checked again by the Worker). Every member sees the list and switches
-- layers on and off for themselves (in their browser, not here).
--
-- A layer is shown only with its source and terms of use recorded: who publishes it, a link
-- to its terms and what they allow, all required. Lines, areas and points are drawn in one
-- colour, or in a colour per value of one of its fields (each railroad its own colour), the
-- colours chosen when the layer is added and kept with it, most common value first.
--
-- A removed layer is kept (archived), never deleted, like the rest of the app's records.
-- The Worker fetches web services itself, so no address of theirs reaches the browser and the
-- app's content security policy stays as it is.

create table app.map_layers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations (id),
  name app.label not null,
  kind text not null check (kind in ('arcgis_features', 'arcgis_image', 'wms', 'file')),
  -- A web service's address, https only, without its query; null for a file.
  source_url text check (
    source_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,63}(/[^[:space:][:cntrl:]?#]*)?$'
    and length(source_url) <= 2000
  ),
  -- The WMS layer names asked for (its LAYERS parameter); only for WMS.
  wms_layers text check (
    wms_layers ~ '^[A-Za-z0-9_.:,/ -]+$' and length(wms_layers) <= 500
  ),
  -- An ArcGIS layer's id field (OBJECTID), read from the service when the layer is added, so a
  -- clicked feature's details can be asked for; null when the service names none.
  id_field text check (id_field ~ '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$'),
  -- Its source and terms of use, recorded before it is shown (specification section 15, item 7).
  source_name app.label not null,
  terms_url text not null check (
    terms_url ~ '^https?://[a-z0-9.-]+\.[a-z]{2,63}(/[^[:space:][:cntrl:]]*)?$'
    and length(terms_url) <= 2000
  ),
  terms_note app.note not null,
  -- The colour of everything without a colour of its own (#rrggbb).
  colour text not null check (colour ~ '^#[0-9a-f]{6}$'),
  -- Colour by this field's values; null: one colour.
  colour_field text check (
    colour_field ~ '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$'
  ),
  -- [[value, "#rrggbb"], ...], most common value first; empty without colour_field.
  colours jsonb not null default '[]'::jsonb check (
    jsonb_typeof(colours) = 'array' and jsonb_array_length(colours) <= 2000
  ),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users (id),
  unique (organization_id, id),
  check ((kind = 'file') = (source_url is null)),
  check ((kind = 'wms') = (wms_layers is not null)),
  check (id_field is null or kind = 'arcgis_features'),
  check (colour_field is not null or colours = '[]'::jsonb),
  check ((archived_at is null) = (archived_by is null))
);

create index map_layers_organization_idx on app.map_layers (organization_id, created_at)
  where archived_at is null;

-- A file layer's features, as the Worker checked them: a GeoJSON FeatureCollection in
-- longitude and latitude, at most 5 MB (Postgres compresses it). Never changed: a new
-- file is a new layer.
create table app.map_layer_files (
  -- Named in the audit trail.
  id uuid not null default gen_random_uuid() unique,
  layer_id uuid primary key,
  organization_id uuid not null,
  file_name app.label not null,
  -- UTF-8 JSON text, starting with "{".
  geojson bytea not null check (
    octet_length(geojson) between 2 and 5242880 and substring(geojson from 1 for 1) = '\x7b'::bytea
  ),
  feature_count integer not null check (feature_count between 1 and 50000),
  sha256 text generated always as (encode(sha256(geojson), 'hex')) stored,
  created_at timestamptz not null default now(),
  foreign key (organization_id, layer_id) references app.map_layers (organization_id, id)
);

-- A file layer has its file from the start: the layer and the file are written in one
-- transaction, and this is checked when it commits.
create function app.check_map_layer_file()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'file' and not exists (
    select 1 from app.map_layer_files f where f.layer_id = new.id
  ) then
    raise exception 'A file layer needs its file' using errcode = '23514';
  end if;
  if new.kind <> 'file' and exists (
    select 1 from app.map_layer_files f where f.layer_id = new.id
  ) then
    raise exception 'Only a file layer has a file' using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger map_layers_file_check
  after insert on app.map_layers
  deferrable initially deferred
  for each row execute function app.check_map_layer_file();

-- What never changes once a layer is added: its organization, kind, address, file and who
-- added it; and a removed layer stays removed.
create function app.keep_map_layer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id or new.kind <> old.kind
     or new.source_url is distinct from old.source_url
     or new.id_field is distinct from old.id_field
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'A map layer keeps its source' using errcode = '23514';
  end if;
  if old.archived_at is not null then
    raise exception 'This map layer was removed' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger map_layers_keep
  before update on app.map_layers
  for each row execute function app.keep_map_layer();
create trigger map_layers_touch_updated_at
  before update on app.map_layers
  for each row execute function app.touch_updated_at();
create trigger map_layers_audit
  after insert or update or delete on app.map_layers
  for each row execute function app.record_audit_event();
create trigger map_layer_files_audit
  after insert or update or delete on app.map_layer_files
  for each row execute function app.record_audit_event();

alter table app.map_layers enable row level security;
alter table app.map_layer_files enable row level security;

create policy map_layers_select_for_members on app.map_layers
  for select to app_api using (app.is_active_member(organization_id));
create policy map_layers_insert_for_admins on app.map_layers
  for insert to app_api
  with check (
    app.is_org_admin(organization_id)
    and created_by = app.current_user_id() and updated_by = app.current_user_id()
    and archived_at is null
  );
create policy map_layers_update_for_admins on app.map_layers
  for update to app_api
  using (app.is_org_admin(organization_id))
  with check (
    app.is_org_admin(organization_id) and updated_by = app.current_user_id()
    and (archived_by is null or archived_by = app.current_user_id())
  );

create policy map_layer_files_select_for_members on app.map_layer_files
  for select to app_api using (app.is_active_member(organization_id));
create policy map_layer_files_insert_for_admins on app.map_layer_files
  for insert to app_api
  with check (
    app.is_org_admin(organization_id)
    and exists (
      select 1 from app.map_layers l
      where l.id = layer_id and l.kind = 'file' and l.archived_at is null
    )
  );

-- Privileges: nothing for public or the Supabase API roles; app_api reads, adds, and changes
-- only a layer's name, source, terms and colours, or removes it. Nothing is deleted.
revoke all on app.map_layers, app.map_layer_files from public, anon, authenticated, service_role;
revoke all on function app.check_map_layer_file(), app.keep_map_layer()
  from public, anon, authenticated, service_role, app_api;
grant select, insert on app.map_layers, app.map_layer_files to app_api;
grant update (name, wms_layers, source_name, terms_url, terms_note, colour, colour_field, colours,
  updated_by, archived_at, archived_by) on app.map_layers to app_api;
