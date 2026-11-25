import { describe, expect, it } from 'vitest';

import {
  landAgreement,
  landDate,
  landFreehold,
  landOffset,
  landRows,
  landShape,
  packLandShape,
  storedLandShape,
  unpackLandShape,
} from './land';

// Made-up land only.
const square = (west: number, south: number) => [
  [west, south],
  [west + 0.01, south],
  [west + 0.01, south + 0.01],
  [west, south + 0.01],
  [west, south],
];
const polygon = { type: 'Polygon', coordinates: [square(-116.123456, 54.1)] };

describe('landDate', () => {
  it('reads the two ways the province writes a date', () => {
    expect(landDate('1964/02/17')).toBe('1964-02-17');
    expect(landDate('2006-05-08')).toBe('2006-05-08');
  });

  it('refuses words and dates that do not exist', () => {
    expect(landDate('INDEFINITE')).toBeNull();
    expect(landDate('2026/02/30')).toBeNull();
    expect(landDate(null)).toBeNull();
  });
});

describe('landShape', () => {
  it('keeps a polygon as a multipolygon to five decimals, with its box', () => {
    const placed = landShape(polygon);
    expect(placed?.shape).toHaveLength(1);
    expect(placed?.shape[0]?.[0]?.[0]).toEqual([-116.12346, 54.1]);
    expect(placed?.bounds).toEqual([-116.12346, 54.1, -116.11346, 54.11]);
  });

  it('keeps every part of a multipolygon', () => {
    const placed = landShape({
      type: 'MultiPolygon',
      coordinates: [[square(-116, 54)], [square(-115, 53)]],
    });
    expect(placed?.shape).toHaveLength(2);
    expect(placed?.bounds).toEqual([-116, 53, -114.99, 54.01]);
  });

  it('refuses what is not a polygon, is outside Alberta, or is broken', () => {
    expect(landShape({ type: 'Point', coordinates: [-116, 54] })).toBeNull();
    expect(landShape({ type: 'Polygon', coordinates: [square(-100, 54)] })).toBeNull();
    expect(landShape({ type: 'Polygon', coordinates: [[[-116, 54]]] })).toBeNull();
    expect(landShape({ type: 'Polygon', coordinates: [] })).toBeNull();
    expect(landShape(null)).toBeNull();
  });
});

describe('landAgreement', () => {
  const feature = {
    geometry: polygon,
    properties: {
      AgreementType: '002',
      AgreementNumber: '       924',
      TractIdentifier: '00',
      MineralType: 'NG',
      AgreementGroup: 'LEASE',
      Status: 'ACTIVE',
      LicenceVintage: '',
      DesRepName: 'EXAMPLE ENERGY LTD.',
      PartyName: 'EXAMPLE ENERGY LTD.  100%',
      Zone: 'NATURAL GAS IN THE EXAMPLE FM',
      OriginalArea: 1664,
      AgreementArea: 1408.12345,
      TermDate: '1964/02/17',
      ContinuationDate: '1985/02/17',
      CurrentExpiryText: 'INDEFINITE',
    },
  };

  it('reads a tract as the province publishes it', () => {
    expect(landAgreement(feature, 'png')).toMatchObject({
      rights: 'png',
      agreementType: '002',
      agreementNumber: '924',
      tract: '00',
      vintage: null,
      holder: 'EXAMPLE ENERGY LTD.',
      parties: 'EXAMPLE ENERGY LTD. 100%',
      originalAreaHa: 1664,
      areaHa: 1408.1235,
      termDate: '1964-02-17',
      continuationDate: '1985-02-17',
      expiryText: 'INDEFINITE',
    });
  });

  it('refuses a tract with no number or no shape', () => {
    expect(
      landAgreement(
        { ...feature, properties: { ...feature.properties, AgreementNumber: ' ' } },
        'png',
      ),
    ).toBeNull();
    expect(landAgreement({ ...feature, geometry: null }, 'oil_sands')).toBeNull();
  });
});

describe('landOffset and landFreehold', () => {
  it('reads an offset notice', () => {
    expect(
      landOffset({
        geometry: polygon,
        properties: {
          OffsetType: 'AAY',
          OffsetNo: '2050843E02',
          Tract: '00',
          DesRep: 'EXAMPLE ENERGY LTD.',
          ExpiryDate: '2027-05-08',
          ZoneDesc: 'PNG TO BASE  EXAMPLE',
        },
      }),
    ).toMatchObject({
      offsetNumber: '2050843E02',
      expiryDate: '2027-05-08',
      zone: 'PNG TO BASE EXAMPLE',
    });
    expect(landOffset({ geometry: polygon, properties: { OffsetNo: 'a b' } })).toBeNull();
  });

  it('reads land that is not the Crown’s, with its park or reserve when it has one', () => {
    expect(
      landFreehold({
        geometry: polygon,
        properties: {
          LandKey: 501032312,
          NationalPark: null,
          IndianReserveNumber: '',
          SubstanceDescription: 'ALL MINERALS EXCEPT GOLD,SILVER',
        },
      }),
    ).toMatchObject({
      landKey: 501032312,
      substances: 'ALL MINERALS EXCEPT GOLD,SILVER',
      nationalPark: null,
      reserveNumber: null,
    });
  });
});

describe('landRows', () => {
  it('counts the shapes it could not read', () => {
    const read = landRows('freehold', [
      { geometry: polygon, properties: {} },
      { geometry: null, properties: {} },
    ]);
    expect(read.rows).toHaveLength(1);
    expect(read.skipped).toBe(1);
  });
});

describe('packLandShape and unpackLandShape (F-310)', () => {
  const one = landShape(polygon)?.shape ?? [];
  const many =
    landShape({
      type: 'MultiPolygon',
      coordinates: [[square(-116.12345, 54), square(-116.12, 54.002)], [square(-115, 53.00001)]],
    })?.shape ?? [];

  it('keeps one ring as its points only, without the closing point and with no counts', () => {
    expect(packLandShape(one)).toEqual({
      path: [-11612346, 5410000, -11611346, 5410000, -11611346, 5411000, -11612346, 5411000],
      rings: [],
    });
  });

  it('gives back every shape exactly, each ring closed again', () => {
    for (const shape of [one, many]) {
      const packed = packLandShape(shape);
      expect(packed).not.toBeNull();
      expect(unpackLandShape(packed?.path ?? [], packed?.rings ?? [])).toEqual(shape);
    }
    expect(packLandShape(many)?.rings).toEqual([2, 4, 4, 1, 4]);
  });

  it('closes a ring that came open', () => {
    const open: [number, number][][][] = [
      [
        [
          [-116, 54],
          [-115.9, 54],
          [-115.9, 54.1],
        ],
      ],
    ];
    expect(unpackLandShape(packLandShape(open)?.path ?? [], [])).toEqual([
      [
        [
          [-116, 54],
          [-115.9, 54],
          [-115.9, 54.1],
          [-116, 54],
        ],
      ],
    ]);
  });

  it('refuses a ring of fewer than three points, and counts that do not match the points', () => {
    expect(
      packLandShape([
        [
          [
            [-116, 54],
            [-115.9, 54],
            [-116, 54],
          ],
        ],
      ]),
    ).toBeNull();
    expect(packLandShape([])).toBeNull();
    expect(unpackLandShape([1, 2, 3], [])).toBeNull();
    expect(unpackLandShape([1, 2, 3, 4, 5, 6], [1, 4])).toBeNull();
    expect(unpackLandShape([1, 2, 3, 4, 5, 6, 7, 8], [1, 3])).toBeNull();
    expect(unpackLandShape([1, 2, 3, 4, 5, 6], [0])).toBeNull();
    expect(unpackLandShape([], [])).toBeNull();
  });

  it('reads a row in either form', () => {
    const packed = packLandShape(one);
    expect(storedLandShape({ shape: null, path: packed?.path ?? null, rings: [] })).toEqual(one);
    expect(storedLandShape({ shape: one, path: null, rings: [] })).toEqual(one);
  });
});
