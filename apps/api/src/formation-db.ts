import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * The layers of the ground around the wells (F-261 part 2;
 * 20261130010000_petro_formation_cells.sql): the Alberta Geological Survey's model of Alberta's
 * subsurface on a lattice of about 1 km, each cell with the elevation of the top and of the base
 * of each of the model's 90 zones. Loaded by hand by the "Load formation layers" workflow;
 * members only read.
 */

/** A run of lattice cells: the first and last column and row, both included. */
export interface FormationRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface FormationCellRow {
  x: number;
  y: number;
  /** Metres above sea level, zone 1 first; null where the zone is absent under the cell. */
  tops: (number | null)[];
  bases: (number | null)[];
}

export interface FormationLoad {
  loadedAt: string;
  sourceDate: string | null;
  model: string;
  lonStep: number;
  latStep: number;
}

export interface FormationDatabase {
  /** Members: the latest load and the cells of the range that are kept. */
  formationCells(
    ctx: PetroleumContext,
    range: FormationRange,
  ): Promise<{ load: FormationLoad | null; cells: FormationCellRow[] }>;
}

interface LoadRow {
  loaded_at: Date;
  source_date: string | null;
  model: string;
  lon_step: string;
  lat_step: string;
}

interface CellRow {
  cell_x: number;
  cell_y: number;
  tops: (number | null)[];
  bases: (number | null)[];
}

async function asMember(tx: postgres.TransactionSql, ctx: PetroleumContext) {
  await tx`select set_config('statement_timeout', '10s', true),
                  set_config('petro.user_id', ${ctx.userId}, true),
                  set_config('petro.organization_id', ${ctx.organizationId}, true),
                  set_config('petro.member_role', ${ctx.role}, true),
                  set_config('petro.request_id', ${ctx.requestId}, true)`;
}

export function formationQueries(sql: postgres.Sql): FormationDatabase {
  return {
    formationCells(ctx, range) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const [load] = await tx<LoadRow[]>`
          select loaded_at, source_date::text as source_date, model, lon_step, lat_step
          from petro.formation_loads order by id desc limit 1`;
        const cells = await tx<CellRow[]>`
          -- As JSON: this connection does not read Postgres arrays into lists.
          select cell_x, cell_y, to_jsonb(tops) as tops, to_jsonb(bases) as bases
          from petro.formation_cells
          where cell_y between ${range.y0} and ${range.y1}
            and cell_x between ${range.x0} and ${range.x1}
          order by cell_y, cell_x`;
        return {
          load: load
            ? {
                loadedAt: load.loaded_at.toISOString(),
                sourceDate: load.source_date,
                model: load.model,
                lonStep: Number(load.lon_step),
                latStep: Number(load.lat_step),
              }
            : null,
          cells: cells.map((cell) => ({
            x: cell.cell_x,
            y: cell.cell_y,
            tops: cell.tops,
            bases: cell.bases,
          })),
        };
      });
    },
  };
}
