import { albertaDay, COUNTRY_NAMES, FACILITY_TYPE_LABELS, type FacilityType } from '@grain/domain';

const TYPE_LABELS: Record<string, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  broker: 'Broker',
  carrier: 'Carrier',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function countryName(code: string): string {
  return (COUNTRY_NAMES as Record<string, string>)[code] ?? code;
}

export function facilityTypeLabel(type: string | null): string | null {
  return type === null
    ? null
    : ((FACILITY_TYPE_LABELS as Record<string, string>)[type as FacilityType] ?? type);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-03-31" → "31 Mar 2027": a calendar date, with no time of day or time zone. */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${String(day)} ${MONTHS[(month ?? 1) - 1] ?? ''} ${String(year)}`;
}

/** Whether a certificate's last day has passed, by today's date in Alberta. */
export function certificateExpired(until: string, now = new Date()): boolean {
  return until < albertaDay(now);
}

/** Whether a counterparty's types include a buyer's side (buyer or broker), which has markets. */
export function hasMarkets(types: readonly string[]): boolean {
  return types.some((type) => type === 'buyer' || type === 'broker');
}

export function sourceLabel(source: string): string {
  return source === 'file_import' ? 'Imported from a spreadsheet' : 'Entered by hand';
}

/** Organization roles allowed to add, change and archive counterparties (spec section 2.1). */
export function canEditDirectory(role: string): boolean {
  return role === 'operations' || role === 'org_admin';
}

/** Admins delete archived counterparties that have no history (owner's request, 2026-10-31). */
export function canDeleteCounterparties(role: string): boolean {
  return role === 'org_admin';
}

/**
 * Counterparties as choices of a searchable dropdown: the legal name, with the trading name
 * and the provinces or states and country beneath it, all searched.
 */
export function counterpartyOptions(
  items: readonly {
    id: string;
    legalName: string;
    tradingName: string | null;
    regions: string[];
    primaryCountry: string;
  }[],
) {
  return items.map((item) => {
    const where = [item.regions.join(', '), countryName(item.primaryCountry)]
      .filter((part) => part !== '')
      .join(' · ');
    return {
      value: item.id,
      label: item.legalName,
      detail: item.tradingName ? `${item.tradingName} · ${where}` : where,
    };
  });
}
