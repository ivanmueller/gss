import { describe, expect, it } from 'vitest';

import type { Grain } from '../data/grains';
import { fold, formatCheckedDate, grainForCommodity, searchGrains, sourcesOf } from './grains';

// Made-up grains, so the search is tested apart from the reference's data.
const SPELT: Grain = {
  id: 'spelt',
  name: 'Spelt',
  symbol: 'Sp',
  number: 1,
  family: 'wheat',
  otherNames: ['Dinkel'],
  commodities: ['spring_wheat'],
  facts: [{ label: 'Test weight', value: '40', source: 'cgc-oggg', where: 'Chapter 99' }],
  classes: [
    {
      name: 'Spelt, Canada Western Example',
      abbreviation: 'CWEX',
      region: 'Western',
      varieties: ['AAC Synthetic', 'CDC Pretend', 'Église'],
      varietiesCitation: { source: 'cgc-variety-lists', where: 'Order 0000-00' },
    },
  ],
  tables: [
    {
      title: 'Trials',
      columns: ['Variety', 'Protein (%)'],
      rows: [
        ['Trial Only One', '12'],
        ['CDC Pretend', '13'],
      ],
      source: 'asg-rvt-2026',
      where: 'Spelt',
    },
  ],
};
const MILLET: Grain = {
  id: 'millet',
  name: 'Millet',
  symbol: 'Mi',
  number: 2,
  family: 'special',
  commodities: [],
  facts: [],
  classes: [],
  tables: [],
};
const GRAINS = [SPELT, MILLET];

describe('fold', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(fold('  Église   DU  Blé ')).toBe('eglise du ble');
  });
});

describe('searchGrains', () => {
  it('finds nothing for an empty search', () => {
    expect(searchGrains('  ', GRAINS)).toEqual([]);
  });

  it('finds a grain by its name or another name', () => {
    expect(searchGrains('mill', GRAINS).map((match) => match.name)).toEqual(['Millet']);
    expect(searchGrains('dinkel', GRAINS)[0]).toMatchObject({ name: 'Spelt' });
  });

  it('finds a class by its abbreviation', () => {
    expect(searchGrains('cwex', GRAINS)).toEqual([
      { grain: SPELT, name: 'Spelt, Canada Western Example (CWEX)', detail: 'Class' },
    ]);
  });

  it('finds a variety with every word typed, in any case and without accents', () => {
    const [match] = searchGrains('pretend cdc', GRAINS);
    expect(match).toMatchObject({
      name: 'CDC Pretend',
      detail: 'Variety · Spelt, Canada Western Example (CWEX)',
    });
    expect(searchGrains('eglise', GRAINS)[0]).toMatchObject({ name: 'Église' });
  });

  it('lists a variety once, and finds one only in a trial table', () => {
    expect(searchGrains('pretend', GRAINS)).toHaveLength(1);
    expect(searchGrains('trial only', GRAINS)).toEqual([
      { grain: SPELT, name: 'Trial Only One', detail: 'Variety' },
    ]);
  });

  it('lists grains first, then classes, then varieties, up to the limit', () => {
    const names = searchGrains('s', GRAINS).map((match) => match.detail ?? 'grain');
    expect(names[0]).toBe('grain');
    expect(searchGrains('a', GRAINS, 2)).toHaveLength(2);
  });
});

describe('grainForCommodity', () => {
  it('finds the grain a commodity belongs to', () => {
    expect(grainForCommodity('spring_wheat', GRAINS)?.id).toBe('spelt');
    expect(grainForCommodity('lentils_unknown', GRAINS)).toBeUndefined();
  });
});

describe('sourcesOf', () => {
  it('lists each source a grain cites once, in the order first cited', () => {
    expect(sourcesOf(SPELT)).toEqual(['cgc-oggg', 'cgc-variety-lists', 'asg-rvt-2026']);
  });
});

describe('formatCheckedDate', () => {
  it('writes a calendar date in words, without shifting it', () => {
    expect(formatCheckedDate('2026-11-05')).toBe('November 5, 2026');
    expect(formatCheckedDate('2026-01-31')).toBe('January 31, 2026');
    expect(formatCheckedDate('not a date')).toBe('not a date');
  });
});
