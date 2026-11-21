import { LAND_SOURCE_NAME } from '@grain/domain';

import { LAND_KINDS, type LandKind, type LandRows } from './land-db';

/**
 * Land held today on the oil and gas map (F-241; docs/FEATURES_OIL_GAS.md): Crown agreements,
 * active offset notices and land whose petroleum and natural gas is not the Crown's, from the
 * Government of Alberta's public map services (docs/DECISIONS.md, 2026-11-21). The department
 * is named with every answer, as the Open Government Licence - Alberta asks.
 */

/** The oil and gas schema version the land needs (20261126010000_petro_land.sql). */
export const LAND_SCHEMA_VERSION = 9;

/**
 * At most this many shapes of each kind per answer; a view holding more is drawn from the
 * first ones, and the page says to zoom in.
 */
export const LAND_MAX: Record<LandKind, number> = {
  agreements: 6000,
  offsets: 1000,
  freehold: 10_000,
};

/** The kinds asked for in `layers` (comma separated), or a sentence saying what is wrong. */
export function parseLandKinds(raw: string | undefined): LandKind[] | string {
  const asked = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const kinds = LAND_KINDS.filter((kind) => asked.includes(kind));
  if (kinds.length === 0 || kinds.length !== new Set(asked).size) {
    return `layers must name one or more of: ${LAND_KINDS.join(', ')}.`;
  }
  return kinds;
}

/** The limits of a request: the kinds asked for at their most, the others at none. */
export function landLimits(kinds: readonly LandKind[]): Record<LandKind, number> {
  return {
    agreements: kinds.includes('agreements') ? LAND_MAX.agreements : 0,
    offsets: kinds.includes('offsets') ? LAND_MAX.offsets : 0,
    freehold: kinds.includes('freehold') ? LAND_MAX.freehold : 0,
  };
}

function cut<T>(rows: T[], max: number) {
  const truncated = rows.length > max;
  return { truncated, items: truncated ? rows.slice(0, max) : rows };
}

export function landAnswer(rows: LandRows) {
  return {
    source: { name: LAND_SOURCE_NAME, loads: rows.loads },
    agreements: cut(rows.agreements, LAND_MAX.agreements),
    offsets: cut(rows.offsets, LAND_MAX.offsets),
    freehold: cut(rows.freehold, LAND_MAX.freehold),
  };
}
