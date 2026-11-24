import type { MapLayerKind, MapLayerView } from '@grain/domain';
import postgres from 'postgres';

import { aerListsQueries, type AerListsDatabase } from './aer-lists-db';
import { connectionOptions } from './db';
import { formationQueries, type FormationDatabase } from './formation-db';
import { landQueries, type LandDatabase } from './land-db';
import { landSalesQueries, type LandSalesDatabase } from './land-sales-db';
import { facilityQueries, type FacilitiesDatabase } from './petro-facilities-db';
import { operatorQueries, type OperatorsDatabase } from './petro-operators-db';
import { fracQueries, type FracDatabase } from './petro-frac-db';
import { geologyQueries, type GeologyDatabase } from './petro-geology-db';
import { priceQueries, type PricesDatabase } from './petro-prices-db';
import { pipelineQueries, type PipelinesDatabase } from './petro-pipelines-db';
import { productionQueries, type ProductionDatabase } from './production-db';
import { st37Queries, type St37Database } from './st37-db';
import { wellsQueries, type WellsDatabase } from './wells-db';
import type { MapLayerChanges, MapLayerSource, MapLayerWrite, NewMapLayer } from './map-layers-db';

/**
 * The oil and gas database (petroleum-staging, F-247; docs/DECISIONS.md 2026-11-18). It has no
 * users: the Worker checks the person's membership in grain's database first, then queries this
 * one as `petro_api`, telling it who is asking for one transaction only.
 */

/** Who is asking, from the verified session and the membership just loaded from grain's database. */
export interface PetroleumContext {
  userId: string;
  organizationId: string;
  role: string;
  requestId: string;
}

/**
 * The oil and gas database's schema version this code needs (petro.schema_version()). Raised with
 * each migration the Worker's code depends on; until the database has it, the oil and gas routes
 * answer "not ready" (F-247-1-R3-01), so a deploy whose migration failed never runs new code
 * against an old schema.
 */
export const PETROLEUM_SCHEMA_VERSION = 3;

/** The AER's daily lists (F-243 part 1) are in `AerListsDatabase` (aer-lists-db.ts). */
export interface PetroleumDatabase
  extends
    AerListsDatabase,
    WellsDatabase,
    St37Database,
    ProductionDatabase,
    LandDatabase,
    FormationDatabase,
    LandSalesDatabase,
    FacilitiesDatabase,
    OperatorsDatabase,
    PipelinesDatabase,
    PricesDatabase,
    FracDatabase,
    GeologyDatabase {
  /** The database's schema version (petro.schema_version()). Reads no data. */
  schemaVersion(): Promise<number>;
  /** The organization the database sees for this person: the health check. */
  organizationSeen(ctx: PetroleumContext): Promise<string | null>;
  /**
   * The oil and gas map layers (20261119010000_petro_map_layers.sql, F-247 part 2), each call
   * one transaction as the person in `ctx`. Row level security decides: every member of the
   * organization reads its layers; only its admins add, change and remove them.
   *
   * The organization's layers that are not removed, oldest first.
   */
  listLayers(ctx: PetroleumContext): Promise<MapLayerView[]>;
  /** A layer that is not removed, as the Worker fetches it; null when not visible. */
  layerSource(ctx: PetroleumContext, id: string): Promise<MapLayerSource | null>;
  /** Throws TooManyLayersError at the organization's ceiling. */
  createLayer(ctx: PetroleumContext, layer: NewMapLayer): Promise<MapLayerWrite>;
  updateLayer(
    ctx: PetroleumContext,
    id: string,
    version: string,
    changes: MapLayerChanges,
  ): Promise<MapLayerWrite>;
  removeLayer(ctx: PetroleumContext, id: string, version: string): Promise<MapLayerWrite>;
  close(): Promise<void>;
  /** Drops the connection at once, whatever it is doing (a request past its deadline). */
  abort(): Promise<void>;
}

export type PetroleumFactory = (
  url: string,
  options?: { viaHyperdrive?: boolean },
) => PetroleumDatabase;

/**
 * The longest any oil and gas query may run, so a stalled database answers "unavailable" within
 * a request instead of holding it (F-247-1-R5-02). Set for each transaction only.
 */
const STATEMENT_TIMEOUT = '10s';

/**
 * Runs `fn` in a transaction that first sets the person, organization, role and request for that
 * transaction only (set_config(..., true)), so a pooled connection never carries them on.
 */
async function asMember<T>(
  sql: postgres.Sql,
  ctx: PetroleumContext,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
    await tx`select set_config('petro.user_id', ${ctx.userId}, true),
                    set_config('petro.organization_id', ${ctx.organizationId}, true),
                    set_config('petro.member_role', ${ctx.role}, true),
                    set_config('petro.request_id', ${ctx.requestId}, true)`;
    return fn(tx);
  })) as T;
}

/** The organization already has the most layers it can keep (SQLSTATE PT001). */
export class TooManyLayersError extends Error {
  constructor() {
    super('too many map layers');
    this.name = 'TooManyLayersError';
  }
}

interface LayerRow {
  id: string;
  name: string;
  kind: MapLayerKind;
  source_url: string;
  source_name: string;
  terms_url: string;
  terms_note: string;
  colour: string;
  colour_field: string | null;
  colours: [string, string][];
  also_fields: string[];
  only_field: string | null;
  only_values: string[];
  created_at: Date;
  version: string;
  line_width: number | null;
  opacity: number;
  min_zoom: number | null;
  max_zoom: number | null;
  definition_expression: string | null;
  others_shown: boolean;
  shown_by_default: boolean;
  tile_min_level: number | null;
  tile_max_level: number | null;
}

/**
 * Whether the person may change a layer and it is the version they saw (the update itself
 * checks all three again).
 */
async function layerWritable(
  tx: postgres.TransactionSql,
  id: string,
  version: string,
): Promise<Exclude<MapLayerWrite, { status: 'saved' }> | null> {
  const [row] = await tx<{ admin: boolean; version: string; removed: boolean }[]>`
    select coalesce(petro.current_member_role() = 'org_admin', false) as admin,
           updated_at::text as version, removed_at is not null as removed
    from petro.map_layers where id = ${id}`;
  if (!row || row.removed) return { status: 'not_found' };
  if (!row.admin) return { status: 'forbidden' };
  if (row.version !== version) return { status: 'stale' };
  return null;
}

/**
 * The database refused a layer's values (a check, SQLSTATE 23514): something the API's own
 * checks let through. The person is told to correct it; it is not a database outage
 * (F-247-2-R1-02).
 */
export class LayerRefusedError extends Error {
  constructor() {
    super('map layer refused by a check');
    this.name = 'LayerRefusedError';
  }
}

/** Turns the database's own refusals of a layer into the errors the routes answer for. */
function layerRefusal(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'PT001') return new TooManyLayersError();
    if (error.code === '23514') return new LayerRefusedError();
  }
  return error;
}

async function refusalsNamed<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw layerRefusal(error);
  }
}

/** The oil and gas database over an existing connection; tests use it directly. */
export function createPetroleumDatabase(sql: postgres.Sql): PetroleumDatabase {
  return {
    ...aerListsQueries(sql),
    ...wellsQueries(sql),
    ...st37Queries(sql),
    ...productionQueries(sql),
    ...landQueries(sql),
    ...formationQueries(sql),
    ...landSalesQueries(sql),
    ...facilityQueries(sql),
    ...operatorQueries(sql),
    ...pipelineQueries(sql),
    ...priceQueries(sql),
    ...fracQueries(sql),
    ...geologyQueries(sql),
    async schemaVersion() {
      const [row] = await sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
        return tx<{ version: number }[]>`select petro.schema_version() as version`;
      });
      return row?.version ?? 0;
    },
    organizationSeen(ctx) {
      return asMember(sql, ctx, async (tx) => {
        const [row] = await tx<{ organization_id: string | null }[]>`
          select petro.current_organization_id()::text as organization_id`;
        return row?.organization_id ?? null;
      });
    },
    listLayers(ctx) {
      return asMember(sql, ctx, async (tx) => {
        const rows = await tx<LayerRow[]>`
          select id, name, kind, source_url, source_name, terms_url, terms_note, colour,
                 colour_field, colours, to_jsonb(also_fields) as also_fields, only_field,
                 to_jsonb(only_values) as only_values, created_at, updated_at::text as version,
                 line_width, opacity, min_zoom, max_zoom, definition_expression, others_shown,
                 shown_by_default, tile_min_level, tile_max_level
          from petro.map_layers
          where organization_id = petro.current_organization_id() and removed_at is null
          order by created_at, id`;
        return rows.map((row): MapLayerView => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          url: row.source_url,
          wmsLayers: null,
          sourceName: row.source_name,
          termsUrl: row.terms_url,
          termsNote: row.terms_note,
          colour: row.colour,
          colourField: row.colour_field,
          colours: row.colours,
          alsoFields: row.also_fields,
          onlyField: row.only_field,
          onlyValues: row.only_values,
          fileName: null,
          featureCount: null,
          // Names live in grain's database; the layer keeps who added it by id only.
          createdByName: null,
          createdAt: row.created_at.toISOString(),
          version: row.version,
          overview: null,
          lineWidth: row.line_width,
          opacity: row.opacity,
          minZoom: row.min_zoom,
          maxZoom: row.max_zoom,
          definitionExpression: row.definition_expression,
          othersShown: row.others_shown,
          map: null,
          mapVisible: row.shown_by_default,
          tileLevels:
            row.tile_min_level !== null && row.tile_max_level !== null
              ? { min: row.tile_min_level, max: row.tile_max_level }
              : null,
        }));
      });
    },
    layerSource(ctx, id) {
      return asMember(sql, ctx, async (tx) => {
        const [row] = await tx<MapLayerSource[]>`
          select id, organization_id as "organizationId", kind, source_url as url,
                 null::text as "wmsLayers", id_field as "idField",
                 colour_field as "colourField", to_jsonb(also_fields) as "alsoFields",
                 only_field as "onlyField", to_jsonb(only_values) as "onlyValues",
                 definition_expression as "definitionExpression",
                 case when tile_min_level is null then null
                      else jsonb_build_object('min', tile_min_level, 'max', tile_max_level)
                 end as "tileLevels"
          from petro.map_layers where id = ${id} and removed_at is null`;
        return row ?? null;
      });
    },
    async createLayer(ctx, layer) {
      try {
        return await asMember(sql, ctx, async (tx): Promise<MapLayerWrite> => {
          const [admin] = await tx<{ ok: boolean }[]>`
            select coalesce(petro.current_member_role() = 'org_admin', false) as ok`;
          if (admin?.ok !== true) return { status: 'forbidden' };
          const [saved] = await tx<{ id: string }[]>`
            insert into petro.map_layers (organization_id, name, kind, source_url, id_field,
              source_name, terms_url, terms_note, colour, colour_field, colours, also_fields,
              only_field, only_values, line_width, opacity, min_zoom, max_zoom,
              definition_expression, others_shown, shown_by_default, tile_min_level,
              tile_max_level, created_by, updated_by)
            values (petro.current_organization_id(), ${layer.name}, ${layer.kind}, ${layer.url},
              ${layer.idField}, ${layer.sourceName}, ${layer.termsUrl}, ${layer.termsNote},
              ${layer.colour}, ${layer.colourField}, ${tx.json(layer.colours)},
              array(select jsonb_array_elements_text(${tx.json(layer.alsoFields)}::jsonb)),
              ${layer.onlyField},
              array(select jsonb_array_elements_text(${tx.json(layer.onlyValues)}::jsonb)),
              ${layer.lineWidth}, ${layer.opacity}, ${layer.minZoom}, ${layer.maxZoom},
              ${layer.definitionExpression}, ${layer.othersShown}, ${layer.mapVisible},
              ${layer.tileLevels?.min ?? null}, ${layer.tileLevels?.max ?? null},
              petro.current_user_id(), petro.current_user_id())
            returning id`;
          if (!saved) throw new Error('map layer was not saved');
          return { status: 'saved', id: saved.id };
        });
      } catch (error) {
        throw layerRefusal(error);
      }
    },
    updateLayer(ctx, id, version, changes) {
      return refusalsNamed(
        asMember(sql, ctx, async (tx): Promise<MapLayerWrite> => {
          const refused = await layerWritable(tx, id, version);
          if (refused) return refused;
          const updated = await tx`
          update petro.map_layers set
            name = ${changes.name}, source_name = ${changes.sourceName},
            terms_url = ${changes.termsUrl}, terms_note = ${changes.termsNote},
            colour = ${changes.colour}, colour_field = ${changes.colourField},
            colours = ${tx.json(changes.colours)},
            also_fields = array(select jsonb_array_elements_text(${tx.json(changes.alsoFields)}::jsonb)),
            only_field = ${changes.onlyField},
            only_values = array(select jsonb_array_elements_text(${tx.json(changes.onlyValues)}::jsonb)),
            shown_by_default = coalesce(${changes.mapVisible ?? null}::boolean, shown_by_default),
            updated_by = petro.current_user_id()
          where id = ${id} and updated_at::text = ${version} and removed_at is null`;
          return updated.count === 1 ? { status: 'saved', id } : { status: 'stale' };
        }),
      );
    },
    removeLayer(ctx, id, version) {
      return asMember(sql, ctx, async (tx): Promise<MapLayerWrite> => {
        const refused = await layerWritable(tx, id, version);
        if (refused) return refused;
        const updated = await tx`
          update petro.map_layers set
            removed_at = now(), removed_by = petro.current_user_id(),
            updated_by = petro.current_user_id()
          where id = ${id} and updated_at::text = ${version} and removed_at is null`;
        return updated.count === 1 ? { status: 'saved', id } : { status: 'stale' };
      });
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
    async abort() {
      await sql.end({ timeout: 0 });
    },
  };
}

/** Connects as `petro_api`, with the same driver settings as grain's database. */
export function postgresPetroleum(
  url: string,
  options: { viaHyperdrive?: boolean } = {},
): PetroleumDatabase {
  return createPetroleumDatabase(postgres(url, connectionOptions(url, options.viaHyperdrive)));
}
