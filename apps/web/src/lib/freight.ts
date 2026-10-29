import type { FreightFormValues, FreightLocation, FreightRevision } from '@grain/domain';

import { countryName } from './directory';
import { formatAmount } from './format';
import { fromLocalInput } from './quotes';

/** Organization roles allowed to enter, revise and withdraw freight rates (spec section 2.1). */
export function canEnterFreight(role: string): boolean {
  return role === 'trader' || role === 'operations' || role === 'org_admin';
}

/** The form's values as the API takes them: its two times as UTC instants. */
export function freightFormToRequest(values: FreightFormValues): FreightFormValues {
  return {
    ...values,
    quotedAt: fromLocalInput(values.quotedAt),
    validUntil: fromLocalInput(values.validUntil),
  };
}

const RATE_UNIT_SHORT: Record<string, string> = {
  MT: 'MT',
  ST: 'short ton',
  BU: 'bu',
  CWT: 'cwt',
  LOAD: 'load',
};

const PAYLOAD_UNIT_SHORT: Record<string, string> = { MT: 'MT', ST: 'short tons', LB: 'lb' };

/** "CAD 105.00/MT", "USD 4200.00/load": a rate with its currency and unit, as entered. */
export function freightRate(revision: Pick<FreightRevision, 'rate' | 'currency' | 'rateUnit'>) {
  return `${revision.currency} ${formatAmount(revision.rate)}/${RATE_UNIT_SHORT[revision.rateUnit] ?? revision.rateUnit}`;
}

/** "90.5 MT a load", "48000 lb a load"; null for a rate that is not per load. */
export function freightPayload(revision: Pick<FreightRevision, 'payload' | 'payloadUnit'>) {
  if (revision.payload === null || revision.payloadUnit === null) return null;
  const amount = revision.payload.includes('.')
    ? revision.payload.replace(/\.?0+$/, '')
    : revision.payload;
  return `${amount} ${PAYLOAD_UNIT_SHORT[revision.payloadUnit] ?? revision.payloadUnit} a load`;
}

/** "Synthetic Mill, Synthetic Town, MN": one end of a route, without its counterparty. */
export function freightPlace(
  location: Pick<FreightLocation, 'name' | 'city' | 'region' | 'country'>,
) {
  const parts = [location.name, location.city, location.region ?? countryName(location.country)];
  return parts.filter((part) => part !== null && part !== '').join(', ') || 'Unnamed location';
}
