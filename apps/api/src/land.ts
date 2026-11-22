import { LAND_RIGHTS, LAND_SOURCE_NAME, rightsZones } from '@grain/domain';

import { LAND_KINDS, type LandKind, type LandRows } from './land-db';

/**
 * Land held today on the oil and gas map (F-241; docs/FEATURES_OIL_GAS.md): Crown agreements,
 * active offset notices and land whose petroleum and natural gas is not the Crown's, from the
 * Government of Alberta's public map services (docs/DECISIONS.md, 2026-11-21). The department
 * is named with every answer, as the Open Government Licence - Alberta asks.
 */

/**
 * The oil and gas schema version the land needs: the order of formations is read from the
 * zones of the sale parcels too (20261127010000_petro_land_sales.sql).
 */
export const LAND_SCHEMA_VERSION = 10;

/**
 * At most this many shapes of each kind per answer; a view holding more is drawn from the
 * first ones, and the page says to zoom in. The agreements' limit holds every agreement with
 * one play's rights at once (6,012 for the Duvernay, 2026-11-21), which the page asks for whole
 * and keeps (F-263).
 */
export const LAND_MAX: Record<LandKind, number> = {
  agreements: 20_000,
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

/**
 * The play the rights must include (`rights=duvernay`); null when none is asked for; a
 * sentence saying what is wrong otherwise.
 */
export function parseLandRights(raw: string | undefined): { play: string | null } | string {
  const key = raw?.trim() ?? '';
  if (key === '') return { play: null };
  return Object.hasOwn(LAND_RIGHTS, key)
    ? { play: key }
    : `rights must be one of: ${Object.keys(LAND_RIGHTS).join(', ')}.`;
}

/**
 * The zones that include each play's rights, kept between requests: they change only when the
 * land or the land sales are loaded again, and reading every zone and ordering the formations
 * takes a moment otherwise. Held by this Worker instance only.
 */
const zonesKept = new Map<string, { stamp: string; zones: string[] }>();

/**
 * The zones including a play's rights, of every zone the loads hold (rightsZones: the order of
 * formations is read from those same zones), as the hashes the database gave them: a zone can
 * be a thousand characters, and thousands are kept. Null when no play is asked for.
 */
export async function landRightsZones(
  play: string | null,
  read: {
    stamp: () => Promise<string>;
    zones: () => Promise<{ zone: string; hash: string }[]>;
  },
): Promise<string[] | null> {
  if (play === null) return null;
  const stamp = await read.stamp();
  const kept = zonesKept.get(play);
  if (kept?.stamp === stamp) return kept.zones;
  const hashOf = new Map((await read.zones()).map((z) => [z.zone, z.hash]));
  const zones = rightsZones([...hashOf.keys()], play).flatMap((zone) => hashOf.get(zone) ?? []);
  zonesKept.set(play, { stamp, zones });
  return zones;
}

/** For tests: forget the zones kept. */
export function clearLandRightsZones() {
  zonesKept.clear();
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
