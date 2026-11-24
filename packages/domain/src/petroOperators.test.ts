import { describe, expect, it } from 'vitest';

import { mergeOperators, operatorKey, operatorMatches } from './petroOperators';

// Operators across the oil and gas map's layers (F-302). Made-up companies only.

describe('operatorKey', () => {
  it('compares names whatever their case, punctuation or trailing code', () => {
    expect(operatorKey('EXAMPLE ENERGY LTD.')).toBe('EXAMPLE ENERGY LTD');
    expect(operatorKey('Example Energy Ltd.')).toBe('EXAMPLE ENERGY LTD');
    expect(operatorKey('Example Energy Ltd.(A1XX)')).toBe('EXAMPLE ENERGY LTD');
    expect(operatorKey('Sample Oil & Gas Inc.')).toBe('SAMPLE OIL AND GAS INC');
    expect(operatorKey(null)).toBe('');
    expect(operatorKey('  ')).toBe('');
  });
});

describe('operatorMatches', () => {
  it('finds the text within a name, part of a word too, as the boxes always did', () => {
    expect(operatorMatches('SAMPLE MIDSTREAM ALBERTA LTD.', 'sample midstream')).toBe(true);
    expect(operatorMatches('Sample Midstream Alberta Ltd.', 'SAMPLE MIDSTREAM ALBERTA LTD.')).toBe(
      true,
    );
    expect(operatorMatches('SAMPLE MIDSTREAM LTD.', 'sample mid')).toBe(true);
    expect(operatorMatches('Sample Oil & Gas Inc.', 'oil and gas')).toBe(true);
    expect(operatorMatches('EXAMPLE ENERGY LTD.', 'sample')).toBe(false);
    expect(operatorMatches(null, 'sample')).toBe(false);
  });

  it('keeps every name for no text', () => {
    expect(operatorMatches(null, '')).toBe(true);
    expect(operatorMatches('Example Energy Ltd.', ' . ')).toBe(true);
  });
});

describe('mergeOperators', () => {
  it('joins one company across sources, its codes kept, the largest first', () => {
    const merged = mergeOperators([
      { source: 'wells', code: null, name: 'EXAMPLE ENERGY LTD.', count: 40 },
      { source: 'facilities', code: 'A0X1', name: 'Example Energy Ltd.', count: 5 },
      { source: 'pipelines', code: 'A0X1', name: 'Example Energy Ltd.', count: 12 },
      { source: 'pipelines', code: 'B0Y2', name: 'Sample Midstream Ltd.', count: 80 },
      { source: 'wells', code: null, name: 'Other Sample Corp.(C0Z3)', count: 2 },
      { source: 'wells', code: null, name: null, count: 9 },
      { source: 'facilities', code: 'D0W4', name: 'Empty Corp.', count: 0 },
      // A holder of Crown land, matched by name only (part 3).
      { source: 'land', code: null, name: 'EXAMPLE ENERGY LTD.', count: 7 },
    ]);
    expect(merged).toEqual([
      {
        name: 'Sample Midstream Ltd.',
        codes: ['B0Y2'],
        wells: 0,
        facilities: 0,
        pipelines: 80,
        land: 0,
      },
      {
        name: 'Example Energy Ltd.',
        codes: ['A0X1'],
        wells: 40,
        facilities: 5,
        pipelines: 12,
        land: 7,
      },
      {
        name: 'Other Sample Corp.',
        codes: ['C0Z3'],
        wells: 2,
        facilities: 0,
        pipelines: 0,
        land: 0,
      },
    ]);
  });

  it('shows a name with lower case letters, else the most used', () => {
    expect(
      mergeOperators([
        { source: 'wells', code: null, name: 'EXAMPLE CORP', count: 9 },
        { source: 'wells', code: null, name: 'EXAMPLE CORP.', count: 1 },
      ])[0]?.name,
    ).toBe('EXAMPLE CORP');
    expect(
      mergeOperators([
        { source: 'wells', code: null, name: 'EXAMPLE CORP', count: 9 },
        { source: 'facilities', code: null, name: 'Example Corp', count: 1 },
      ])[0]?.name,
    ).toBe('Example Corp');
  });
});
