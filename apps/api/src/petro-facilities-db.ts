import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';
import type { St37Box } from './st37-db';

/**
 * Facilities (F-278; 20261202010000_petro_facilities.sql): the AER's ST102 facility list, for the
 * area of the latest load. Loaded by hand by the "Load facilities" workflow; members only read.
 */

export interface FacilityDbRow {
  facility_id: string;
  name: string | null;
  operator_code: string | null;
  operator: string | null;
  sub_code: number | null;
  sub_type: string | null;
  licence_number: string | null;
  licence_type: 'W' | 'F' | null;
  licensee_code: string | null;
  licensee: string | null;
  status: string | null;
  location_source: string | null;
  longitude: string;
  latitude: string;
}

/** The latest load. */
export interface FacilityLoad {
  loadedAt: string;
  fileDate: string | null;
  area: St37Box;
  facilities: number;
}

export interface FacilitiesDatabase {
  /** Members: the latest load and every facility it holds. */
  facilities(ctx: PetroleumContext): Promise<{ load: FacilityLoad | null; rows: FacilityDbRow[] }>;
}

export function facilityQueries(sql: postgres.Sql): FacilitiesDatabase {
  return {
    facilities(ctx) {
      return sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '15s', true),
                        set_config('petro.user_id', ${ctx.userId}, true),
                        set_config('petro.organization_id', ${ctx.organizationId}, true),
                        set_config('petro.member_role', ${ctx.role}, true),
                        set_config('petro.request_id', ${ctx.requestId}, true)`;
        const [load] = await tx<
          {
            loaded_at: Date;
            file_date: string | null;
            west: string;
            south: string;
            east: string;
            north: string;
            facilities: number;
          }[]
        >`
          select loaded_at, file_date::text as file_date, west, south, east, north, facilities
          from petro.facility_loads order by id desc limit 1`;
        const rows = await tx<FacilityDbRow[]>`
          select facility_id, name, operator_code, operator, sub_code, sub_type, licence_number,
                 licence_type, licensee_code, licensee, status, location_source,
                 longitude::text as longitude, latitude::text as latitude
          from petro.facilities
          order by facility_id`;
        return {
          load: load
            ? {
                loadedAt: load.loaded_at.toISOString(),
                fileDate: load.file_date,
                area: {
                  west: Number(load.west),
                  south: Number(load.south),
                  east: Number(load.east),
                  north: Number(load.north),
                },
                facilities: load.facilities,
              }
            : null,
          rows,
        };
      });
    },
  };
}
