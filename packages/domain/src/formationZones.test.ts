import { describe, expect, it } from 'vitest';

import {
  FORMATION_PLAY_ZONES,
  FORMATION_ROCKS,
  FORMATION_ZONE_COUNT,
  FORMATION_ZONES,
  formationCell,
  formationColumn,
  formationLayerAt,
  formationZone,
} from './formationZones';

// The Survey's 90 model zones and their rock types (F-261 part 2).

describe('FORMATION_ZONES', () => {
  it('lists the 90 zones from the surface down, each under its own number', () => {
    expect(FORMATION_ZONES).toHaveLength(FORMATION_ZONE_COUNT);
    expect(FORMATION_ZONES.map((zone) => zone.number)).toEqual(
      Array.from({ length: 90 }, (_, i) => i + 1),
    );
    // The model's abbreviation starts with the zone's number, as its files are named.
    for (const zone of FORMATION_ZONES) {
      expect(zone.code.startsWith(`${String(zone.number).padStart(2, '0')}_`)).toBe(true);
      expect(zone.name.length).toBeGreaterThan(3);
      expect(zone.short.length).toBeGreaterThan(2);
    }
    expect(formationZone(1)?.name).toBe('Sediment above bedrock (surficial deposits)');
    expect(formationZone(90)?.name).toBe('Precambrian');
    expect(formationZone(91)).toBeUndefined();
  });

  it('gives every zone a rock type the table has, with the unit it was read from', () => {
    for (const zone of FORMATION_ZONES) {
      expect(FORMATION_ROCKS[zone.rock]).toBeDefined();
      for (const other of zone.also) {
        expect(FORMATION_ROCKS[other.rock]).toBeDefined();
        expect(other.rock).not.toBe(zone.rock);
      }
      // Only the surface, the basement and a zone the table does not show name no unit.
      if (['surficial', 'basement', 'unknown'].includes(zone.rock)) {
        expect(zone.unit).toBeNull();
      } else {
        expect(zone.unit).not.toBeNull();
        expect(zone.column).toMatch(/Plains$/);
      }
    }
    expect(FORMATION_ZONES.filter((zone) => zone.rock === 'unknown').map((z) => z.number)).toEqual([
      85,
    ]);
  });

  it('reads the Duvernay and its neighbours as the table colours them', () => {
    const play = formationZone(FORMATION_PLAY_ZONES.duvernay ?? 0);
    expect(play).toMatchObject({
      number: 68,
      code: '68_D_Dv_Mu',
      age: 'Devonian',
      name: 'Duvernay Formation / Muskwa Formation',
      rock: 'shale',
      unit: 'Duvernay',
      column: 'West-Central Plains',
    });
    expect(formationZone(67)).toMatchObject({ rock: 'shale', unit: 'Ireton' });
    expect(formationZone(69)).toMatchObject({ rock: 'carbonate', unit: 'Leduc' });
    // The two interbedded classes are hatched on the table.
    expect(formationZone(64)).toMatchObject({ rock: 'carbonate_shale', unit: 'Banff' });
    expect(formationZone(64)?.also).toEqual([
      { rock: 'shale', unit: 'Exshaw', column: 'West-Central Plains' },
    ]);
    expect(FORMATION_ROCKS.carbonate_shale.hatch).not.toBeNull();
    expect(FORMATION_ROCKS.shale).toEqual({
      label: 'Shale and mudstone with subordinate siltstone',
      colour: '#cecfd1',
      hatch: null,
      earth: '#7f8794',
      pattern: 'dashes',
    });
  });
});

describe('FORMATION_ROCKS', () => {
  it('draws every rock type in a colour and a texture of its own kind', () => {
    for (const rock of Object.values(FORMATION_ROCKS)) {
      expect(rock.colour).toMatch(/^#[0-9a-f]{6}$/);
      expect(rock.earth).toMatch(/^#[0-9a-f]{6}$/);
      expect(rock.pattern.length).toBeGreaterThan(3);
    }
    // The customary marks: grains for sandstone, fine beds for shale, blocks for limestone
    // and dolostone; both rocks of an interbedded class show in its texture.
    expect(FORMATION_ROCKS.sandstone.pattern).toBe('dots');
    expect(FORMATION_ROCKS.shale.pattern).toBe('dashes');
    expect(FORMATION_ROCKS.carbonate.pattern).toBe('bricks');
    expect(FORMATION_ROCKS.carbonate_shale.pattern).toBe('bricks_dashes');
    expect(FORMATION_ROCKS.carbonate_anhydrite.pattern).toBe('bricks_hatch');
    // Only a rock the table does not show is left plain.
    expect(
      Object.entries(FORMATION_ROCKS)
        .filter(([, rock]) => rock.pattern === 'plain')
        .map(([key]) => key),
    ).toEqual(['unknown']);
    // No two rock types the play's column shows share a colour on the block.
    const earths = ['sandstone', 'shale', 'carbonate', 'carbonate_shale', 'basement'].map(
      (key) => FORMATION_ROCKS[key as keyof typeof FORMATION_ROCKS].earth,
    );
    expect(new Set(earths).size).toBe(earths.length);
  });
});

describe('formationColumn', () => {
  const tops: (number | null)[] = new Array<number | null>(90).fill(null);
  const bases: (number | null)[] = new Array<number | null>(90).fill(null);
  [
    [1, 840, 830],
    [3, 830, 691],
    [68, -2252, -2310],
    [90, -2722, -6000],
  ].forEach(([zone, top, base]) => {
    tops[(zone ?? 0) - 1] = top ?? null;
    bases[(zone ?? 0) - 1] = base ?? null;
  });
  // A zone with a top and no base, and one with no thickness, are not there.
  tops[9] = 500;
  tops[19] = 100;
  bases[19] = 100;

  it('keeps the zones present, from the surface down', () => {
    expect(formationColumn(tops, bases)).toEqual([
      { zone: 1, top: 840, base: 830 },
      { zone: 3, top: 830, base: 691 },
      { zone: 68, top: -2252, base: -2310 },
      { zone: 90, top: -2722, base: -6000 },
    ]);
    expect(formationColumn([], [])).toEqual([]);
  });

  it('finds the layer a point lies in', () => {
    const layers = formationColumn(tops, bases);
    expect(formationLayerAt(layers, -2300)?.zone).toBe(68);
    // A layer's top belongs to it: where two meet, the point is in the lower one.
    expect(formationLayerAt(layers, 830.1)?.zone).toBe(1);
    expect(formationLayerAt(layers, 830)?.zone).toBe(3);
    expect(formationLayerAt(layers, 0)).toBeNull();
    expect(formationLayerAt(layers, 900)).toBeNull();
  });
});

describe('formationCell', () => {
  it('names the lattice cell nearest a place', () => {
    expect(formationCell(-116.9, 54.39)).toEqual({ x: -7306, y: 6043 });
    // Cell (-7306, 6043) is centred on (-116.896, 54.387) and reaches half a step each way.
    expect(formationCell(-116.896 + 0.0079, 54.387 + 0.0044)).toEqual({ x: -7306, y: 6043 });
    expect(formationCell(-116.896 + 0.0081, 54.387)).toEqual({ x: -7305, y: 6043 });
    expect(formationCell(-116.896, 54.387 - 0.0046)).toEqual({ x: -7306, y: 6042 });
  });
});
