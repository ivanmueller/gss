import { describe, expect, it } from 'vitest';

import { inZone, maturityWindow, roFromTmax, sampleInPlay, sampleMaturity } from './geology';

describe('maturity from a sample (F-287)', () => {
  it("reads Ro from Tmax by the Survey's formula", () => {
    expect(roFromTmax(448)).toBe(0.9);
    expect(roFromTmax(435)).toBe(0.67);
    expect(roFromTmax(null)).toBeNull();
  });

  it('puts each reflectance in its window, the edges in the deeper one', () => {
    expect(maturityWindow(0.59)).toBe('immature');
    expect(maturityWindow(0.6)).toBe('oil');
    expect(maturityWindow(0.99)).toBe('oil');
    expect(maturityWindow(1.0)).toBe('condensate');
    expect(maturityWindow(1.4)).toBe('dry-gas');
  });

  it('gives no window without a Tmax, or from a small S2 peak', () => {
    expect(sampleMaturity('460', '3.2')).toEqual({ ro: 1.12, window: 'condensate', note: null });
    expect(sampleMaturity(null, '3.2')).toEqual({ ro: null, window: null, note: 'no-tmax' });
    expect(sampleMaturity('460', '0.19')).toEqual({ ro: 1.12, window: null, note: 'small-s2' });
    expect(sampleMaturity('460', null)).toEqual({ ro: 1.12, window: null, note: 'small-s2' });
  });

  it("knows the play's units by the file's names", () => {
    expect(sampleInPlay('Duvernay', 'duvernay')).toBe(true);
    expect(sampleInPlay(' muskwa ', 'duvernay')).toBe(true);
    expect(sampleInPlay('Ireton', 'duvernay')).toBe(false);
    expect(sampleInPlay('Duvernay', 'montney')).toBe(false);
    expect(sampleInPlay(null, 'duvernay')).toBe(false);
  });
});

describe('a leg in its zone', () => {
  it('measures from the top and the base', () => {
    expect(inZone(-2230, -2200, -2260)).toEqual({ belowTopM: 30, aboveBaseM: 30, inside: true });
    expect(inZone(-2190, -2200, -2260)).toEqual({ belowTopM: -10, aboveBaseM: 70, inside: false });
    expect(inZone(-2230, null, -2260)).toBeNull();
  });
});
