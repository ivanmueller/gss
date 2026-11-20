import { describe, expect, it } from 'vitest';

import {
  petrinexDecimal,
  petrinexFirstFreeMonth,
  petrinexMonth,
  petrinexMonths,
  petrinexThousandths,
  petrinexWellUwi,
} from './petrinex';

// Made-up lines in the shape of Petrinex's public Conventional Volumetric Data file.
const HEADER =
  'ProductionMonth,OperatorBAID,OperatorName,ReportingFacilityID,SubmissionDate,ActivityID,ProductID,FromToID,FromToIDProvinceState,FromToIDType,FromToIDIdentifier,Volume,Energy,Hours,CCICode';
const line = (
  activity: string,
  product: string,
  type: string,
  id: string,
  volume: string,
  hours = '',
) =>
  `2026-08,0001,"EXAMPLE ENERGY, LTD.",ABBT0000001,2026-10-20,${activity},${product},AB${type}${id},AB,${type},${id},${volume},,${hours},`;

const WELL = '100112303027W402';
const UWI = '00/11-23-030-27W4/2';

describe('petrinexWellUwi', () => {
  it('writes a well identifier as the UWI the wells use', () => {
    expect(petrinexWellUwi('100020606503W400')).toBe('00/02-06-065-03W4/0');
    expect(petrinexWellUwi(WELL)).toBe(UWI);
    expect(petrinexWellUwi('1AA020606503W500')).toBe('AA/02-06-065-03W5/0');
  });

  it('refuses anything else', () => {
    for (const id of ['', '0051211', '200020606503W400', '100020606503W700', '100020606503W412']) {
      expect(petrinexWellUwi(id)).toBeNull();
    }
  });
});

describe('petrinexThousandths', () => {
  it('reads volumes exactly, and writes them back with three decimals', () => {
    expect(petrinexThousandths('12.5')).toBe(12500);
    expect(petrinexThousandths('0.001')).toBe(1);
    expect(petrinexThousandths('310')).toBe(310000);
    expect(petrinexDecimal(12500)).toBe('12.500');
    expect(petrinexDecimal(1)).toBe('0.001');
    expect(petrinexDecimal(100300 + 200600)).toBe('300.900');
  });

  it('refuses what is not a plain number', () => {
    for (const value of ['', ' ', '-1', '1.2345', '1e3', 'abc']) {
      expect(petrinexThousandths(value)).toBeNull();
    }
  });
});

describe('petrinexMonth', () => {
  const uwis = new Set([UWI]);

  it("keeps a well's production by product, with the most hours reported", () => {
    const { wells, skipped } = petrinexMonth(
      [
        HEADER,
        line('PROD', 'OIL', 'WI', WELL, '310.5', '744'),
        line('PROD', 'GAS', 'WI', WELL, '120.25'),
        line('PROD', 'WATER', 'WI', WELL, '80', '600'),
        // Not its production, not a well, another well, a product not kept.
        line('FUEL', 'GAS', 'WI', WELL, '5'),
        line('PROD', 'GAS', 'BT', '0000002', '900'),
        line('PROD', 'OIL', 'WI', '100020606503W400', '77'),
        line('PROD', 'SAND', 'WI', WELL, '3'),
        '',
      ],
      '2026-08',
      uwis,
    );
    expect(skipped).toBe(0);
    expect([...wells.entries()]).toEqual([
      [UWI, { oil: 310500, gas: 120250, water: 80000, condensate: null, hours: 744 }],
    ]);
  });

  it('adds two lines of the same product and counts an unreadable volume', () => {
    const { wells, skipped } = petrinexMonth(
      [
        HEADER,
        line('PROD', 'COND', 'WI', WELL, '1.1'),
        line('PROD', 'COND', 'WI', WELL, '2.2'),
        line('PROD', 'OIL', 'WI', WELL, 'n/a'),
      ],
      '2026-08',
      uwis,
    );
    expect(wells.get(UWI)?.condensate).toBe(3300);
    expect(wells.get(UWI)?.oil).toBeNull();
    expect(skipped).toBe(1);
  });

  it('refuses a file of another month, a file without its columns and an empty file', () => {
    expect(() =>
      petrinexMonth([HEADER, line('PROD', 'OIL', 'WI', WELL, '1')], '2026-07', uwis),
    ).toThrow(/holds 2026-08, not 2026-07/);
    expect(() => petrinexMonth(['ProductionMonth,Volume'], '2026-08', uwis)).toThrow(
      /no column ActivityID/,
    );
    expect(() => petrinexMonth([], '2026-08', uwis)).toThrow(/empty/);
  });
});

describe('the months asked for', () => {
  it('lists every month between two, across years', () => {
    expect(petrinexMonths('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(petrinexMonths('2026-03', '2026-02')).toEqual([]);
    expect(() => petrinexMonths('2026-13', '2026-02')).toThrow(/Not a month/);
  });

  it('starts at January, four years before the current year', () => {
    expect(petrinexFirstFreeMonth(new Date('2026-11-20T12:00:00Z'))).toBe('2022-01');
  });
});
