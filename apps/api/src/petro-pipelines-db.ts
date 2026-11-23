import type { Bbox } from '@grain/domain';
import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';
import type { St37Box } from './st37-db';

/**
 * Pipelines (F-249; 20261203010000_petro_pipelines.sql): the AER's pipeline file, for the area of
 * the latest load. Loaded by hand by the "Load pipelines" workflow; members only read.
 */

/** A segment as a square of the map needs it. */
export interface PipelineLineRow {
  id: string;
  licence_number: string;
  line_number: string | null;
  licensee_code: string | null;
  licensee: string | null;
  status: string | null;
  /** The first of its substances, the one the AER ranks highest. */
  substance: string | null;
  diameter_mm: number | null;
  path: number[];
  breaks: number[];
}

/** Every column of one segment, for its panel. */
export interface PipelineSegmentRow {
  id: string;
  segment_id: string | null;
  licence_number: string;
  line_number: string | null;
  federal: boolean;
  licensee_code: string | null;
  licensee: string | null;
  status: string | null;
  substances: string[];
  from_facility: string | null;
  from_location: string | null;
  to_facility: string | null;
  to_location: string | null;
  length_km: string | null;
  diameter_mm: string | null;
  wall_mm: string | null;
  material: string | null;
  pipe_type: string | null;
  pipe_grade: string | null;
  max_pressure: string | null;
  h2s: string | null;
  field_centre: string | null;
  licence_approved: string | null;
  last_occurrence_year: number | null;
  geometry_source: string | null;
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The latest load. */
export interface PipelineLoad {
  loadedAt: string;
  fileDate: string | null;
  area: St37Box;
  segments: number;
}

export interface PipelinesDatabase {
  /**
   * Members: the latest load and, of its segments whose box touches `box`, those whose outside
   * diameter is `minDiameterMm` or more or whose length is `minLengthKm` or more (each test
   * left out when 0; every segment when both are), at most `limit`, the largest first.
   */
  pipelineSquare(
    ctx: PetroleumContext,
    box: Bbox,
    sizes: { minDiameterMm: number; minLengthKm: number },
    limit: number,
  ): Promise<{ load: PipelineLoad | null; rows: PipelineLineRow[] }>;
  /** Members: one segment by its row id, every column; null when there is none. */
  pipelineSegment(ctx: PetroleumContext, id: string): Promise<PipelineSegmentRow | null>;
}

async function readAs(tx: postgres.TransactionSql, ctx: PetroleumContext) {
  await tx`select set_config('statement_timeout', '15s', true),
                  set_config('petro.user_id', ${ctx.userId}, true),
                  set_config('petro.organization_id', ${ctx.organizationId}, true),
                  set_config('petro.member_role', ${ctx.role}, true),
                  set_config('petro.request_id', ${ctx.requestId}, true)`;
}

export function pipelineQueries(sql: postgres.Sql): PipelinesDatabase {
  return {
    pipelineSquare(ctx, box, { minDiameterMm, minLengthKm }, limit) {
      return sql.begin(async (tx) => {
        await readAs(tx, ctx);
        const [load] = await tx<
          {
            loaded_at: Date;
            file_date: string | null;
            west: string;
            south: string;
            east: string;
            north: string;
            segments: number;
          }[]
        >`
          select loaded_at, file_date::text as file_date, west, south, east, north, segments
          from petro.pipeline_loads order by id desc limit 1`;
        const rows = await tx<PipelineLineRow[]>`
          select id::text as id, licence_number, line_number, licensee_code, licensee, status,
                 substances[1] as substance, diameter_mm::float8 as diameter_mm,
                 -- As JSON: the connection reads no array types (connectionOptions), JSON it does.
                 to_jsonb(path) as path, to_jsonb(breaks) as breaks
          from petro.pipelines
          where bounds && box(point(${box.west}, ${box.south}), point(${box.east}, ${box.north}))
            and ((${minDiameterMm}::numeric = 0 and ${minLengthKm}::numeric = 0)
                 or (${minDiameterMm}::numeric > 0 and diameter_mm >= ${minDiameterMm}::numeric)
                 or (${minLengthKm}::numeric > 0 and length_km >= ${minLengthKm}::numeric))
          order by diameter_mm desc nulls last, id
          limit ${limit}`;
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
                segments: load.segments,
              }
            : null,
          rows,
        };
      });
    },

    pipelineSegment(ctx, id) {
      return sql.begin(async (tx) => {
        await readAs(tx, ctx);
        const [row] = await tx<PipelineSegmentRow[]>`
          select id::text as id, segment_id, licence_number, line_number, federal, licensee_code,
                 licensee, status, to_jsonb(substances) as substances, from_facility,
                 from_location, to_facility,
                 to_location, length_km::text as length_km, diameter_mm::text as diameter_mm,
                 wall_mm::text as wall_mm, material, pipe_type, pipe_grade,
                 max_pressure::text as max_pressure, h2s::text as h2s, field_centre,
                 licence_approved::text as licence_approved, last_occurrence_year,
                 geometry_source,
                 (bounds[1])[0] as west, (bounds[1])[1] as south,
                 (bounds[0])[0] as east, (bounds[0])[1] as north
          from petro.pipelines
          where id = ${id}::bigint`;
        return row ?? null;
      });
    },
  };
}
