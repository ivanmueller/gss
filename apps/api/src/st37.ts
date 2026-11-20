import { ST37_FORMATIONS, st37Zones } from '@grain/domain';

import type { St37Box, St37Load, St37WellRow } from './st37-db';

/**
 * The AER's ST37 wells on the oil and gas map (F-243 part 4; docs/FEATURES_OIL_GAS.md). Data
 * from the AER, used on the owner's decision (docs/DECISIONS.md, 2026-11-19): members only,
 * shown with its source, never offered as a download.
 */

/** The oil and gas schema version the ST37 wells need (20261123010000_petro_st37_formation.sql). */
export const ST37_SCHEMA_VERSION = 6;

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

export function st37Answer(load: St37Load | null, rows: St37WellRow[]) {
  const truncated = rows.length > ST37_MAX_WELLS;
  return {
    source: {
      name: ST37_SOURCE_NAME,
      loadedAt: load?.loadedAt ?? null,
      sourceDate: load?.sourceDate ?? null,
      area: load?.area ?? null,
      licenceSource: load?.formation ? ST37_LICENCE_SOURCE_NAME : null,
    },
    // The formation loaded whole, with its wells by status; null when the load was a rectangle.
    formation: load?.formation
      ? {
          key: load.formation,
          name: FORMATION_NAMES[load.formation] ?? load.formation,
          totals: load.totals,
          // Where its drilled wells cluster (F-255): computed here from the stored wells.
          zones: st37Zones(load.drilled ?? []),
        }
      : null,
    truncated,
    wells: truncated ? rows.slice(0, ST37_MAX_WELLS) : rows,
  };
}
