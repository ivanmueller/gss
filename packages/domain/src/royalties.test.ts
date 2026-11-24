import { describe, expect, it } from 'vitest';

import {
  ROYALTY_FORMULAS_VERSION,
  RoyaltyInputError,
  arfCondensateRate,
  arfDepthFactor,
  arfMethaneEthaneRate,
  arfOilRate,
  cStar,
  equivalentProppant,
  estimateWellRoyalties,
  gasEnergyGJ,
  mrfEquivalentVolume,
  mrfPostCStarRate,
  royaltyFramework,
  royaltyTotals,
  type WellMonthInput,
} from './royalties';

// Alberta's Crown royalty formulas (F-285 part 3). The MRF cases are the guideline's own worked
// examples ("Alberta Modernized Royalty Framework Guidelines", version 1.1); the guideline rounds
// its intermediate steps, the code does not, so exact figures are computed from its inputs.

const v = (oilM3: string | null, gasE3m3: string | null, condensateM3: string | null) => ({
  oilM3,
  gasE3m3,
  condensateM3,
});

describe('MRF post-C* rates, the guideline examples', () => {
  it('oil: light oil at $364.06/m3, 146 m3 in the month (§5)', () => {
    expect(mrfPostCStarRate('oil', '364.06', v('146', null, null))).toEqual({
      ratePct: '11.49756',
      rpPct: '17.97756',
      rqPct: '-6.48',
    });
  });

  it('ethane: $3.20/GJ, 100 e3m3 of gas and 50 m3 of condensate, so the 5% minimum (§6.1)', () => {
    const rate = mrfPostCStarRate('ethane', '3.20', v(null, '100.0', '50.0'));
    expect(rate.rpPct).toBe('9.45');
    expect(rate.rqPct?.startsWith('-7.7236')).toBe(true);
    expect(rate.ratePct).toBe('5');
    expect(mrfEquivalentVolume(v(null, '100.0', '50.0'), 'gas')).toBe('189.055');
  });

  it('propane spec at $102.96/m3, so the 5% minimum (§6.2)', () => {
    const rate = mrfPostCStarRate('propane', '102.96', v(null, '42.9', '12.2'));
    expect(rate.rpPct).toBe('13.00172');
    expect(rate.ratePct).toBe('5');
  });

  it('butanes mix at $250.00/m3, above the maturity threshold (§6.3)', () => {
    expect(mrfPostCStarRate('butanes', '250.00', v(null, '200.0', '110.0'))).toEqual({
      ratePct: '17.45481',
      rpPct: '17.45481',
      rqPct: '0',
    });
  });

  it('pentanes plus spec at $1,200/m3 stops at the 40% maximum (§6.4)', () => {
    expect(mrfPostCStarRate('pentanes_plus', '1200.00', v(null, '346.0', null)).ratePct).toBe('40');
  });

  it('condensate at $200/m3: rp 10%, then the 5% minimum (§6.5)', () => {
    const rate = mrfPostCStarRate('condensate', '200.00', v(null, '100.0', '50.0'));
    expect(rate.rpPct).toBe('10');
    expect(rate.ratePct).toBe('5');
  });

  it('gas stops at 36%, sulphur is 16.66667%, a missing price is refused', () => {
    expect(mrfPostCStarRate('methane', '20.00', v(null, '500', null)).ratePct).toBe('36');
    expect(mrfPostCStarRate('methane', '2.00', v(null, '500', null)).rpPct).toBe('5');
    expect(mrfPostCStarRate('sulphur', null, v(null, null, null)).ratePct).toBe('16.66667');
    expect(() => mrfPostCStarRate('oil', null, v('10', null, null))).toThrow(RoyaltyInputError);
    expect(() => mrfPostCStarRate('oil', '1e3', v('10', null, null))).toThrow(RoyaltyInputError);
  });

  it('the price tables, band by band, as the province rounds them', () => {
    const rp = (product: 'oil' | 'methane' | 'propane' | 'butanes', price: string) =>
      mrfPostCStarRate(product, price, v('1000', '1000', null)).rpPct;
    expect(rp('oil', '409.02')).toBe('21.16972');
    expect(rp('oil', '409.03')).toBe('21.17039');
    expect(rp('oil', '723.64')).toBe('33.44018');
    expect(rp('methane', '3.00')).toBe('8.6');
    expect(rp('propane', '143.16')).toBe('21.12212');
    expect(rp('butanes', '286.31')).toBe('21.12212');
  });
});

describe('C*, the drilling and completion cost allowance', () => {
  it('the guideline example: TVD 4,724 m, TMD 6,210 m, 965 t engineered proppant, ACCI 1.00 (§2.1)', () => {
    expect(
      cStar({
        tvdMaxM: '4724',
        tmdM: '6210',
        proppant: [{ kind: 'engineered', tonnes: '965' }],
        acciYear: 2017,
      }),
    ).toEqual({
      status: 'calculated',
      cStar: '21761420',
      lateralLengthM: '1486',
      y: '1',
      tppe: '2412.5',
    });
  });

  it('a shallow well, the ACCI of its year, and a long multi-leg well', () => {
    const shallow = cStar({
      tvdMaxM: '1500',
      tmdM: '3000',
      proppant: [{ kind: 'sand', tonnes: '1000' }],
      acciYear: 2026,
    });
    // 0.87 × (1,170 × 1,251 + 800 × 1,500 + 0.6 × 1,500 × 1,000)
    expect(shallow).toMatchObject({ status: 'calculated', cStar: '3100392.9' });
    const legs = cStar({
      tvdMaxM: '1000',
      tvdAvgM: '1000',
      tmdM: '20000',
      proppant: [],
      acciYear: 2017,
    });
    // TMD / TVDavg = 20, so Y = max(0.24, 1.39 − 0.8) = 0.59
    expect(legs).toMatchObject({ status: 'calculated', y: '0.59' });
  });

  it('acid counts at its concentration × 10, coated sand at 1.5', () => {
    expect(
      equivalentProppant([
        { kind: 'acid', m3: '100', concentrationPct: '15' },
        { kind: 'coated_sand', tonnes: '10' },
      ]),
    ).toBe('165');
  });

  it('waits for the frac data, the depths or a year without an ACCI', () => {
    expect(cStar({ tvdMaxM: '3000', tmdM: '5000', proppant: null, acciYear: 2020 })).toEqual({
      status: 'waiting',
      missing: ['proppant'],
    });
    expect(cStar({ tvdMaxM: null, tmdM: null, proppant: [], acciYear: 2040 })).toEqual({
      status: 'waiting',
      missing: ['true_vertical_depth', 'measured_depth', 'acci'],
    });
  });
});

describe('ARF rates, the 2009 regulations', () => {
  it('oil: the 2011 table caps at 40%, the 2010 one at 50%', () => {
    expect(arfOilRate('535.00', '304.0', '2015-06')).toEqual({
      ratePct: '40',
      rpPct: '25.35',
      rqPct: '16.568',
    });
    expect(arfOilRate('535.00', '304.0', '2010-12').ratePct).toBe('41.918');
  });

  it('oil: rp stops at 35%, and a low price and volume give 0%', () => {
    expect(arfOilRate('2000.00', '50', '2015-01').rpPct).toBe('35');
    expect(arfOilRate('100.00', '10', '2015-01')).toEqual({
      ratePct: '0',
      rpPct: '-5.4',
      rqPct: '-25.064',
    });
    expect(() => arfOilRate('0', '10', '2015-01')).toThrow(RoyaltyInputError);
  });

  it('condensate counts the gas at 0.78783 e3m3 per m3', () => {
    // 50 m3 + 78.783 e3m3 / 0.78783 = 150 m3; at $250/m3: rp 3.6%, rq 4.36%
    expect(arfCondensateRate('250.00', v(null, '78.783', '50'), '2015-01')).toEqual({
      ratePct: '7.96',
      rpPct: '3.6',
      rqPct: '4.36',
    });
  });

  it('gas: average daily production over the producing hours, and the depth factor', () => {
    const base = {
      parPrice: '6.00',
      volumes: v(null, '300', null),
      hours: 720,
      measuredDepthM: null,
      solutionGas: false,
      productionMonth: '2015-01',
    };
    // ADP 10 e3m3/day: rp (6 − 5.25) × 0.02 + 0.03375 = 4.875%, rq (10 − 6) × 0.03 + 0.1 = 22%
    expect(arfMethaneEthaneRate(base)).toEqual({ ratePct: '26.875', rpPct: '4.875', rqPct: '22' });
    expect(arfDepthFactor('3000')).toBe('2.25');
    expect(arfDepthFactor('4500')).toBe('4');
    expect(arfDepthFactor('1800')).toBe('1');
    expect(
      arfMethaneEthaneRate({ ...base, measuredDepthM: '3000' }).ratePct.startsWith('7.0972'),
    ).toBe(true);
    expect(
      arfMethaneEthaneRate({ ...base, parPrice: '4.00', volumes: v(null, '30', null) }).ratePct,
    ).toBe('5');
    expect(() => arfMethaneEthaneRate({ ...base, hours: 0 })).toThrow(RoyaltyInputError);
  });

  it('gas: the acid gas factor lowers the daily production, solution gas counts the oil', () => {
    const base = {
      parPrice: '6.00',
      volumes: v('0', '300', null),
      hours: 720,
      measuredDepthM: null,
      solutionGas: false,
      productionMonth: '2015-01',
    };
    // AGF 1.03 − 0.13 = 0.90: ADP 9, rq (9 − 6) × 0.03 + 0.1 = 19%
    expect(arfMethaneEthaneRate({ ...base, acidGasFraction: '0.13' }).rqPct).toBe('19');
    // 30% acid gas is above the 25% the factor covers: unchanged
    expect(arfMethaneEthaneRate({ ...base, acidGasFraction: '0.30' }).rqPct).toBe('22');
    // 100 m3 of oil × 1.0686 = 106.86 e3m3 more: ADP 13.562, rq 30% at most
    expect(
      arfMethaneEthaneRate({ ...base, volumes: v('100', '300', null), solutionGas: true }).rqPct,
    ).toBe('27.562');
  });
});

describe('which framework', () => {
  it('follows the spud date and the move of every well to MRF in 2027', () => {
    expect(royaltyFramework('2017-01-01', '2020-05')).toEqual({ framework: 'mrf' });
    expect(royaltyFramework('2016-07-12', '2026-12')).toEqual({ framework: 'arf' });
    expect(royaltyFramework('2016-07-12', '2027-01')).toEqual({ framework: 'mrf_post_c_star' });
    expect(royaltyFramework('2016-07-13', '2020-01')).toEqual({
      framework: null,
      reason: 'early_opt_in_unknown',
    });
    expect(royaltyFramework('2005-03-01', '2008-12')).toEqual({
      framework: null,
      reason: 'before_2009',
    });
    expect(royaltyFramework(null, '2020-01')).toEqual({ framework: null, reason: 'no_spud_date' });
    expect(() => royaltyFramework('2017-1-1', '2020-01')).toThrow(RoyaltyInputError);
  });
});

const prices = {
  oilPar: '389.61',
  methanePar: '2.20',
  gasReference: '2.20',
  pentanesPlusPar: '360.00',
};
const monthOf = (month: string, over: Partial<WellMonthInput> = {}): WellMonthInput => ({
  month,
  volumes: v('240.0', '2.2', '120.0'),
  hours: 744,
  gasGJ: '83',
  prices,
  ...over,
});

describe('a well, month by month', () => {
  it('the guideline C* drawdown example: 5% on every product while below C* (§3)', () => {
    const estimate = estimateWellRoyalties({
      spudDate: '2017-06-15',
      measuredDepthM: null,
      cStar: { status: 'calculated', cStar: '1578900', lateralLengthM: '0', y: '1', tppe: '0' },
      fromFirstProduction: true,
      months: [monthOf('2017-08')],
    });
    expect(estimate.version).toBe(ROYALTY_FORMULAS_VERSION);
    // 240 × 389.61 + 83 × 2.20 + 120 × 360 = 136,889.00 (the example's propane left out)
    expect(estimate.months[0]).toMatchObject({
      status: 'estimated',
      framework: 'mrf',
      cStarPhase: 'pre',
      valueCad: '136889',
      royaltyCad: '6844.45',
      effectivePct: '5',
    });
  });

  it('the month C* is reached blends 5% and the post-C* rate alike on every product', () => {
    const estimate = estimateWellRoyalties({
      spudDate: '2018-01-10',
      measuredDepthM: null,
      cStar: { status: 'calculated', cStar: '150000', lateralLengthM: '0', y: '1', tppe: '0' },
      fromFirstProduction: true,
      months: [monthOf('2018-03'), monthOf('2018-04'), monthOf('2018-05')],
    });
    const [first, second, third] = estimate.months;
    expect(first).toMatchObject({ cStarPhase: 'pre', effectivePct: '5' });
    expect(second).toMatchObject({ cStarPhase: 'reached' });
    expect(third).toMatchObject({ cStarPhase: 'post' });
    // Post-C* oil at $389.61 with 362.0 m3 OEV: rp 19.79161%, above the maturity threshold.
    const oilAfter =
      third?.status === 'estimated' ? third.products.find((p) => p.product === 'oil') : undefined;
    expect(oilAfter?.ratePct).toBe('19.79161');
    // 13,111 of the second month's 136,889 still under C*: 9.578% of it at 5%.
    const oilReached =
      second?.status === 'estimated' ? second.products.find((p) => p.product === 'oil') : undefined;
    expect(oilReached?.ratePct).toBe('18.37489');
    expect(estimate.royaltyCad).not.toBe('0');
  });

  it('waits on the frac data, and on a production history that does not start at the first month', () => {
    const waiting = estimateWellRoyalties({
      spudDate: '2019-02-01',
      measuredDepthM: null,
      cStar: cStar({ tvdMaxM: '3000', tmdM: '5000', proppant: null, acciYear: 2019 }),
      fromFirstProduction: false,
      months: [monthOf('2023-01')],
    });
    expect(waiting.months[0]).toEqual({
      month: '2023-01',
      status: 'blocked',
      blockedBy: ['waiting_on_frac_data', 'production_history_incomplete'],
    });
    expect(waiting.royaltyCad).toBe('0');
    expect(waiting.effectivePct).toBeNull();
  });

  it('an ARF well: blocked without hours or gas energy, then estimated on its own rates', () => {
    const estimate = estimateWellRoyalties({
      spudDate: '2012-05-01',
      measuredDepthM: '4200',
      cStar: null,
      fromFirstProduction: false,
      months: [
        monthOf('2022-01', { hours: null, gasGJ: null }),
        monthOf('2022-02', { volumes: v('150', null, null) }),
        monthOf('2027-01', { volumes: v('150', null, null) }),
      ],
    });
    expect(estimate.months[0]).toEqual({
      month: '2022-01',
      status: 'blocked',
      blockedBy: ['gas_energy', 'producing_hours'],
    });
    // ARF oil at $389.61 and 150 m3: rp 17.561%, rq 4.36%
    expect(estimate.months[1]).toMatchObject({ framework: 'arf', effectivePct: '21.921' });
    // From 2027 the same well pays MRF post-C* rates: rp 19.79161%, rq (150 − 194) × 0.135 = −5.94%
    expect(estimate.months[2]).toMatchObject({
      framework: 'mrf_post_c_star',
      effectivePct: '13.85161',
    });
  });
});

describe('gas energy and totals', () => {
  it("values gas at the Canada Energy Regulator's 37.3 GJ per e3m3", () => {
    expect(gasEnergyGJ('100')).toBe('3730');
    expect(gasEnergyGJ('0.5')).toBe('18.65');
  });

  it('adds only the estimated months', () => {
    expect(
      royaltyTotals([
        {
          month: '2026-01',
          status: 'estimated',
          framework: 'arf',
          products: [],
          valueCad: '1000',
          royaltyCad: '150.5',
          effectivePct: '15.05',
        },
        { month: '2026-02', status: 'blocked', blockedBy: ['oil_par_price'] },
        {
          month: '2026-03',
          status: 'estimated',
          framework: 'arf',
          products: [],
          valueCad: '3000',
          royaltyCad: '249.5',
          effectivePct: '8.31667',
        },
      ]),
    ).toEqual({ months: 2, valueCad: '4000', royaltyCad: '400', effectivePct: '10' });
  });
});
