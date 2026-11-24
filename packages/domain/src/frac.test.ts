import { describe, expect, it } from 'vitest';

import { fracWells, fromThousandths, thousandths } from './frac';

// The AER's frac file read into one line per well event (F-288). Made-up wells; the layout is
// the AER's own (SummaryChemical-WaterUse.csv, pipe-delimited, disclaimer lines first).

const HEADER =
  'Well_Licence_Number|Last_Submission_Date|Licensee|field_centre|UWI|Well_Name|Number_Of_Stages|Bottom_Hole_Latitude|Bottom_Hole_Longitude|Production_Fluid_Type|Max_True_Vertical_Depth|Total_Water_Volume|Start_Date|End_Date|Component_Type|Component_Trade_Name|Component_Quantity_UOM|Total_Component_Volume_or_Weight|Component_Supplier_Name|Additive_Purpose|Ingredient_Name|CAS#_HMIRC#|Concentration_Component|Concentration_HFF';

interface Line {
  uwi?: string;
  submitted?: string;
  stages?: string;
  tvd?: string;
  water?: string;
  start?: string;
  end?: string;
  type?: string;
  name?: string;
  unit?: string;
  amount?: string;
  ingredient?: string;
}
const line = (l: Line) =>
  [
    '0999999',
    l.submitted ?? '2030-02-01 10:00:00.000',
    'Example Energy Ltd.',
    'Red Deer',
    l.uwi ?? '00/11-23-030-27W4/0',
    'EXAMPLE HZ',
    l.stages ?? '20',
    '53.3',
    '-113.6',
    'CRUDE OIL',
    l.tvd ?? '2233.00',
    l.water ?? '1000.000',
    `${l.start ?? '2030-01-02'} 00:00:00.000`,
    `${l.end ?? '2030-01-10'} 00:00:00.000`,
    l.type ?? 'Proppant',
    l.name ?? 'Sand 40/70',
    l.unit ?? 'Metric Tonnes',
    l.amount ?? '100.500',
    'Example Supplier',
    'NULL',
    l.ingredient ?? 'crystalline silica',
    '14808-60-7',
    '100',
    '10',
  ].join('|');

const file = (...lines: string[]) => [
  `${String.fromCharCode(0xfeff)}AER||Hydraulic Fracturing Summary Chemical and Water Use Data|||`,
  'Disclaimer|||',
  HEADER,
  ...lines,
  '',
];

describe('amounts', () => {
  it('reads three decimals exactly, as whole thousandths', () => {
    expect(thousandths('1376.520')).toBe(1376520);
    expect(thousandths('1,376.5')).toBe(1376500);
    expect(thousandths('NULL')).toBeNull();
    expect(thousandths('-1')).toBeNull();
    expect(fromThousandths(1376520)).toBe('1376.52');
    expect(fromThousandths(5)).toBe('0.005');
    expect(fromThousandths(0)).toBe('0');
  });
});

describe('the frac file', () => {
  it("counts a component's tonnes once however many ingredients it lists", () => {
    const { wells, skipped } = fracWells(
      file(
        line({ name: 'RCS 20/40', amount: '59.100', ingredient: 'aluminum oxide' }),
        line({ name: 'RCS 20/40', amount: '59.100', ingredient: 'silica crystalline' }),
        line({ amount: '100.500' }),
        line({ type: 'Carrier Fluid', name: 'Water', unit: 'm3', amount: '1000.000' }),
      ),
    );
    expect(skipped).toBe(0);
    expect(wells).toEqual([
      {
        uwi: '00/11-23-030-27W4/0',
        licenceNumber: '0999999',
        firstFracDate: '2030-01-02',
        lastFracDate: '2030-01-10',
        fracs: 1,
        stages: 20,
        waterM3: '1000',
        proppantT: '159.6',
        upgradeHintT: '59.1',
        refracProppantT: '0',
        maxTvdM: '2233',
        suspect: false,
      },
    ]);
  });

  it('a frac more than a year after the first is a re-frac, by its own date', () => {
    const { wells } = fracWells(
      file(
        line({ stages: '3', amount: '129.400' }),
        line({
          submitted: '2033-01-01 00:00:00.000',
          stages: '1',
          start: '2032-06-01',
          end: '2032-06-01',
          amount: '59.100',
        }),
        // The later report's water spans both fracs; it does not move the re-frac back.
        line({
          submitted: '2033-01-01 00:00:00.000',
          stages: '4',
          type: 'Carrier Fluid',
          start: '2030-01-02',
          end: '2032-06-01',
          water: '1088.674',
        }),
      ),
    );
    expect(wells[0]).toMatchObject({
      fracs: 2,
      stages: 3,
      proppantT: '129.4',
      refracProppantT: '59.1',
      lastFracDate: '2032-06-01',
      waterM3: '2088.674',
    });
  });

  it('keeps a water-only frac as fractured with no proppant', () => {
    const { wells } = fracWells(file(line({ type: 'Carrier Fluid', name: 'Water', unit: 'm3' })));
    expect(wells[0]).toMatchObject({ proppantT: '0', fracs: 1, firstFracDate: '2030-01-02' });
  });

  it('marks more than 1,000 t a stage as a likely reporting error', () => {
    const { wells } = fracWells(file(line({ stages: '2', amount: '2936632.600' })));
    expect(wells[0]?.suspect).toBe(true);
  });

  it('skips unreadable lines, counts other units, and stops on a changed file', () => {
    const read = fracWells(
      file(line({ uwi: 'not a uwi' }), line({ unit: 'Kilograms' }), line({ start: 'NULL' })),
    );
    expect(read.skipped).toBe(2);
    expect(read.otherUnits).toBe(1);
    expect(() => fracWells(['Disclaimer', 'Well_Licence_Number|UWI'])).toThrow(/has changed/);
    expect(() => fracWells(['Disclaimer'])).toThrow(/no header/);
  });
});
