import { COUNTRY_NAMES, FACILITY_TYPE_LABELS, type FacilityType } from '@grain/domain';

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

export function sourceLabel(source: string): string {
  return source === 'file_import' ? 'Imported from a spreadsheet' : 'Entered by hand';
}

/** Where a location's coordinates came from, in words; null when unknown. */
export function coordinatesSourceLabel(source: string | null): string | null {
  switch (source) {
    case 'geocodio':
      return 'found from the address (Geocodio)';
    case 'manual':
      return 'entered by hand';
    case 'file_import':
      return 'from the spreadsheet';
    default:
      return null;
  }
}

/** Organization roles allowed to add, change and archive counterparties (spec section 2.1). */
export function canEditDirectory(role: string): boolean {
  return role === 'operations' || role === 'org_admin';
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
