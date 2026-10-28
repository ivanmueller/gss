import { DELIVERY_BASIS_LABELS, QUOTE_SOURCE_LABELS, type QuoteSummary } from '@grain/domain';

import type { Facility, FacilityRole, Quote } from '../data/types';

// GSS's real bids and offers (GET /api/v1/quotes) as the workspace shows them: one entry per
// location quoted at, each with its quotes, so the map, order book and facility table work on
// them as they do on the demo data. Prices, quantities and times are passed on exactly as
// recorded; nothing is converted or invented here.

/** A coordinate as a number for the map, from the decimal text the API sends. */
function degrees(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function quoteOf(summary: QuoteSummary): Quote {
  const terms = summary.current;
  return {
    id: summary.id,
    side: summary.side === 'bid' ? 'BID' : 'OFFER',
    commodity: summary.commodity.name,
    // An empty grade is shown as not stated; quotes of one commodity group by grade.
    grade: terms.grade ?? '',
    price: { amount: terms.price, currency: terms.currency, unit: terms.priceUnit },
    deliveryBasis: DELIVERY_BASIS_LABELS[terms.deliveryBasis],
    status: summary.status,
    source: QUOTE_SOURCE_LABELS[terms.sourceType],
    revision: terms.revisionNumber,
    href: `/quotes/${summary.id}`,
    quotedAt: terms.quotedAt,
    validUntil: terms.validUntil,
    deliveryWindow: { start: terms.deliveryStart, end: terms.deliveryEnd },
    quantityMt: { min: terms.quantityMinMt, max: terms.quantityMaxMt },
  };
}

/**
 * The workspace's facilities from live bids and offers: a quote at a location belongs to that
 * location; a quote without one to its counterparty, which then has no pin on the map. Newest
 * quotes first within each, as the API lists them.
 */
export function quotesToFacilities(quotes: readonly QuoteSummary[]): Facility[] {
  const byId = new Map<
    string,
    Facility & { roles: FacilityRole[]; quotes: Quote[]; commodities: string[] }
  >();
  for (const summary of quotes) {
    const place = summary.facility;
    const id = place ? place.id : `counterparty:${summary.counterparty.id}`;
    let facility = byId.get(id);
    if (!facility) {
      const latitude = degrees(place?.latitude);
      const longitude = degrees(place?.longitude);
      const located = latitude !== null && longitude !== null;
      facility = {
        id,
        name: summary.counterparty.legalName,
        roles: [],
        // Where the price applies: the location's province or state, else its town, else the
        // basis place written on the quote.
        region: place?.region ?? place?.city ?? summary.current.basisLocation ?? 'Location not set',
        country: place?.country ?? '',
        latitude: located ? latitude : null,
        longitude: located ? longitude : null,
        locationPrecision: located ? (place?.locationPrecision ?? 'approximate') : null,
        href: `/counterparties/${summary.counterparty.id}`,
        commodities: [],
        quotes: [],
      };
      byId.set(id, facility);
    }
    const role: FacilityRole = summary.side === 'bid' ? 'buyer' : 'seller';
    if (!facility.roles.includes(role)) facility.roles.push(role);
    if (!facility.commodities.includes(summary.commodity.name)) {
      facility.commodities.push(summary.commodity.name);
    }
    facility.quotes.push(quoteOf(summary));
  }
  return [...byId.values()];
}

/** The commodities that have live quotes, in the order of the full list (by its names). */
export function quotedCommodities(
  facilities: readonly Facility[],
  order: readonly string[],
): string[] {
  const quoted = new Set(facilities.flatMap((facility) => facility.commodities));
  const known = order.filter((name) => quoted.has(name));
  const rest = [...quoted].filter((name) => !order.includes(name)).sort();
  return [...known, ...rest];
}
