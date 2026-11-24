import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * The AER's frac data (F-288; 20261207010000_petro_frac.sql): one line per well event fractured
 * in Alberta since 2013, kept by the "Load frac data" workflow. Members only read.
 */

export interface FracDbRow {
  uwi: string;
  first_frac_date: string;
  last_frac_date: string;
  fracs: number;
  stages: number | null;
  /** Decimal strings, as stored. */
  water_m3: string;
  proppant_t: string;
  upgrade_hint_t: string;
  refrac_proppant_t: string;
  max_tvd_m: string | null;
  suspect: boolean;
}

/** The latest load. */
export interface FracLoad {
  loadedAt: string;
  /** The AER file's own date. */
  sourceDate: string | null;
  wells: number;
}

export interface FracDatabase {
  /** Members: the latest load and the fractured well events of one licence. */
  fracOfLicence(
    ctx: PetroleumContext,
    licence: string,
  ): Promise<{ load: FracLoad | null; rows: FracDbRow[] }>;
}

export function fracQueries(sql: postgres.Sql): FracDatabase {
  return {
    fracOfLicence(ctx, licence) {
      return sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '15s', true),
                        set_config('petro.user_id', ${ctx.userId}, true),
                        set_config('petro.organization_id', ${ctx.organizationId}, true),
                        set_config('petro.member_role', ${ctx.role}, true),
                        set_config('petro.request_id', ${ctx.requestId}, true)`;
        const [load] = await tx<{ loaded_at: Date; source_date: string | null; wells: number }[]>`
          select loaded_at, to_char(source_date, 'YYYY-MM-DD') as source_date, wells
          from petro.frac_loads order by id desc limit 1`;
        const rows = await tx<FracDbRow[]>`
          select uwi, to_char(first_frac_date, 'YYYY-MM-DD') as first_frac_date,
                 to_char(last_frac_date, 'YYYY-MM-DD') as last_frac_date, fracs, stages,
                 water_m3::text as water_m3, proppant_t::text as proppant_t,
                 upgrade_hint_t::text as upgrade_hint_t,
                 refrac_proppant_t::text as refrac_proppant_t, max_tvd_m::text as max_tvd_m,
                 suspect
          from petro.frac_wells where licence_number = ${licence}
          order by uwi`;
        return {
          load: load
            ? {
                loadedAt: load.loaded_at.toISOString(),
                sourceDate: load.source_date,
                wells: load.wells,
              }
            : null,
          rows,
        };
      });
    },
  };
}
