import type { FracDbRow, FracLoad } from './petro-frac-db';

/** The Worker's frac route needs this oil and gas schema (20261207010000). */
export const FRAC_SCHEMA_VERSION = 20;

/** The AER's page the file is linked from, named with the data. */
export const FRAC_SOURCE_PAGE =
  'https://www.aer.ca/data-and-performance-reports/activity-and-data/lists-and-activities/hydraulic-fracture-fluid-data';

/** A licence as the AER writes it (seven characters, zero-padded), or a sentence saying what is wrong. */
export function parseLicence(raw: string | undefined): { licence: string } | string {
  const licence = raw?.trim() ?? '';
  return /^[0-9A-Z]{1,9}$/.test(licence)
    ? { licence }
    : 'licence must be a well licence number such as 0509395.';
}

export interface FracWellAnswer {
  uwi: string;
  firstFracDate: string;
  lastFracDate: string;
  fracs: number;
  stages: number | null;
  waterM3: string;
  proppantT: string;
  upgradeHintT: string;
  refracProppantT: string;
  maxTvdM: string | null;
  suspect: boolean;
}

export interface FracAnswer {
  source: { name: string; page: string; loadedAt: string | null; sourceDate: string | null };
  wells: FracWellAnswer[];
}

export function fracAnswer(load: FracLoad | null, rows: FracDbRow[]): FracAnswer {
  return {
    source: {
      name: 'Alberta Energy Regulator, Hydraulic Fracturing Summary Chemical and Water Use Data',
      page: FRAC_SOURCE_PAGE,
      loadedAt: load?.loadedAt ?? null,
      sourceDate: load?.sourceDate ?? null,
    },
    wells: rows.map((r) => ({
      uwi: r.uwi,
      firstFracDate: r.first_frac_date,
      lastFracDate: r.last_frac_date,
      fracs: r.fracs,
      stages: r.stages,
      waterM3: r.water_m3,
      proppantT: r.proppant_t,
      upgradeHintT: r.upgrade_hint_t,
      refracProppantT: r.refrac_proppant_t,
      maxTvdM: r.max_tvd_m,
      suspect: r.suspect,
    })),
  };
}
