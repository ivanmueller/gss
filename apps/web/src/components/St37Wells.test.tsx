import { describe, expect, it } from 'vitest';

import { st37Features, st37Legs, st37Pads, type St37MapWell } from '../lib/st37Map';
import { st37ByOperator, st37Covers, st37Place, st37Plan, st37Request } from './St37Wells';

// The AER's ST37 wells on the oil and gas map (F-243 part 4). Made-up wells only.

const well = (uwi: string, extra: Partial<St37MapWell> = {}): St37MapWell => ({
  uwi,
  licenceNumber: '0509395',
  wellName: 'EXAMPLE HZ',
  licensee: 'Example Energy Ltd.',
  statusClass: 'producing',
  statusFluid: 'Crude oil',
  statusType: null,
  spudDate: '2023-09-03',
  totalDepthM: 5846,
  trueVerticalDepthM: 2233,
  surface: [-113.6, 53.3],
  bottom: [-113.62, 53.3],
  path: [
    [-113.6, 53.3],
    [-113.62, 53.3],
  ],
  licenceDate: null,
  plannedOperation: null,
  plannedFormation: null,
  plannedDepthM: null,
  plannedBottom: null,
  ...extra,
});

describe('st37Request', () => {
  it('asks for the view and half again on each side', () => {
    expect(st37Request({ west: -114, south: 53, east: -113, north: 54 })).toEqual({
      west: -114.5,
      south: 52.5,
      east: -112.5,
      north: 54.5,
    });
  });

  it('stays within Alberta, and asks nothing for a view outside it', () => {
    expect(st37Request({ west: -141, south: 41.7, east: -52.6, north: 70 })).toEqual({
      west: -120.1,
      south: 48.9,
      east: -109.9,
      north: 60.1,
    });
    expect(st37Request({ west: -80, south: 43, east: -79, north: 44 })).toBeNull();
  });
});

describe('st37Covers', () => {
  const asked = { west: -114.5, south: 52.5, east: -112.5, north: 54.5 };
  it('needs nothing new while the view stays inside the box asked for', () => {
    expect(st37Covers(asked, { west: -114, south: 53, east: -113, north: 54 })).toBe(true);
    expect(st37Covers(asked, { west: -115, south: 53, east: -114, north: 54 })).toBe(false);
  });

  it('needs nothing for a view outside Alberta', () => {
    expect(st37Covers(asked, { west: -80, south: 43, east: -79, north: 44 })).toBe(true);
  });
});

describe('st37Features', () => {
  it('draws a path, a bottom-hole dot and a surface hole per well, and no path for a vertical one', () => {
    const { features } = st37Features([
      well('00/09-07-030-26W4/0'),
      well('00/01-27-030-27W4/0', { path: null, licenceNumber: '0509396' }),
    ]);
    expect(features.map((f): unknown => f.properties?.part)).toEqual([
      // One dot a well first, for when the main legs are off (F-257).
      'well',
      'well',
      'path',
      'bottom',
      'surface',
      'bottom',
      'surface',
    ]);
    expect(features[2]?.properties).toMatchObject({
      uwi: '00/09-07-030-26W4/0',
      licence: '0509395',
      status: 'producing',
      pad: '0509395',
      leg: 'main',
    });
  });

  it("marks a well's main leg and its other legs, and gives the well one dot (F-257)", () => {
    const first = well('00/09-07-030-26W4/0', { statusClass: 'abandoned', poolCode: null });
    const second = well('00/09-07-030-26W4/2', { poolCode: 728001 });
    const legs = st37Legs([first, second]);
    // The producing leg is the main one, whatever the order they came in.
    expect(legs.get('0509395')?.map((w) => w.uwi)).toEqual([second.uwi, first.uwi]);
    const { features } = st37Features([first, second]);
    expect(features.filter((f) => f.properties?.part === 'well')).toEqual([
      {
        type: 'Feature',
        properties: {
          uwi: second.uwi,
          licence: '0509395',
          status: 'producing',
          pad: '0509395',
          leg: 'main',
          part: 'well',
        },
        geometry: { type: 'Point', coordinates: [-113.6, 53.3] },
      },
    ]);
    expect(
      features
        .filter((f) => f.properties?.part === 'path')
        .map((f): unknown => [f.properties?.uwi, f.properties?.leg]),
    ).toEqual([
      [first.uwi, 'other'],
      [second.uwi, 'main'],
    ]);
  });

  it('groups wells drilled from one surface spot into a pad (F-259)', () => {
    // About 55 m apart each, in a row: one pad, though its ends are 110 m apart.
    const row = ['0509397', '0509395', '0509396'].map((licenceNumber, i) =>
      well(`0${String(i)}/09-07-030-26W4/0`, {
        licenceNumber,
        surface: [-113.6, 53.3 + i * 0.0005],
      }),
    );
    // A second leg of a well on the pad, and a well a kilometre away.
    const leg = well('00/09-07-030-26W4/2', { licenceNumber: '0509397' });
    const far = well('00/01-08-030-26W4/0', { licenceNumber: '0400000', surface: [-113.6, 53.31] });
    const pads = st37Pads([...row, leg, far]);
    expect(Object.fromEntries(pads)).toEqual({
      '0509395': '0509395',
      '0509396': '0509395',
      '0509397': '0509395',
      '0400000': '0400000',
    });
    const { features } = st37Features([...row, leg, far]);
    expect(
      features.filter((f) => f.properties?.part === 'path').map((f): unknown => f.properties?.pad),
    ).toEqual(['0509395', '0509395', '0509395', '0509395', '0400000']);
  });

  it('ranks equal legs: the one in a pool, then the one with a path, then the latest', () => {
    const uwis = (list: St37MapWell[]) =>
      st37Legs(list)
        .get('0509395')
        ?.map((w) => w.uwi.slice(-1));
    const a = (event: string, extra: Partial<St37MapWell>) =>
      well(`00/09-07-030-26W4/${event}`, { statusClass: 'abandoned', ...extra });
    expect(uwis([a('0', {}), a('2', { poolCode: 728001, path: null })])).toEqual(['2', '0']);
    expect(uwis([a('0', { path: null }), a('2', {})])).toEqual(['2', '0']);
    expect(uwis([a('0', {}), a('3', {}), a('2', {})])).toEqual(['3', '2', '0']);
  });
});

const LICENSED: Partial<St37MapWell> = {
  statusClass: 'licensed',
  statusFluid: null,
  spudDate: null,
  totalDepthM: null,
  trueVerticalDepthM: null,
  bottom: [-113.6, 53.3],
  path: null,
  licenceDate: '2026-11-19',
  plannedOperation: 'Horizontal',
  plannedFormation: 'Duvernay Fm',
  plannedDepthM: 5300,
  plannedBottom: [-113.63, 53.32],
};

describe('a well not drilled yet', () => {
  it('is drawn as a planned line to its planned bottom hole, with one dot where it starts', () => {
    const { features } = st37Features([well('00/01-29-049-26W4/0', LICENSED)]);
    expect(features.map((f): unknown => [f.properties?.part, f.properties?.at])).toEqual([
      ['well', undefined],
      ['planned', undefined],
      // One dot, where it starts, for far out or when planned lines are off; none at the planned
      // bottom hole (F-259).
      ['bottom', 'start'],
      ['surface', undefined],
    ]);
    features.shift();
    expect(features[0]?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-113.6, 53.3],
        [-113.63, 53.32],
      ],
    });
    expect(features[1]?.geometry).toEqual({ type: 'Point', coordinates: [-113.6, 53.3] });
  });

  it('says what its licence planned', () => {
    expect(st37Plan(well('00/01-29-049-26W4/0', LICENSED))).toBe(
      'Planned horizontal in the Duvernay Fm, 5,300 m measured depth · Licensed 2026-11-19',
    );
    expect(st37Plan(well('00/01-29-049-26W4/0'))).toBeNull();
  });
});

describe('st37Place', () => {
  it("names the well's field and pool, and a pool the list does not name by its code", () => {
    const uwi = '00/09-07-030-26W4/0';
    const named = well(uwi, {
      fieldName: 'EXAMPLE SOUTH',
      poolCode: 728001,
      poolName: 'EXAMPLE A',
    });
    expect(st37Place(named)).toBe('Example South field · Example A pool');
    expect(st37Place(well(uwi, { fieldName: "O'EXAMPLE-WEST", poolCode: 728098 }))).toBe(
      "O'Example-West field · pool 728098",
    );
    expect(st37Place(well(uwi))).toBeNull();
  });
});

describe('st37ByOperator (F-267)', () => {
  const list = [
    well('100/01-01-060-20W5/00'),
    well('100/02-01-060-20W5/00', { licensee: 'Sample Resources Inc.' }),
    well('100/03-01-060-20W5/00', { licensee: null }),
  ];

  it('keeps the wells of the operators whose name holds the text typed', () => {
    expect(st37ByOperator(list, ' sample ').map((w) => w.uwi)).toEqual(['100/02-01-060-20W5/00']);
    expect(st37ByOperator(list, 'ENERGY').map((w) => w.uwi)).toEqual(['100/01-01-060-20W5/00']);
  });

  it('keeps every well for no text', () => {
    expect(st37ByOperator(list, '  ')).toHaveLength(3);
  });
});
