import type { ProductionLoad } from './production-db';

/**
 * Monthly production by well on the oil and gas map (F-252 step 3; docs/FEATURES_OIL_GAS.md).
 * Petrinex's public data, used on the owner's decision (docs/DECISIONS.md, 2026-11-20):
 * non-commercial, members only, shown with its source and Crown copyright, never offered as a
 * download.
 */

/**
 * The oil and gas schema version production needs: the injection beside it (F-300,
 * 20261212010000_petro_well_injection.sql).
 */
export const PRODUCTION_SCHEMA_VERSION = 25;

export const PRODUCTION_SOURCE_NAME =
  'Petrinex public data, Conventional Volumetric Data, © Government of Alberta';

/** The units of the volumes, as Petrinex's description of its file gives them. */
export const PRODUCTION_UNITS = {
  oil: 'm3',
  gas: 'e3m3',
  water: 'm3',
  condensate: 'm3',
  waterInjected: 'm3',
  gasInjected: 'e3m3',
} as const;

const UWI = /^[0-9A-Z]{2}\/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]\/[0-9A-Z]$/;

/** The UWI asked for, or a sentence saying what is wrong. */
export function parseUwi(raw: string | undefined): { uwi: string } | string {
  const uwi = raw?.trim() ?? '';
  return UWI.test(uwi) ? { uwi } : 'uwi must be a well identifier such as 00/11-23-030-27W4/2.';
}

/** The play asked for ("duvernay"), or a sentence saying what is wrong. */
export function parseFormation(raw: string | undefined): { formation: string } | string {
  const formation = raw?.trim() ?? '';
  return /^[a-z][a-z_]{1,39}$/.test(formation)
    ? { formation }
    : 'formation must be the key of a play, such as duvernay.';
}

export function productionAnswer<M>(load: ProductionLoad | null, months: M[]) {
  return {
    source: {
      name: PRODUCTION_SOURCE_NAME,
      loadedAt: load?.loadedAt ?? null,
      // The months the load asked for: a well's earlier production is not in the free files.
      firstMonth: load?.firstMonth ?? null,
      lastMonth: load?.lastMonth ?? null,
    },
    units: PRODUCTION_UNITS,
    months,
  };
}
