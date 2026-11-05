import { describe, expect, it } from 'vitest';

import type { Grain, GrainClass, GrainTable } from '../data/grains';
import { classLabel, classMoisture, classSlug, onSpec } from './grainClasses';

// Made-up grains, so the rules are tested apart from the reference's data.
const QUALITY: GrainTable = {
  title: 'Standard of quality',
  columns: ['Grading factor', 'No. 1 CWXX', 'No. 2 CWXX', 'CW Feed'],
  rows: [
    ['Degree of soundness', 'Fairly well matured', 'Reasonably well matured', 'Any'],
    ['Minimum test weight kg/hL (g/0.5 L)', '75 (365)', '72 (350)', '65 (315)'],
    ['Minimum protein %', '10.0', 'No minimum', 'No minimum'],
  ],
  source: 'cgc-oggg',
  where: 'Chapter 99',
};
const RED: GrainClass = {
  name: 'Spelt, Canada Western Example Red',
  abbreviation: 'CWXX',
  region: 'Western',
  grades: ['No. 1 CWXX', 'No. 2 CWXX', 'CW Feed'],
  gradesCitation: { source: 'cgc-oggg', where: 'Chapter 99' },
  tables: [QUALITY],
};
const HULLESS: GrainClass = {
  name: 'Spelt, Canada Eastern Malting, Two-row Hulless',
  abbreviation: 'CE',
  region: 'Eastern',
  grades: ['Select Malting CE Two-row Hulless'],
};
const MALTING: GrainClass = {
  name: 'Spelt, Canada Eastern Malting, Two-row',
  abbreviation: 'CE',
  region: 'Eastern',
  grades: ['Select Malting CE Two-row'],
};
function spelt(classes: GrainClass[], rows: string[][]): Grain {
  return {
    id: 'spelt',
    name: 'Spelt',
    symbol: 'Sp',
    number: 1,
    family: 'wheat',
    commodities: [],
    facts: [],
    classes,
    tables: [
      {
        title: 'Moisture: straight, tough and damp',
        columns: ['Spelt', 'Straight (%)', 'Tough (%)', 'Damp (%)'],
        rows,
        source: 'cgc-oggg',
        where: 'Chapter 2',
      },
    ],
  };
}
const ROWS = [
  ['CWXX (>66kg/hl)', 'less than 14.6', '14.6-17.0', 'over 17.0'],
  ['Malting (covered) (>52 kg/hl)', 'less than 13.6', '13.6-17.0', 'over 17.0'],
  ['Malting (hulless)', 'less than 13.1', '13.1-17.0', 'over 17.0'],
];

describe('classLabel', () => {
  it('drops the grain’s and Canada’s words', () => {
    expect(classLabel(RED)).toBe('Example Red');
    expect(classLabel(HULLESS)).toBe('Malting, Two-row Hulless');
    expect(classLabel({ name: 'Lentils, Canada, other than Red' })).toBe('Other than Red');
  });

  it('falls back on the region, then the name’s first part', () => {
    expect(classLabel({ name: 'Oats, Canada Western', region: 'Western' })).toBe('Western');
    expect(classLabel({ name: 'Canola, Canada' })).toBe('Canola');
  });
});

describe('classSlug', () => {
  it('makes a short address from the abbreviation, region and label', () => {
    expect(classSlug(RED)).toBe('cwxx-western-example-red');
    expect(classSlug(HULLESS)).toBe('ce-eastern-malting-two-row-hulless');
  });
});

describe('classMoisture', () => {
  it('takes the row named by the class’s abbreviation', () => {
    expect(classMoisture(spelt([RED], ROWS), RED)).toMatchObject({
      straight: 'less than 14.6',
      tough: '14.6-17.0',
      damp: 'over 17.0',
      row: 'CWXX (>66kg/hl)',
    });
  });

  it('keeps hulless rows for hulless classes', () => {
    const grain = spelt([HULLESS, MALTING], ROWS);
    expect(classMoisture(grain, HULLESS)?.straight).toBe('less than 13.1');
    expect(classMoisture(grain, MALTING)?.straight).toBe('less than 13.6');
  });

  it('uses the one set of limits when every row has the same', () => {
    const grain = spelt(
      [RED],
      [
        ['Hulled', 'less than 13.6', '13.6-17.0', 'over 17.0'],
        ['Hulless', 'less than 13.6', '13.6-17.0', 'over 17.0'],
      ],
    );
    expect(classMoisture(grain, RED)).toMatchObject({ straight: 'less than 13.6' });
    expect(classMoisture(grain, RED)?.row).toBeUndefined();
  });

  it('gives nothing when no row fits', () => {
    expect(classMoisture(spelt([RED], ROWS.slice(1)), RED)).toBeUndefined();
  });
});

describe('onSpec', () => {
  it('lists each grade’s minimum test weight and protein and the dry moisture', () => {
    const spec = onSpec(spelt([RED], ROWS), RED);
    expect(spec.columns).toEqual(['Grade', 'Min. test weight (kg/hL)', 'Min. protein (%)']);
    expect(spec.rows).toEqual([
      ['No. 1 CWXX', '75', '10.0'],
      ['No. 2 CWXX', '72', 'No minimum'],
      ['CW Feed', '65', 'No minimum'],
    ]);
    expect(spec.moisture).toMatchObject({ straight: 'less than 14.6', tough: '14.6-17.0' });
    expect(spec.tables).toEqual([QUALITY]);
  });

  it('leaves out what the class has no limit for', () => {
    const spec = onSpec(spelt([MALTING], ROWS), MALTING);
    expect(spec.columns).toEqual(['Grade']);
    expect(spec.rows).toEqual([['Select Malting CE Two-row']]);
    expect(spec.moisture?.straight).toBe('less than 13.6');
    expect(spec.tables).toEqual([]);
  });
});
