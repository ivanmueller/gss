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
  runsLane,
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
    expect(laneChangeSchema.parse(change)).toEqual(change);
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
