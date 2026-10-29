import {
  DELIVERY_BASIS_LABELS,
  type QuoteFormValues,
  type QuoteRevision,
  type QuoteSummary,
} from '@grain/domain';

import { countryName } from './directory';
import { formatAmount } from './format';
import { albertaInputToRequest } from './time';

/** Organization roles allowed to enter, revise and withdraw bids and offers (spec section 2.1). */
export function canEnterQuotes(role: string): boolean {
  return role === 'trader' || role === 'org_admin';
}

/** The form's values as the API takes them: its two times, typed in Alberta time, as UTC instants. */
export function formToRequest(values: QuoteFormValues): QuoteFormValues {
  return {
    ...values,
    quotedAt: albertaInputToRequest(values.quotedAt),
    validUntil: albertaInputToRequest(values.validUntil),
  };
}

const UNIT_SHORT: Record<string, string> = { MT: 'MT', ST: 'short ton', BU: 'bu', CWT: 'cwt' };

/** "USD 725.00/MT", "CAD 15.25/bu": a quoted price with its currency and unit, as entered. */
export function quotePrice(revision: Pick<QuoteRevision, 'price' | 'currency' | 'priceUnit'>) {
  return `${revision.currency} ${formatAmount(revision.price)}/${UNIT_SHORT[revision.priceUnit] ?? revision.priceUnit}`;
}

/** "21.000" → "21", "84.500" → "84.5": tonnes without trailing zeros, as text. */
function tonnes(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** "21–84.5 MT" or "Up to 84.5 MT". */
export function quoteQuantity(revision: Pick<QuoteRevision, 'quantityMinMt' | 'quantityMaxMt'>) {
  const max = tonnes(revision.quantityMaxMt);
  return revision.quantityMinMt === null || /^0+(\.0+)?$/.test(revision.quantityMinMt)
    ? `Up to ${max} MT`
    : `${tonnes(revision.quantityMinMt)}–${max} MT`;
}

/** "Delivered · Synthetic Town, MN". */
export function quoteBasis(revision: Pick<QuoteRevision, 'deliveryBasis' | 'basisLocation'>) {
  const basis = DELIVERY_BASIS_LABELS[revision.deliveryBasis];
  return revision.basisLocation ? `${basis} · ${revision.basisLocation}` : basis;
}

/** "2026-11-01 to 2026-11-30", "From 2026-11-01", or "Not stated". */
export function quoteDelivery(revision: Pick<QuoteRevision, 'deliveryStart' | 'deliveryEnd'>) {
  const { deliveryStart: start, deliveryEnd: end } = revision;
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `By ${end}`;
  return 'Not stated';
}

/** "Synthetic Mill, Synthetic Town, MN" for a quote's location; null without one. */
export function quotePlace(quote: Pick<QuoteSummary, 'facility'>): string | null {
  const facility = quote.facility;
  if (!facility) return null;
  const parts = [facility.name, facility.city, facility.region ?? countryName(facility.country)];
  return parts.filter((part) => part !== null && part !== '').join(', ');
}
