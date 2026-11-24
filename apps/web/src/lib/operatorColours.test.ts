import { describe, expect, it } from 'vitest';

import {
  countOperators,
  OPERATOR_OTHER,
  OPERATOR_PALETTE,
  operatorColourExpression,
  topOperators,
} from './operatorColours';

// Colour by operator (F-302 part 2). Made-up companies only.

describe('countOperators', () => {
  it('counts each operator once whatever the case or punctuation, no name left out', () => {
    expect(
      countOperators(['EXAMPLE ENERGY LTD.', 'Example Energy Ltd.', null, '', 'Sample Corp']),
    ).toEqual([
      { key: 'EXAMPLE ENERGY LTD', name: 'EXAMPLE ENERGY LTD.', count: 2 },
      { key: 'SAMPLE CORP', name: 'Sample Corp', count: 1 },
    ]);
  });
});

describe('topOperators', () => {
  it('adds the layers up, the largest first, a colour each by rank; a layer off counts nothing', () => {
    const wells = [
      { key: 'A', name: 'A Ltd.', count: 5 },
      { key: 'B', name: 'B Ltd.', count: 1 },
    ];
    const pipes = [{ key: 'B', name: 'B Ltd.', count: 9 }];
    expect(topOperators([wells, null, pipes])).toEqual([
      { key: 'B', name: 'B Ltd.', count: 10, colour: OPERATOR_PALETTE[0] },
      { key: 'A', name: 'A Ltd.', count: 5, colour: OPERATOR_PALETTE[1] },
    ]);
  });

  it('keeps ten at most, ties by name', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      key: `K${String(i).padStart(2, '0')}`,
      name: `Company ${String(i).padStart(2, '0')}`,
      count: 1,
    }));
    const top = topOperators([many]);
    expect(top).toHaveLength(10);
    expect(top[0]?.name).toBe('Company 00');
    expect(new Set(top.map((o) => o.colour)).size).toBe(10);
    expect(top.map((o) => o.colour)).not.toContain(OPERATOR_OTHER);
  });
});

describe('operatorColourExpression', () => {
  it('colours the ten by their key and every other operator grey', () => {
    expect(operatorColourExpression([])).toBe(OPERATOR_OTHER);
    expect(
      operatorColourExpression([{ key: 'A', name: 'A Ltd.', count: 5, colour: '#4e79a7' }]),
    ).toEqual(['match', ['get', 'op'], 'A', '#4e79a7', OPERATOR_OTHER]);
  });
});
