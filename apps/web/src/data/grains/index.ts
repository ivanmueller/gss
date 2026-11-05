// Every grain of the Grains reference, in the table's order. One file per grain; add a grain
// by adding its file and its line here.

import { barley } from './barley';
import { beans } from './beans';
import { buckwheat } from './buckwheat';
import { canarySeed } from './canary-seed';
import { canola } from './canola';
import { chickpeas } from './chickpeas';
import { corn } from './corn';
import { fabaBeans } from './faba-beans';
import { flaxseed } from './flaxseed';
import { lentils } from './lentils';
import { mustard } from './mustard';
import { oats } from './oats';
import { peas } from './peas';
import { rye } from './rye';
import { safflower } from './safflower';
import { soybeans } from './soybeans';
import { sunflower } from './sunflower';
import { triticale } from './triticale';
import type { Grain, GrainFamily } from './types';
import { wheat } from './wheat';

export const GRAINS: readonly Grain[] = [
  wheat,
  barley,
  rye,
  oats,
  triticale,
  corn,
  canola,
  flaxseed,
  soybeans,
  mustard,
  sunflower,
  safflower,
  peas,
  lentils,
  beans,
  fabaBeans,
  chickpeas,
  canarySeed,
  buckwheat,
].sort((a, b) => a.number - b.number);

/** The families in the table's order, with their names in words. */
export const GRAIN_FAMILIES: readonly { family: GrainFamily; label: string }[] = [
  { family: 'wheat', label: 'Wheat' },
  { family: 'coarse', label: 'Coarse grains' },
  { family: 'oilseed', label: 'Oilseeds' },
  { family: 'pulse', label: 'Pulses' },
  { family: 'special', label: 'Special crops' },
];

export function familyLabel(family: GrainFamily): string {
  return GRAIN_FAMILIES.find((entry) => entry.family === family)?.label ?? family;
}

export function grainById(id: string): Grain | undefined {
  return GRAINS.find((grain) => grain.id === id);
}

export type { Grain, GrainClass, GrainFact, GrainFamily, GrainTable } from './types';
export { GRAIN_SOURCES, type SourceId } from './sources';
