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

/** Organization roles allowed to create counterparties and change logos (spec section 2.1). */
export function canEditDirectory(role: string): boolean {
  return role === 'operations' || role === 'org_admin';
}
