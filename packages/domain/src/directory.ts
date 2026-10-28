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
      'seller',
      'seller name',
      'supplier',
      'supplier name',
      'grower',
      'producer',
      'farm name',
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
    headers: ['country', 'buyer country', 'seller country', 'company country'],
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

/** The fields of each part of a directory record: the company, one contact, one location. */
export const COUNTERPARTY_FIELD_IDS = [
  'legalName',
  'tradingName',
  'country',
  'types',
  'verificationStatus',
  'notes',
] as const satisfies readonly ImportFieldId[];
export const CONTACT_FIELD_IDS = [
  'contactName',
  'contactRole',
  'contactEmail',
  'contactPhone',
] as const satisfies readonly ImportFieldId[];
export const FACILITY_FIELD_IDS = [
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
] as const satisfies readonly ImportFieldId[];

export type CounterpartyFieldId = (typeof COUNTERPARTY_FIELD_IDS)[number];
export type ContactFieldId = (typeof CONTACT_FIELD_IDS)[number];
export type FacilityFieldId = (typeof FACILITY_FIELD_IDS)[number];

const fieldValues = <T extends ImportFieldId>(ids: readonly T[]) =>
  z.partialRecord(z.enum(ids as unknown as [T, ...T[]]), z.string().max(MAX_RAW_VALUE_LENGTH));

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
  /** Types for rows whose type is empty or not in the file; buyer when left out. */
  defaultTypes: z.array(z.enum(COUNTERPARTY_TYPES)).min(1).max(4).optional(),
  rows: z
    .array(
      z.object({
        line: z.number().int().min(1).max(1_000_000),
        values: fieldValues(FIELD_IDS),
      }),
    )
    .min(1)
    .max(MAX_IMPORT_ROWS),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

/** POST /api/v1/counterparties: one counterparty entered by hand, with an optional first contact and location. */
export const createCounterpartySchema = z.object({
  organizationId: z.uuid(),
  values: fieldValues(FIELD_IDS),
});

/**
 * The version a record had when its form was opened: its last change time to the
 * microsecond, in UTC, as the API sent it (e.g. 2026-10-28T14:05:09.123456Z). A save is
 * refused when the record has changed since, so no one's edit is lost unseen.
 */
export const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const version = z.string().regex(VERSION);

/** PATCH /api/v1/counterparties/{id}. */
export const updateCounterpartySchema = z.object({
  version,
  values: fieldValues(COUNTERPARTY_FIELD_IDS),
});
/** POST /api/v1/counterparties/{id}/contacts. */
export const createContactSchema = z.object({ values: fieldValues(CONTACT_FIELD_IDS) });
/** PATCH /api/v1/counterparties/{id}/contacts/{contactId}. */
export const updateContactSchema = z.object({ version, values: fieldValues(CONTACT_FIELD_IDS) });
/** POST /api/v1/counterparties/{id}/facilities. */
export const createFacilitySchema = z.object({ values: fieldValues(FACILITY_FIELD_IDS) });
/** PATCH /api/v1/counterparties/{id}/facilities/{facilityId}. */
export const updateFacilitySchema = z.object({ version, values: fieldValues(FACILITY_FIELD_IDS) });

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

/** A problem with one field of a form or spreadsheet row; field null for the record as a whole. */
export interface FieldIssue {
  field: ImportFieldId | null;
  message: string;
}

export interface ImportIssue extends FieldIssue {
  line: number;
}

/** A counterparty with at most one contact and one location: a spreadsheet row or the add form. */
export interface DirectoryRecord {
  counterparty: CounterpartyInput;
  contact: ContactInput | null;
  facility: FacilityInput | null;
}

export interface ParsedImportRow extends DirectoryRecord {
  line: number;
}

export type ParseRowResult =
  | { status: 'ok'; row: ParsedImportRow }
  | { status: 'empty' }
  | { status: 'invalid'; issues: ImportIssue[] };

export type ParseResult<T> =
  { status: 'ok'; value: T } | { status: 'invalid'; issues: FieldIssue[] };

/** Trim and collapse runs of whitespace; empty becomes null. */
function clean(value: string | undefined): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** Like clean, but keeps single line breaks (notes); blank lines between paragraphs become one. */
function cleanLines(value: string | undefined): string | null {
  const text = (value ?? '')
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

/** Reads the values of one form or row, collecting every problem with its field. */
class FieldReader {
  readonly issues: FieldIssue[] = [];

  constructor(private readonly values: ImportRowValues) {}

  /** The cleaned value, or null when empty. */
  value(field: ImportFieldId): string | null {
    return clean(this.values[field]);
  }

  raw(field: ImportFieldId): string | undefined {
    return this.values[field];
  }

  issue(field: ImportFieldId | null, message: string): void {
    this.issues.push({ field, message });
  }

  /** Reports values longer than the import limit, which are refused rather than cut. */
  checkLengths(fields: readonly ImportFieldId[]): void {
    for (const field of fields) {
      if ((this.values[field]?.length ?? 0) > MAX_IMPORT_VALUE_LENGTH) {
        this.issue(field, `is longer than ${String(MAX_IMPORT_VALUE_LENGTH)} characters`);
      }
    }
  }

  /** A name-like value of at most LABEL_MAX characters. */
  label(field: ImportFieldId): string | null {
    const value = this.value(field);
    if (value !== null && value.length > LABEL_MAX) {
      this.issue(field, `is longer than ${String(LABEL_MAX)} characters`);
      return null;
    }
    return value;
  }
}

function readCounterparty(
  r: FieldReader,
  defaultTypes: readonly CounterpartyType[] | undefined,
): CounterpartyInput | null {
  const legalName = r.label('legalName');
  if (r.value('legalName') === null) r.issue('legalName', 'is required');

  const countryText = r.value('country');
  const country = countryText === null ? null : normalizeCountry(countryText);
  if (countryText === null) r.issue('country', 'is required');
  else if (country === null)
    r.issue('country', `"${countryText}" is not Canada or the United States`);

  const tradingName = r.label('tradingName');

  const typesText = r.value('types');
  let types: CounterpartyType[] = [...(defaultTypes ?? [])];
  if (typesText !== null) {
    const parts = typesText
      .split(/[;,/|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const parsed = parts.map((part) => oneOf(COUNTERPARTY_TYPES, part));
    if (parsed.some((type) => type === null)) {
      r.issue('types', `"${typesText}" must be buyer, seller, broker or carrier`);
    } else {
      types = [...new Set(parsed as CounterpartyType[])];
    }
  } else if (types.length === 0) {
    r.issue('types', 'choose at least one: buyer, seller, broker or carrier');
  }

  const statusText = r.value('verificationStatus');
  let verificationStatus: VerificationStatus = 'unverified';
  if (statusText !== null) {
    const status = oneOf(VERIFICATION_STATUSES, statusText);
    if (status === null)
      r.issue('verificationStatus', `"${statusText}" must be unverified, pending or verified`);
    else verificationStatus = status;
  }

  const notes = cleanLines(r.raw('notes'));

  if (legalName === null || country === null || types.length === 0) return null;
  return { legalName, tradingName, types, primaryCountry: country, verificationStatus, notes };
}

/** A contact, or null when no contact field has a value. */
function readContact(r: FieldReader): ContactInput | null {
  if (!CONTACT_FIELD_IDS.some((field) => r.value(field) !== null)) return null;
  const name = r.label('contactName');
  const email = r.value('contactEmail');
  const phone = r.value('contactPhone')?.replace(/\s*(ext\.?|extension)\s*/i, ' x') ?? null;
  if (r.value('contactName') === null)
    r.issue('contactName', 'is required when other contact details are given');
  if (email !== null && (email.length > 254 || !EMAIL.test(email)))
    r.issue('contactEmail', `"${email}" is not an email address`);
  if (phone !== null && !PHONE.test(phone))
    r.issue('contactPhone', `"${phone}" is not a phone number`);
  return name === null ? null : { name, role: r.label('contactRole'), email, phone };
}

/**
 * A location, or null when no location field has a value. Its country is the location's own
 * or, when not given, `fallbackCountry` (the counterparty's).
 */
function readFacility(r: FieldReader, fallbackCountry: CountryCode | null): FacilityInput | null {
  if (!FACILITY_FIELD_IDS.some((field) => r.value(field) !== null)) return null;

  const facilityCountryText = r.value('facilityCountry');
  const facilityCountry =
    facilityCountryText === null ? fallbackCountry : normalizeCountry(facilityCountryText);
  if (facilityCountryText !== null && facilityCountry === null) {
    r.issue('facilityCountry', `"${facilityCountryText}" is not Canada or the United States`);
  }

  const typeText = r.value('facilityType');
  const facilityType =
    typeText === null ? null : (FACILITY_TYPE_ALIASES[typeText.toLowerCase()] ?? null);
  if (typeText !== null && facilityType === null) {
    r.issue(
      'facilityType',
      `"${typeText}" is not a known location type (${Object.values(FACILITY_TYPE_LABELS).join(', ')})`,
    );
  }

  const addressLine = r.value('addressLine');
  if (addressLine !== null && addressLine.length > 300)
    r.issue('addressLine', 'is longer than 300 characters');

  const regionText = r.value('region');
  let region: string | null = null;
  if (regionText !== null && facilityCountry !== null) {
    region = normalizeRegion(facilityCountry, regionText);
    if (region === null)
      r.issue('region', `"${regionText}" is not a province or state of ${facilityCountry}`);
  }

  const postalText = r.value('postalCode');
  let postal: string | null = null;
  if (postalText !== null && facilityCountry !== null) {
    postal = postalCode(facilityCountry, postalText);
    if (postal === null) {
      r.issue(
        'postalCode',
        facilityCountry === 'CA'
          ? `"${postalText}" is not a postal code like S4P 3Y2`
          : `"${postalText}" is not a 5-digit ZIP code (spreadsheets sometimes drop a leading zero)`,
      );
    }
  }

  const latText = r.value('latitude');
  const lngText = r.value('longitude');
  const latitude = latText === null ? null : degrees(latText, 90);
  const longitude = lngText === null ? null : degrees(lngText, 180);
  if (latText !== null && latitude === null)
    r.issue('latitude', `"${latText}" is not a latitude between -90 and 90`);
  if (lngText !== null && longitude === null)
    r.issue('longitude', `"${lngText}" is not a longitude between -180 and 180`);
  if ((latText === null) !== (lngText === null)) {
    r.issue(
      latText === null ? 'latitude' : 'longitude',
      'latitude and longitude must be given together',
    );
  }

  const precisionText = r.value('locationPrecision');
  let locationPrecision: LocationPrecision | null =
    latText !== null && lngText !== null ? 'approximate' : null;
  if (precisionText !== null) {
    const precision =
      precisionText.toLowerCase() === 'approx'
        ? 'approximate'
        : oneOf(LOCATION_PRECISIONS, precisionText);
    if (precision === null)
      r.issue('locationPrecision', `"${precisionText}" must be exact or approximate`);
    else if (latText === null) r.issue('locationPrecision', 'needs a latitude and longitude');
    else locationPrecision = precision;
  }

  if (facilityCountry === null) return null;
  return {
    name: r.label('facilityName'),
    facilityType,
    addressLine,
    city: r.label('city'),
    region,
    postalCode: postal,
    country: facilityCountry,
    latitude,
    longitude,
    locationPrecision,
  };
}

/**
 * Validates and normalizes a counterparty with at most one contact and one location, as a
 * spreadsheet row or the add form gives them. Every problem is reported, each with its
 * field, so they can all be shown at once. Without a type, `defaultTypes` are used; with
 * none, a type is required.
 */
export function parseDirectoryRecord(
  values: ImportRowValues,
  options: { defaultTypes?: readonly CounterpartyType[] } = {},
):
  | { status: 'ok'; record: DirectoryRecord }
  | { status: 'empty' }
  | { status: 'invalid'; issues: FieldIssue[] } {
  const r = new FieldReader(values);
  if (FIELD_IDS.every((field) => r.value(field) === null)) return { status: 'empty' };
  r.checkLengths(FIELD_IDS);
  const counterparty = readCounterparty(r, options.defaultTypes);
  const contact = readContact(r);
  const countryText = r.value('country');
  const facility = readFacility(r, countryText === null ? null : normalizeCountry(countryText));
  if (r.issues.length > 0 || counterparty === null) return { status: 'invalid', issues: r.issues };
  return { status: 'ok', record: { counterparty, contact, facility } };
}

/** Validates one mapped spreadsheet row; rows without a type are buyers unless `defaultTypes` says otherwise. */
export function parseImportRow(
  line: number,
  values: ImportRowValues,
  options: { defaultTypes?: readonly CounterpartyType[] } = {},
): ParseRowResult {
  const result = parseDirectoryRecord(values, {
    defaultTypes: options.defaultTypes ?? ['buyer'],
  });
  if (result.status === 'empty') return result;
  if (result.status === 'invalid') {
    return { status: 'invalid', issues: result.issues.map((issue) => ({ line, ...issue })) };
  }
  return { status: 'ok', row: { line, ...result.record } };
}

/** A counterparty's own details from its edit form. A type is required. */
export function parseCounterpartyFields(values: ImportRowValues): ParseResult<CounterpartyInput> {
  const r = new FieldReader(values);
  r.checkLengths(COUNTERPARTY_FIELD_IDS);
  const counterparty = readCounterparty(r, undefined);
  return r.issues.length > 0 || counterparty === null
    ? { status: 'invalid', issues: r.issues }
    : { status: 'ok', value: counterparty };
}

/** One contact from its form. A name is required. */
export function parseContactFields(values: ImportRowValues): ParseResult<ContactInput> {
  const r = new FieldReader(values);
  r.checkLengths(CONTACT_FIELD_IDS);
  const contact = readContact(r);
  if (contact === null && r.issues.length === 0) r.issue('contactName', 'is required');
  return r.issues.length > 0 || contact === null
    ? { status: 'invalid', issues: r.issues }
    : { status: 'ok', value: contact };
}

/** Fields of a location that say where it is; a type or country alone does not. */
const WHERE_FIELDS: readonly FacilityFieldId[] = [
  'facilityName',
  'addressLine',
  'city',
  'region',
  'postalCode',
  'latitude',
  'longitude',
];
const WHERE_MESSAGE =
  'Give the location at least a name, an address, a city, a province or state, or coordinates.';

/**
 * The add form: a counterparty with an optional first contact and location. A type is
 * required. The location's country is filled in for the user, so a country alone is no
 * location; anything more needs to say where it is, as parseFacilityFields requires.
 */
export function parseNewCounterparty(
  values: ImportRowValues,
): ReturnType<typeof parseDirectoryRecord> {
  const given = (field: ImportFieldId) => clean(values[field]) !== null;
  const location = FACILITY_FIELD_IDS.some((field) => field !== 'facilityCountry' && given(field));
  const own = location
    ? values
    : Object.fromEntries(Object.entries(values).filter(([field]) => field !== 'facilityCountry'));
  const result = parseDirectoryRecord(own);
  if (!location || WHERE_FIELDS.some(given)) return result;
  const issue: FieldIssue = { field: null, message: WHERE_MESSAGE };
  return result.status === 'invalid'
    ? { status: 'invalid', issues: [...result.issues, issue] }
    : { status: 'invalid', issues: [issue] };
}

/**
 * One location from its form. Without a country of its own it is in `counterpartyCountry`.
 * It needs at least a name, address, city, province or state, postal code or coordinates.
 */
export function parseFacilityFields(
  values: ImportRowValues,
  counterpartyCountry: CountryCode,
): ParseResult<FacilityInput> {
  const r = new FieldReader(values);
  r.checkLengths(FACILITY_FIELD_IDS);
  if (!WHERE_FIELDS.some((field) => r.value(field) !== null)) r.issue(null, WHERE_MESSAGE);
  const facility = readFacility(r, counterpartyCountry);
  return r.issues.length > 0 || facility === null
    ? { status: 'invalid', issues: r.issues }
    : { status: 'ok', value: facility };
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
