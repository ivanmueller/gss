import {
  cStar,
  estimateWellRoyalties,
  gasEnergyGJ,
  royaltyTotals,
  type RoyaltyBlock,
  type WellMonthInput,
  type WellMonthRoyalty,
  type WellRoyaltyEstimate,
} from '@grain/domain';

import type { ProductionAnswer } from '../components/Production';
import type { PricesAnswer } from '../components/Prices';

/**
 * A well's estimated Crown royalty on its panel (F-285 part 4): its legs' Petrinex production,
 * the province's prices of each month, and the formulas of packages/domain/src/royalties.ts.
 * Worked out in the browser from what the panel and the Prices section already read; nothing is
 * stored. Amounts stay decimal strings until they are written on screen.
 */

/** What a well's estimate needs from the well itself. */
export interface RoyaltyWell {
  spudDate: string | null;
  totalDepthM: number | null;
  trueVerticalDepthM: number | null;
}

/** The price series each product's rate and value use. */
export const ROYALTY_SERIES = {
  // The regulation's own default when the density is not known (AR 222/2008 s4(4)).
  oilPar: 'oil_light_par',
  methanePar: 'methane_isc_par',
  gasReference: 'gas_reference',
  pentanesPlusPar: 'pentanes_plus_par',
} as const;

/** A volume as the database keeps it (three decimals), as a decimal string. */
const volume = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : n.toFixed(3);

/** Adds the legs' months together (volumes exactly, in thousandths); the hours are the longest leg's. */
export function wellMonths(
  answers: readonly ProductionAnswer[],
): Map<
  string,
  { oil: number | null; gas: number | null; condensate: number | null; hours: number | null }
> {
  const add = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.round((a + b) * 1000) / 1000;
  const byMonth = new Map<
    string,
    { oil: number | null; gas: number | null; condensate: number | null; hours: number | null }
  >();
  for (const answer of answers) {
    for (const m of answer.months) {
      const sum = byMonth.get(m.month);
      const hours = m.hours ?? null;
      byMonth.set(
        m.month,
        sum
          ? {
              oil: add(sum.oil, m.oil),
              gas: add(sum.gas, m.gas),
              condensate: add(sum.condensate, m.condensate),
              hours:
                sum.hours === null
                  ? hours
                  : hours === null
                    ? sum.hours
                    : Math.max(sum.hours, hours),
            }
          : { oil: m.oil, gas: m.gas, condensate: m.condensate, hours },
      );
    }
  }
  return byMonth;
}

/** Each series' price by month, as stored. */
function priceTable(prices: PricesAnswer): Map<string, Map<string, string>> {
  return new Map(
    prices.series.map((s) => [s.key, new Map(s.points.map(([month, price]) => [month, price]))]),
  );
}

export interface WellRoyalty {
  estimate: WellRoyaltyEstimate;
  /** The months the production load covers from; a well spud earlier shows only these. */
  firstLoaded: string | null;
}

/** The well's estimate, month by month, over the production loaded. */
export function wellRoyalty(
  well: RoyaltyWell,
  answers: readonly ProductionAnswer[],
  prices: PricesAnswer,
): WellRoyalty {
  const firstLoaded = answers[0]?.source.firstMonth ?? null;
  const table = priceTable(prices);
  const price = (series: string, month: string) => table.get(series)?.get(month) ?? null;
  const months: WellMonthInput[] = [...wellMonths(answers)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => {
      const gas = volume(m.gas);
      return {
        month,
        volumes: { oilM3: volume(m.oil), gasE3m3: gas, condensateM3: volume(m.condensate) },
        hours: m.hours,
        gasGJ: gas === null ? null : gasEnergyGJ(gas),
        prices: {
          oilPar: price(ROYALTY_SERIES.oilPar, month),
          methanePar: price(ROYALTY_SERIES.methanePar, month),
          gasReference: price(ROYALTY_SERIES.gasReference, month),
          pentanesPlusPar: price(ROYALTY_SERIES.pentanesPlusPar, month),
        },
      };
    });
  const spud = well.spudDate;
  // C* only for wells on the modernized rules from the start; the frac data (F-288) is not
  // loaded yet, so it waits. The ACCI of the spud year: the guideline names the year of the
  // activity for re-entries and says nothing else for new wells.
  const needsCStar = spud !== null && spud >= '2017-01-01';
  return {
    firstLoaded,
    estimate: estimateWellRoyalties({
      spudDate: spud,
      measuredDepthM: well.totalDepthM === null ? null : well.totalDepthM.toFixed(2),
      cStar: needsCStar
        ? cStar({
            tvdMaxM: well.trueVerticalDepthM === null ? null : well.trueVerticalDepthM.toFixed(2),
            tmdM: well.totalDepthM === null ? null : well.totalDepthM.toFixed(2),
            proppant: null,
            acciYear: Number(spud.slice(0, 4)),
          })
        : null,
      // Whole only when the load starts no later than the well's spud month.
      fromFirstProduction: spud !== null && firstLoaded !== null && spud.slice(0, 7) >= firstLoaded,
      months,
    }),
  };
}

/** The last `count` estimated months' totals. */
export function lastMonthsTotals(months: readonly WellMonthRoyalty[], count: number) {
  return royaltyTotals(months.filter((m) => m.status === 'estimated').slice(-count));
}

/** Why months are not estimated, each reason once with how many months it stops. */
export function blockedReasons(months: readonly WellMonthRoyalty[]): [RoyaltyBlock, number][] {
  const counts = new Map<RoyaltyBlock, number>();
  for (const m of months) {
    if (m.status !== 'blocked') continue;
    for (const reason of m.blockedBy) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts];
}

/** A reason in plain words. */
export function blockText(reason: RoyaltyBlock, firstLoaded: string | null): string {
  switch (reason) {
    case 'waiting_on_frac_data':
      return 'Royalty estimate waiting on frac data: the well’s drilling and completion cost allowance (C*) needs the proppant placed.';
    case 'c_star_inputs_missing':
      return 'Its drilling and completion cost allowance (C*) needs its depths, which are not known.';
    case 'production_history_incomplete':
      return `Its production before ${firstLoaded ?? 'the months loaded'} is not loaded, so how much of its cost allowance (C*) is used up is not known.`;
    case 'no_spud_date':
      return 'The well has no spud date, so which royalty rules apply is not known.';
    case 'before_2009':
      return 'Months before 2009 fall under earlier rules not covered here.';
    case 'early_opt_in_unknown':
      return 'Spud between 13 July and 31 December 2016: it may have opted in early to the modernized rules, and those elections are not public.';
    case 'oil_par_price':
      return 'No oil par price for the month.';
    case 'methane_par_price':
      return 'No methane par price for the month yet: GitHub → Actions → Load prices loads it.';
    case 'gas_reference_price':
      return 'No gas reference price for the month.';
    case 'pentanes_plus_par_price':
      return 'No pentanes plus par price for the month.';
    case 'gas_energy':
      return 'No energy for the month’s gas.';
    case 'producing_hours':
      return 'No producing hours reported for the month.';
  }
}
