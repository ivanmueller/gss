-- A zoomed-out view of a live ArcGIS map layer (the owner's request of 2026-11-07, F-134).
--
-- Zoomed out, a live layer is fetched one map square at a time, and a square holds at most what
-- the service sends at once (4,000 rail pieces for North American Rail Network Lines, where a
-- dense square has tens of thousands), so the map showed scattered pieces. An admin's browser
-- now reads the whole layer once through the Worker, joins each value's pieces into lines and
-- simplifies them, and sends the result in parts of about 100 KB, each checked by the Worker
-- (Cloudflare's free plan allows a request about 10 ms of computing; checking the whole view at
-- once takes about 115 ms). Once every part has arrived, the view is published: the layer's
-- colour field is checked again under a lock, so a view grouped by an older field never replaces
-- the current one (Codex's review of 8e0fd95), and the parts of earlier views are dropped.
--
-- Zoomed out, the map draws the published view instead of squares. Read by every member,
-- prepared by admins only, for a live lines layer of their own organization that is not removed.
-- A view is derived from the service, not anyone's record: its parts are replaced, not kept.

-- One part of a view being prepared or published: a JSON array of checked GeoJSON features.
create table app.map_layer_overview_parts (
  layer_id uuid not null,
  organization_id uuid not null,
  -- The preparation it belongs to, chosen by the browser.
  version uuid not null,
  part_no integer not null check (part_no between 0 and 63),
  -- UTF-8 JSON text of an array, starting with "[".
  features bytea not null check (
    octet_length(features) between 2 and 262144 and substring(features from 1 for 1) = '\x5b'::bytea
  ),
  feature_count integer not null check (feature_count between 1 and 50000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (layer_id, version, part_no),
  foreign key (organization_id, layer_id) references app.map_layers (organization_id, id)
);

-- The published view of a layer: which preparation, grouped by which field, and its size.
create table app.map_layer_overviews (
  -- Named in the audit trail.
  id uuid not null default gen_random_uuid() unique,
  layer_id uuid primary key,
  organization_id uuid not null,
  version uuid not null,
  -- The field its lines are grouped by; null: all in one.
  colour_field text check (colour_field ~ '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$'),
  part_count integer not null check (part_count between 1 and 64),
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

alter table app.map_layer_overview_parts enable row level security;
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

create policy map_layer_overview_parts_select_for_members on app.map_layer_overview_parts
  for select to app_api using (app.is_active_member(organization_id));
create policy map_layer_overview_parts_insert_for_admins on app.map_layer_overview_parts
  for insert to app_api
  with check (
    app.can_prepare_map_overview(layer_id, organization_id)
    and created_by = app.current_user_id()
  );
-- Parts of earlier or abandoned preparations are dropped when a view is published.
create policy map_layer_overview_parts_delete_for_admins on app.map_layer_overview_parts
  for delete to app_api using (app.can_prepare_map_overview(layer_id, organization_id));

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

-- Privileges: nothing for public or the Supabase API roles. app_api adds and drops parts, and
-- publishes a view (never moving it to another layer or organization); a view is not deleted.
revoke all on app.map_layer_overview_parts, app.map_layer_overviews
  from public, anon, authenticated, service_role;
revoke all on function app.can_prepare_map_overview(uuid, uuid)
  from public, anon, authenticated, service_role;
grant select, insert, delete on app.map_layer_overview_parts to app_api;
grant select, insert on app.map_layer_overviews to app_api;
grant update (version, colour_field, part_count, feature_count, source_count, prepared_by,
  prepared_at) on app.map_layer_overviews to app_api;
grant execute on function app.can_prepare_map_overview(uuid, uuid) to app_api;
