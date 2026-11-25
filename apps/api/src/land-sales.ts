import { LAND_SOURCE_NAME, SALE_DOCUMENTS_SITE, saleDocumentPath } from '@grain/domain';

import type { LandSaleLoad, LandSaleParcelRow, LandSaleSummary } from './land-sales-db';

/**
 * Crown land sales on the oil and gas map (F-242; docs/FEATURES_OIL_GAS.md): the parcels of
 * Alberta Energy and Minerals' public offerings of petroleum and natural gas rights, with
 * their results, as published (docs/DECISIONS.md, 2026-11-21). The department is named with
 * every answer. Nothing here is a price of GSS's, and nothing is estimated.
 */

/**
 * The oil and gas schema version the land sales need: the shapes are read as whole numbers too
 * (F-310, 20261210010000_petro_land_compact.sql).
 */
export const LAND_SALES_SCHEMA_VERSION = 23;

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

/** A sale's notice and results as PDF files on the department's site; null for none. */
export interface SaleDocuments {
  notice: string | null;
  results: string | null;
}

/**
 * The documents of the sales given, by sale date, as addresses on the department's site
 * (F-265). Only a path in the form the department's page writes is made into an address;
 * anything else the load kept is left out, so no other site is ever linked.
 */
export function saleDocuments(
  kept: unknown,
  saleDates: Iterable<string>,
): Record<string, SaleDocuments> {
  const out: Record<string, SaleDocuments> = {};
  if (typeof kept !== 'object' || kept === null) return out;
  const address = (path: unknown) =>
    saleDocumentPath(path) ? `${SALE_DOCUMENTS_SITE}${path}` : null;
  for (const date of new Set(saleDates)) {
    const links: unknown = Object.hasOwn(kept, date)
      ? (kept as Record<string, unknown>)[date]
      : null;
    if (typeof links !== 'object' || links === null) continue;
    const { notice, results } = links as { notice?: unknown; results?: unknown };
    const documents = { notice: address(notice), results: address(results) };
    if (documents.notice !== null || documents.results !== null) out[date] = documents;
  }
  return out;
}

export function landSalesAnswer(load: LandSaleLoad | null, parcels: LandSaleParcelRow[]) {
  const truncated = parcels.length > LAND_SALES_MAX;
  const sent = truncated ? parcels.slice(0, LAND_SALES_MAX) : parcels;
  return {
    source: source(load),
    truncated,
    // The documents of the sales these parcels belong to, and of no other.
    documents: saleDocuments(
      load?.documents,
      sent.map((p) => p.saleDate),
    ),
    parcels: sent,
  };
}

export function landSaleSummaryAnswer(summary: LandSaleSummary) {
  return { source: { name: LAND_SALES_SOURCE_NAME }, currency: 'CAD' as const, ...summary };
}
