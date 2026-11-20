import { describe, expect, it } from 'vitest';

import {
  buildSt37Wells,
  st37Date,
  st37Reach,
  st37StatusClass,
  type St37Feature,
  type St37StatusInput,
} from './st37';

// Made-up wells in the layout ogr2ogr writes from the AER's ST37 geodatabase (F-243 part 4).
const AREA = { west: -114, south: 53, east: -113, north: 54 };

const base: St37StatusInput = {
  licenceStatus: 'Issued',
  spudDate: '2023-09-03',
  finalDrillDate: '2023-09-20',
  mode: null,
  type: null,
};

describe('st37StatusClass', () => {
  it('reads the AER status modes', () => {
    expect(st37StatusClass({ ...base, mode: '11' })).toBe('producing');
    expect(st37StatusClass({ ...base, mode: '10' })).toBe('producing');
    expect(st37StatusClass({ ...base, mode: '01' })).toBe('suspended');
    expect(st37StatusClass({ ...base, mode: '02' })).toBe('abandoned');
    expect(st37StatusClass({ ...base, mode: '07' })).toBe('awaiting');
    expect(st37StatusClass({ ...base, mode: '09' })).toBe('inactive');
    expect(st37StatusClass({ ...base, mode: '15' })).toBe('drilling');
  });

  it('counts a service well in use as injecting', () => {
    expect(st37StatusClass({ ...base, mode: '00', type: 'Injection' })).toBe('producing');
    expect(st37StatusClass({ ...base, mode: '00', type: null })).toBe('awaiting');
  });

  it('puts an ended licence before any mode', () => {
    expect(st37StatusClass({ ...base, licenceStatus: 'RecCertified', mode: '11' })).toBe(
      'abandoned',
    );
    expect(st37StatusClass({ ...base, licenceStatus: 'Abandoned' })).toBe('abandoned');
  });

  it('places wells without a production string by their licence and dates', () => {
    expect(st37StatusClass({ ...base, licenceStatus: 'Suspension' })).toBe('suspended');
    expect(st37StatusClass({ ...base, spudDate: null, finalDrillDate: null })).toBe('licensed');
    expect(st37StatusClass({ ...base, finalDrillDate: null })).toBe('drilling');
    expect(st37StatusClass(base)).toBe('awaiting');
  });

  it('never guesses an unknown mode', () => {
    expect(st37StatusClass({ ...base, mode: '99' })).toBe('awaiting');
  });
});

describe('st37Date', () => {
  it('reads the three forms the layers use', () => {
    expect(st37Date('20230903')).toBe('2023-09-03');
    expect(st37Date('09/03/2023')).toBe('2023-09-03');
    expect(st37Date('2023-09-03T00:00:00Z')).toBe('2023-09-03');
  });

  it('refuses what is not a date', () => {
    expect(st37Date('20231340')).toBeNull();
    expect(st37Date('')).toBeNull();
    expect(st37Date(null)).toBeNull();
    expect(st37Date(20230903)).toBeNull();
  });
});

describe('st37Reach', () => {
  it('measures how far a path runs sideways', () => {
    // 0.01 degrees of latitude is about 1,106 m.
    expect(
      st37Reach([
        [-113.6, 53.3],
        [-113.6, 53.31],
      ]),
    ).toBeCloseTo(1105.7, 0);
    expect(st37Reach([[-113.6, 53.3]])).toBe(0);
  });
});

const surface = (licence: string, lon: number, lat: number): St37Feature => ({
  properties: {
    Well_Licence_Number: licence,
    SH_Actual_Longitude: lon,
    SH_Actual_Latitude: lat,
  },
  geometry: { type: 'Point', coordinates: [lon, lat] },
});

const bottom = (
  uwi: string,
  licence: string,
  lon: number,
  lat: number,
  extra = {},
): St37Feature => ({
  properties: {
    Well_UWI: uwi,
    Well_Licence_Number: licence,
    Well_Name: 'EXAMPLE HZ 1-2-3-4    ',
    Licensee: 'Example Energy Ltd.',
    Licence_Status: 'Issued',
    Spud_Date: '20230903',
    Final_Drill_Date: '20230920',
    Final_Total_Depth: 5846,
    Max_True_Vertical_Depth: 0,
    BH_Longitude: lon,
    BH_Latitude: lat,
    ...extra,
  },
  geometry: { type: 'Point', coordinates: [lon, lat] },
});

const string = (uwi: string, mode: string, fluid = 'CRUDE OIL     '): St37Feature => ({
  properties: {
    Prod_String_UWI: uwi,
    Status_Mode: mode,
    Status_Fluid: fluid,
    Status_Type: 'Not Applicable',
    Pool_Code: 336005,
  },
  geometry: null,
});

const path = (uwi: string, coords: number[][]): St37Feature => ({
  properties: { UWI_Label: uwi },
  geometry: { type: 'MultiLineString', coordinates: [coords] },
});

describe('buildSt37Wells', () => {
  const H1 = '00/09-07-030-26W4/0';
  const H2 = '02/09-07-030-26W4/0';
  const V = '00/01-27-030-27W4/0';

  const layers = {
    surface: [surface('0509395', -113.6, 53.3), surface('0340721', -113.5, 53.2)],
    bottom: [
      bottom(H1, '0509395', -113.6, 53.32),
      bottom(H2, '0509395', -113.62, 53.3),
      bottom(V, '0340721', -113.5, 53.2, { Licence_Status: 'Abandoned' }),
      bottom('bad', '1', -113.5, 53.2),
      bottom('00/01-01-001-01W4/0', '0000001', -110.5, 49.1),
    ],
    strings: [string(H1, '11'), string(H1, '2', 'GAS'), string(H2, '1')],
    paths: [
      path(H1, [
        [-113.6, 53.3, 700],
        [-113.6, 53.3, 600],
        [-113.6, 53.32, 0],
      ]),
      path(H2, [
        [-113.6, 53.3],
        [-113.62, 53.3],
      ]),
      path(V, [
        [-113.5, 53.2],
        [-113.50001, 53.20001],
      ]),
    ],
  };
  const { wells, skipped } = buildSt37Wells(layers, AREA);
  const at = (i: number) => {
    const w = wells[i];
    if (!w) throw new Error(`no well ${String(i)}`);
    return w;
  };

  it('keeps one well per UWI in the area, each leg its own', () => {
    expect(wells.map((w) => w.uwi)).toEqual([H1, H2, V]);
    expect(skipped).toBe(1);
  });

  it('places a well at its licence surface hole and its bottom hole', () => {
    const h1 = at(0);
    expect(h1.surface).toEqual([-113.6, 53.3]);
    expect(h1.bottom).toEqual([-113.6, 53.32]);
    expect(h1.licenceNumber).toBe('0509395');
  });

  it('shows the most active production string', () => {
    const h1 = at(0);
    expect(h1.statusClass).toBe('producing');
    expect(h1.statusFluid).toBe('Crude oil');
    expect(h1.statusMode).toBe('11');
    expect(at(1).statusClass).toBe('suspended');
    expect(at(2).statusClass).toBe('abandoned');
  });

  it('keeps a path that runs sideways, without repeated points, and none for a vertical well', () => {
    expect(at(0).path).toEqual([
      [-113.6, 53.3],
      [-113.6, 53.32],
    ]);
    expect(at(2).path).toBeNull();
  });

  it('cleans the AER text and depths', () => {
    const h1 = at(0);
    expect(h1.wellName).toBe('EXAMPLE HZ 1-2-3-4');
    expect(h1.spudDate).toBe('2023-09-03');
    expect(h1.totalDepthM).toBe(5846);
    expect(h1.trueVerticalDepthM).toBeNull();
    expect(h1.poolCode).toBe(336005);
  });
});
