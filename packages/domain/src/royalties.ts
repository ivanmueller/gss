import { Decimal } from 'decimal.js';

// Alberta's Crown royalty formulas (F-285 part 3, docs/FEATURES_OIL_GAS.md): both frameworks,
// every product, decimal arithmetic, a missing input blocking the result (AGENTS.md rules 1
// and 3). Every number below is copied from the province's own text, read 2026-11-23:
// - MRF: "Alberta Modernized Royalty Framework Guidelines, Principles and Procedures",
//   version 1.1 (sections 2 to 6), and the formula sheets "Modernized Royalty Framework:
//   Formulas" for oil, gas and C*; the ACCI from the province's C* calculator page.
// - ARF: the Petroleum Royalty Regulation, 2009 (AR 222/2008, consolidated to AR 89/2013),
//   its Schedule; the Natural Gas Royalty Regulation, 2009 (AR 221/2008, consolidated to AR
//   80/2020), section 8(6) and (7) and Schedules 2 to 6.
// The sources and what is left out are listed in docs/FEATURES_OIL_GAS.md, F-285.

/** Changes whenever a formula or a constant here changes; kept with every saved estimate. */
export const ROYALTY_FORMULAS_VERSION = 'alberta-royalty-2026-11-23';

const Exact = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_EVEN });
type Num = InstanceType<typeof Exact>;

export class RoyaltyInputError extends Error {}

const DECIMAL = /^-?\d{1,15}(?:\.\d{1,15})?$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function num(text: string, what: string): Num {
  if (!DECIMAL.test(text)) throw new RoyaltyInputError(`${what}: not a decimal: "${text}"`);
  return new Exact(text);
}
function month(text: string): string {
  if (!MONTH.test(text)) throw new RoyaltyInputError(`Not a month (YYYY-MM): "${text}"`);
  return text;
}
const d = (text: string) => new Exact(text);
const ZERO = d('0');
/** A decimal as plain text, never in exponent form, never "-0". */
const text = (n: Num) => (n.isZero() ? '0' : n.toFixed());
const clamp = (n: Num, low: Num, high: Num) => Exact.max(low, Exact.min(high, n));

/** One band of a price or quantity table: from `start`, `base + (x - start) × slope`. */
interface Band {
  /** The band's upper end, included; null for the last band. */
  upTo: string | null;
  start: string;
  slope: string;
  base: string;
}
function piecewise(x: Num, bands: readonly Band[]): Num {
  const band = bands.find((b) => b.upTo === null || x.lte(b.upTo)) ?? bands[bands.length - 1];
  if (band === undefined) throw new Error('An empty table');
  return x.minus(band.start).times(band.slope).plus(band.base);
}
const flat = (upTo: string, base: string): Band => ({ upTo, start: '0', slope: '0', base });

/** The products the formulas name. */
export type RoyaltyProduct =
  'oil' | 'condensate' | 'methane' | 'ethane' | 'propane' | 'butanes' | 'pentanes_plus' | 'sulphur';

/** A month's well production, as Petrinex reports it; null where a product is not reported. */
export interface WellVolumes {
  oilM3: string | null;
  gasE3m3: string | null;
  condensateM3: string | null;
}

/** A royalty rate, in per cent, with its price and quantity parts where the formula has them. */
export interface RoyaltyRate {
  ratePct: string;
  rpPct?: string;
  rqPct?: string;
}

// ---------------------------------------------------------------------------------------------
// The Modernized Royalty Framework (wells spud on or after 1 January 2017, and every well from
// 1 January 2027).

/** The flat rate while a well's revenue is below its C* (guideline §4.1). */
export const MRF_PRE_C_STAR_PCT = '5';
/** Sulphur, unchanged from ARF (guideline §6, "Royalty Rate for Sulphur"). */
export const SULPHUR_PCT = '16.66667';
/** Oil and gas equivalence: 1 m3 of oil or condensate to 1.7811 e3m3 of gas (guideline §4.2). */
export const MRF_EQUIVALENCE = '1.7811';

interface MrfTable {
  bands: readonly Band[];
  maxPct: string;
  /** Which maturity threshold the product's quantity part uses. */
  quantity: 'oil' | 'gas';
}

// Guideline Tables 2, 10 and 12 (oil, pentanes plus, condensate): par price in $/m3.
const MRF_OIL: MrfTable = {
  bands: [
    flat('251.70', '0.10'),
    { upTo: '409.02', start: '251.70', slope: '0.00071', base: '0.10000' },
    { upTo: '723.64', start: '409.02', slope: '0.00039', base: '0.21170' },
    { upTo: null, start: '723.64', slope: '0.00020', base: '0.33440' },
  ],
  maxPct: '40',
  quantity: 'oil',
};
// Guideline Table 4 (methane and ethane): par price in $/GJ.
const MRF_GAS: MrfTable = {
  bands: [
    flat('2.40', '0.05'),
    { upTo: '3.00', start: '2.40', slope: '0.06000', base: '0.05000' },
    { upTo: '6.75', start: '3.00', slope: '0.04250', base: '0.08600' },
    { upTo: null, start: '6.75', slope: '0.02250', base: '0.24538' },
  ],
  maxPct: '36',
  quantity: 'gas',
};
// Guideline Table 6 (propane): the propane mix (or spec) par price in $/m3.
const MRF_PROPANE: MrfTable = {
  bands: [
    flat('88.10', '0.10'),
    { upTo: '143.16', start: '88.10', slope: '0.00202', base: '0.10000' },
    { upTo: '253.28', start: '143.16', slope: '0.00111', base: '0.21122' },
    { upTo: null, start: '253.28', slope: '0.00059', base: '0.33347' },
  ],
  maxPct: '36',
  quantity: 'oil',
};
// Guideline Table 8 (butanes): the butanes mix (or spec) par price in $/m3.
const MRF_BUTANES: MrfTable = {
  bands: [
    flat('176.19', '0.10'),
    { upTo: '286.31', start: '176.19', slope: '0.00101', base: '0.10000' },
    { upTo: '506.55', start: '286.31', slope: '0.00055', base: '0.21122' },
    { upTo: null, start: '506.55', slope: '0.00031', base: '0.33235' },
  ],
  maxPct: '36',
  quantity: 'oil',
};

const MRF_TABLES: Record<Exclude<RoyaltyProduct, 'sulphur'>, MrfTable> = {
  oil: MRF_OIL,
  condensate: MRF_OIL,
  pentanes_plus: MRF_OIL,
  methane: MRF_GAS,
  ethane: MRF_GAS,
  propane: MRF_PROPANE,
  butanes: MRF_BUTANES,
};

// Maturity thresholds (guideline §4.2, Tables 3 and 5): oil equivalent 194.0 m3 a month,
// gas equivalent 345.5 e3m3 a month; below them the quantity part is negative.
const MATURITY = {
  oil: { threshold: '194.0', slope: '0.001350' },
  gas: { threshold: '345.5', slope: '0.0004937' },
} as const;

const volume = (v: string | null, what: string) => (v === null ? ZERO : num(v, what));

/** The well's month in oil equivalent m3 (OEV) or gas equivalent e3m3 (GEV), guideline §4.2. */
export function mrfEquivalentVolume(volumes: WellVolumes, basis: 'oil' | 'gas'): string {
  const liquids = volume(volumes.oilM3, 'oil').plus(volume(volumes.condensateM3, 'condensate'));
  const gas = volume(volumes.gasE3m3, 'gas');
  return text(
    basis === 'oil'
      ? liquids.plus(gas.dividedBy(MRF_EQUIVALENCE))
      : gas.plus(liquids.times(MRF_EQUIVALENCE)),
  );
}

/**
 * The MRF post-C* rate of one product for a month: R% = rp + rq, between 5% and the product's
 * maximum. `parPrice` is the product's par price ($/m3 for liquids, $/GJ for methane and
 * ethane): oil by its density class, condensate and pentanes plus by the pentanes plus spec,
 * methane by the methane ISC par price, propane and butanes by their mix (or spec) price.
 */
export function mrfPostCStarRate(
  product: RoyaltyProduct,
  parPrice: string | null,
  volumes: WellVolumes,
): RoyaltyRate {
  if (product === 'sulphur') return { ratePct: SULPHUR_PCT };
  if (parPrice === null) throw new RoyaltyInputError(`${product}: no par price`);
  const table = MRF_TABLES[product];
  const max = d(table.maxPct);
  const rp = Exact.min(
    max,
    piecewise(num(parPrice, `${product} par price`), table.bands).times(100),
  );
  const maturity = MATURITY[table.quantity];
  const q = d(mrfEquivalentVolume(volumes, table.quantity));
  const rq = q.gte(maturity.threshold)
    ? ZERO
    : q.minus(maturity.threshold).times(maturity.slope).times(100);
  return {
    ratePct: text(clamp(rp.plus(rq), d(MRF_PRE_C_STAR_PCT), max)),
    rpPct: text(rp),
    rqPct: text(rq),
  };
}

// C*, the drilling and completion cost allowance (guideline §2.1, the C* formula sheet).

/** The Alberta Capital Cost Index by year, as the province's C* calculator lists it. */
export const ACCI: Readonly<Record<number, string>> = {
  2017: '1.00',
  2018: '1.00',
  2019: '0.95',
  2020: '0.90',
  2021: '0.86',
  2022: '0.82',
  2023: '0.86',
  2024: '0.90',
  2025: '0.90',
  2026: '0.87',
  2027: '0.83',
};

/** Proppant placed, by kind (guideline Table 1, TPPe). */
export type ProppantPlaced =
  | { kind: 'sand' | 'coated_sand' | 'engineered'; tonnes: string }
  | { kind: 'acid'; m3: string; concentrationPct: string };

const PROPPANT_FACTOR = { sand: '1', coated_sand: '1.5', engineered: '2.5' } as const;

/** Total equivalent proppant placed, in tonnes: sand 1, coated sand 1.5, engineered 2.5, acid its concentration × 10. */
export function equivalentProppant(placed: readonly ProppantPlaced[]): string {
  let total = ZERO;
  for (const p of placed) {
    total =
      p.kind === 'acid'
        ? total.plus(
            num(p.m3, 'acid').times(num(p.concentrationPct, 'acid concentration').dividedBy(10)),
          )
        : total.plus(num(p.tonnes, p.kind).times(PROPPANT_FACTOR[p.kind]));
  }
  return text(total);
}

export interface CStarInput {
  /** The deepest true vertical depth of the well's legs, m. */
  tvdMaxM: string | null;
  /** The average true vertical depth of its legs, m; the deepest when it has one leg. */
  tvdAvgM?: string | null;
  /** Total measured depth, every leg together, m. */
  tmdM: string | null;
  /** Proppant placed; null until the well's frac data is loaded (F-288). */
  proppant: readonly ProppantPlaced[] | null;
  /** The year whose ACCI applies. */
  acciYear: number;
}

export type CStarMissing = 'true_vertical_depth' | 'measured_depth' | 'proppant' | 'acci';

export type CStarResult =
  | { status: 'calculated'; cStar: string; lateralLengthM: string; y: string; tppe: string }
  | { status: 'waiting'; missing: CStarMissing[] };

/**
 * A new well's C*:
 * ACCI × (1,170 × (TVD − 249) [+ 3,120 × (TVD − 2,000) below 2,000 m] + Y × 800 × TLL + 0.6 × TVDavg × TPPe).
 * The province counts a missing proppant figure as zero; here it waits for the frac data (the
 * owner, 2026-11-23), so no well is shown a C* lower than its own.
 */
export function cStar(input: CStarInput): CStarResult {
  const missing: CStarMissing[] = [];
  if (input.tvdMaxM === null) missing.push('true_vertical_depth');
  if (input.tmdM === null) missing.push('measured_depth');
  if (input.proppant === null) missing.push('proppant');
  const acci = ACCI[input.acciYear];
  if (acci === undefined) missing.push('acci');
  if (
    missing.length > 0 ||
    input.tvdMaxM === null ||
    input.tmdM === null ||
    input.proppant === null ||
    acci === undefined
  ) {
    return { status: 'waiting', missing };
  }
  const tvd = num(input.tvdMaxM, 'TVD');
  const tvdAvg = input.tvdAvgM == null ? tvd : num(input.tvdAvgM, 'average TVD');
  const tmd = num(input.tmdM, 'measured depth');
  const tll = Exact.max(ZERO, tmd.minus(tvd));
  const ratio = tvdAvg.isZero() ? ZERO : tmd.dividedBy(tvdAvg);
  const y = ratio.lt(10) ? d('1') : Exact.max(d('0.24'), d('1.39').minus(ratio.times('0.04')));
  const tppe = d(equivalentProppant(input.proppant));
  let costs = Exact.max(ZERO, tvd.minus(249)).times(1170);
  if (tvd.gt(2000)) costs = costs.plus(tvd.minus(2000).times(3120));
  costs = costs.plus(y.times(800).times(tll)).plus(tvdAvg.times('0.6').times(tppe));
  return {
    status: 'calculated',
    cStar: text(costs.times(acci)),
    lateralLengthM: text(tll),
    y: text(y),
    tppe: text(tppe),
  };
}

// ---------------------------------------------------------------------------------------------
// The Alberta Royalty Framework of 2009 (wells spud before 2017 that did not opt in to MRF,
// production months of 2009 to 2026).

const ARF_LAST_TABLE_1_MONTH = '2010-12';

// Petroleum Royalty Regulation, 2009, Schedule s3: rate for price, par price in $/m3.
const ARF_OIL_PRICE_1: readonly Band[] = [
  { upTo: '250.00', start: '190.00', slope: '0.0006', base: '0' },
  { upTo: '400.00', start: '250.00', slope: '0.0010', base: '0.0360' },
  { upTo: null, start: '400.00', slope: '0.0005', base: '0.1860' },
];
const ARF_OIL_PRICE_2: readonly Band[] = [
  { upTo: '250.00', start: '190.00', slope: '0.0006', base: '0' },
  { upTo: '400.00', start: '250.00', slope: '0.0010', base: '0.0360' },
  { upTo: '535.00', start: '400.00', slope: '0.0005', base: '0.1860' },
  { upTo: null, start: '535.00', slope: '0.0003', base: '0.2535' },
];
// Schedule s4: rate for quantity, the well event's monthly oil in m3.
const ARF_OIL_QUANTITY: readonly Band[] = [
  { upTo: '106.4', start: '106.4', slope: '0.0026', base: '0' },
  { upTo: '197.6', start: '106.4', slope: '0.0010', base: '0' },
  { upTo: '304.0', start: '197.6', slope: '0.0007', base: '0.0912' },
  { upTo: null, start: '304.0', slope: '0.0003', base: '0.1657' },
];

function positivePrice(price: string | null, what: string): Num {
  if (price === null) throw new RoyaltyInputError(`${what}: no par price`);
  const p = num(price, what);
  // The tables start at "par price greater than zero".
  if (p.lte(0)) throw new RoyaltyInputError(`${what}: the tables need a price above zero`);
  return p;
}

function arfOilFormula(parPrice: Num, quantity: Num, productionMonth: string): RoyaltyRate {
  const early = month(productionMonth) <= ARF_LAST_TABLE_1_MONTH;
  const rp = Exact.min(
    d('35'),
    piecewise(parPrice, early ? ARF_OIL_PRICE_1 : ARF_OIL_PRICE_2).times(100),
  );
  const rq = Exact.min(d('30'), piecewise(quantity, ARF_OIL_QUANTITY).times(100));
  return {
    ratePct: text(clamp(rp.plus(rq), ZERO, d(early ? '50' : '40'))),
    rpPct: text(rp),
    rqPct: text(rq),
  };
}

/** ARF crude oil (Petroleum Royalty Regulation, 2009, Schedule s2 to s4). */
export function arfOilRate(
  parPrice: string | null,
  oilM3: string | null,
  productionMonth: string,
): RoyaltyRate {
  return arfOilFormula(positivePrice(parPrice, 'oil'), volume(oilM3, 'oil'), productionMonth);
}

/** Gas to field condensate: 0.78783 e3m3 of gas per m3 (Natural Gas Royalty Regulation, 2009, s5(7)). */
export const ARF_GAS_PER_CONDENSATE_M3 = '0.78783';

/**
 * ARF field condensate: the oil formula with the pentanes plus par price, its quantity the
 * condensate plus the well's gas as condensate (Natural Gas Royalty Regulation, 2009, s8(6), (7)).
 */
export function arfCondensateRate(
  pentanesPlusParPrice: string | null,
  volumes: WellVolumes,
  productionMonth: string,
): RoyaltyRate {
  const quantity = volume(volumes.condensateM3, 'condensate').plus(
    volume(volumes.gasE3m3, 'gas').dividedBy(ARF_GAS_PER_CONDENSATE_M3),
  );
  return arfOilFormula(
    positivePrice(pentanesPlusParPrice, 'pentanes plus'),
    quantity,
    productionMonth,
  );
}

// Natural Gas Royalty Regulation, 2009, Schedule 2 s3: methane and ethane, par price in $/GJ.
const ARF_GAS_PRICE_1: readonly Band[] = [
  { upTo: '7.00', start: '4.50', slope: '0.0450', base: '0' },
  { upTo: '11.00', start: '7.00', slope: '0.0300', base: '0.1125' },
  { upTo: null, start: '11.00', slope: '0.0100', base: '0.2325' },
];
const ARF_GAS_PRICE_2: readonly Band[] = [
  { upTo: '5.25', start: '4.50', slope: '0.0450', base: '0' },
  { upTo: '9.00', start: '5.25', slope: '0.0200', base: '0.03375' },
  { upTo: null, start: '9.00', slope: '0.0100', base: '0.10875' },
];
/** Oil to gas for the ADP of solution gas: 1.0686 e3m3 per m3 (Schedule 2 s4(5)). */
export const ARF_GAS_PER_OIL_M3 = '1.0686';

export interface ArfGasInput {
  /** The methane ISC par price, $/GJ. */
  parPrice: string | null;
  volumes: WellVolumes;
  /** Hours the well event produced in the month. */
  hours: number | null;
  /** Measured depth to the base of the deepest producing interval, m; null if unknown. */
  measuredDepthM: string | null;
  /** Hydrogen sulphide and carbon dioxide together, as a fraction of the gas (0.10 = 10%); null if unknown. */
  acidGasFraction?: string | null;
  /** Solution gas (from an oil well event): its ADP counts the oil as gas. */
  solutionGas: boolean;
  productionMonth: string;
}

/** The depth factor (Schedule 2 s6): 1 to 2,000 m or unknown, (MD / 2,000)² below, 4 from 4,000 m. */
export function arfDepthFactor(measuredDepthM: string | null): string {
  if (measuredDepthM === null) return '1';
  const md = num(measuredDepthM, 'measured depth');
  if (md.lte(2000)) return '1';
  if (md.gte(4000)) return '4';
  return text(md.dividedBy(2000).pow(2));
}

/** ARF methane and ethane (Natural Gas Royalty Regulation, 2009, Schedule 2 s2 to s6). */
export function arfMethaneEthaneRate(input: ArfGasInput): RoyaltyRate {
  const early = month(input.productionMonth) <= ARF_LAST_TABLE_1_MONTH;
  const price = positivePrice(input.parPrice, 'methane');
  if (input.hours === null || input.hours <= 0) {
    throw new RoyaltyInputError('methane: no producing hours for the average daily production');
  }
  let gas = volume(input.volumes.gasE3m3, 'gas');
  if (input.solutionGas)
    gas = gas.plus(volume(input.volumes.oilM3, 'oil').times(ARF_GAS_PER_OIL_M3));
  let adp = gas.dividedBy(input.hours).times(24);
  // The acid gas factor applies when H2S and CO2 are above 3% and at most 25% (s5).
  if (input.acidGasFraction != null && !input.solutionGas) {
    const acid = num(input.acidGasFraction, 'acid gas');
    if (acid.gt('0.03') && acid.lte('0.25')) {
      adp = adp.times(clamp(d('1.03').minus(acid), d('0.78'), d('1.00')));
    }
  }
  const df = d(arfDepthFactor(input.measuredDepthM));
  const rp = Exact.min(
    d('30'),
    piecewise(price, early ? ARF_GAS_PRICE_1 : ARF_GAS_PRICE_2).times(100),
  );
  const quantity: readonly Band[] = [
    {
      upTo: text(df.times(6)),
      start: text(df.times(4)),
      slope: text(d('0.0500').dividedBy(df)),
      base: '0',
    },
    {
      upTo: text(df.times(11)),
      start: text(df.times(6)),
      slope: text(d('0.0300').dividedBy(df)),
      base: '0.1000',
    },
    {
      upTo: null,
      start: text(df.times(11)),
      slope: text(d('0.0100').dividedBy(df)),
      base: '0.25000',
    },
  ];
  const rq = Exact.min(d('30'), piecewise(adp, quantity).times(100));
  return {
    ratePct: text(clamp(rp.plus(rq), d('5'), d(early ? '50' : '36'))),
    rpPct: text(rp),
    rqPct: text(rq),
  };
}

/** ARF fixed shares: propane and butanes 30%, pentanes plus 40%, sulphur 16.66667% (Schedules 3 to 6). */
export const ARF_FIXED_PCT = {
  propane: '30',
  butanes: '30',
  pentanes_plus: '40',
  sulphur: SULPHUR_PCT,
} as const;

// ---------------------------------------------------------------------------------------------
// Which framework a well's month falls under.

export type RoyaltyFramework =
  | { framework: 'mrf' }
  | { framework: 'mrf_post_c_star' }
  | { framework: 'arf' }
  | { framework: null; reason: 'no_spud_date' | 'before_2009' | 'early_opt_in_unknown' };

/**
 * MRF for wells spud on or after 1 January 2017; ARF until 31 December 2026 for wells spud
 * before 13 July 2016, then MRF post-C* rates for every well (guideline §1). A well spud from
 * 13 July to 31 December 2016 may have opted in to MRF early; the elections are not public.
 * Production months before 2009 fell under rules not covered here.
 */
export function royaltyFramework(
  spudDate: string | null,
  productionMonth: string,
): RoyaltyFramework {
  month(productionMonth);
  if (spudDate === null) return { framework: null, reason: 'no_spud_date' };
  if (!DAY.test(spudDate)) throw new RoyaltyInputError(`Not a date (YYYY-MM-DD): "${spudDate}"`);
  if (spudDate >= '2017-01-01') return { framework: 'mrf' };
  if (spudDate >= '2016-07-13') return { framework: null, reason: 'early_opt_in_unknown' };
  if (productionMonth >= '2027-01') return { framework: 'mrf_post_c_star' };
  if (productionMonth < '2009-01') return { framework: null, reason: 'before_2009' };
  return { framework: 'arf' };
}

// ---------------------------------------------------------------------------------------------
// A well's estimated Crown royalty, month by month, from its reported production.

export interface WellMonthInput {
  month: string;
  volumes: WellVolumes;
  hours: number | null;
  /** The energy of the month's gas, GJ, to value it; null when not known. */
  gasGJ: string | null;
  prices: {
    /** The par price of the well's oil density class, $/m3. */
    oilPar: string | null;
    /** The methane ISC par price, $/GJ (the rate of the gas). */
    methanePar: string | null;
    /** The gas reference price, $/GJ (the value of the gas). */
    gasReference: string | null;
    /** The pentanes plus (spec) par price, $/m3 (condensate's rate and value). */
    pentanesPlusPar: string | null;
  };
}

export interface WellRoyaltyInput {
  spudDate: string | null;
  /** Measured depth, m, for ARF's depth factor; null if unknown. */
  measuredDepthM: string | null;
  /** The well's C*; null for a well that never needs one. */
  cStar: CStarResult | null;
  /** True when `months` starts at the well's first production month, so C*'s drawdown is whole. */
  fromFirstProduction: boolean;
  /** Months in order, oldest first. */
  months: readonly WellMonthInput[];
}

export type RoyaltyBlock =
  | 'no_spud_date'
  | 'before_2009'
  | 'early_opt_in_unknown'
  | 'waiting_on_frac_data'
  | 'c_star_inputs_missing'
  | 'production_history_incomplete'
  | 'oil_par_price'
  | 'methane_par_price'
  | 'gas_reference_price'
  | 'pentanes_plus_par_price'
  | 'gas_energy'
  | 'producing_hours';

export interface ProductRoyalty {
  product: 'oil' | 'gas' | 'condensate';
  /** The rate applied, per cent; a blend of 5% and the post-C* rate in the month C* is reached. */
  ratePct: string;
  valueCad: string;
  royaltyCad: string;
}

export type WellMonthRoyalty =
  | {
      month: string;
      status: 'estimated';
      framework: 'mrf' | 'mrf_post_c_star' | 'arf';
      /** For MRF wells with a C*: before, reached in, or after this month. */
      cStarPhase?: 'pre' | 'reached' | 'post';
      products: ProductRoyalty[];
      valueCad: string;
      royaltyCad: string;
      /** Royalty over value, per cent; null for a month with no value. */
      effectivePct: string | null;
    }
  | { month: string; status: 'blocked'; blockedBy: RoyaltyBlock[] };

export interface WellRoyaltyEstimate {
  version: string;
  months: WellMonthRoyalty[];
  /** Over the estimated months only. */
  valueCad: string;
  royaltyCad: string;
  effectivePct: string | null;
}

const toMoney = (n: Num) => text(n.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN));
const share = (part: Num, whole: Num) =>
  whole.isZero() ? null : text(part.dividedBy(whole).times(100).toDecimalPlaces(5));

/**
 * Each month's estimated Crown royalty: each product's rate × its volume × its price, before any
 * cost allowance, as if the well were all Crown land. Gas is valued at the gas reference price
 * per GJ and rated as methane; the gas liquids extracted from it downstream are not separated.
 */
export function estimateWellRoyalties(input: WellRoyaltyInput): WellRoyaltyEstimate {
  const months: WellMonthRoyalty[] = [];
  let cumulative = ZERO;
  let totalValue = ZERO;
  let totalRoyalty = ZERO;
  for (const m of input.months) {
    const result = estimateMonth(input, m, cumulative);
    if (result.status === 'estimated') {
      totalValue = totalValue.plus(result.valueCad);
      totalRoyalty = totalRoyalty.plus(result.royaltyCad);
      if (result.framework === 'mrf') cumulative = cumulative.plus(result.valueCad);
    }
    months.push(result);
  }
  return {
    version: ROYALTY_FORMULAS_VERSION,
    months,
    valueCad: toMoney(totalValue),
    royaltyCad: toMoney(totalRoyalty),
    effectivePct: share(totalRoyalty, totalValue),
  };
}

function estimateMonth(
  input: WellRoyaltyInput,
  m: WellMonthInput,
  cumulative: Num,
): WellMonthRoyalty {
  const which = royaltyFramework(input.spudDate, m.month);
  if (which.framework === null)
    return { month: m.month, status: 'blocked', blockedBy: [which.reason] };
  const blocks: RoyaltyBlock[] = [];
  const oil = volume(m.volumes.oilM3, 'oil');
  const gas = volume(m.volumes.gasE3m3, 'gas');
  const condensate = volume(m.volumes.condensateM3, 'condensate');
  if (oil.gt(0) && m.prices.oilPar === null) blocks.push('oil_par_price');
  if (gas.gt(0)) {
    if (m.prices.methanePar === null) blocks.push('methane_par_price');
    if (m.prices.gasReference === null) blocks.push('gas_reference_price');
    if (m.gasGJ === null) blocks.push('gas_energy');
    if (which.framework === 'arf' && (m.hours === null || m.hours <= 0))
      blocks.push('producing_hours');
  }
  if (condensate.gt(0) && m.prices.pentanesPlusPar === null) blocks.push('pentanes_plus_par_price');
  if (which.framework === 'mrf') {
    if (input.cStar === null || input.cStar.status === 'waiting') {
      blocks.push(
        input.cStar?.status === 'waiting' &&
          input.cStar.missing.length === 1 &&
          input.cStar.missing[0] === 'proppant'
          ? 'waiting_on_frac_data'
          : 'c_star_inputs_missing',
      );
    }
    if (!input.fromFirstProduction) blocks.push('production_history_incomplete');
  }
  if (blocks.length > 0) return { month: m.month, status: 'blocked', blockedBy: blocks };

  const values = {
    oil: oil.gt(0) ? oil.times(num(m.prices.oilPar ?? '0', 'oil par price')) : ZERO,
    gas: gas.gt(0)
      ? num(m.gasGJ ?? '0', 'gas energy').times(
          num(m.prices.gasReference ?? '0', 'gas reference price'),
        )
      : ZERO,
    condensate: condensate.gt(0)
      ? condensate.times(num(m.prices.pentanesPlusPar ?? '0', 'pentanes plus par price'))
      : ZERO,
  };
  const valueCad = values.oil.plus(values.gas).plus(values.condensate);

  // The post-C* (or ARF) rate of each product reported.
  const rates: Record<'oil' | 'gas' | 'condensate', Num> = {
    oil: ZERO,
    gas: ZERO,
    condensate: ZERO,
  };
  if (which.framework === 'arf') {
    if (oil.gt(0)) rates.oil = d(arfOilRate(m.prices.oilPar, m.volumes.oilM3, m.month).ratePct);
    if (gas.gt(0)) {
      rates.gas = d(
        arfMethaneEthaneRate({
          parPrice: m.prices.methanePar,
          volumes: m.volumes,
          hours: m.hours,
          measuredDepthM: input.measuredDepthM,
          solutionGas: oil.gt(0),
          productionMonth: m.month,
        }).ratePct,
      );
    }
    if (condensate.gt(0)) {
      rates.condensate = d(arfCondensateRate(m.prices.pentanesPlusPar, m.volumes, m.month).ratePct);
    }
  } else {
    if (oil.gt(0)) rates.oil = d(mrfPostCStarRate('oil', m.prices.oilPar, m.volumes).ratePct);
    if (gas.gt(0))
      rates.gas = d(mrfPostCStarRate('methane', m.prices.methanePar, m.volumes).ratePct);
    if (condensate.gt(0)) {
      rates.condensate = d(
        mrfPostCStarRate('condensate', m.prices.pentanesPlusPar, m.volumes).ratePct,
      );
    }
  }

  // Under C*: 5% while revenue is below C*; in the month it is reached, every product's volume
  // is prorated alike between 5% and its post-C* rate (guideline §4.1).
  let phase: 'pre' | 'reached' | 'post' | undefined;
  let preShare = ZERO;
  if (which.framework === 'mrf' && input.cStar?.status === 'calculated') {
    const remaining = Exact.max(ZERO, d(input.cStar.cStar).minus(cumulative));
    if (remaining.isZero()) phase = 'post';
    else if (valueCad.lte(remaining)) {
      phase = 'pre';
      preShare = d('1');
    } else {
      phase = 'reached';
      preShare = remaining.dividedBy(valueCad);
    }
  }
  const products: ProductRoyalty[] = [];
  let royaltyCad = ZERO;
  for (const product of ['oil', 'gas', 'condensate'] as const) {
    if (values[product].isZero() && rates[product].isZero()) continue;
    const rate = preShare
      .times(MRF_PRE_C_STAR_PCT)
      .plus(d('1').minus(preShare).times(rates[product]));
    const royalty = values[product].times(rate).dividedBy(100);
    royaltyCad = royaltyCad.plus(royalty);
    products.push({
      product,
      ratePct: text(rate.toDecimalPlaces(5)),
      valueCad: toMoney(values[product]),
      royaltyCad: toMoney(royalty),
    });
  }
  return {
    month: m.month,
    status: 'estimated',
    framework: which.framework,
    ...(phase === undefined ? {} : { cStarPhase: phase }),
    products,
    valueCad: toMoney(valueCad),
    royaltyCad: toMoney(royaltyCad),
    effectivePct: share(royaltyCad, valueCad),
  };
}
