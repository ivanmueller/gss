import { type LandLayerKey, type LandShape, storedLandShape } from '@grain/domain';
import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';
import type { St37Box } from './st37-db';

/**
 * Land held today (F-241; 20261126010000_petro_land.sql): Crown agreements, active offset
 * notices and land whose petroleum and natural gas is not the Crown's. Loaded by hand by the
 * "Load land" workflow; members only read.
 */

export const LAND_KINDS = ['agreements', 'offsets', 'freehold'] as const;
export type LandKind = (typeof LAND_KINDS)[number];

export interface LandAgreementRow {
  id: string;
  rights: 'png' | 'oil_sands';
  agreementType: string;
  agreementNumber: string;
  tract: string | null;
  group: string | null;
  status: string | null;
  vintage: string | null;
  holder: string | null;
  /** Both left out of an agreement sent as a dot (F-312): a zone can be a thousand characters. */
  parties?: string | null;
  zone?: string | null;
  areaHa: number | null;
  termDate: string | null;
  continuationDate: string | null;
  expiryText: string | null;
  shape: LandShape;
  /** Where its dot goes, the middle of its box, when sent as a dot (`shape` then empty). */
  centre?: [number, number];
}

export interface LandOffsetRow {
  id: string;
  offsetType: string | null;
  offsetNumber: string;
  tract: string | null;
  holder: string | null;
  expiryDate: string | null;
  zone: string | null;
  shape: LandShape;
}

export interface LandFreeholdRow {
  id: string;
  substances: string | null;
  nationalPark: string | null;
  reserveNumber: string | null;
  reserveName: string | null;
  shape: LandShape;
}

/** The latest load of one layer. */
export interface LandLoad {
  layer: LandLayerKey;
  loadedAt: string;
  area: St37Box;
  shapes: number;
}

export interface LandRows {
  loads: LandLoad[];
  agreements: LandAgreementRow[];
  offsets: LandOffsetRow[];
  freehold: LandFreeholdRow[];
}

export interface LandDatabase {
  /**
   * Members: each layer's latest load, and for each kind asked for (a limit above zero) up to
   * that many shapes whose box touches the view, plus one more to tell the caller the view
   * holds more.
   */
  land(
    ctx: PetroleumContext,
    box: St37Box,
    limits: Record<LandKind, number>,
    /**
     * Only agreements whose zone has one of these hashes (md5, those including a play); null
     * for every one.
     */
    zones?: readonly string[] | null,
  ): Promise<LandRows>;
  /**
   * Members: each layer's latest load, and up to `limit` Crown agreements anywhere (one more
   * tells the caller there are more), without their outlines, parties or zone: each with the
   * middle of its box, for the dots drawn far out when no play narrows them (F-312).
   */
  landAgreementDots(
    ctx: PetroleumContext,
    limit: number,
  ): Promise<{ loads: LandLoad[]; agreements: LandAgreementRow[] }>;
  /**
   * Members: what the loads now hold, as a stamp that changes with each load of the land held
   * or of the land sales.
   */
  landZoneStamp(ctx: PetroleumContext): Promise<string>;
  /** Members: every zone written on an agreement or a sale parcel, each once, with its md5. */
  landZones(ctx: PetroleumContext): Promise<{ zone: string; hash: string }[]>;
}

interface LoadDbRow {
  layer: LandLayerKey;
  loaded_at: Date;
  west: string;
  south: string;
  east: string;
  north: string;
  shapes: number;
}

const num = (value: string | null) => (value === null ? null : Number(value));

async function asMember(tx: postgres.TransactionSql, ctx: PetroleumContext) {
  await tx`select set_config('statement_timeout', '10s', true),
                  set_config('petro.user_id', ${ctx.userId}, true),
                  set_config('petro.organization_id', ${ctx.organizationId}, true),
                  set_config('petro.member_role', ${ctx.role}, true),
                  set_config('petro.request_id', ${ctx.requestId}, true)`;
}

const loadOf = (l: LoadDbRow): LandLoad => ({
  layer: l.layer,
  loadedAt: l.loaded_at.toISOString(),
  area: {
    west: Number(l.west),
    south: Number(l.south),
    east: Number(l.east),
    north: Number(l.north),
  },
  shapes: l.shapes,
});

export function landQueries(sql: postgres.Sql): LandDatabase {
  return {
    landAgreementDots(ctx, limit) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const loads = await tx<LoadDbRow[]>`
          select distinct on (layer) layer, loaded_at, west, south, east, north, shapes
          from petro.land_loads order by layer, id desc`;
        const rows = await tx<
          {
            id: string;
            rights: 'png' | 'oil_sands';
            agreement_type: string;
            agreement_number: string;
            tract: string | null;
            agreement_group: string | null;
            status: string | null;
            vintage: string | null;
            holder: string | null;
            area_ha: string | null;
            term_date: string | null;
            continuation_date: string | null;
            expiry_text: string | null;
            // As float8 the driver gives a number; read through Number() either way.
            x: number | string;
            y: number | string;
          }[]
        >`
          select id::text as id, rights, agreement_type, agreement_number, tract,
                 agreement_group, status, vintage, holder, area_ha,
                 term_date::text as term_date,
                 continuation_date::text as continuation_date, expiry_text,
                 round(((center(bounds))[0])::numeric, 5)::float8 as x,
                 round(((center(bounds))[1])::numeric, 5)::float8 as y
          from petro.land_agreements
          order by id
          limit ${limit + 1}`;
        return {
          loads: loads.map(loadOf),
          agreements: rows.map((a) => ({
            id: a.id,
            rights: a.rights,
            agreementType: a.agreement_type,
            agreementNumber: a.agreement_number,
            tract: a.tract,
            group: a.agreement_group,
            status: a.status,
            vintage: a.vintage,
            holder: a.holder,
            areaHa: num(a.area_ha),
            termDate: a.term_date,
            continuationDate: a.continuation_date,
            expiryText: a.expiry_text,
            shape: [],
            centre: [Number(a.x), Number(a.y)] as [number, number],
          })),
        };
      });
    },
    landZoneStamp(ctx) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const [row] = await tx<{ stamp: string }[]>`
          select coalesce((select max(id) from petro.land_loads), 0)::text || ':' ||
                 coalesce((select max(id) from petro.land_sale_loads), 0)::text as stamp`;
        return row?.stamp ?? '0:0';
      });
    },
    landZones(ctx) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        return await tx<{ zone: string; hash: string }[]>`
          select zone, md5(zone) as hash from (
            select zone from petro.land_agreements where zone is not null
            union
            select zone from petro.land_sale_parcels where zone is not null
          ) z`;
      });
    },
    land(ctx, box, limits, zones = null) {
      return sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '10s', true),
                        set_config('petro.user_id', ${ctx.userId}, true),
                        set_config('petro.organization_id', ${ctx.organizationId}, true),
                        set_config('petro.member_role', ${ctx.role}, true),
                        set_config('petro.request_id', ${ctx.requestId}, true)`;
        const view = tx`box(point(${box.west}::float8, ${box.south}::float8),
                            point(${box.east}::float8, ${box.north}::float8))`;
        const loads = await tx<LoadDbRow[]>`
          select distinct on (layer) layer, loaded_at, west, south, east, north, shapes
          from petro.land_loads order by layer, id desc`;
        const agreements =
          limits.agreements > 0
            ? await tx<
                {
                  id: string;
                  rights: 'png' | 'oil_sands';
                  agreement_type: string;
                  agreement_number: string;
                  tract: string | null;
                  agreement_group: string | null;
                  status: string | null;
                  vintage: string | null;
                  holder: string | null;
                  parties: string | null;
                  zone: string | null;
                  area_ha: string | null;
                  term_date: string | null;
                  continuation_date: string | null;
                  expiry_text: string | null;
                  shape: LandShape | null;
                  path: number[] | null;
                  rings: number[] | null;
                }[]
              >`
                select id::text as id, rights, agreement_type, agreement_number, tract,
                       agreement_group, status, vintage, holder, parties, zone, area_ha,
                       term_date::text as term_date,
                       continuation_date::text as continuation_date, expiry_text, shape,
                       -- As JSON: without fetch_types (the Worker's connection) an array comes as text.
                       to_jsonb(path) as path, to_jsonb(rings) as rings
                from petro.land_agreements
                where bounds && ${view}
                  and (${zones === null}::boolean
                       or md5(zone) in (select jsonb_array_elements_text((${JSON.stringify(zones ?? [])}::text)::jsonb)))
                order by id
                limit ${limits.agreements + 1}`
            : [];
        const offsets =
          limits.offsets > 0
            ? await tx<
                {
                  id: string;
                  offset_type: string | null;
                  offset_number: string;
                  tract: string | null;
                  holder: string | null;
                  expiry_date: string | null;
                  zone: string | null;
                  shape: LandShape | null;
                  path: number[] | null;
                  rings: number[] | null;
                }[]
              >`
                select id::text as id, offset_type, offset_number, tract, holder,
                       expiry_date::text as expiry_date, zone, shape,
                       -- As JSON: without fetch_types (the Worker's connection) an array comes as text.
                       to_jsonb(path) as path, to_jsonb(rings) as rings
                from petro.land_offsets
                where bounds && ${view}
                order by id
                limit ${limits.offsets + 1}`
            : [];
        const freehold =
          limits.freehold > 0
            ? await tx<
                {
                  id: string;
                  substances: string | null;
                  national_park: string | null;
                  reserve_number: string | null;
                  reserve_name: string | null;
                  shape: LandShape | null;
                  path: number[] | null;
                  rings: number[] | null;
                }[]
              >`
                select id::text as id, substances, national_park, reserve_number, reserve_name,
                       shape,
                       -- As JSON: without fetch_types (the Worker's connection) an array comes as text.
                       to_jsonb(path) as path, to_jsonb(rings) as rings
                from petro.land_freehold
                where bounds && ${view}
                order by id
                limit ${limits.freehold + 1}`
            : [];
        return {
          loads: loads.map((l) => ({
            layer: l.layer,
            loadedAt: l.loaded_at.toISOString(),
            area: {
              west: Number(l.west),
              south: Number(l.south),
              east: Number(l.east),
              north: Number(l.north),
            },
            shapes: l.shapes,
          })),
          agreements: agreements.map((a) => ({
            id: a.id,
            rights: a.rights,
            agreementType: a.agreement_type,
            agreementNumber: a.agreement_number,
            tract: a.tract,
            group: a.agreement_group,
            status: a.status,
            vintage: a.vintage,
            holder: a.holder,
            parties: a.parties,
            zone: a.zone,
            areaHa: num(a.area_ha),
            termDate: a.term_date,
            continuationDate: a.continuation_date,
            expiryText: a.expiry_text,
            shape: storedLandShape(a),
          })),
          offsets: offsets.map((o) => ({
            id: o.id,
            offsetType: o.offset_type,
            offsetNumber: o.offset_number,
            tract: o.tract,
            holder: o.holder,
            expiryDate: o.expiry_date,
            zone: o.zone,
            shape: storedLandShape(o),
          })),
          freehold: freehold.map((f) => ({
            id: f.id,
            substances: f.substances,
            nationalPark: f.national_park,
            reserveNumber: f.reserve_number,
            reserveName: f.reserve_name,
            shape: storedLandShape(f),
          })),
        };
      });
    },
  };
}
