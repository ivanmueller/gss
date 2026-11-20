import { describe, expect, it } from 'vitest';

import {
  buildSt37Wells,
  ST37_FORMATIONS,
  st37CsvFields,
  st37Date,
  st37FormationLicences,
  st37LsdCentres,
  st37PlanBottoms,
  st37Reach,
  st37Simplify,
  st37StatusClass,
  st37UwiLsd,
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

describe('st37Simplify', () => {
  it('drops the vertices that lie on the line, and keeps a real bend and both ends', () => {
    // 0.0001 degrees of latitude is about 11 m: the third point is a bend, the second is not.
    const line: [number, number][] = [
      [-113.6, 53.3],
      [-113.6, 53.3001],
      [-113.6, 53.3002],
      [-113.6002, 53.3002],
    ];
    expect(st37Simplify(line, 2)).toEqual([
      [-113.6, 53.3],
      [-113.6, 53.3002],
      [-113.6002, 53.3002],
    ]);
    expect(st37Simplify(line.slice(0, 2), 2)).toEqual(line.slice(0, 2));
  });
});

// Petrinex's Well Licence file, in its layout, with made-up licences (F-252).
const LICENCE_HEADER =
  'LicenceType,LicenceNumber,LicenceIssueDate,LicenceStatus,LicenceStatusDate,Licensee,LicenseeName,LicenceLocation,LicenceLegalSubdivision,LicenceSection,LicenceTownship,LicenceRange,LicenceMeridian,DrillingOperationType,WellPurpose,WellLicenceType,WellSubstance,ProjectedFormation,TerminatingFormation,ProjectedTotalDepth,AERClass,HeadLessor,WellCompletionType,TargetPool,OrphanWellFlg';
const licenceLine = (number: string, status: string, projected: string, depth = '5300.000000000') =>
  `WELL,${number},2026-11-19,${status},2026-11-19,X001,"EXAMPLE ENERGY, LTD.",01-09-043-06W5,1,9,43,6,5,HORIZONTAL,NEW WELL,PRODUCTION,GAS,${projected},DUVERNAY FM,${depth},DEVELOPMENT WELL,ALBERTA CROWN,,,N`;

describe('st37FormationLicences', () => {
  const csv = [
    LICENCE_HEADER,
    licenceLine('0999001', 'ISSUED', 'DUVERNAY FM'),
    licenceLine('0999002', 'CANCELLED', 'DUVERNAY FM'),
    // Only passes through the Duvernay: aimed elsewhere.
    licenceLine('0999003', 'ISSUED', 'SPARKY MBR'),
    licenceLine('0999004', 'Amended', 'DUVERNAY FM', ''),
    '',
  ].join('\r\n');
  const duvernay = ST37_FORMATIONS.duvernay;
  if (!duvernay) throw new Error('no Duvernay');

  it('keeps the licences aimed at the formation, but for the cancelled ones', () => {
    const licences = st37FormationLicences(csv, duvernay);
    expect([...licences.keys()]).toEqual(['0999001', '0999004']);
    expect(licences.get('0999001')).toEqual({
      licenceDate: '2026-11-19',
      operation: 'Horizontal',
      formation: 'Duvernay Fm',
      depthM: 5300,
    });
    expect(licences.get('0999004')?.depthM).toBeNull();
  });

  it('refuses a file that is not the one expected', () => {
    expect(() => st37FormationLicences('a,b\n1,2', duvernay)).toThrow(/no LicenceType column/);
  });

  it('reads quoted fields', () => {
    expect(st37CsvFields('a,"b, ""c""",d')).toEqual(['a', 'b, "c"', 'd']);
  });
});

describe('planned bottom holes', () => {
  it('reads the legal subdivision in a UWI', () => {
    expect(st37UwiLsd('00/01-29-049-26W4/0')).toEqual({
      meridian: 4,
      range: 26,
      township: 49,
      section: 29,
      lsd: 1,
    });
    expect(st37UwiLsd('00/17-29-049-26W4/0')).toBeNull();
    expect(st37UwiLsd('bad')).toBeNull();
  });

  // A subdivision about 400 m square, 1.3 km north of the surface hole, as the grid answers.
  const grid = {
    features: [
      {
        properties: { M: 4, RGE: 26, TWP: 49, SEC: 29, LS: 1 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-113.603, 53.31],
              [-113.597, 53.31],
              [-113.597, 53.314],
              [-113.603, 53.314],
              [-113.603, 53.31],
            ],
          ],
        },
      },
    ],
  };

  it("finds the centre of each subdivision in the grid's answer", () => {
    expect(st37LsdCentres(grid).get('4-26-49-29-1')).toEqual([-113.6, 53.312]);
    expect(() => st37LsdCentres({})).toThrow(/malformed/);
  });

  it('plans a licensed well with no path, from its licence, and no other', () => {
    const LICENSED = '00/01-29-049-26W4/0';
    const VERTICAL = '02/01-29-049-26W4/0';
    const DRILLED = '03/01-29-049-26W4/0';
    const undrilled = { Spud_Date: null, Final_Drill_Date: null };
    const { wells } = buildSt37Wells(
      {
        surface: [surface('0999001', -113.6, 53.3), surface('0999005', -113.6, 53.3)],
        bottom: [
          bottom(LICENSED, '0999001', -113.6, 53.3, undrilled),
          bottom(VERTICAL, '0999005', -113.6, 53.3, undrilled),
          bottom(DRILLED, '0999001', -113.6, 53.312),
        ],
        strings: [],
        paths: [],
      },
      AREA,
      new Map([
        [
          '0999001',
          {
            licenceDate: '2026-11-19',
            operation: 'Horizontal',
            formation: 'Duvernay Fm',
            depthM: 5300,
          },
        ],
        ['0999005', { licenceDate: null, operation: 'Vertical', formation: null, depthM: null }],
      ]),
    );
    expect(wells.map((w) => w.statusClass)).toEqual(['licensed', 'licensed', 'awaiting']);
    expect(wells[0]).toMatchObject({
      licenceDate: '2026-11-19',
      plannedOperation: 'Horizontal',
      plannedFormation: 'Duvernay Fm',
      plannedDepthM: 5300,
      plannedBottom: null,
    });

    expect(st37PlanBottoms(wells, st37LsdCentres(grid))).toBe(1);
    expect(wells.map((w) => w.plannedBottom)).toEqual([[-113.6, 53.312], null, null]);
    // A subdivision the grid did not find, or one at the surface hole, plans nothing.
    for (const w of wells) w.plannedBottom = null;
    expect(st37PlanBottoms(wells, new Map())).toBe(0);
    expect(st37PlanBottoms(wells, new Map([['4-26-49-29-1', [-113.6, 53.3005]]]))).toBe(0);
  });
});
