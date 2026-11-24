/**
 * Geology on a well's panel (F-287; docs/FEATURES_OIL_GAS.md): the maturity read from the
 * Alberta Geological Survey's Rock-Eval samples, and where a well's legs lie in its play's zone.
 *
 * Maturity. The Survey publishes no maturity map as data, only measured samples (Digital Dataset
 * 2013-0003). Each sample's Tmax gives a vitrinite reflectance by the formula the Survey's own
 * metadata states, Ro = 0.018 × Tmax − 7.16 (per cent; Jarvie and others), and that reflectance
 * a window by the thresholds commonly used for shale plays: under 0.6% immature, 0.6 to 1.0% oil,
 * 1.0 to 1.4% wet gas and condensate, 1.4% and over dry gas. A Tmax read from a small S2 peak
 * (under 0.2 mg/g of rock) is not reliable (Peters, 1986) and gives no window. The thresholds are
 * a convention, recorded in docs/DECISIONS.md (2026-11-24), not the Survey's.
 */

export type MaturityWindow = 'immature' | 'oil' | 'condensate' | 'dry-gas';

export const MATURITY_WINDOW_LABELS: Record<MaturityWindow, string> = {
  immature: 'Immature',
  oil: 'Oil window',
  condensate: 'Wet gas and condensate',
  'dry-gas': 'Dry gas',
};

/** Reflectance (Ro %) at which each window begins, after immature. */
export const MATURITY_RO_EDGES = { oil: 0.6, condensate: 1.0, dryGas: 1.4 } as const;

/** The smallest S2 (mg/g of rock) whose Tmax is read. */
export const MATURITY_MIN_S2 = 0.2;

/** The Survey's play units for its samples, by play: the names the samples' file uses. */
export const PLAY_SAMPLE_UNITS: Record<string, readonly string[]> = {
  duvernay: ['Duvernay', 'Muskwa'],
};

/** Ro (%) from Tmax (°C), to two decimals; null for no Tmax. */
export function roFromTmax(tmax: number | null): number | null {
  if (tmax === null || !Number.isFinite(tmax)) return null;
  return Math.round((0.018 * tmax - 7.16) * 100) / 100;
}

export function maturityWindow(ro: number): MaturityWindow {
  if (ro < MATURITY_RO_EDGES.oil) return 'immature';
  if (ro < MATURITY_RO_EDGES.condensate) return 'oil';
  if (ro < MATURITY_RO_EDGES.dryGas) return 'condensate';
  return 'dry-gas';
}

export interface SampleMaturity {
  /** Ro (%) from the sample's Tmax; null without a Tmax. */
  ro: number | null;
  /** Null without a Tmax, or when its S2 is too small for the Tmax to be read. */
  window: MaturityWindow | null;
  /** Why no window: no Tmax, or a small S2. */
  note: 'no-tmax' | 'small-s2' | null;
}

/** A sample's maturity, from its Tmax and S2 as stored (decimal text, or null). */
export function sampleMaturity(tmax: string | null, s2: string | null): SampleMaturity {
  const t = tmax === null ? null : Number(tmax);
  const ro = roFromTmax(t);
  if (ro === null) return { ro: null, window: null, note: 'no-tmax' };
  const peak = s2 === null ? null : Number(s2);
  if (peak === null || !Number.isFinite(peak) || peak < MATURITY_MIN_S2) {
    return { ro, window: null, note: 'small-s2' };
  }
  return { ro, window: maturityWindow(ro), note: null };
}

/** Whether a sample's unit (as the samples' file names it) belongs to a play. */
export function sampleInPlay(unit: string | null, play: string): boolean {
  const units = PLAY_SAMPLE_UNITS[play];
  if (!units || unit === null) return false;
  const u = unit.trim().toLowerCase();
  return units.some((name) => name.toLowerCase() === u);
}

/**
 * Where a point of a leg lies against a zone, all in metres above sea level: how far under the
 * zone's top and over its base, and whether it is inside. Null when the zone is absent there.
 */
export function inZone(
  elevation: number,
  top: number | null,
  base: number | null,
): { belowTopM: number; aboveBaseM: number; inside: boolean } | null {
  if (top === null || base === null || !Number.isFinite(elevation)) return null;
  const belowTopM = Math.round(top - elevation);
  const aboveBaseM = Math.round(elevation - base);
  return { belowTopM, aboveBaseM, inside: belowTopM >= 0 && aboveBaseM >= 0 };
}
