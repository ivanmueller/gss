import { describe, expect, it } from 'vitest';

import {
  COMMODITIES,
  commodityChangeSchema,
  commodityDirections,
  commodityFromName,
  commodityName,
  parseCommodityList,
} from './commodities';

describe('commodityFromName', () => {
  it('reads every commodity by its name and its code, in any case, singular or plural', () => {
    for (const { code, name } of COMMODITIES) {
      expect(commodityFromName(name)).toBe(code);
      expect(commodityFromName(name.toUpperCase())).toBe(code);
      expect(commodityFromName(code)).toBe(code);
    }
    expect(commodityFromName('Yellow Pea')).toBe('yellow_peas');
    expect(commodityFromName('chickpea')).toBe('chickpeas');
    expect(commodityFromName('  Oat ')).toBe('oats');
  });

  it('knows common other names, but not ambiguous ones', () => {
    expect(commodityFromName('Flax')).toBe('flaxseed');
    expect(commodityFromName('Durum')).toBe('durum_wheat');
    expect(commodityFromName('CWRS')).toBe('spring_wheat');
    expect(commodityFromName('Fava beans')).toBe('faba_beans');
    expect(commodityFromName('Soy')).toBe('soybeans');
    expect(commodityFromName('Mustard')).toBe('mustard_seed');
    // Feed wheat names no class of wheat (Codex's review of ivanmueller/gss#78).
    for (const name of ['Wheat', 'Feed wheat', 'Barley', 'Peas', 'Lentils', 'Hemp', '']) {
      expect(commodityFromName(name)).toBeNull();
    }
  });
});

describe('parseCommodityList', () => {
  it('splits on semicolons, commas, slashes, new lines and "and"; keeps the list order, each once', () => {
    expect(parseCommodityList('Oats; canola, Flax / oats\nYellow peas and Rye')).toEqual({
      commodities: ['canola', 'flaxseed', 'yellow_peas', 'oats', 'rye'],
      unknown: [],
    });
  });

  it('gives back the names it does not know', () => {
    expect(parseCommodityList('Canola; Wheat;; Hemp')).toEqual({
      commodities: ['canola'],
      unknown: ['Wheat', 'Hemp'],
    });
  });
});

describe('commodityDirections', () => {
  it('lets buyers buy, sellers sell and brokers do both; carriers neither', () => {
    expect(commodityDirections(['buyer'])).toEqual(['buys']);
    expect(commodityDirections(['seller'])).toEqual(['sells']);
    expect(commodityDirections(['buyer', 'seller'])).toEqual(['buys', 'sells']);
    expect(commodityDirections(['broker'])).toEqual(['buys', 'sells']);
    expect(commodityDirections(['carrier'])).toEqual([]);
  });
});

describe('commodityChangeSchema', () => {
  it('takes commodities to add and to remove', () => {
    expect(
      commodityChangeSchema.safeParse({
        add: [{ commodity: 'canola', direction: 'buys' }],
        remove: [{ commodity: 'oats', direction: 'sells' }],
      }).success,
    ).toBe(true);
  });

  it('refuses unknown commodities or directions, and an empty change', () => {
    const one = (commodity: string, direction: string) =>
      commodityChangeSchema.safeParse({ add: [{ commodity, direction }], remove: [] }).success;
    expect(one('hemp', 'buys')).toBe(false);
    expect(one('canola', 'trades')).toBe(false);
    expect(commodityChangeSchema.safeParse({ add: [], remove: [] }).success).toBe(false);
  });

  it('takes commodities to verify, alone or with other changes', () => {
    const verify = [{ commodity: 'canola', direction: 'buys' }];
    expect(commodityChangeSchema.parse({ add: [], remove: [], verify })).toEqual({
      add: [],
      remove: [],
      verify,
    });
    expect(
      commodityChangeSchema.parse({ add: [{ commodity: 'oats', direction: 'sells' }], remove: [] })
        .verify,
    ).toEqual([]);
    expect(
      commodityChangeSchema.safeParse({
        add: [],
        remove: [],
        verify: [{ commodity: 'hemp', direction: 'buys' }],
      }).success,
    ).toBe(false);
  });
});

describe('commodityName', () => {
  it('names a code', () => {
    expect(commodityName('yellow_peas')).toBe('Yellow peas');
  });
});
