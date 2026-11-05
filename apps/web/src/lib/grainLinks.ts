import type { CommodityCode } from '@grain/domain';

/**
 * The grain on the Grains page that each of GSS's commodities belongs to (its window,
 * /grains?grain=<id>). Kept apart from the grain data so a commodity badge links to it without
 * loading the whole reference; a test keeps the two in step.
 */
export const GRAIN_OF_COMMODITY: Record<CommodityCode, string> = {
  canola: 'canola',
  flaxseed: 'flaxseed',
  yellow_peas: 'peas',
  green_peas: 'peas',
  red_lentils: 'lentils',
  green_lentils: 'lentils',
  chickpeas: 'chickpeas',
  faba_beans: 'faba-beans',
  spring_wheat: 'wheat',
  durum_wheat: 'wheat',
  winter_wheat: 'wheat',
  feed_barley: 'barley',
  malt_barley: 'barley',
  oats: 'oats',
  rye: 'rye',
  corn: 'corn',
  soybeans: 'soybeans',
  mustard_seed: 'mustard',
  canary_seed: 'canary-seed',
  sunflower_seed: 'sunflower',
};

/** The address of a commodity's grain window, or undefined for a code not in the list. */
export function grainHref(code: string): string | undefined {
  const id = (GRAIN_OF_COMMODITY as Record<string, string | undefined>)[code];
  return id === undefined ? undefined : `/grains?grain=${id}`;
}
