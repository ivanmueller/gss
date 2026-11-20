import type { St37StatusClass, ZoneWell } from '@grain/domain';
import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * Alberta's wells from the AER's ST37 list (F-243 part 4; 20261122010000_petro_st37_wells.sql).
 * Loaded by hand by the "Load ST37 wells" workflow; members only read.
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
}

export interface St37Load {
  loadedAt: string;
  sourceDate: string | null;
  area: St37Box;
  /** The formation loaded whole ("duvernay"), or null when the load was a rectangle. */
  formation: string | null;
  /** How many wells the whole load holds, by status. */
  totals: Partial<Record<St37StatusClass, number>>;
  /**
   * Every drilled well of a formation loaded whole (not the licensed or the ones being
   * drilled), for the zones where they cluster (F-255); absent for a rectangle.
   */
  drilled?: ZoneWell[];
}

export interface St37Database {
  /**
   * Members: the latest load, and up to `limit` wells whose surface hole lies in the box (one
   * more than `limit` tells the caller the box holds more).
   */
  st37Wells(
    ctx: PetroleumContext,
    box: St37Box,
    limit: number,
  ): Promise<{ load: St37Load | null; wells: St37WellRow[] }>;
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
}

interface LoadDbRow {
  loaded_at: Date;
  source_date: string | null;
  formation: string | null;
  west: string;
  south: string;
  east: string;
  north: string;
}

const num = (value: string | null) => (value === null ? null : Number(value));

export function st37Queries(sql: postgres.Sql): St37Database {
  return {
    st37Wells(ctx, box, limit) {
      return sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '10s', true),
                        set_config('petro.user_id', ${ctx.userId}, true),
                        set_config('petro.organization_id', ${ctx.organizationId}, true),
                        set_config('petro.member_role', ${ctx.role}, true),
                        set_config('petro.request_id', ${ctx.requestId}, true)`;
        const [load] = await tx<LoadDbRow[]>`
          select loaded_at, source_date::text as source_date, formation, west, south, east, north
          from petro.st37_loads order by id desc limit 1`;
        const totals = load
          ? await tx<{ status_class: St37StatusClass; wells: number }[]>`
              select status_class, count(*)::int as wells
              from petro.st37_wells group by status_class`
          : [];
        const drilled = load?.formation
          ? await tx<
              Pick<
                WellDbRow,
                'surface_longitude' | 'surface_latitude' | 'bottom_longitude' | 'bottom_latitude'
              >[]
            >`
              select surface_longitude, surface_latitude, bottom_longitude, bottom_latitude
              from petro.st37_wells
              where status_class not in ('licensed', 'drilling')
              order by uwi`
          : null;
        const rows = await tx<WellDbRow[]>`
          select uwi, licence_number, well_name, licensee, status_class, status_fluid,
                 status_type, spud_date::text as spud_date, total_depth_m, true_vertical_depth_m,
                 surface_longitude, surface_latitude, bottom_longitude, bottom_latitude, path,
                 licence_date::text as licence_date, planned_operation, planned_formation,
                 planned_depth_m, planned_bottom_longitude, planned_bottom_latitude
          from petro.st37_wells
          where surface_longitude between ${box.west} and ${box.east}
            and surface_latitude between ${box.south} and ${box.north}
          order by uwi
          limit ${limit + 1}`;
        return {
          load: load
            ? {
                loadedAt: load.loaded_at.toISOString(),
                sourceDate: load.source_date,
                area: {
                  west: Number(load.west),
                  south: Number(load.south),
                  east: Number(load.east),
                  north: Number(load.north),
                },
                formation: load.formation,
                totals: Object.fromEntries(totals.map((t) => [t.status_class, t.wells])),
                ...(drilled && {
                  drilled: drilled.map((d) => ({
                    surface: [Number(d.surface_longitude), Number(d.surface_latitude)] as const,
                    bottom: [Number(d.bottom_longitude), Number(d.bottom_latitude)] as const,
                  })),
                }),
              }
            : null,
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
          })),
        };
      });
    },
  };
}
