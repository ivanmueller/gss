import { z } from 'zod';

import { normalizeCountry, normalizeRegion, type CountryCode } from './regions';

/** Values accepted by the database enums in app (20261027030100_counterparty_directory.sql). */
export const COUNTERPARTY_TYPES = ['buyer', 'seller', 'broker', 'carrier'] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];
export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const FACILITY_TYPES = [
  'elevator',
  'terminal',
  'processor',
  'feed_mill',
  'port',
  'farm',
  'warehouse',
  'office',
  'other',
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];
export const LOCATION_PRECISIONS = ['exact', 'approximate'] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export const FACILITY_TYPE_LABELS: Record<FacilityType, string> = {
  elevator: 'Elevator',
  terminal: 'Terminal',
  processor: 'Processor',
  feed_mill: 'Feed mill',
  port: 'Port',
  farm: 'Farm',
  warehouse: 'Warehouse',
  office: 'Office',
  other: 'Other',
};

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_VALUE_LENGTH = 2000;
/** Longest value a request may carry; longer than MAX_IMPORT_VALUE_LENGTH is reported per row. */
export const MAX_RAW_VALUE_LENGTH = 10_000;

/** Spreadsheet columns an import can fill, with header names they are matched from. */
export const IMPORT_FIELDS = [
  {
    id: 'legalName',
    label: 'Legal name',
    required: true,
    headers: [
      'legal name',
      'company',
      'company name',
      'buyer',
      'buyer name',
      'name',
      'customer',
      'account',
    ],
  },
  {
    id: 'tradingName',
    label: 'Trading name',
    required: false,
    headers: ['trading name', 'trade name', 'dba', 'operating name', 'doing business as'],
  },
  {
    id: 'country',
    label: 'Country',
    required: true,
    headers: ['country', 'buyer country', 'company country'],
  },
  {
    id: 'types',
    label: 'Counterparty type',
    required: false,
    headers: ['type', 'types', 'counterparty type', 'relationship'],
  },
  {
    id: 'verificationStatus',
    label: 'Verification status',
    required: false,
    headers: ['verification', 'verification status', 'verified'],
  },
  {
    id: 'notes',
    label: 'Notes',
    required: false,
    headers: ['notes', 'note', 'comments', 'comment'],
  },
  {
    id: 'contactName',
    label: 'Contact name',
    required: false,
    headers: ['contact', 'contact name', 'contact person'],
  },
  {
    id: 'contactRole',
    label: 'Contact role',
    required: false,
    headers: ['title', 'job title', 'position', 'contact title', 'contact role'],
  },
  {
    id: 'contactEmail',
    label: 'Contact email',
    required: false,
    headers: ['email', 'e-mail', 'email address', 'contact email'],
  },
  {
    id: 'contactPhone',
    label: 'Contact phone',
    required: false,
    headers: ['phone', 'telephone', 'tel', 'phone number', 'contact phone'],
  },
  {
    id: 'facilityName',
    label: 'Location name',
    required: false,
    headers: ['location', 'location name', 'facility', 'facility name', 'site', 'plant'],
  },
  {
    id: 'facilityType',
    label: 'Location type',
    required: false,
    headers: ['location type', 'facility type', 'site type'],
  },
  {
    id: 'addressLine',
    label: 'Address',
    required: false,
    headers: ['address', 'street', 'street address', 'address line 1', 'address 1'],
  },
  { id: 'city', label: 'City', required: false, headers: ['city', 'town', 'municipality'] },
  {
    id: 'region',
    label: 'Province or state',
    required: false,
    headers: ['province', 'state', 'province/state', 'state/province', 'prov', 'region'],
  },
  {
    id: 'postalCode',
    label: 'Postal or ZIP code',
    required: false,
    headers: ['postal code', 'postal', 'zip', 'zip code', 'postcode'],
  },
  {
    id: 'facilityCountry',
    label: 'Location country',
    required: false,
    headers: ['location country', 'facility country', 'site country'],
  },
  { id: 'latitude', label: 'Latitude', required: false, headers: ['latitude', 'lat'] },
  {
    id: 'longitude',
    label: 'Longitude',
    required: false,
    headers: ['longitude', 'long', 'lng', 'lon'],
  },
  {
    id: 'locationPrecision',
    label: 'Location precision',
    required: false,
    headers: ['location precision', 'precision', 'geocode precision'],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  required: boolean;
  headers: readonly string[];
}[];

export type ImportFieldId = (typeof IMPORT_FIELDS)[number]['id'];
export type ImportRowValues = Partial<Record<ImportFieldId, string>>;

const FIELD_IDS = IMPORT_FIELDS.map((field) => field.id) as [ImportFieldId, ...ImportFieldId[]];
const FACILITY_FIELDS: ImportFieldId[] = [
  'facilityName',
  'facilityType',
  'addressLine',
  'city',
  'region',
  'postalCode',
  'facilityCountry',
  'latitude',
  'longitude',
  'locationPrecision',
];
const CONTACT_FIELDS: ImportFieldId[] = [
  'contactName',
  'contactRole',
  'contactEmail',
  'contactPhone',
];

/** The request body of POST /api/v1/counterparties/import. Rows are already mapped to fields. */
export const importRequestSchema = z.object({
  organizationId: z.uuid(),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\p{Cc}]+$/u),
  commit: z.boolean(),
  rows: z
    .array(
      z.object({
        line: z.number().int().min(1).max(1_000_000),
        values: z.partialRecord(z.enum(FIELD_IDS), z.string().max(MAX_RAW_VALUE_LENGTH)),
      }),
    )
    .min(1)
    .max(MAX_IMPORT_ROWS),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export interface CounterpartyInput {
  legalName: string;
  tradingName: string | null;
  types: CounterpartyType[];
  primaryCountry: CountryCode;
  verificationStatus: VerificationStatus;
  notes: string | null;
}

export interface ContactInput {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

export interface FacilityInput {
  name: string | null;
  facilityType: FacilityType | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: CountryCode;
  /** Decimal degrees as text with at most six decimals, as stored. */
  latitude: string | null;
  longitude: string | null;
  locationPrecision: LocationPrecision | null;
}

export interface ImportIssue {
  line: number;
  field: ImportFieldId | null;
  message: string;
}

export interface ParsedImportRow {
  line: number;
  counterparty: CounterpartyInput;
  contact: ContactInput | null;
  facility: FacilityInput | null;
}

export type ParseRowResult =
  | { status: 'ok'; row: ParsedImportRow }
  | { status: 'empty' }
  | { status: 'invalid'; issues: ImportIssue[] };

/** Trim and collapse runs of whitespace; empty becomes null. */
function clean(value: string | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

const LABEL_MAX = 200;
// Mirrors the database checks so a row that passes here is not refused there.
const EMAIL = /^[^@\s\p{Cc}]+@[^@\s\p{Cc}]+\.[^@\s\p{Cc}]+$/u;
const PHONE = /^[0-9+(). /x-]{3,40}$/;
const CA_POSTAL = /^([A-Z]\d[A-Z]) ?(\d[A-Z]\d)$/;
const US_ZIP = /^\d{5}(-\d{4})?$/;
const DEGREES = /^[+-]?\d{1,3}(\.\d+)?$/;

const FACILITY_TYPE_ALIASES: Record<string, FacilityType> = {
  elevator: 'elevator',
  'grain elevator': 'elevator',
  'country elevator': 'elevator',
  terminal: 'terminal',
  'inland terminal': 'terminal',
  processor: 'processor',
  'processing plant': 'processor',
  crusher: 'processor',
  'feed mill': 'feed_mill',
  feedmill: 'feed_mill',
  feed_mill: 'feed_mill',
  port: 'port',
  'port terminal': 'port',
  'export terminal': 'port',
  farm: 'farm',
  warehouse: 'warehouse',
  office: 'office',
  'head office': 'office',
  headquarters: 'office',
  hq: 'office',
  other: 'other',
};

function oneOf<T extends string>(allowed: readonly T[], value: string): T | null {
  const wanted = value.toLowerCase();
  return allowed.find((item) => item === wanted) ?? null;
}

function degrees(value: string, limit: number): string | null {
  if (!DEGREES.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) return null;
  // Coordinates are not money: rounding to the stored six decimals (about 0.1 m) is fine.
  return number.toFixed(6);
}

function postalCode(country: CountryCode, value: string): string | null {
  const upper = value.toUpperCase();
  if (country === 'CA') {
    const match = CA_POSTAL.exec(upper);
    return match ? `${match[1] ?? ''} ${match[2] ?? ''}` : null;
  }
  return US_ZIP.test(upper) ? upper : null;
}

/**
 * Validates and normalizes one mapped spreadsheet row. Every problem in the row is
 * reported, each with its field, so the preview can show them all at once.
 */
export function parseImportRow(line: number, values: ImportRowValues): ParseRowResult {
  const v = (field: ImportFieldId) => clean(values[field]);
  if (FIELD_IDS.every((field) => v(field) === null)) return { status: 'empty' };

  const issues: ImportIssue[] = [];
  const issue = (field: ImportFieldId | null, message: string) =>
    issues.push({ line, field, message });
  const label = (field: ImportFieldId, value: string | null): string | null => {
    if (value !== null && value.length > LABEL_MAX) {
      issue(field, `is longer than ${String(LABEL_MAX)} characters`);
      return null;
    }
    return value;
  };

  for (const field of FIELD_IDS) {
    if ((values[field]?.length ?? 0) > MAX_IMPORT_VALUE_LENGTH) {
      issue(field, `is longer than ${String(MAX_IMPORT_VALUE_LENGTH)} characters`);
    }
  }

  const legalName = label('legalName', v('legalName'));
  if (v('legalName') === null) issue('legalName', 'is required');

  const countryText = v('country');
  const country = countryText === null ? null : normalizeCountry(countryText);
  if (countryText === null) issue('country', 'is required');
  else if (country === null)
    issue('country', `"${countryText}" is not Canada or the United States`);

  const tradingName = label('tradingName', v('tradingName'));

  const typesText = v('types');
  let types: CounterpartyType[] = ['buyer'];
  if (typesText !== null) {
    const parts = typesText
      .split(/[;,/|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const parsed = parts.map((part) => oneOf(COUNTERPARTY_TYPES, part));
    if (parsed.some((type) => type === null)) {
      issue('types', `"${typesText}" must be buyer, seller, broker or carrier`);
    } else {
      types = [...new Set(parsed as CounterpartyType[])];
    }
  }

  const statusText = v('verificationStatus');
  let verificationStatus: VerificationStatus = 'unverified';
  if (statusText !== null) {
    const status = oneOf(VERIFICATION_STATUSES, statusText);
    if (status === null)
      issue('verificationStatus', `"${statusText}" must be unverified, pending or verified`);
    else verificationStatus = status;
  }

  const notes = clean((values.notes ?? '').replace(/\r\n?/g, '\n'));

  // Contact: only when some contact column has a value.
  let contact: ContactInput | null = null;
  if (CONTACT_FIELDS.some((field) => v(field) !== null)) {
    const name = label('contactName', v('contactName'));
    const email = v('contactEmail');
    const phone = v('contactPhone')?.replace(/\s*(ext\.?|extension)\s*/i, ' x') ?? null;
    if (v('contactName') === null)
      issue('contactName', 'is required when other contact details are given');
    if (email !== null && (email.length > 254 || !EMAIL.test(email)))
      issue('contactEmail', `"${email}" is not an email address`);
    if (phone !== null && !PHONE.test(phone))
      issue('contactPhone', `"${phone}" is not a phone number`);
    if (name !== null)
      contact = { name, role: label('contactRole', v('contactRole')), email, phone };
  }

  // Facility: only when some location column has a value.
  let facility: FacilityInput | null = null;
  if (FACILITY_FIELDS.some((field) => v(field) !== null)) {
    const facilityCountryText = v('facilityCountry');
    const facilityCountry =
      facilityCountryText === null ? country : normalizeCountry(facilityCountryText);
    if (facilityCountryText !== null && facilityCountry === null) {
      issue('facilityCountry', `"${facilityCountryText}" is not Canada or the United States`);
    }

    const typeText = v('facilityType');
    const facilityType =
      typeText === null ? null : (FACILITY_TYPE_ALIASES[typeText.toLowerCase()] ?? null);
    if (typeText !== null && facilityType === null) {
      issue(
        'facilityType',
        `"${typeText}" is not a known location type (${Object.values(FACILITY_TYPE_LABELS).join(', ')})`,
      );
    }

    const addressLine = v('addressLine');
    if (addressLine !== null && addressLine.length > 300)
      issue('addressLine', 'is longer than 300 characters');

    const regionText = v('region');
    let region: string | null = null;
    if (regionText !== null && facilityCountry !== null) {
      region = normalizeRegion(facilityCountry, regionText);
      if (region === null)
        issue('region', `"${regionText}" is not a province or state of ${facilityCountry}`);
    }

    const postalText = v('postalCode');
    let postal: string | null = null;
    if (postalText !== null && facilityCountry !== null) {
      postal = postalCode(facilityCountry, postalText);
      if (postal === null) {
        issue(
          'postalCode',
          facilityCountry === 'CA'
            ? `"${postalText}" is not a postal code like S4P 3Y2`
            : `"${postalText}" is not a 5-digit ZIP code (spreadsheets sometimes drop a leading zero)`,
        );
      }
    }

    const latText = v('latitude');
    const lngText = v('longitude');
    const latitude = latText === null ? null : degrees(latText, 90);
    const longitude = lngText === null ? null : degrees(lngText, 180);
    if (latText !== null && latitude === null)
      issue('latitude', `"${latText}" is not a latitude between -90 and 90`);
    if (lngText !== null && longitude === null)
      issue('longitude', `"${lngText}" is not a longitude between -180 and 180`);
    if ((latText === null) !== (lngText === null)) {
      issue(
        latText === null ? 'latitude' : 'longitude',
        'latitude and longitude must be given together',
      );
    }

    const precisionText = v('locationPrecision');
    let locationPrecision: LocationPrecision | null =
      latText !== null && lngText !== null ? 'approximate' : null;
    if (precisionText !== null) {
      const precision =
        precisionText.toLowerCase() === 'approx'
          ? 'approximate'
          : oneOf(LOCATION_PRECISIONS, precisionText);
      if (precision === null)
        issue('locationPrecision', `"${precisionText}" must be exact or approximate`);
      else if (latText === null) issue('locationPrecision', 'needs a latitude and longitude');
      else locationPrecision = precision;
    }

    if (facilityCountry !== null) {
      facility = {
        name: label('facilityName', v('facilityName')),
        facilityType,
        addressLine,
        city: label('city', v('city')),
        region,
        postalCode: postal,
        country: facilityCountry,
        latitude,
        longitude,
        locationPrecision,
      };
    }
  }

  if (issues.length > 0 || legalName === null || country === null) {
    return { status: 'invalid', issues };
  }
  return {
    status: 'ok',
    row: {
      line,
      counterparty: {
        legalName,
        tradingName,
        types,
        primaryCountry: country,
        verificationStatus,
        notes,
      },
      contact,
      facility,
    },
  };
}

/** Matches the database's unique key: organization, country and legal name ignoring case. */
export function counterpartyKey(country: string, legalName: string): string {
  return `${country}:${legalName.toLowerCase()}`;
}

export interface ImportGroup {
  key: string;
  counterparty: CounterpartyInput;
  contacts: ContactInput[];
  facilities: FacilityInput[];
  lines: number[];
}

/**
 * Rows with the same legal name and country become one counterparty with several
 * contacts and locations. The first row's company details are used; a later row that
 * disagrees produces a warning, not an error. Repeated contacts and locations are kept once.
 */
export function groupImportRows(rows: ParsedImportRow[]): {
  groups: ImportGroup[];
  warnings: ImportIssue[];
} {
  const groups = new Map<string, ImportGroup>();
  const warnings: ImportIssue[] = [];
  const contactKeys = new Map<string, Set<string>>();
  const facilityKeys = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = counterpartyKey(row.counterparty.primaryCountry, row.counterparty.legalName);
    let group = groups.get(key);
    if (!group) {
      group = { key, counterparty: row.counterparty, contacts: [], facilities: [], lines: [] };
      groups.set(key, group);
      contactKeys.set(key, new Set());
      facilityKeys.set(key, new Set());
    } else {
      const first = group.counterparty;
      const firstLine = group.lines[0] ?? row.line;
      const compare: [ImportFieldId, string | null, string | null][] = [
        ['tradingName', first.tradingName, row.counterparty.tradingName],
        ['types', first.types.join(', '), row.counterparty.types.join(', ')],
        ['verificationStatus', first.verificationStatus, row.counterparty.verificationStatus],
        ['notes', first.notes, row.counterparty.notes],
      ];
      for (const [field, kept, ignored] of compare) {
        if (ignored !== null && ignored !== kept) {
          warnings.push({
            line: row.line,
            field,
            message: `differs from line ${String(firstLine)} for the same company; line ${String(firstLine)}'s value is used`,
          });
        }
      }
    }
    group.lines.push(row.line);

    if (row.contact) {
      const contactKey =
        row.contact.email?.toLowerCase() ??
        `${row.contact.name.toLowerCase()}|${row.contact.phone ?? ''}`;
      const seen = contactKeys.get(key);
      if (seen && !seen.has(contactKey)) {
        seen.add(contactKey);
        group.contacts.push(row.contact);
      }
    }
    if (row.facility) {
      const facilityKey = JSON.stringify(row.facility).toLowerCase();
      const seen = facilityKeys.get(key);
      if (seen && !seen.has(facilityKey)) {
        seen.add(facilityKey);
        group.facilities.push(row.facility);
      }
    }
  }
  return { groups: [...groups.values()], warnings };
}

function normalizeHeader(header: string): string {
  return header
    .replace(/[_\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Suggests which spreadsheet column fills each field, by header name. */
export function suggestMapping(headers: string[]): Partial<Record<ImportFieldId, string>> {
  const mapping: Partial<Record<ImportFieldId, string>> = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const match = headers.find(
      (header) =>
        !used.has(header) &&
        (normalizeHeader(header) === field.label.toLowerCase() ||
          (field.headers as readonly string[]).includes(normalizeHeader(header))),
    );
    if (match !== undefined) {
      mapping[field.id] = match;
      used.add(match);
    }
  }
  return mapping;
}
