import { FORMATION_LAT_STEP, FORMATION_LON_STEP } from '@grain/domain';
import type postgres from 'postgres';

import type { FormationCellRow } from './formation-db';
import type { PetroleumContext } from './petroleum-db';

/**
 * Geology around one well (F-287 part 2; 20261209010000_petro_geology.sql): the Alberta
 * Geological Survey's formation tops picked in wells and its Rock-Eval samples, kept by the
 * "Load geology" workflow, with the well's legs and the model's layers under them
 * (petro.formation_cells, F-261). Members only read.
 */

/** How far around the well the picked wells and samples are looked for, in kilometres. */
export const GEOLOGY_PICKS_KM = 5;
export const GEOLOGY_SAMPLES_KM = 50;

export interface GeologyWellRow {
  uwi: string;
  licenceNumber: string;
  formation: string | null;
  surface: [number, number];
  bottom: [number, number];
  groundElevationM: number | null;
}

export interface GeologyLegRow {
  uwi: string;
  kbElevationM: number | null;
  /** [longitude, latitude, metres above sea level], from the surface down; null when not drilled. */
  points: [number, number, number][] | null;
}

export interface PickedWellRow {
  uwi: string;
  licenceNumber: string;
  longitude: number;
  latitude: number;
  kbElevationM: number | null;
  names: number[];
  tvdM: number[];
  sources: number[];
}

export interface PickNameRow {
  id: number;
  name: string;
  surface: string;
}

export interface SampleRow {
  sampleId: number;
  run: number;
  uwi: string | null;
  site: 'well' | 'outcrop';
  longitude: number;
  latitude: number;
  topDepthM: string | null;
  unit: string | null;
  lithology: string | null;
  collectedOn: string | null;
  /** Decimal text, as stored. */
  tmaxC: string | null;
  s2: string | null;
  tocPct: string | null;
  hydrogenIndex: string | null;
}

export interface GeologyLoad {
  loadedAt: string;
  sourceDate: string | null;
}

export interface GeologyOfWell {
  well: GeologyWellRow | null;
  legs: GeologyLegRow[];
  picked: PickedWellRow[];
  names: PickNameRow[];
  samples: SampleRow[];
  cells: FormationCellRow[];
  loads: { picks: GeologyLoad | null; samples: GeologyLoad | null; model: GeologyLoad | null };
}

export interface PlaySamples {
  samples: SampleRow[];
  load: GeologyLoad | null;
}

export interface GeologyDatabase {
  /** Members: what the panel's Geology section needs for one well. */
  geologyOfWell(ctx: PetroleumContext, uwi: string): Promise<GeologyOfWell>;
  /**
   * Members: every sample of a play's units, as the samples' file names them (F-287 part 4,
   * the Maturity map). A few hundred at most.
   */
  playSamples(ctx: PetroleumContext, units: readonly string[]): Promise<PlaySamples>;
}

interface SampleDbRow {
  sample_id: number;
  run: number;
  uwi: string | null;
  site: 'well' | 'outcrop';
  longitude: string;
  latitude: string;
  top_depth_m: string | null;
  unit: string | null;
  lithology: string | null;
  collected_on: string | null;
  tmax_c: string | null;
  s2: string | null;
  toc_pct: string | null;
  hydrogen_index: string | null;
}

function sampleOf(r: SampleDbRow): SampleRow {
  return {
    sampleId: r.sample_id,
    run: r.run,
    uwi: r.uwi,
    site: r.site,
    longitude: Number(r.longitude),
    latitude: Number(r.latitude),
    topDepthM: r.top_depth_m,
    unit: r.unit,
    lithology: r.lithology,
    collectedOn: r.collected_on,
    tmaxC: r.tmax_c,
    s2: r.s2,
    tocPct: r.toc_pct,
    hydrogenIndex: r.hydrogen_index,
  };
}

/** The member's settings for the policies, inside a transaction. */
async function asMember(tx: postgres.TransactionSql, ctx: PetroleumContext) {
  await tx`select set_config('statement_timeout', '15s', true),
                  set_config('petro.user_id', ${ctx.userId}, true),
                  set_config('petro.organization_id', ${ctx.organizationId}, true),
                  set_config('petro.member_role', ${ctx.role}, true),
                  set_config('petro.request_id', ${ctx.requestId}, true)`;
}

const num = (v: string | number | null) => (v === null ? null : Number(v));

/**
 * A list as a Postgres array literal, cast in the query: this connection does not send lists as
 * arrays. Only numbers and UWIs go in (checked forms, no quote or brace).
 */
export function pgArray(values: readonly (number | string)[]): string {
  return `{${values.map((v) => (typeof v === 'number' ? String(v) : `"${v}"`)).join(',')}}`;
}

/** Degrees of latitude and longitude that reach `km` at this latitude. */
export function reachDegrees(lat: number, km: number) {
  return { dlat: km / 110.574, dlon: km / (111.32 * Math.cos((lat * Math.PI) / 180)) };
}

export function geologyQueries(sql: postgres.Sql): GeologyDatabase {
  return {
    geologyOfWell(ctx, uwi) {
      return sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '15s', true),
                        set_config('petro.user_id', ${ctx.userId}, true),
                        set_config('petro.organization_id', ${ctx.organizationId}, true),
                        set_config('petro.member_role', ${ctx.role}, true),
                        set_config('petro.request_id', ${ctx.requestId}, true)`;
        const loadRows = await tx<{ kind: string; loaded_at: Date; source_date: string | null }[]>`
          select distinct on (kind) kind, loaded_at, to_char(source_date, 'YYYY-MM-DD') as source_date
          from petro.geology_loads order by kind, id desc`;
        const [model] = await tx<{ loaded_at: Date; source_date: string | null }[]>`
          select loaded_at, source_date::text as source_date
          from petro.formation_loads order by id desc limit 1`;
        const load = (kind: string) => {
          const row = loadRows.find((r) => r.kind === kind);
          return row
            ? { loadedAt: row.loaded_at.toISOString(), sourceDate: row.source_date }
            : null;
        };
        const loads = {
          picks: load('picks'),
          samples: load('samples'),
          model: model
            ? { loadedAt: model.loaded_at.toISOString(), sourceDate: model.source_date }
            : null,
        };
        const empty = {
          well: null,
          legs: [],
          picked: [],
          names: [],
          samples: [],
          cells: [],
          loads,
        };

        const [w] = await tx<
          {
            uwi: string;
            licence_number: string;
            formation: string | null;
            surface_longitude: string;
            surface_latitude: string;
            bottom_longitude: string;
            bottom_latitude: string;
            ground_elevation_m: string | null;
          }[]
        >`
          select uwi, licence_number, formation, surface_longitude, surface_latitude,
                 bottom_longitude, bottom_latitude, ground_elevation_m
          from petro.st37_wells where uwi = ${uwi}`;
        if (!w) return empty;
        const well: GeologyWellRow = {
          uwi: w.uwi,
          licenceNumber: w.licence_number,
          formation: w.formation,
          surface: [Number(w.surface_longitude), Number(w.surface_latitude)],
          bottom: [Number(w.bottom_longitude), Number(w.bottom_latitude)],
          groundElevationM: num(w.ground_elevation_m),
        };

        const legRows = await tx<
          {
            uwi: string;
            kb_elevation_m: string | null;
            path_3d: [number, number, number][] | null;
          }[]
        >`
          select uwi, kb_elevation_m, path_3d from petro.st37_wells
          where licence_number = ${well.licenceNumber} order by uwi`;
        const legs = legRows.map((r) => ({
          uwi: r.uwi,
          kbElevationM: num(r.kb_elevation_m),
          points: r.path_3d,
        }));

        // The picked wells under this licence, and those in a box around the well's two ends.
        const lat = (well.surface[1] + well.bottom[1]) / 2;
        const lon = (well.surface[0] + well.bottom[0]) / 2;
        const p = reachDegrees(lat, GEOLOGY_PICKS_KM);
        const west = Math.min(well.surface[0], well.bottom[0]) - p.dlon;
        const east = Math.max(well.surface[0], well.bottom[0]) + p.dlon;
        const south = Math.min(well.surface[1], well.bottom[1]) - p.dlat;
        const north = Math.max(well.surface[1], well.bottom[1]) + p.dlat;
        const pickedRows = await tx<
          {
            uwi: string;
            licence_number: string;
            longitude: string;
            latitude: string;
            kb_elevation_m: string | null;
            names: number[];
            tvd_m: number[];
            sources: number[];
          }[]
        >`
          -- As JSON: this connection does not read Postgres arrays into lists.
          select uwi, licence_number, longitude, latitude, kb_elevation_m, to_jsonb(names) as names,
                 to_jsonb(tvd_m::float8[]) as tvd_m, to_jsonb(sources) as sources
          from petro.formation_pick_wells
          where licence_number = ${well.licenceNumber}
             or (latitude between ${south} and ${north} and longitude between ${west} and ${east})`;
        const picked = pickedRows.map((r) => ({
          uwi: r.uwi,
          licenceNumber: r.licence_number,
          longitude: Number(r.longitude),
          latitude: Number(r.latitude),
          kbElevationM: num(r.kb_elevation_m),
          names: r.names,
          tvdM: r.tvd_m,
          sources: r.sources,
        }));
        const ids = [...new Set(picked.flatMap((r) => r.names))];
        const names =
          ids.length === 0
            ? []
            : await tx<PickNameRow[]>`
                select id, name, surface from petro.formation_pick_names where id = any(${pgArray(ids)}::smallint[])`;

        const s = reachDegrees(lat, GEOLOGY_SAMPLES_KM);
        const legUwis = legs.map((l) => l.uwi);
        const sampleRows = await tx<SampleDbRow[]>`
          select sample_id, run, uwi, site, longitude, latitude, top_depth_m::text as top_depth_m,
                 unit, lithology, to_char(collected_on, 'YYYY-MM-DD') as collected_on,
                 tmax_c::text as tmax_c, s2::text as s2, toc_pct::text as toc_pct,
                 hydrogen_index::text as hydrogen_index
          from petro.maturity_samples
          where uwi = any(${pgArray(legUwis)}::text[])
             or (latitude between ${lat - s.dlat} and ${lat + s.dlat}
                 and longitude between ${lon - s.dlon} and ${lon + s.dlon})`;
        const samples = sampleRows.map(sampleOf);

        // The model's cells under the legs (and the well's two ends): a few kilometres at most.
        const lons = [well.surface[0], well.bottom[0]];
        const lats = [well.surface[1], well.bottom[1]];
        for (const leg of legs) {
          for (const [x, y] of leg.points ?? []) {
            lons.push(x);
            lats.push(y);
          }
        }
        const cellRows = await tx<
          { cell_x: number; cell_y: number; tops: (number | null)[]; bases: (number | null)[] }[]
        >`
          select cell_x, cell_y, to_jsonb(tops) as tops, to_jsonb(bases) as bases
          from petro.formation_cells
          where cell_x between ${Math.round(Math.min(...lons) / FORMATION_LON_STEP) - 1}
                          and ${Math.round(Math.max(...lons) / FORMATION_LON_STEP) + 1}
            and cell_y between ${Math.round(Math.min(...lats) / FORMATION_LAT_STEP) - 1}
                          and ${Math.round(Math.max(...lats) / FORMATION_LAT_STEP) + 1}
          limit 400`;
        const cells = cellRows.map((c) => ({
          x: c.cell_x,
          y: c.cell_y,
          tops: c.tops,
          bases: c.bases,
        }));
        return { well, legs, picked, names, samples, cells, loads };
      });
    },
    playSamples(ctx, units) {
      return sql.begin(async (tx) => {
        await asMember(tx, ctx);
        const [load] = await tx<{ loaded_at: Date; source_date: string | null }[]>`
          select loaded_at, to_char(source_date, 'YYYY-MM-DD') as source_date
          from petro.geology_loads where kind = 'samples' order by id desc limit 1`;
        // Units as the file names them, any case; the names are the code's own (PLAY_SAMPLE_UNITS).
        const names = units.map((u) => u.trim().toLowerCase());
        const rows = await tx<SampleDbRow[]>`
          select sample_id, run, uwi, site, longitude, latitude, top_depth_m::text as top_depth_m,
                 unit, lithology, to_char(collected_on, 'YYYY-MM-DD') as collected_on,
                 tmax_c::text as tmax_c, s2::text as s2, toc_pct::text as toc_pct,
                 hydrogen_index::text as hydrogen_index
          from petro.maturity_samples
          where lower(btrim(unit)) = any(${pgArray(names)}::text[])
          order by sample_id, run
          limit 2000`;
        return {
          samples: rows.map(sampleOf),
          load: load
            ? { loadedAt: load.loaded_at.toISOString(), sourceDate: load.source_date }
            : null,
        };
      });
    },
  };
}
