import { describe, expect, it } from 'vitest';

import type { Grain, GrainClass } from '../data/grains';
import { grainVarieties, MIN_SHARE, shownClasses, varietyName } from './grainWindow';

// Made-up grains and acres, so the rules are tested apart from the real figures.
const wheatClass = (abbreviation: string, varieties: string[] = []): GrainClass => ({
  name: `Wheat, Canada Western ${abbreviation}`,
  abbreviation,
  region: 'Western',
  varieties,
});
const WHEAT: Grain = {
  id: 'wheat',
  name: 'Wheat',
  symbol: 'Wh',
  number: 1,
  family: 'wheat',
  commodities: [],
  facts: [],
  classes: [
    wheatClass('CWRS', ['AAC Synthetic', 'CDC Pretend']),
    wheatClass('CPSR', ['AAC Redsample']),
    wheatClass('CPSW', ['AAC Whitesample']),
    wheatClass('CWES'),
    { name: 'Wheat, Canada Eastern Red Spring', abbreviation: 'CERS', region: 'Eastern' },
  ],
  tables: [],
};
const ACRES = {
  wheat: {
    CWRS: {
      acres: 1000,
      varieties: [
        ['CDC PRETEND', 300],
        ['AAC SYNTHETIC', 600],
      ] as [string, number][],
    },
    CPS: {
      acres: 200,
      varieties: [
        ['AAC REDSAMPLE', 150],
        ['AAC WHITESAMPLE', 50],
      ] as [string, number][],
    },
    CWES: { acres: 1, varieties: [['ODD ONE', 1]] as [string, number][] },
    'UNKNOWN CLASS': { acres: 5000, varieties: [] as [string, number][] },
  },
  lentils: {
    LENTIL: {
      acres: 100,
      varieties: [
        ['CDC SAMPLEROUND', 60],
        ['DK12-34', 40],
      ] as [string, number][],
    },
  },
};

describe('shownClasses', () => {
  it('lists the classes grown, most acres first, CPS split red and white', () => {
    const shown = shownClasses(WHEAT, ACRES);
    expect(shown.map((entry) => [entry.grainClass.abbreviation, entry.acres])).toEqual([
      ['CWRS', 1000],
      ['CPSR', 150],
      ['CPSW', 50],
    ]);
    expect(shown[0]?.varieties).toEqual(['AAC Synthetic', 'CDC Pretend']);
  });

  it(`leaves out classes under ${String(MIN_SHARE * 100)}% of the acres, and Eastern ones`, () => {
    const names = shownClasses(WHEAT, ACRES).map((entry) => entry.grainClass.abbreviation);
    expect(names).not.toContain('CWES');
    expect(names).not.toContain('CERS');
  });

  it('shows a grain without acres by class with its Western classes and no varieties', () => {
    const lentils: Grain = {
      ...WHEAT,
      id: 'lentils',
      classes: [
        { name: 'Lentils, Canada, Red' },
        { name: 'Lentils, Canada Eastern', region: 'Eastern' },
      ],
    };
    expect(shownClasses(lentils, ACRES)).toEqual([
      { grainClass: { name: 'Lentils, Canada, Red' }, varieties: [] },
    ]);
    expect(grainVarieties(lentils, ACRES)).toEqual(['CDC Sampleround', 'DK12-34']);
    expect(grainVarieties(WHEAT, ACRES)).toEqual([]);
  });
});

describe('varietyName', () => {
  it('spells a variety as the guide does, or capitalizes long words and keeps codes', () => {
    expect(varietyName('AAC SYNTHETIC', WHEAT)).toBe('AAC Synthetic');
    expect(varietyName('SNOWBIRD', WHEAT)).toBe('Snowbird');
    expect(varietyName('CDC LEADER', WHEAT)).toBe('CDC Leader');
    expect(varietyName('DKC31-85RIB', WHEAT)).toBe('DKC31-85RIB');
  });
});
