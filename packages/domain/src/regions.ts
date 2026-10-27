/** Countries the directory accepts in v1 (Canada–U.S. trade). */
export const SUPPORTED_COUNTRIES = ['CA', 'US'] as const;
export type CountryCode = (typeof SUPPORTED_COUNTRIES)[number];

export const COUNTRY_NAMES: Record<CountryCode, string> = {
  CA: 'Canada',
  US: 'United States',
};

/** Provinces and territories (Canada Post codes). */
export const CA_REGIONS: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

/** States and the District of Columbia (USPS codes). */
export const US_REGIONS: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

export const REGIONS: Record<CountryCode, Record<string, string>> = {
  CA: CA_REGIONS,
  US: US_REGIONS,
};

const COUNTRY_ALIASES: Record<string, CountryCode> = {
  ca: 'CA',
  can: 'CA',
  canada: 'CA',
  us: 'US',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  'united states': 'US',
  'united states of america': 'US',
};

function key(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** "Canada", "CAN", "ca" → "CA"; unsupported or unknown → null. */
export function normalizeCountry(value: string): CountryCode | null {
  return COUNTRY_ALIASES[key(value)] ?? null;
}

/** "Saskatchewan", "sk" → "SK" for the given country; unknown → null. */
export function normalizeRegion(country: CountryCode, value: string): string | null {
  const wanted = key(value).replace(/\./g, '');
  const regions = REGIONS[country];
  for (const [code, name] of Object.entries(regions)) {
    if (wanted === code.toLowerCase() || wanted === name.toLowerCase()) return code;
  }
  return null;
}
