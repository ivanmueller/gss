import { ST37_FORMATIONS, st37Zones, type St37Zone, type ZoneWell } from '@grain/domain';

import type { St37Box, St37Load, St37WellRow } from './st37-db';

/**
 * The AER's ST37 wells on the oil and gas map (F-243 part 4; docs/FEATURES_OIL_GAS.md). Data
 * from the AER, used on the owner's decision (docs/DECISIONS.md, 2026-11-19): members only,
 * shown with its source, never offered as a download.
 */

/** The oil and gas schema version the ST37 wells need (20261125010000_petro_plays_fields_pools.sql). */
export const ST37_SCHEMA_VERSION = 8;

/** At most this many wells per answer; a view holding more is drawn from the first ones. */
export const ST37_MAX_WELLS = 20_000;

export const ST37_SOURCE_NAME = 'Alberta Energy Regulator, ST37 List of Wells in Alberta';
/** Named beside the AER when a formation was loaded: its licences come from Petrinex's file. */
export const ST37_LICENCE_SOURCE_NAME =
  'licence plans from Petrinex public data, © Government of Alberta';

/** The formations a load can hold whole, as the page names them. */
const FORMATION_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(ST37_FORMATIONS).map((f) => [f.key, f.name]),
);

/** The box from west, south, east and north; a sentence saying what is wrong otherwise. */
export function parseSt37Box(query: Record<string, string>): St37Box | string {
  const values: number[] = [];
  for (const key of ['west', 'south', 'east', 'north'] as const) {
    const raw = query[key];
    const n = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(n)) return 'west, south, east and north must be numbers.';
    values.push(n);
  }
  const [west, south, east, north] = values as [number, number, number, number];
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    return 'The box must run west to east and south to north, in degrees.';
  }
  return { west, south, east, north };
}

/**
 * The zones of each play's latest load, kept between requests (F-255): they change only when
 * the play is loaded again, and working them out takes a moment on every wells request
 * otherwise. Held by this Worker instance only; a new instance works them out once.
 */
const zonesKept = new Map<string, St37Zone[]>();

/** The zones of a load's play, from those kept or worked out from its drilled wells. */
export async function st37LoadZones(
  load: St37Load,
  drilled: (formation: string) => Promise<ZoneWell[]>,
): Promise<St37Zone[]> {
  if (!load.formation) return [];
  const key = `${load.formation}:${load.id}`;
  const kept = zonesKept.get(key);
  if (kept) return kept;
  const zones = st37Zones(await drilled(load.formation));
  // One entry a play: an earlier load's zones are let go.
  for (const k of zonesKept.keys()) {
    if (k.startsWith(`${load.formation}:`)) zonesKept.delete(k);
  }
  zonesKept.set(key, zones);
  return zones;
}

/** For tests: forget the zones kept. */
export function clearSt37Zones() {
  zonesKept.clear();
}

export function st37Answer(
  loads: readonly St37Load[],
  zones: ReadonlyMap<string, St37Zone[]>,
  rows: St37WellRow[],
) {
  const truncated = rows.length > ST37_MAX_WELLS;
  // The newest load of all: its date and source describe the copy.
  const [latest] = loads;
  return {
    source: {
      name: ST37_SOURCE_NAME,
      loadedAt: latest?.loadedAt ?? null,
      sourceDate: latest?.sourceDate ?? null,
      // The rectangle loaded, when there is one beside the plays.
      area: loads.find((load) => load.formation === null)?.area ?? null,
      licenceSource: loads.some((load) => load.formation) ? ST37_LICENCE_SOURCE_NAME : null,
    },
    // Each play loaded whole, with where it lies, its wells by status and its zones.
    formations: loads.flatMap((load) =>
      load.formation
        ? [
            {
              key: load.formation,
              name: FORMATION_NAMES[load.formation] ?? load.formation,
              area: load.area,
              loadedAt: load.loadedAt,
              totals: load.totals,
              zones: zones.get(load.formation) ?? [],
            },
          ]
        : [],
    ),
    truncated,
    wells: truncated ? rows.slice(0, ST37_MAX_WELLS) : rows,
  };
}
