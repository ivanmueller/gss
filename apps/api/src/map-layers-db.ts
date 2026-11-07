import type { MapLayerKind, MapLayerView } from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

// Map layers in Postgres (20261107040000_map_layers.sql, F-107). Everything runs as the
// verified user, so row level security decides: every active member reads their organization's
// layers; only its admins add, change and remove them.

/** What adding, changing or removing a layer did. */
export type MapLayerWrite =
  | { status: 'saved'; id: string }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'stale' };

export interface NewMapLayer {
  name: string;
  kind: MapLayerKind;
  url: string | null;
  wmsLayers: string | null;
  /** An ArcGIS layer's id field, to ask for a clicked feature's details. */
  idField: string | null;
  sourceName: string;
  termsUrl: string;
  termsNote: string;
  colour: string;
  colourField: string | null;
  colours: [string, string][];
  /** A file layer's file: its name, its checked GeoJSON as UTF-8 and how many features. */
  file: { name: string; geojson: Uint8Array; featureCount: number } | null;
}

export type MapLayerChanges = Omit<NewMapLayer, 'kind' | 'url' | 'file' | 'idField'>;

/** What the Worker needs to fetch a live layer for the map. */
export interface MapLayerSource {
  id: string;
  kind: MapLayerKind;
  url: string | null;
  wmsLayers: string | null;
  idField: string | null;
  colourField: string | null;
}

export interface MapLayersDatabase {
  /** The organization's layers that are not removed, oldest first; null for a non-member. */
  listMapLayers: (ctx: RequestContext, organizationId: string) => Promise<MapLayerView[] | null>;
  /** A layer that is not removed, as the Worker fetches it; null when not visible. */
  getMapLayerSource: (ctx: RequestContext, id: string) => Promise<MapLayerSource | null>;
  /** A file layer's GeoJSON and its checksum; null when not visible. */
  getMapLayerFile: (
    ctx: RequestContext,
    id: string,
  ) => Promise<{ geojson: Uint8Array; sha256: string } | null>;
  createMapLayer: (
    ctx: RequestContext,
    organizationId: string,
    layer: NewMapLayer,
  ) => Promise<MapLayerWrite>;
  updateMapLayer: (
    ctx: RequestContext,
    id: string,
    version: string,
    changes: MapLayerChanges,
  ) => Promise<MapLayerWrite>;
  removeMapLayer: (ctx: RequestContext, id: string, version: string) => Promise<MapLayerWrite>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

interface LayerRow {
  id: string;
  name: string;
  kind: MapLayerKind;
  source_url: string | null;
  wms_layers: string | null;
  source_name: string;
  terms_url: string;
  terms_note: string;
  colour: string;
  colour_field: string | null;
  colours: [string, string][];
  file_name: string | null;
  feature_count: number | null;
  created_by_name: string | null;
  created_at: Date;
  version: string;
}

/** Whether the person may change a layer and it is the version they saw (checked again by the update itself). */
async function writable(
  tx: postgres.TransactionSql,
  id: string,
  version: string,
): Promise<Exclude<MapLayerWrite, { status: 'saved' }> | null> {
  const [row] = await tx<{ admin: boolean; version: string; archived: boolean }[]>`
    select app.is_org_admin(organization_id) as admin, updated_at::text as version,
           archived_at is not null as archived
    from app.map_layers where id = ${id}`;
  if (!row || row.archived) return { status: 'not_found' };
  if (!row.admin) return { status: 'forbidden' };
  if (row.version !== version) return { status: 'stale' };
  return null;
}

export function mapLayerQueries(asUser: AsUser): MapLayersDatabase {
  return {
    listMapLayers(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [member] = await tx<{ ok: boolean }[]>`
          select app.is_active_member(${organizationId}) as ok`;
        if (member?.ok !== true) return null;
        const rows = await tx<LayerRow[]>`
          select l.id, l.name, l.kind, l.source_url, l.wms_layers, l.source_name, l.terms_url,
                 l.terms_note, l.colour, l.colour_field, l.colours, f.file_name, f.feature_count,
                 app.member_name(l.organization_id, l.created_by) as created_by_name,
                 l.created_at, l.updated_at::text as version
          from app.map_layers l
          left join app.map_layer_files f on f.layer_id = l.id
          where l.organization_id = ${organizationId} and l.archived_at is null
          order by l.created_at, l.id`;
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          url: row.source_url,
          wmsLayers: row.wms_layers,
          sourceName: row.source_name,
          termsUrl: row.terms_url,
          termsNote: row.terms_note,
          colour: row.colour,
          colourField: row.colour_field,
          colours: row.colours,
          fileName: row.file_name,
          featureCount: row.feature_count,
          createdByName: row.created_by_name ?? 'A former member',
          createdAt: row.created_at.toISOString(),
          version: row.version,
        }));
      });
    },

    getMapLayerSource(ctx, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<MapLayerSource[]>`
          select id, kind, source_url as url, wms_layers as "wmsLayers", id_field as "idField",
                 colour_field as "colourField"
          from app.map_layers where id = ${id} and archived_at is null`;
        return row ?? null;
      });
    },

    getMapLayerFile(ctx, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ geojson: Uint8Array; sha256: string }[]>`
          select f.geojson, f.sha256
          from app.map_layer_files f
          join app.map_layers l on l.id = f.layer_id
          where f.layer_id = ${id} and l.archived_at is null`;
        return row ?? null;
      });
    },

    createMapLayer(ctx, organizationId, layer) {
      return asUser(ctx, async (tx): Promise<MapLayerWrite> => {
        const [admin] = await tx<{ ok: boolean }[]>`
          select app.is_org_admin(${organizationId}) as ok`;
        if (admin?.ok !== true) return { status: 'forbidden' };
        const [saved] = await tx<{ id: string }[]>`
          insert into app.map_layers (organization_id, name, kind, source_url, wms_layers,
            id_field, source_name, terms_url, terms_note, colour, colour_field, colours, created_by,
            updated_by)
          values (${organizationId}, ${layer.name}, ${layer.kind}, ${layer.url},
            ${layer.wmsLayers}, ${layer.idField}, ${layer.sourceName}, ${layer.termsUrl}, ${layer.termsNote},
            ${layer.colour}, ${layer.colourField}, ${tx.json(layer.colours)},
            app.current_user_id(), app.current_user_id())
          returning id`;
        if (!saved) throw new Error('map layer was not saved');
        if (layer.file) {
          await tx`
            insert into app.map_layer_files (layer_id, organization_id, file_name, geojson,
              feature_count)
            values (${saved.id}, ${organizationId}, ${layer.file.name}, ${layer.file.geojson},
              ${layer.file.featureCount})`;
        }
        return { status: 'saved', id: saved.id };
      });
    },

    updateMapLayer(ctx, id, version, changes) {
      return asUser(ctx, async (tx): Promise<MapLayerWrite> => {
        const refused = await writable(tx, id, version);
        if (refused) return refused;
        const updated = await tx`
          update app.map_layers set
            name = ${changes.name}, wms_layers = ${changes.wmsLayers},
            source_name = ${changes.sourceName}, terms_url = ${changes.termsUrl},
            terms_note = ${changes.termsNote}, colour = ${changes.colour},
            colour_field = ${changes.colourField}, colours = ${tx.json(changes.colours)},
            updated_by = app.current_user_id()
          where id = ${id} and updated_at::text = ${version} and archived_at is null`;
        return updated.count === 1 ? { status: 'saved', id } : { status: 'stale' };
      });
    },

    removeMapLayer(ctx, id, version) {
      return asUser(ctx, async (tx): Promise<MapLayerWrite> => {
        const refused = await writable(tx, id, version);
        if (refused) return refused;
        const updated = await tx`
          update app.map_layers set
            archived_at = now(), archived_by = app.current_user_id(),
            updated_by = app.current_user_id()
          where id = ${id} and updated_at::text = ${version} and archived_at is null`;
        return updated.count === 1 ? { status: 'saved', id } : { status: 'stale' };
      });
    },
  };
}
