import type { St37StatusClass, ZoneWell } from '@grain/domain';
import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * Alberta's wells from the AER's ST37 list (F-243 part 4; 20261122010000_petro_st37_wells.sql),
 * several plays side by side, each well with its field and pool (F-256;
 * 20261125010000_petro_plays_fields_pools.sql). Loaded by hand by the "Load ST37 wells"
 * workflow; members only read.
 */

export interface St37Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface St37WellRow {
  uwi: string;
  licenceNumber: string;
  wellName: string | null;
  licensee: string | null;
  statusClass: St37StatusClass;
  statusFluid: string | null;
  statusType: string | null;
  spudDate: string | null;
  totalDepthM: number | null;
  trueVerticalDepthM: number | null;
  surface: [number, number];
  bottom: [number, number];
  path: [number, number][] | null;
  /** What the licence planned (Petrinex), when the load read it. */
  licenceDate: string | null;
  plannedOperation: string | null;
  plannedFormation: string | null;
  plannedDepthM: number | null;
  /** The planned bottom hole of a well with no drilled path yet, or null. */
  plannedBottom: [number, number] | null;
  /** The play the well was loaded for ("duvernay"), or null for a rectangle's well. */
  formation: string | null;
  /** The field and pool of the string its status comes from; names from the AER's ST103 list. */
  fieldCode: number | null;
  fieldName: string | null;
  poolCode: number | null;
  poolName: string | null;
}

/** The latest load of one play (or of a rectangle, `formation` null) that still has wells. */
export interface St37Load {
  /** The load's number: with the play's key, what its zones are kept under. */
  id: string;
  loadedAt: string;
  sourceDate: string | null;
  area: St37Box;
  /** The formation loaded whole ("duvernay"), or null when the load was a rectangle. */
  formation: string | null;
  /** How many wells the play holds, by status. */
  totals: Partial<Record<St37StatusClass, number>>;
}

/** A leg with its depth along the path (F-261; 20261129010000_petro_st37_depths.sql). */
export interface St37DeepLeg {
  uwi: string;
  licenceNumber: string;
  licensee: string | null;
  statusClass: St37StatusClass;
  /** Whether the AER surveyed the path (true) or worked it out (false); null when not said. */
  surveyed: boolean | null;
  /** Whether it is a leg of the well asked for. */
  own: boolean;
  surface: [number, number];
  kbElevationM: number | null;
  groundElevationM: number | null;
  /** [longitude, latitude, metres above sea level] from the surface down; null when not loaded. */
  points: [number, number, number][] | null;
}

export interface St37Database {
  /**
   * Members: every leg under the licence of the well asked for, the leg asked for first, then
   * up to `limit` other wells' legs that have a path with depth and start within `km`
   * kilometres of it, the nearest first (one more than `limit` tells the caller there are
   * more). Empty when the well is not in the copy. `loadedAt` is the latest load's time.
   */
  st37Well3d(
    ctx: PetroleumContext,
    uwi: string,
    km: number,
    limit: number,
  ): Promise<{ loadedAt: string | null; legs: St37DeepLeg[] }>;
  /**
   * Members: the latest load of each play, newest first, and up to `limit` wells whose surface
   * hole lies in the box (one more than `limit` tells the caller the box holds more).
   */
  st37Wells(
    ctx: PetroleumContext,
    box: St37Box,
    limit: number,
  ): Promise<{ loads: St37Load[]; wells: St37WellRow[] }>;
  /**
   * Members: every drilled well of a play (not the licensed or the ones being drilled), for
   * the zones where they cluster (F-255).
   */
  st37Drilled(ctx: PetroleumContext, formation: string): Promise<ZoneWell[]>;
}

interface WellDbRow {
  uwi: string;
  licence_number: string;
  well_name: string | null;
  licensee: string | null;
  status_class: St37StatusClass;
  status_fluid: string | null;
  status_type: string | null;
  spud_date: string | null;
  total_depth_m: string | null;
  true_vertical_depth_m: string | null;
  surface_longitude: string;
  surface_latitude: string;
  bottom_longitude: string;
  bottom_latitude: string;
  path: [number, number][] | null;
  licence_date: string | null;
  planned_operation: string | null;
  planned_formation: string | null;
  planned_depth_m: string | null;
  planned_bottom_longitude: string | null;
  planned_bottom_latitude: string | null;
  formation: string | null;
  field_code: number | null;
  field_name: string | null;
  pool_code: number | null;
  pool_name: string | null;
}

interface LoadDbRow {
  id: string;
  loaded_at: Date;
  source_date: string | null;
  formation: string | null;
  west: string;
  south: string;
  east: string;
  north: string;
}

interface DeepDbRow {
  uwi: string;
  licence_number: string;
  licensee: string | null;
  status_class: St37StatusClass;
  path_surveyed: boolean | null;
  own: boolean;
  surface_longitude: string;
  surface_latitude: string;
  kb_elevation_m: string | null;
  ground_elevation_m: string | null;
  path_3d: [number, number, number][] | null;
}

const num = (value: string | null) => (value === null ? null : Number(value));

async function asMember(tx: postgres.TransactionSql, ctx: PetroleumContext) {
  await tx`select set_config('statement_timeout', '10s', true),
                  set_config('petro.user_id', ${ctx.userId}, true),
                  set_config('petro.organization_id', ${ctx.organizationId}, true),
                  set_config('petro.member_role', ${ctx.role}, true),
                  set_config('petro.request_id', ${ctx.requestId}, true)`;
}

export function st37Queries(sql: postgres.Sql): St37Database {
  return {
    st37Wells(ctx, box, limit) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        // Each play's latest load; a play whose wells are gone is not listed.
        const loads = await tx<LoadDbRow[]>`
          select distinct on (formation) id::text as id, loaded_at,
                 source_date::text as source_date, formation, west, south, east, north
          from petro.st37_loads l
          where exists (select 1 from petro.st37_wells w
                        where w.formation is not distinct from l.formation)
          order by formation, id desc`;
        const totals = await tx<
          { formation: string | null; status_class: St37StatusClass; wells: number }[]
        >`
          select formation, status_class, count(*)::int as wells
          from petro.st37_wells group by formation, status_class`;
        const rows = await tx<WellDbRow[]>`
          select w.uwi, w.licence_number, w.well_name, w.licensee, w.status_class,
                 w.status_fluid, w.status_type, w.spud_date::text as spud_date, w.total_depth_m,
                 w.true_vertical_depth_m, w.surface_longitude, w.surface_latitude,
                 w.bottom_longitude, w.bottom_latitude, w.path,
                 w.licence_date::text as licence_date, w.planned_operation, w.planned_formation,
                 w.planned_depth_m, w.planned_bottom_longitude, w.planned_bottom_latitude,
                 w.formation, w.field_code, f.name as field_name, w.pool_code,
                 p.name as pool_name
          from petro.st37_wells w
          left join petro.fields f on f.field_code = w.field_code
          left join petro.pools p on p.field_code = w.field_code and p.pool_code = w.pool_code
          where w.surface_longitude between ${box.west} and ${box.east}
            and w.surface_latitude between ${box.south} and ${box.north}
          order by w.uwi
          limit ${limit + 1}`;
        return {
          loads: loads
            .map((load) => ({
              id: load.id,
              loadedAt: load.loaded_at.toISOString(),
              sourceDate: load.source_date,
              area: {
                west: Number(load.west),
                south: Number(load.south),
                east: Number(load.east),
                north: Number(load.north),
              },
              formation: load.formation,
              totals: Object.fromEntries(
                totals
                  .filter((t) => t.formation === load.formation)
                  .map((t) => [t.status_class, t.wells]),
              ),
            }))
            .sort((a, b) => Number(b.id) - Number(a.id)),
          wells: rows.map((r) => ({
            uwi: r.uwi,
            licenceNumber: r.licence_number,
            wellName: r.well_name,
            licensee: r.licensee,
            statusClass: r.status_class,
            statusFluid: r.status_fluid,
            statusType: r.status_type,
            spudDate: r.spud_date,
            totalDepthM: num(r.total_depth_m),
            trueVerticalDepthM: num(r.true_vertical_depth_m),
            surface: [Number(r.surface_longitude), Number(r.surface_latitude)],
            bottom: [Number(r.bottom_longitude), Number(r.bottom_latitude)],
            path: r.path,
            licenceDate: r.licence_date,
            plannedOperation: r.planned_operation,
            plannedFormation: r.planned_formation,
            plannedDepthM: num(r.planned_depth_m),
            plannedBottom:
              r.planned_bottom_longitude !== null && r.planned_bottom_latitude !== null
                ? [Number(r.planned_bottom_longitude), Number(r.planned_bottom_latitude)]
                : null,
            formation: r.formation,
            fieldCode: r.field_code,
            fieldName: r.field_name,
            poolCode: r.pool_code,
            poolName: r.pool_name,
          })),
        };
      });
    },
    st37Well3d(ctx, uwi, km, limit) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const [load] = await tx<{ loaded_at: Date }[]>`
          select loaded_at from petro.st37_loads order by id desc limit 1`;
        // The well's own legs, whatever they hold, then the others nearby that have a path with
        // depth: found by the box around the well's surface hole (the index by place), the
        // nearest first.
        const rows = await tx<DeepDbRow[]>`
          with picked as (
            select licence_number, surface_longitude as lon, surface_latitude as lat,
                   (${km}::float8 / 110.574)::numeric as dlat,
                   (${km}::float8 / (111.320 * cos(radians(surface_latitude::float8))))::numeric
                     as dlon
            from petro.st37_wells where uwi = ${uwi}
          ), legs as (
            select w.uwi, w.licence_number, w.licensee, w.status_class, w.path_surveyed,
                   w.surface_longitude, w.surface_latitude, w.kb_elevation_m,
                   w.ground_elevation_m, w.path_3d, true as own, 0::float8 as away
            from petro.st37_wells w, picked p
            where w.licence_number = p.licence_number
            union all
            (select w.uwi, w.licence_number, w.licensee, w.status_class, w.path_surveyed,
                    w.surface_longitude, w.surface_latitude, w.kb_elevation_m,
                    w.ground_elevation_m, w.path_3d, false as own,
                    ((w.surface_longitude - p.lon)::float8 * cos(radians(p.lat::float8))) ^ 2
                      + ((w.surface_latitude - p.lat)::float8) ^ 2 as away
             from petro.st37_wells w, picked p
             where w.licence_number <> p.licence_number
               and w.path_3d is not null
               and w.surface_longitude between p.lon - p.dlon and p.lon + p.dlon
               and w.surface_latitude between p.lat - p.dlat and p.lat + p.dlat
             order by away, w.uwi
             limit ${limit + 1})
          )
          select uwi, licence_number, licensee, status_class, path_surveyed, own,
                 surface_longitude, surface_latitude, kb_elevation_m, ground_elevation_m, path_3d
          from legs
          order by own desc, (uwi = ${uwi}) desc, away, uwi`;
        return {
          loadedAt: load?.loaded_at.toISOString() ?? null,
          legs: rows.map((r) => ({
            uwi: r.uwi,
            licenceNumber: r.licence_number,
            licensee: r.licensee,
            statusClass: r.status_class,
            surveyed: r.path_surveyed,
            own: r.own,
            surface: [Number(r.surface_longitude), Number(r.surface_latitude)],
            kbElevationM: num(r.kb_elevation_m),
            groundElevationM: num(r.ground_elevation_m),
            points: r.path_3d,
          })),
        };
      });
    },
    st37Drilled(ctx, formation) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const rows = await tx<
          Pick<
            WellDbRow,
            'surface_longitude' | 'surface_latitude' | 'bottom_longitude' | 'bottom_latitude'
          >[]
        >`
          select surface_longitude, surface_latitude, bottom_longitude, bottom_latitude
          from petro.st37_wells
          where formation = ${formation} and status_class not in ('licensed', 'drilling')
          order by uwi`;
        return rows.map((d) => ({
          surface: [Number(d.surface_longitude), Number(d.surface_latitude)] as const,
          bottom: [Number(d.bottom_longitude), Number(d.bottom_latitude)] as const,
        }));
      });
    },
  };
}
