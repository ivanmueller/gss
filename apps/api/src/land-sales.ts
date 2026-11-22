import { LAND_SOURCE_NAME } from '@grain/domain';

import type { LandSaleLoad, LandSaleParcelRow, LandSaleSummary } from './land-sales-db';

/**
 * Crown land sales on the oil and gas map (F-242; docs/FEATURES_OIL_GAS.md): the parcels of
 * Alberta Energy and Minerals' public offerings of petroleum and natural gas rights, with
 * their results, as published (docs/DECISIONS.md, 2026-11-21). The department is named with
 * every answer. Nothing here is a price of GSS's, and nothing is estimated.
 */

/** The oil and gas schema version the land sales need (20261127010000_petro_land_sales.sql). */
export const LAND_SALES_SCHEMA_VERSION = 10;

/**
 * At most this many parcels per answer; a view holding more is drawn from the newest sales.
 * Enough for every parcel loaded (42,285 on 2026-11-21), so the parcels with one play's rights
 * can be asked for whole and kept by the page (F-263).
 */
export const LAND_SALES_MAX = 50_000;

export const LAND_SALES_SOURCE_NAME = `${LAND_SOURCE_NAME}, public offerings of petroleum and natural gas rights`;

/** The first sale date wanted (`since=2024-11-22`), or none; a sentence when it is no date. */
export function parseSince(raw: string | undefined): { since: string | null } | string {
  const text = raw?.trim() ?? '';
  if (text === '') return { since: null };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
  return date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
    ? { since: text }
    : 'since must be a date such as 2024-11-22.';
}

const source = (load: LandSaleLoad | null) => ({
  name: LAND_SALES_SOURCE_NAME,
  loadedAt: load?.loadedAt ?? null,
  firstSale: load?.firstSale ?? null,
  lastSale: load?.lastSale ?? null,
  area: load?.area ?? null,
});

export function landSalesAnswer(load: LandSaleLoad | null, parcels: LandSaleParcelRow[]) {
  const truncated = parcels.length > LAND_SALES_MAX;
  return {
    source: source(load),
    truncated,
    parcels: truncated ? parcels.slice(0, LAND_SALES_MAX) : parcels,
  };
}

export function landSaleSummaryAnswer(summary: LandSaleSummary) {
  return { source: { name: LAND_SALES_SOURCE_NAME }, currency: 'CAD' as const, ...summary };
}
