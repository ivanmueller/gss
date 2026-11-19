-- Oil and gas map layers (F-247 part 2; docs/FEATURES_OIL_GAS.md, the owner's answers of
-- 2026-11-18): the layers admins add from the Settings button on the oil and gas map.
--
-- One list per organization, kept by its admins: live ArcGIS layers only for now (lines, areas
-- and points; pictures drawn on request; pictures drawn ahead of time). Files, WMS services
-- and whole ArcGIS maps come later. Every member sees the list; an admin chooses for each
-- layer whether it is on when the map opens (shown_by_default), for everyone.
--
-- The shape is grain's app.map_layers as it stands after its migrations (F-107, F-137, F-138,
-- F-141), so the Worker's layer code serves both; the two databases share no SQL, so the
-- checks are written out again here.
--
-- Access (20261118230000): this database has no users. The Worker sets the person, their
-- organization and their role for one transaction; row level security reads them. Nothing is
-- deleted: a removed layer is marked, and every addition, change and removal is kept in
-- petro.map_layer_history.

create function petro.every_match(items text[], pattern text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(item ~ pattern), true) from unnest(items) as item
$$;

-- Whether a filter's brackets and quotes are closed (as app.balanced_filter).
create function petro.balanced_filter(filter text)
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

create table petro.map_layers (
  id uuid primary key default gen_random_uuid(),
  -- The organization in grain's database (no foreign key: it lives there).
  organization_id uuid not null,
  name text not null check (
    name = btrim(name) and length(name) between 1 and 200 and name !~ '[[:cntrl:]]'
  ),
  kind text not null check (kind in ('arcgis_features', 'arcgis_image', 'arcgis_tiles')),
  -- The service's address, https only, without its query.
  source_url text not null check (
    source_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,63}(/[^[:space:][:cntrl:]?#]*)?$'
    and length(source_url) <= 2000
  ),
  -- A layer's id field (OBJECTID), read from the service when the layer is added.
  id_field text check (id_field ~ '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$'),
  -- Its source and terms of use, recorded before it is shown.
  source_name text not null check (
    source_name = btrim(source_name) and length(source_name) between 1 and 200
    and source_name !~ '[[:cntrl:]]'
  ),
  -- Letters of either case, as the API takes them (F-247-2-R1-02).
  terms_url text not null check (
    terms_url ~* '^https?://[a-z0-9.-]+\.[a-z]{2,63}(/[^[:space:][:cntrl:]]*)?$'
    and length(terms_url) <= 2000
  ),
  terms_note text not null check (
    terms_note = btrim(terms_note) and length(terms_note) between 1 and 2000
  ),
  colour text not null check (colour ~ '^#[0-9a-f]{6}$'),
  colour_field text check (colour_field ~ '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$'),
  -- [[value, "#rrggbb"], ...], most common value first; empty without colour_field.
  colours jsonb not null default '[]'::jsonb check (
    jsonb_typeof(colours) = 'array' and jsonb_array_length(colours) <= 2000
  ),
  also_fields text[] not null default '{}' check (
    cardinality(also_fields) <= 16
    and array_position(also_fields, null) is null
    and petro.every_match(also_fields, '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$')
  ),
  only_field text check (only_field ~ '^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,63}$'),
  only_values text[] not null default '{}' check (
    cardinality(only_values) <= 20
    and array_position(only_values, null) is null
    and petro.every_match(only_values, '^[A-Za-z0-9 _.-]{1,50}$')
  ),
  line_width double precision check (line_width > 0 and line_width <= 50),
  opacity double precision not null default 1 check (opacity > 0 and opacity <= 1),
  min_zoom double precision check (min_zoom >= 0 and min_zoom <= 24),
  max_zoom double precision check (max_zoom >= 0 and max_zoom <= 24),
  -- The publisher's filter (an ArcGIS where clause), sent only to the layer's own service.
  definition_expression text check (
    length(definition_expression) between 1 and 2000
    and definition_expression !~ '[\x01-\x1f\x7f-\x9f;]'
    and position('--' in definition_expression) = 0
    and position('/*' in definition_expression) = 0
    and petro.balanced_filter(definition_expression)
  ),
  others_shown boolean not null default true,
  tile_min_level integer check (tile_min_level between 0 and 23),
  tile_max_level integer check (tile_max_level between 0 and 23),
  -- Whether the layer is on when the map opens, for everyone; an admin's choice.
  shown_by_default boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid,
  check (id_field is null or kind = 'arcgis_features'),
  check (colour_field is not null or colours = '[]'::jsonb),
  check ((only_field is null) = (cardinality(only_values) = 0)),
  check (cardinality(also_fields) = 0 or colour_field is not null),
  check (
    (colour_field is null and cardinality(also_fields) = 0 and only_field is null
      and definition_expression is null)
    or kind = 'arcgis_features'
  ),
  check (min_zoom is null or max_zoom is null or min_zoom < max_zoom),
  check (
    (kind = 'arcgis_tiles') = (tile_min_level is not null and tile_max_level is not null)
    and (tile_min_level is null or tile_min_level <= tile_max_level)
    and (tile_min_level is null) = (tile_max_level is null)
  ),
  check ((removed_at is null) = (removed_by is null)),
  -- The version the API compares is a real time, always (F-247-2-R3-03).
  check (isfinite(created_at) and isfinite(updated_at))
);

create index map_layers_organization_idx on petro.map_layers (organization_id, created_at)
  where removed_at is null;

-- Every addition, change and removal, as the row stood after it. Written only by the trigger
-- below; nobody reads or changes it through the API.
create table petro.map_layer_history (
  id bigint generated always as identity primary key,
  layer_id uuid not null references petro.map_layers (id),
  organization_id uuid not null,
  action text not null check (action in ('added', 'changed', 'removed')),
  snapshot jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  request_id text check (length(request_id) <= 200)
);

create index map_layer_history_layer_idx on petro.map_layer_history (layer_id, id);

-- At most this many layers not removed per organization, so the list stays small.
create function petro.guard_map_layer_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- One addition at a time per organization, so two at once cannot both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('petro.map_layers:' || new.organization_id::text, 0));
  if (select count(*) from petro.map_layers l
      where l.organization_id = new.organization_id and l.removed_at is null) >= 200 then
    raise exception 'This organization has the most map layers it can keep'
      using errcode = 'PT001';
  end if;
  return new;
end
$$;

-- What never changes once a layer is added, and a removed layer stays removed. Each change
-- gets its own time, which is the version the API compares.
create function petro.keep_map_layer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.removed_at is not null then
    raise exception 'This map layer was removed' using errcode = '23514';
  end if;
  if new.id <> old.id or new.organization_id <> old.organization_id or new.kind <> old.kind
     or new.source_url <> old.source_url
     or new.id_field is distinct from old.id_field
     or new.line_width is distinct from old.line_width or new.opacity <> old.opacity
     or new.min_zoom is distinct from old.min_zoom or new.max_zoom is distinct from old.max_zoom
     or new.definition_expression is distinct from old.definition_expression
     or new.others_shown <> old.others_shown
     or new.tile_min_level is distinct from old.tile_min_level
     or new.tile_max_level is distinct from old.tile_max_level
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'A map layer keeps its source' using errcode = '23514';
  end if;
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end
$$;

create function petro.record_map_layer_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into petro.map_layer_history (layer_id, organization_id, action, snapshot, changed_by,
    request_id)
  values (
    new.id, new.organization_id,
    case
      when tg_op = 'INSERT' then 'added'
      when new.removed_at is not null then 'removed'
      else 'changed'
    end,
    to_jsonb(new), petro.current_user_id(),
    left(nullif(current_setting('petro.request_id', true), ''), 200)
  );
  return null;
end
$$;

create trigger map_layers_guard_count
  before insert on petro.map_layers
  for each row execute function petro.guard_map_layer_count();
create trigger map_layers_keep
  before update on petro.map_layers
  for each row execute function petro.keep_map_layer();
create trigger map_layers_history
  after insert or update on petro.map_layers
  for each row execute function petro.record_map_layer_history();

alter table petro.map_layers enable row level security;
alter table petro.map_layer_history enable row level security;

-- Every member of the organization the Worker named reads its layers; only its admins add,
-- change and remove them, and only in their own name. Without a context every policy is false.
create policy map_layers_select_for_members on petro.map_layers
  for select to petro_api
  using (
    organization_id = petro.current_organization_id()
    and petro.current_user_id() is not null
    and petro.current_member_role() is not null
  );
create policy map_layers_insert_for_admins on petro.map_layers
  for insert to petro_api
  with check (
    organization_id = petro.current_organization_id()
    and petro.current_member_role() = 'org_admin'
    and created_by = petro.current_user_id() and updated_by = petro.current_user_id()
    and removed_at is null
  );
create policy map_layers_update_for_admins on petro.map_layers
  for update to petro_api
  using (
    organization_id = petro.current_organization_id()
    and petro.current_user_id() is not null
    and petro.current_member_role() = 'org_admin'
  )
  with check (
    organization_id = petro.current_organization_id()
    and petro.current_member_role() = 'org_admin'
    and updated_by = petro.current_user_id()
    and (removed_by is null or removed_by = petro.current_user_id())
  );

-- Privileges: nothing for public or the Supabase API roles. petro_api reads, adds, and changes
-- only a layer's name, source, terms, colours and default, or marks it removed. Nothing is
-- deleted, and the history is out of its reach.
revoke all on petro.map_layers, petro.map_layer_history
  from public, anon, authenticated, service_role, petro_api;
grant select on petro.map_layers to petro_api;
-- Only what the Worker writes: a layer's id, its times (its version among them) and its removal
-- are the database's to set, never the caller's (F-247-2-R3-03).
grant insert (organization_id, name, kind, source_url, id_field, source_name, terms_url,
  terms_note, colour, colour_field, colours, also_fields, only_field, only_values, line_width,
  opacity, min_zoom, max_zoom, definition_expression, others_shown, shown_by_default,
  tile_min_level, tile_max_level, created_by, updated_by)
  on petro.map_layers to petro_api;
grant update (name, source_name, terms_url, terms_note, colour, colour_field, colours,
  also_fields, only_field, only_values, shown_by_default, updated_by, removed_at, removed_by)
  on petro.map_layers to petro_api;

revoke all on function petro.every_match(text[], text), petro.balanced_filter(text),
  petro.guard_map_layer_count(), petro.keep_map_layer(), petro.record_map_layer_history()
  from public, anon, authenticated, service_role, petro_api;
grant execute on function petro.every_match(text[], text), petro.balanced_filter(text)
  to petro_api;

-- The Worker's layer routes need this version (PETROLEUM_SCHEMA_VERSION).
create or replace function petro.schema_version()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 2
$$;
