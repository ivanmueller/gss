import { describe, expect, it } from 'vitest';

import {
  crossesBorder,
  equipmentSchema,
  groupLanes,
  isLaneRegion,
  LANE_REGIONS,
  laneChangeSchema,
  laneRegionName,
  laneRegionOf,
  laneRegionsOf,
  laneRegionShort,
  parseEquipmentList,
  parseLaneMode,
  parsePlaceList,
  runsLane,
  createCounterpartyDetailsSchema,
  updateCounterpartyDetailsSchema,
  type CarrierLane,
} from './carriers';
import { CA_REGIONS, US_REGIONS } from './regions';

describe('lane places', () => {
  it("are Canada's 13 provinces and territories and the 50 states and DC", () => {
    expect(LANE_REGIONS).toHaveLength(
      Object.keys(CA_REGIONS).length + Object.keys(US_REGIONS).length,
    );
    expect(LANE_REGIONS).toHaveLength(64);
    expect(isLaneRegion('CA-AB')).toBe(true);
    expect(isLaneRegion('US-MT')).toBe(true);
    expect(isLaneRegion('US-DC')).toBe(true);
  });

  it('refuses anything else', () => {
    for (const code of ['AB', 'ca-ab', 'CA-MT', 'US-AB', 'MX-SON', 'CA-', '', 'CA-AB ']) {
      expect(isLaneRegion(code)).toBe(false);
    }
  });

  it('are named and shortened', () => {
    expect(laneRegionName('CA-AB')).toBe('Alberta');
    expect(laneRegionName('US-ND')).toBe('North Dakota');
    expect(laneRegionName('XX-YY')).toBe('XX-YY');
    expect(laneRegionShort('US-ND')).toBe('ND');
  });

  it("come from a location's country and province or state", () => {
    expect(laneRegionOf('CA', 'SK')).toBe('CA-SK');
    expect(laneRegionOf('US', 'MN')).toBe('US-MN');
    expect(laneRegionOf('CA', null)).toBeNull();
    expect(laneRegionOf('CA', 'MT')).toBeNull();
  });

  it('are listed by name for each country', () => {
    const canada = laneRegionsOf('CA');
    expect(canada).toHaveLength(13);
    expect(canada[0]).toEqual({ code: 'CA-AB', name: 'Alberta' });
    expect(laneRegionsOf('US').map((place) => place.name)).toContain('District of Columbia');
  });
});

describe('laneChangeSchema', () => {
  it('takes lanes to add and to remove', () => {
    const change = {
      add: [{ origin: 'CA-AB', destination: 'US-MT', transport: 'truck' }],
      remove: [{ origin: 'CA-MB', destination: 'US-ND' }],
    };
    expect(laneChangeSchema.parse(change)).toEqual({ ...change, verify: [] });
  });

  it('refuses an empty change, unknown places and transport', () => {
    expect(laneChangeSchema.safeParse({ add: [], remove: [] }).success).toBe(false);
    expect(
      laneChangeSchema.safeParse({
        add: [{ origin: 'CA-AB', destination: 'MX-SON', transport: 'truck' }],
        remove: [],
      }).success,
    ).toBe(false);
    expect(
      laneChangeSchema.safeParse({
        add: [{ origin: 'CA-AB', destination: 'US-MT', transport: 'barge' }],
        remove: [],
      }).success,
    ).toBe(false);
    expect(
      laneChangeSchema.safeParse({ add: [], remove: [{ origin: 'AB', destination: 'MT' }] })
        .success,
    ).toBe(false);
  });

  it('refuses more than 500 lanes at once', () => {
    const lane = { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' };
    expect(
      laneChangeSchema.safeParse({ add: Array.from({ length: 501 }, () => lane), remove: [] })
        .success,
    ).toBe(false);
  });
});

describe('crossesBorder', () => {
  it('is true from Canada to the U.S. and back, false within a country', () => {
    expect(crossesBorder({ origin: 'CA-AB', destination: 'US-MT' })).toBe(true);
    expect(crossesBorder({ origin: 'US-ND', destination: 'CA-MB' })).toBe(true);
    expect(crossesBorder({ origin: 'CA-AB', destination: 'CA-SK' })).toBe(false);
    expect(crossesBorder({ origin: 'US-ND', destination: 'US-MN' })).toBe(false);
  });
});

describe('runsLane', () => {
  const lanes = [
    { origin: 'CA-AB', destination: 'US-MT' },
    { origin: 'CA-AB', destination: 'US-ND' },
    { origin: 'CA-SK', destination: 'US-ND' },
  ];

  it('finds a carrier by where it loads, where it delivers, or both', () => {
    expect(runsLane(lanes, ['CA-AB'], [])).toBe(true);
    expect(runsLane(lanes, [], ['US-ND'])).toBe(true);
    expect(runsLane(lanes, ['CA-SK'], ['US-ND'])).toBe(true);
    expect(runsLane(lanes, ['CA-SK', 'CA-MB'], ['US-MT', 'US-MN'])).toBe(false);
    expect(runsLane(lanes, ['CA-MB'], [])).toBe(false);
  });

  it('needs both ends on the same lane', () => {
    // From Saskatchewan, and to Montana, but not on one lane.
    expect(runsLane(lanes, ['CA-SK'], ['US-MT'])).toBe(false);
  });

  it('lets every carrier through without a place, and none without lanes', () => {
    expect(runsLane([], [], [])).toBe(true);
    expect(runsLane([], ['CA-AB'], [])).toBe(false);
  });
});

describe('groupLanes', () => {
  it('groups by origin and transport, places by name', () => {
    const lanes: CarrierLane[] = [
      { origin: 'CA-SK', destination: 'US-ND', transport: 'truck' },
      { origin: 'CA-AB', destination: 'US-ND', transport: 'truck' },
      { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
      { origin: 'CA-AB', destination: 'US-WA', transport: 'rail' },
    ];
    expect(groupLanes(lanes)).toEqual([
      { origin: 'CA-AB', transport: 'rail', destinations: ['US-WA'] },
      { origin: 'CA-AB', transport: 'truck', destinations: ['US-MT', 'US-ND'] },
      { origin: 'CA-SK', transport: 'truck', destinations: ['US-ND'] },
    ]);
  });

  it('is empty without lanes', () => {
    expect(groupLanes([])).toEqual([]);
  });
});

describe('equipment', () => {
  it('is kept each once, in the list order', () => {
    expect(equipmentSchema.parse(['van', 'super_b', 'van'])).toEqual(['super_b', 'van']);
    expect(equipmentSchema.parse([])).toEqual([]);
  });

  it('refuses anything not on the list', () => {
    expect(equipmentSchema.safeParse(['spaceship']).success).toBe(false);
  });

  it('may be left out of a change of details', () => {
    const base = {
      version: '2026-11-01T12:00:00.000000Z',
      values: { legalName: 'Synthetic Hauling' },
    };
    expect(updateCounterpartyDetailsSchema.parse(base).equipment).toBeUndefined();
    expect(
      updateCounterpartyDetailsSchema.parse({ ...base, equipment: ['tridem'] }).equipment,
    ).toEqual(['tridem']);
  });
});

describe('lanes not stated as truck or rail', () => {
  it('are taken as null, and only truck, rail or both otherwise', () => {
    const lane = { origin: 'CA-AB', destination: 'US-MT', transport: null };
    expect(laneChangeSchema.parse({ add: [lane], remove: [] }).add).toEqual([lane]);
    expect(
      laneChangeSchema.safeParse({ add: [{ ...lane, transport: '' }], remove: [] }).success,
    ).toBe(false);
  });

  it('are grouped apart, after truck, rail and both', () => {
    expect(
      groupLanes([
        { origin: 'CA-AB', destination: 'US-ND', transport: null },
        { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
        { origin: 'CA-AB', destination: 'US-MN', transport: null },
      ]),
    ).toEqual([
      { origin: 'CA-AB', transport: 'truck', destinations: ['US-MT'] },
      { origin: 'CA-AB', transport: null, destinations: ['US-MN', 'US-ND'] },
    ]);
  });
});

describe('createCounterpartyDetailsSchema', () => {
  const base = {
    organizationId: '00000000-0000-4000-8000-0000000000aa',
    values: { legalName: 'Synthetic Hauling', types: 'carrier', country: 'CA' },
  };

  it('takes a carrier’s equipment and first lanes, or neither', () => {
    const plain = createCounterpartyDetailsSchema.parse(base);
    expect(plain.equipment).toBeUndefined();
    expect(plain.lanes).toBeUndefined();
    expect(
      createCounterpartyDetailsSchema.parse({
        ...base,
        equipment: ['van', 'super_b'],
        lanes: [{ origin: 'CA-AB', destination: 'US-MT', transport: null }],
      }),
    ).toMatchObject({
      equipment: ['super_b', 'van'],
      lanes: [{ origin: 'CA-AB', destination: 'US-MT', transport: null }],
    });
  });

  it('refuses unknown equipment and places', () => {
    expect(
      createCounterpartyDetailsSchema.safeParse({ ...base, equipment: ['ship'] }).success,
    ).toBe(false);
    expect(
      createCounterpartyDetailsSchema.safeParse({
        ...base,
        lanes: [{ origin: 'CA-AB', destination: 'MX-SON', transport: null }],
      }).success,
    ).toBe(false);
  });
});

describe('reading spreadsheet cells', () => {
  it('reads places by code, name or ISO code, each once, and lists the unknown', () => {
    expect(parsePlaceList('AB, Saskatchewan; US-MT / north dakota and AB')).toEqual({
      places: ['CA-AB', 'CA-SK', 'US-MT', 'US-ND'],
      unknown: [],
    });
    expect(parsePlaceList('Albrta, Sonora, MX-SON')).toEqual({
      places: [],
      unknown: ['Albrta', 'Sonora', 'MX-SON'],
    });
  });

  it('reads equipment by its name or a common one', () => {
    expect(parseEquipmentList('Super-B, Dry van & flat deck; railcar')).toEqual({
      equipment: ['super_b', 'van', 'flatdeck', 'hopper_car'],
      unknown: [],
    });
    expect(parseEquipmentList('Reefer').unknown).toEqual(['Reefer']);
  });

  it('reads a mode as truck, rail or both; empty is not stated', () => {
    expect(parseLaneMode('Truck')).toBe('truck');
    expect(parseLaneMode('RAIL')).toBe('rail');
    expect(parseLaneMode('Truck/Rail')).toBe('rail_and_truck');
    expect(parseLaneMode('Both')).toBe('rail_and_truck');
    expect(parseLaneMode(null)).toBeNull();
    expect(parseLaneMode('Barge')).toBeUndefined();
  });
});
