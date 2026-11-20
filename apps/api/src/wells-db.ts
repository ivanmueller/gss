import type { WellPage } from '@grain/domain';
import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * Alberta's wells in the oil and gas database (F-243 part 3; 20261121010000_petro_wells.sql). The
 * wells job writes as itself (`petro.job` = `wells`, no member); members read.
 */

export type WellLoadStatus = 'running' | 'done' | 'done_unclean' | 'stopped_size' | 'failed';

export interface WellLoad {
  id: number;
  status: WellLoadStatus;
  startedAt: string;
  finishedAt: string | null;
  lastObjectId: number;
  rowsSaved: number;
  rowsUnidentified: number;
  rowsInvalid: number;
}

export interface WellsDatabase {
  /** Job: the oil and gas database's size in bytes (pg_database_size). */
  databaseSize(): Promise<number>;
  /** Job: the latest load, whatever its status, or null. */
  latestWellLoad(): Promise<WellLoad | null>;
  /** Job: the latest clean finished load, or null. */
  lastDoneWellLoad(): Promise<WellLoad | null>;
  /** Job: starts a load; null when one is already running. */
  startWellLoad(): Promise<WellLoad | null>;
  /**
   * Job: saves one page and moves the cursor, only while the load runs with the cursor this run
   * fetched from (F-243-3-D1-03); `moved` when another run changed it first (nothing written).
   * `ending` finishes the load: `complete` (every well the service counts was seen) makes it done
   * unless a row could not be identified; `incomplete` makes it done_unclean; null keeps it
   * running (F-243-3-R2-02).
   */
  saveWellPage(
    loadId: number,
    fromObjectId: number,
    page: WellPage,
    ending: 'complete' | 'incomplete' | null,
  ): Promise<'saved' | 'moved'>;
  /** Job: stops a running load (the size guard, or a failure); `moved` when it no longer runs. */
  stopWellLoad(loadId: number, status: 'stopped_size' | 'failed'): Promise<'saved' | 'moved'>;
  /** Members: the latest load and the number of current wells. */
  wellsStatus(ctx: PetroleumContext): Promise<{ load: WellLoad | null; current: number }>;
}

interface LoadRow {
  id: string;
  status: WellLoadStatus;
  started_at: Date;
  finished_at: Date | null;
  last_object_id: string;
  rows_saved: number;
  rows_unidentified: number;
  rows_invalid: number;
}

function loadOf(row: LoadRow | undefined): WellLoad | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    status: row.status,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    lastObjectId: Number(row.last_object_id),
    rowsSaved: row.rows_saved,
    rowsUnidentified: row.rows_unidentified,
    rowsInvalid: row.rows_invalid,
  };
}

async function asJob<T>(
  sql: postgres.Sql,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('statement_timeout', '30s', true),
                    set_config('petro.job', 'wells', true)`;
    return fn(tx);
  })) as T;
}

const LOAD_COLUMNS =
  'id, status, started_at, finished_at, last_object_id, rows_saved, rows_unidentified, rows_invalid';

export function wellsQueries(sql: postgres.Sql): WellsDatabase {
  return {
    async databaseSize() {
      const [row] = await sql<{ size: string }[]>`
        select pg_database_size(current_database())::text as size`;
      return Number(row?.size ?? NaN);
    },

    latestWellLoad() {
      return asJob(sql, async (tx) => {
        const [row] = await tx<LoadRow[]>`
          select ${tx.unsafe(LOAD_COLUMNS)} from petro.well_loads order by id desc limit 1`;
        return loadOf(row);
      });
    },

    lastDoneWellLoad() {
      return asJob(sql, async (tx) => {
        const [row] = await tx<LoadRow[]>`
          select ${tx.unsafe(LOAD_COLUMNS)} from petro.well_loads
          where status = 'done' order by id desc limit 1`;
        return loadOf(row);
      });
    },

    startWellLoad() {
      return asJob(sql, async (tx) => {
        const [row] = await tx<LoadRow[]>`
          insert into petro.well_loads (status) values ('running')
          on conflict do nothing
          returning ${tx.unsafe(LOAD_COLUMNS)}`;
        return loadOf(row);
      });
    },

    saveWellPage(loadId, fromObjectId, page, ending) {
      return asJob(sql, async (tx) => {
        // The load row is locked for the whole page: one run at a time moves it (D1-03).
        const [load] = await tx<{ status: string; last_object_id: string }[]>`
          select status, last_object_id from petro.well_loads where id = ${loadId} for update`;
        if (load?.status !== 'running' || Number(load.last_object_id) !== fromObjectId) {
          return 'moved';
        }
        const rows = page.rows.map((r) => ({
          uwi: r.uwi,
          source_object_id: r.objectId,
          well_name: r.wellName,
          operator_code: r.operatorCode,
          operator_name: r.operatorName,
          well_type: r.wellType,
          status_code: r.statusCode,
          status: r.status,
          final_drill_date: r.finalDrillDate,
          longitude: r.longitude,
          latitude: r.latitude,
          invalid: r.invalid,
        }));
        if (rows.length > 0) {
          const data = tx.json(rows);
          // Known wells: a field that failed its check keeps its stored value (D1-01).
          await tx`
            with x as (
              select * from jsonb_to_recordset(${data}::jsonb) as x(uwi text,
                source_object_id bigint, well_name text, operator_code text, operator_name text,
                well_type text, status_code text, status text, final_drill_date date,
                longitude numeric, latitude numeric, invalid jsonb)
            )
            update petro.wells w set
              source_object_id = x.source_object_id,
              well_name = case when x.invalid ? 'wellName' then w.well_name else x.well_name end,
              operator_code = case when x.invalid ? 'operatorCode' then w.operator_code
                                   else x.operator_code end,
              operator_name = case when x.invalid ? 'operatorName' then w.operator_name
                                   else x.operator_name end,
              well_type = case when x.invalid ? 'wellType' then w.well_type else x.well_type end,
              status_code = case when x.invalid ? 'statusCode' then w.status_code
                                 else x.status_code end,
              status = case when x.invalid ? 'status' then w.status else x.status end,
              final_drill_date = case when x.invalid ? 'finalDrillDate' then w.final_drill_date
                                      else x.final_drill_date end,
              longitude = case when x.invalid ? 'location' then w.longitude else x.longitude end,
              latitude = case when x.invalid ? 'location' then w.latitude else x.latitude end,
              load_id = ${loadId}, updated_at = now()
            from x where w.uwi = x.uwi`;
          // New wells: a field that failed its check is stored empty (a location, as none).
          await tx`
            insert into petro.wells (uwi, source_object_id, well_name, operator_code,
              operator_name, well_type, status_code, status, final_drill_date, longitude,
              latitude, load_id)
            select x.uwi, x.source_object_id, x.well_name, x.operator_code, x.operator_name,
              x.well_type, x.status_code, x.status, x.final_drill_date, x.longitude, x.latitude,
              ${loadId}
            from jsonb_to_recordset(${data}::jsonb) as x(uwi text, source_object_id bigint,
              well_name text, operator_code text, operator_name text, well_type text,
              status_code text, status text, final_drill_date date, longitude numeric,
              latitude numeric)
            on conflict (uwi) do nothing`;
        }
        const invalid = page.rows.filter((r) => r.invalid.length > 0).length;
        const last = page.lastObjectId ?? fromObjectId;
        const finished = ending !== null;
        const complete = ending === 'complete';
        await tx`
          update petro.well_loads set
            last_object_id = ${last},
            rows_saved = rows_saved + ${page.rows.length},
            rows_unidentified = rows_unidentified + ${page.unidentified},
            rows_invalid = rows_invalid + ${invalid},
            status = case when ${finished}::boolean
                          then case when rows_unidentified + ${page.unidentified} = 0
                                         and ${complete}::boolean
                                    then 'done' else 'done_unclean' end
                          else status end,
            finished_at = case when ${finished}::boolean then now() else null end
          where id = ${loadId}`;
        return 'saved';
      });
    },

    stopWellLoad(loadId, status) {
      return asJob(sql, async (tx) => {
        const updated = await tx`
          update petro.well_loads set status = ${status}, finished_at = now()
          where id = ${loadId} and status = 'running'`;
        return updated.count === 1 ? 'saved' : 'moved';
      });
    },

    wellsStatus(ctx) {
      return sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '10s', true),
                        set_config('petro.user_id', ${ctx.userId}, true),
                        set_config('petro.organization_id', ${ctx.organizationId}, true),
                        set_config('petro.member_role', ${ctx.role}, true),
                        set_config('petro.request_id', ${ctx.requestId}, true)`;
        const [load] = await tx<LoadRow[]>`
          select ${tx.unsafe(LOAD_COLUMNS)} from petro.well_loads order by id desc limit 1`;
        const [count] = await tx<{ n: string }[]>`
          select count(*)::text as n from petro.current_wells`;
        return { load: loadOf(load), current: Number(count?.n ?? 0) };
      });
    },
  };
}
