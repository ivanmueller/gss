import { describe, expect, it } from 'vitest';

import type { PricesAnswer } from '../components/Prices';
import type { ProductionAnswer } from '../components/Production';
import {
  blockText,
  blockedReasons,
  lastMonthsTotals,
  wellMonths,
  wellRoyalty,
} from './wellRoyalty';

// A well's estimated Crown royalty (F-285 part 4). Made-up wells, volumes and prices only.

const SOURCE = {
  name: 'Petrinex',
  loadedAt: '2026-11-20T22:00:00.000Z',
  firstMonth: '2022-01',
  lastMonth: '2026-08',
};

const answer = (months: ProductionAnswer['months']): ProductionAnswer => ({
  source: SOURCE,
  months,
});

const series = (key: string, unit: string, points: [string, string][]) => ({
  key,
  name: key,
  unit,
  points: points.map(([month, price]): [string, string, number] => [month, price, 0]),
});
const PRICES: PricesAnswer = {
  load: null,
  sources: ['https://www.alberta.ca/'],
  series: [
    series('oil_light_par', '$/m3', [
      ['2026-06', '389.61'],
      ['2026-07', '389.61'],
    ]),
    series('methane_isc_par', '$/GJ', [['2026-06', '6.00']]),
    series('gas_reference', '$/GJ', [
      ['2026-06', '6.00'],
      ['2026-07', '6.00'],
    ]),
    series('pentanes_plus_par', '$/m3', [['2026-06', '600.00']]),
  ],
};

const OLD_WELL = { spudDate: '2012-05-01', totalDepthM: 1800, trueVerticalDepthM: 1700 };
const NEW_WELL = { spudDate: '2023-09-03', totalDepthM: 5846, trueVerticalDepthM: 2233 };

describe('the well and its months', () => {
  it('adds the legs together, the hours of the longest leg', () => {
    const months = wellMonths([
      answer([{ month: '2026-06', oil: 100.25, gas: 10, water: 5, condensate: null, hours: 700 }]),
      answer([{ month: '2026-06', oil: 50.5, gas: null, water: null, condensate: 2, hours: 744 }]),
    ]);
    expect(months.get('2026-06')).toEqual({ oil: 150.75, gas: 10, condensate: 2, hours: 744 });
  });

  it('an ARF oil well: its own rate on the light oil par price', () => {
    const { estimate } = wellRoyalty(
      OLD_WELL,
      [answer([{ month: '2026-06', oil: 150, gas: null, water: 3, condensate: null, hours: 720 }])],
      PRICES,
    );
    // Rate for price 17.561%, for quantity 4.36% (AR 222/2008, Schedule).
    expect(estimate.months[0]).toMatchObject({
      status: 'estimated',
      framework: 'arf',
      valueCad: '58441.5',
      effectivePct: '21.921',
    });
  });

  it('values gas at 37.3 GJ per 10³ m³ and blocks a month without a methane par price', () => {
    const { estimate } = wellRoyalty(
      OLD_WELL,
      [
        answer([
          { month: '2026-06', oil: null, gas: 100, water: null, condensate: null, hours: 744 },
          { month: '2026-07', oil: null, gas: 100, water: null, condensate: null, hours: 744 },
        ]),
      ],
      PRICES,
    );
    // 100 × 37.3 GJ × $6.00.
    expect(estimate.months[0]).toMatchObject({ status: 'estimated', valueCad: '22380' });
    expect(estimate.months[1]).toEqual({
      month: '2026-07',
      status: 'blocked',
      blockedBy: ['methane_par_price'],
    });
    expect(blockedReasons(estimate.months)).toEqual([['methane_par_price', 1]]);
    expect(lastMonthsTotals(estimate.months, 12)).toMatchObject({ months: 1, valueCad: '22380' });
  });

  it('a well on the modernized rules waits on its frac data', () => {
    const { estimate, firstLoaded } = wellRoyalty(
      NEW_WELL,
      [
        answer([
          { month: '2026-06', oil: 300, gas: 50, water: null, condensate: null, hours: 744 },
        ]),
      ],
      PRICES,
    );
    expect(firstLoaded).toBe('2022-01');
    // Spud after the load's first month, so its history is whole: only the frac data is missing.
    expect(estimate.months[0]).toEqual({
      month: '2026-06',
      status: 'blocked',
      blockedBy: ['waiting_on_frac_data'],
    });
    expect(blockText('waiting_on_frac_data', null)).toMatch(
      /^Royalty estimate waiting on frac data/,
    );
    expect(blockText('production_history_incomplete', 'Jan 2022')).toContain('before Jan 2022');
  });

  it('a 2016 well spud in the early opt-in window is not estimated', () => {
    const { estimate } = wellRoyalty(
      { ...OLD_WELL, spudDate: '2016-08-01' },
      [
        answer([
          { month: '2026-06', oil: 10, gas: null, water: null, condensate: null, hours: 744 },
        ]),
      ],
      PRICES,
    );
    expect(blockedReasons(estimate.months)).toEqual([['early_opt_in_unknown', 1]]);
  });
});
