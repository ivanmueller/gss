import { z } from 'zod';

import { normalizeCountry, normalizeRegion, type CountryCode } from './regions';
import {
  EQUIPMENT as EQUIPMENT_ORDER,
  parseEquipmentList,
  parseLaneMode,
  parsePlaceList,
  type Equipment,
} from './carrier-basics';
import type { CarrierLane } from './carriers';
import { commodityDirections, parseCommodityList, type CommodityInterest } from './commodities';
import { parseWebsite } from './website';

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
/** The markets a counterparty serves (owner's request, 2026-10-30); several allowed. */
export const MARKETS = [
  'pet',
  'bird',
  'equine',
  'specialty',
  'small_animal',
  'exotic',
  'wildlife',
  'aqua',
] as const;
export type Market = (typeof MARKETS)[number];

export const MARKET_LABELS: Record<Market, string> = {
  pet: 'Pet',
  bird: 'Bird',
  equine: 'Equine',
  specialty: 'Specialty',
  small_animal: 'Small Animal',
  exotic: 'Exotic',
  wildlife: 'Wildlife',
  aqua: 'Aqua',
};

/** A counterparty's tier (owner's request, 2026-10-30); one, or none. */
export const TIERS = ['A', 'B', 'C'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * A seller's grain types (owner's request and answers, 2026-11-03): what kind of grain it
 * sells, for the whole company, instead of a buyer's Market; several allowed.
 */
export const GRAIN_TYPES = ['feed', 'human_consumption', 'organic', 'non_gmo_ip'] as const;
export type GrainType = (typeof GRAIN_TYPES)[number];

export const GRAIN_TYPE_LABELS: Record<GrainType, string> = {
  feed: 'Feed',
  human_consumption: 'Human consumption',
  organic: 'Organic',
  non_gmo_ip: 'Non-GMO / IP',
};

/** What kind of business a seller is (owner's answer, 2026-11-03); one, or none. */
export const SELLER_KINDS = ['farm', 'elevator', 'processor', 'other'] as const;
export type SellerKind = (typeof SELLER_KINDS)[number];

export const SELLER_KIND_LABELS: Record<SellerKind, string> = {
  farm: 'Farm',
  elevator: 'Elevator',
  processor: 'Processor',
  other: 'Other',
};

/** The most tonnes a year a seller may be given (the database's check). */
export const MAX_ANNUAL_TONNES = 10_000_000;

/**
 * How a location is served (owner's request, 2026-10-30): set by hand on a location, or from
 * a spreadsheet's Served by column (owner's request, 2026-11-03).
 */
export const TRANSPORT_ACCESS = ['rail', 'truck', 'rail_and_truck'] as const;
export type TransportAccess = (typeof TRANSPORT_ACCESS)[number];

export const TRANSPORT_ACCESS_LABELS: Record<TransportAccess, string> = {
  rail: 'Rail',
  truck: 'Truck',
  rail_and_truck: 'Rail and truck',
};

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
    id: 'website',
    label: 'Website',
    required: false,
    headers: ['website', 'web site', 'web', 'url', 'homepage', 'home page', 'web address'],
  },
  {
    id: 'companyPhone',
    label: 'Company phone',
    required: false,
    headers: [
      'company phone',
      'main phone',
      'office phone',
      'business phone',
      'company telephone',
      'main line',
      'phone (company)',
    ],
  },
  {
    id: 'commodities',
    label: 'Commodities',
    required: false,
    headers: [
      'commodities',
      'commodity',
      'crops',
      'crop',
      'grains',
      'grain',
      'products',
      'commodities bought',
      'commodities sold',
    ],
  },
  {
    id: 'markets',
    label: 'Market',
    required: false,
    headers: ['market', 'markets', 'market type', 'markets served', 'segment'],
  },
  {
    id: 'tier',
    label: 'Tier',
    required: false,
    headers: ['tier', 'customer tier', 'account tier'],
  },
  // A seller's details (owner's request and answers, 2026-11-03).
  {
    id: 'grainTypes',
    label: 'Grain type',
    required: false,
    headers: ['grain type', 'grain types', 'grade type', 'end use', 'grain use'],
  },
  {
    id: 'sellerKind',
    label: 'Seller kind',
    required: false,
    headers: ['seller kind', 'seller type', 'supplier type', 'kind of seller'],
  },
  {
    id: 'annualTonnes',
    label: 'Tonnes a year',
    required: false,
    headers: [
      'tonnes a year',
      'tonnes per year',
      'tonnes/year',
      'annual tonnes',
      'annual volume',
      'mt per year',
      'tons a year',
      'tons per year',
    ],
  },
  {
    id: 'organicCertifier',
    label: 'Organic certifier',
    required: false,
    headers: ['organic certifier', 'certifier', 'certified by', 'certification body'],
  },
  {
    id: 'organicCertifiedUntil',
    label: 'Organic certified until',
    required: false,
    headers: [
      'organic certified until',
      'certified until',
      'organic expiry',
      'organic certificate expiry',
      'certificate expiry',
      'organic expires',
    ],
  },
  // A carrier's equipment and lanes (owner's request, 2026-11-01): every Loads in and
  // Delivers to pair on a row is a lane, unverified until someone on the team verifies it.
  {
    id: 'equipment',
    label: 'Equipment',
    required: false,
    headers: ['equipment', 'equipment types', 'trailers', 'trailer types', 'trucks', 'fleet'],
  },
  {
    id: 'loadsIn',
    label: 'Loads in',
    required: false,
    headers: ['loads in', 'load in', 'loads from', 'origin', 'origins', 'pick up', 'pickup'],
  },
  {
    id: 'deliversTo',
    label: 'Delivers to',
    required: false,
    headers: ['delivers to', 'deliver to', 'destination', 'destinations', 'lanes to'],
  },
  {
    id: 'laneMode',
    label: 'Mode',
    required: false,
    headers: ['mode', 'lane mode', 'truck or rail', 'transport', 'transport mode'],
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
  {
    id: 'city',
    label: 'City',
    required: false,
    headers: ['city', 'town', 'municipality', 'city or town', 'town or city', 'city/town'],
  },
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
  // A location's rail or truck access, from a spreadsheet only; forms send it beside their
  // values (transportAccess). Not a carrier lane's Mode.
  {
    id: 'servedBy',
    label: 'Served by',
    required: false,
    headers: ['served by', 'rail/truck', 'rail or truck access', 'access', 'shipping', 'ships by'],
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
  'website',
  'companyPhone',
  'markets',
  'tier',
  'grainTypes',
  'sellerKind',
  'annualTonnes',
  'organicCertifier',
  'organicCertifiedUntil',
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
  /**
   * With commit: the fingerprint of what the Check step showed (its answer's `fingerprint`),
   * so nothing is written unless it is still what was checked (Codex's review of
   * ivanmueller/gss#95). Null when the Check step had nothing to write.
   */
  reviewed: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
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

/** A location's rail or truck access, sent beside its form values; null when not known. */
const transportAccess = z.enum(TRANSPORT_ACCESS).nullable().optional();

/**
 * POST /api/v1/counterparties: one counterparty entered by hand, with an optional first
 * contact and location (and that location's access).
 */
export const createCounterpartySchema = z.object({
  organizationId: z.uuid(),
  values: fieldValues(FIELD_IDS),
  transportAccess,
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
/** PUT /api/v1/counterparties/{id}/main-contact: one of its contacts, or null for none. */
export const mainContactSchema = z.object({ contactId: z.uuid().nullable() });
/** POST /api/v1/counterparties/{id}/facilities. */
export const createFacilitySchema = z.object({
  values: fieldValues(FACILITY_FIELD_IDS),
  transportAccess,
});
/** PATCH /api/v1/counterparties/{id}/facilities/{facilityId}; access left out is kept. */
export const updateFacilitySchema = z.object({
  version,
  values: fieldValues(FACILITY_FIELD_IDS),
  transportAccess,
});

export interface CounterpartyInput {
  legalName: string;
  tradingName: string | null;
  types: CounterpartyType[];
  primaryCountry: CountryCode;
  verificationStatus: VerificationStatus;
  /** A public http or https address, tidied by parseWebsite. */
  website: string | null;
  /** The company's main phone number, apart from its contacts' own. */
  phone: string | null;
  /** The markets it serves, each once, in MARKETS order: a buyer's or broker's. */
  markets: Market[];
  tier: Tier | null;
  /** A seller's grain types, each once, in GRAIN_TYPES order. */
  grainTypes: GrainType[];
  sellerKind: SellerKind | null;
  /** About how many tonnes it sells a year; a whole number from 1 to MAX_ANNUAL_TONNES. */
  annualTonnes: number | null;
  /** Who certified it organic and until when (a calendar date, YYYY-MM-DD). */
  organicCertifier: string | null;
  organicCertifiedUntil: string | null;
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
  /**
   * Rail, truck or both, from a form beside its values or a spreadsheet's Served by column.
   * Left out (undefined) on a change, or an empty cell: kept.
   */
  transportAccess?: TransportAccess | null | undefined;
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
  /** What it buys and sells, from a Commodities column: buyers buy them, sellers sell them. */
  commodities: CommodityInterest[];
  /** A carrier's equipment and lanes, from the Equipment, Loads in, Delivers to and Mode columns. */
  equipment: Equipment[];
  lanes: CarrierLane[];
}

export interface ParsedImportRow extends DirectoryRecord {
  line: number;
  /**
   * Whether the row gave a verification status; an empty cell reads as unverified, which
   * must not replace a listed company's (owner's answer, 2026-10-31).
   */
  givenVerification: boolean;
  /** What was read differently from how the row put it, e.g. a second phone number moved to the notes. */
  notices: ImportIssue[];
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
const PHONE_MAX = 40;
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
  /** Not problems: what was read differently, said on the import's check step. */
  readonly notices: FieldIssue[] = [];

  /** `importing`: a spreadsheet row, read more leniently than a form someone is filling in. */
  constructor(
    private readonly values: ImportRowValues,
    readonly importing = false,
  ) {}

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

  notice(field: ImportFieldId | null, message: string): void {
    this.notices.push({ field, message });
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

/**
 * A phone number as it is saved (owner's choice, 2026-10-31): a North American number as
 * (403) 555-0100, an extension as " x7" ("ext. 7" and "extension 7" too). A number with
 * another country code (+44 …), or anything else that is not 10 digits (11 with a leading 1),
 * is kept as written. `app.format_phone` in the database does the same
 * (20261031020000_phone_format.sql, 20261031040000_phone_format_length.sql).
 */
export function formatPhone(text: string): string {
  const phone = text.trim().replace(/\s*(extension|ext\.?)\s*/i, ' x');
  const parts = /^(.*?)\s*x\s*(\d+)$/i.exec(phone);
  const main = parts?.[1] ?? phone;
  const extension = parts?.[2];
  if (/[^0-9+(). /-]/.test(main)) return phone;
  let digits = main.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  else if (main.startsWith('+')) return phone;
  if (digits.length !== 10) return phone;
  const ext = extension === undefined ? '' : ` x${extension}`;
  const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}${ext}`;
  // Never longer than a phone may be: a long extension keeps the number as written (Codex's
  // review of ivanmueller/gss#95).
  return formatted.length > PHONE_MAX ? phone : formatted;
}

/** A phone number field, formatted (formatPhone); null when empty. */
function readPhone(r: FieldReader, field: 'contactPhone' | 'companyPhone'): string | null {
  const text = r.value(field);
  const phone = text === null ? null : formatPhone(text);
  if (phone !== null && !PHONE.test(phone)) r.issue(field, `"${phone}" is not a phone number`);
  return phone;
}

/**
 * A spreadsheet's company phone cell may hold two numbers ("403-555-0100; 403-555-0101") or
 * a number and a note ("403-555-0100 (front desk)"). From a spreadsheet the first number is
 * the company phone and the rest goes to the notes, with a notice; a form still refuses it.
 */
function readCompanyPhone(r: FieldReader): { phone: string | null; more: string | null } {
  const text = r.value('companyPhone');
  if (text === null) return { phone: null, more: null };
  const whole = text.replace(/\s*(extension|ext\.?)\s*/i, ' x');
  // "403-555-0100 / 403-555-0101" fits a phone's characters but is two numbers; "780/555-0100"
  // is one (Codex's review of ivanmueller/gss#88).
  const slashed = whole.split('/');
  const twoNumbers =
    slashed.length > 1 && slashed.every((part) => part.replace(/\D/g, '').length >= 7);
  if ((PHONE.test(whole) && !twoNumbers) || !r.importing)
    return { phone: readPhone(r, 'companyPhone'), more: null };
  // A slash splits only two whole numbers, so "780/555-0100 (front desk)" keeps 780/555-0100.
  const split = (
    twoNumbers
      ? /^(.+?)(?:\s*[;,|\n/]\s*|\s+(?=\([^)]*[a-z]))(.+)$/i
      : /^(.+?)(?:\s*[;,|\n]\s*|\s+(?=\([^)]*[a-z]))(.+)$/i
  ).exec(text);
  const first = split?.[1]?.replace(/\s*(extension|ext\.?)\s*/i, ' x') ?? '';
  const rest = split?.[2]?.trim() ?? '';
  if (!PHONE.test(first) || rest === '') return { phone: readPhone(r, 'companyPhone'), more: null };
  r.notice(
    'companyPhone',
    `holds more than one number or a note: "${formatPhone(first)}" is the company phone, and "${rest}" is added to the notes`,
  );
  return { phone: formatPhone(first), more: rest };
}

/**
 * Words of a market name, without case, spaces, hyphens or a plural ("Small animals",
 * "Specialties"; Codex's review of ivanmueller/gss#85).
 */
function marketKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z]+/g, '')
    .replace(/ies$/, 'y')
    .replace(/s$/, '');
}

const MARKET_NAMES = new Map<string, Market>([
  ...MARKETS.map((market) => [marketKey(MARKET_LABELS[market]), market] as const),
  ['aquatic', 'aqua'],
  ['aquaculture', 'aqua'],
  ['horse', 'equine'],
]);

/** A Market column's names ("Pet; Bird"), each once, in MARKETS order. Others are refused. */
function readMarkets(r: FieldReader): Market[] {
  const text = r.value('markets');
  if (text === null) return [];
  const found = new Set<Market>();
  const unknown: string[] = [];
  for (const part of text.split(/[;,/|\n]+| and /i)) {
    const name = part.trim();
    if (name === '') continue;
    const market = MARKET_NAMES.get(marketKey(name));
    if (market) found.add(market);
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    r.issue(
      'markets',
      `${unknown.map((name) => `"${name}"`).join(', ')} must be ${Object.values(MARKET_LABELS).join(', ')}`,
    );
  }
  return MARKETS.filter((market) => found.has(market));
}

/** Words of a grain type ("Human", "Food grade", "Non GMO", "IP"), like marketKey. */
const GRAIN_TYPE_NAMES = new Map<string, GrainType>([
  ...GRAIN_TYPES.map((type) => [marketKey(GRAIN_TYPE_LABELS[type]), type] as const),
  ['human', 'human_consumption'],
  ['food', 'human_consumption'],
  ['foodgrade', 'human_consumption'],
  ['milling', 'human_consumption'],
  ['feedgrade', 'feed'],
  ['certifiedorganic', 'organic'],
  ['nongmo', 'non_gmo_ip'],
  ['ip', 'non_gmo_ip'],
  ['identitypreserved', 'non_gmo_ip'],
  ['nongmoip', 'non_gmo_ip'],
]);

/** Splits a list cell ("Feed; Organic", "Pet and Bird"), keeping "Non-GMO / IP" whole. */
function listNames(text: string): string[] {
  return text
    .replace(/non[\s-]*gmo\s*\/\s*ip/gi, 'Non-GMO IP')
    .split(/[;,/|\n]+| and /i)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Grain type names, each once in GRAIN_TYPES order, and the names that are not one. */
function grainTypesOf(text: string): { grainTypes: GrainType[]; unknown: string[] } {
  const found = new Set<GrainType>();
  const unknown: string[] = [];
  for (const name of listNames(text)) {
    const type = GRAIN_TYPE_NAMES.get(marketKey(name));
    if (type) found.add(type);
    else unknown.push(name);
  }
  return { grainTypes: GRAIN_TYPES.filter((type) => found.has(type)), unknown };
}

const GRAIN_TYPE_LIST = Object.values(GRAIN_TYPE_LABELS).join(', ');

/** A Grain type column's names ("Feed; Organic"), each once. Others are refused. */
function readGrainTypes(r: FieldReader): GrainType[] {
  const text = r.value('grainTypes');
  if (text === null) return [];
  const { grainTypes, unknown } = grainTypesOf(text);
  if (unknown.length > 0) {
    r.issue(
      'grainTypes',
      `${unknown.map((name) => `"${name}"`).join(', ')} must be ${GRAIN_TYPE_LIST}`,
    );
  }
  return grainTypes;
}

const SELLER_KIND_NAMES: Record<string, SellerKind> = {
  farm: 'farm',
  farmer: 'farm',
  grower: 'farm',
  producer: 'farm',
  elevator: 'elevator',
  'grain elevator': 'elevator',
  terminal: 'elevator',
  processor: 'processor',
  'processing plant': 'processor',
  other: 'other',
};

function readSellerKind(r: FieldReader): SellerKind | null {
  const text = r.value('sellerKind');
  if (text === null) return null;
  const kind = SELLER_KIND_NAMES[text.toLowerCase().replace(/s$/, '')] ?? null;
  if (kind === null) r.issue('sellerKind', `"${text}" must be Farm, Elevator, Processor or Other`);
  return kind;
}

/**
 * About how many tonnes a year: a whole number, with or without thousands separators or a
 * unit ("4,500", "4 500 t", "4500 MT", "4500 tonnes"). Tons are not tonnes and are refused
 * rather than converted (no unit conversion is assumed).
 */
function readAnnualTonnes(r: FieldReader): number | null {
  const text = r.value('annualTonnes');
  if (text === null) return null;
  const match = /^(\d{1,3}(?:[ ,]\d{3})+|\d+)(?:\.0+)?\s*(t|mt|tonnes?|metric tonnes?)?$/i.exec(
    text,
  );
  const tonnes = match ? Number((match[1] ?? '').replace(/[ ,]/g, '')) : NaN;
  if (!Number.isSafeInteger(tonnes) || tonnes < 1 || tonnes > MAX_ANNUAL_TONNES) {
    r.issue(
      'annualTonnes',
      `"${text}" must be a whole number of tonnes from 1 to ${MAX_ANNUAL_TONNES.toLocaleString('en-CA')}, like 5000`,
    );
    return null;
  }
  return tonnes;
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

/** A calendar date as YYYY-MM-DD when it exists and is from 2000 to 2100; else null. */
function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * A date as written in a form or spreadsheet: 2027-03-31 (or 2027/03/31), March 31, 2027,
 * 31 March 2027, or 31/03/2027 and 03/31/2027 when only one reading is a date (a day above
 * 12). A date both ways (04/05/2027) is ambiguous and refused, never guessed.
 */
export function parseCalendarDate(
  text: string,
): { status: 'ok'; date: string } | { status: 'ambiguous' } | { status: 'invalid' } {
  const read = (date: string | null) =>
    date === null ? ({ status: 'invalid' } as const) : ({ status: 'ok', date } as const);
  const value = text.trim().replace(/\s+/g, ' ');
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (match) return read(calendarDate(Number(match[1]), Number(match[2]), Number(match[3])));
  const month = (name: string) =>
    (MONTHS as readonly string[]).indexOf(name.slice(0, 3).toLowerCase()) + 1;
  match = /^([a-z]{3,9})\.? (\d{1,2}),? (\d{4})$/i.exec(value);
  if (match) return read(calendarDate(Number(match[3]), month(match[1] ?? ''), Number(match[2])));
  match = /^(\d{1,2}) ([a-z]{3,9})\.?,? (\d{4})$/i.exec(value);
  if (match) return read(calendarDate(Number(match[3]), month(match[2] ?? ''), Number(match[1])));
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (match) {
    const [first, second, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const dayFirst = first > 12 ? calendarDate(year, second, first) : null;
    const monthFirst = second > 12 ? calendarDate(year, first, second) : null;
    if (dayFirst !== null || monthFirst !== null) return read(dayFirst ?? monthFirst);
    return first === second ? read(calendarDate(year, first, second)) : { status: 'ambiguous' };
  }
  return { status: 'invalid' };
}

function readOrganicCertificate(r: FieldReader): {
  organicCertifier: string | null;
  organicCertifiedUntil: string | null;
} {
  const organicCertifier = r.label('organicCertifier');
  const text = r.value('organicCertifiedUntil');
  let organicCertifiedUntil: string | null = null;
  if (text !== null) {
    const date = parseCalendarDate(text);
    if (date.status === 'ambiguous') {
      r.issue(
        'organicCertifiedUntil',
        `"${text}" could be read two ways; write it as year-month-day, like 2027-03-31`,
      );
    } else if (date.status === 'invalid') {
      r.issue('organicCertifiedUntil', `"${text}" is not a date like 2027-03-31`);
    } else organicCertifiedUntil = date.date;
  }
  return { organicCertifier, organicCertifiedUntil };
}

/** The fields of a seller's own details. */
const SELLER_FIELDS = [
  'grainTypes',
  'sellerKind',
  'annualTonnes',
  'organicCertifier',
  'organicCertifiedUntil',
] as const satisfies readonly ImportFieldId[];

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

  const websiteText = r.value('website');
  let website: string | null = null;
  if (websiteText !== null) {
    const parsed = parseWebsite(websiteText);
    if (parsed.ok) website = parsed.website;
    else r.issue('website', parsed.message);
  }

  const { phone, more } = readCompanyPhone(r);
  const seller = types.includes('seller');
  const buysToo = types.some((type) => type === 'buyer' || type === 'broker');
  const marketText = r.value('markets');
  // A spreadsheet's Market column on a row that is only a seller (owner's request,
  // 2026-11-03): a seller's market is its grain types, so names that are all grain types
  // are read as them; Pet, Bird … are a buyer's, left out with a warning rather than holding
  // up the file.
  const sellerMarket = r.importing && seller && !buysToo && marketText !== null;
  const marketGrainTypes = sellerMarket ? grainTypesOf(marketText) : null;
  let markets: Market[] = [];
  if (marketGrainTypes === null) markets = readMarkets(r);
  else if (marketGrainTypes.unknown.length > 0) {
    r.notice(
      'markets',
      `is a buyer's (${Object.values(MARKET_LABELS).join(', ')}), so it is not imported for a seller; a seller's is its Grain type: ${GRAIN_TYPE_LIST}`,
    );
  } else if (r.value('grainTypes') === null) {
    r.notice('markets', `is read as the seller's Grain type: ${marketText ?? ''}`);
  }
  let grainTypes = readGrainTypes(r);
  if (marketGrainTypes !== null && grainTypes.length === 0 && marketGrainTypes.unknown.length === 0)
    grainTypes = marketGrainTypes.grainTypes;
  const sellerKind = readSellerKind(r);
  const annualTonnes = readAnnualTonnes(r);
  const { organicCertifier, organicCertifiedUntil } = readOrganicCertificate(r);
  // In a spreadsheet, a seller's details on a row that is not a seller are a mistake worth
  // saying; a form only shows them for a seller and keeps saved ones (Edit details).
  if (r.importing && types.length > 0 && !seller) {
    const given = SELLER_FIELDS.find((field) => r.value(field) !== null);
    if (given !== undefined) r.issue(given, 'is for sellers; this row is not a seller');
  }
  const tierText = r.value('tier');
  const tier =
    tierText === null
      ? null
      : (TIERS.find((item) => item === tierText.replace(/^tier\s*/i, '').toUpperCase()) ?? null);
  if (tierText !== null && tier === null) r.issue('tier', `"${tierText}" must be A, B or C`);
  const written = cleanLines(r.raw('notes'));
  const notes =
    more === null
      ? written
      : `${written === null ? '' : `${written}\n`}Company phone also: ${more}`;
  // Checked here, so a row the check step passes is not refused when imported (Codex's review
  // of ivanmueller/gss#88).
  if (more !== null && notes !== null && notes.length > MAX_IMPORT_VALUE_LENGTH)
    r.issue(
      'notes',
      `with the company phone's other numbers added, is longer than ${String(MAX_IMPORT_VALUE_LENGTH)} characters`,
    );

  if (legalName === null || country === null || types.length === 0) return null;
  return {
    legalName,
    tradingName,
    types,
    primaryCountry: country,
    verificationStatus,
    website,
    phone,
    markets,
    tier,
    grainTypes,
    sellerKind,
    annualTonnes,
    organicCertifier,
    organicCertifiedUntil,
    notes,
  };
}

/**
 * A Commodities column's names ("Canola; Yellow peas"), as what the counterparty buys if it
 * is a buyer, sells if it is a seller, and both for a broker. Names off the list are refused.
 */
function readCommodities(r: FieldReader, types: readonly string[]): CommodityInterest[] {
  const text = r.value('commodities');
  if (text === null) return [];
  const { commodities, unknown } = parseCommodityList(text);
  if (unknown.length > 0) {
    r.issue(
      'commodities',
      `${unknown.map((name) => `"${name}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not on the list of commodities (for example Spring wheat, Feed barley, Yellow peas)`,
    );
  }
  const directions = commodityDirections(types);
  if (types.length > 0 && directions.length === 0) {
    r.issue('commodities', 'are for buyers, sellers and brokers, not carriers');
  }
  return directions.flatMap((direction) =>
    commodities.map((commodity) => ({ commodity, direction })),
  );
}

/**
 * A carrier's equipment and lanes: every place in Loads in to every place in Delivers to, by
 * the Mode given or, when empty, not stated (owner's answer, 2026-11-01). Only for carriers.
 */
function readCarrierColumns(
  r: FieldReader,
  types: readonly string[],
): { equipment: Equipment[]; lanes: CarrierLane[] } {
  const equipmentText = r.value('equipment');
  const fromText = r.value('loadsIn');
  const toText = r.value('deliversTo');
  const modeText = r.value('laneMode');
  const none = { equipment: [], lanes: [] };
  if (equipmentText === null && fromText === null && toText === null && modeText === null) {
    return none;
  }
  const carrier = types.includes('carrier');
  if (types.length > 0 && !carrier) {
    const field =
      equipmentText !== null ? 'equipment' : fromText !== null ? 'loadsIn' : 'deliversTo';
    r.issue(field, 'is for carriers; this row is not a carrier');
    return none;
  }

  let equipment: Equipment[] = [];
  if (equipmentText !== null) {
    const parsed = parseEquipmentList(equipmentText);
    equipment = parsed.equipment;
    if (parsed.unknown.length > 0) {
      r.issue(
        'equipment',
        `${parsed.unknown.map((name) => `"${name}"`).join(', ')} must be Super B hopper, Tridem hopper, Walking floor, Dry van, Flatdeck, Container or Rail hopper car`,
      );
    }
  }

  const places = (field: 'loadsIn' | 'deliversTo', text: string | null): string[] => {
    if (text === null) return [];
    const parsed = parsePlaceList(text);
    if (parsed.unknown.length > 0) {
      r.issue(
        field,
        `${parsed.unknown.map((name) => `"${name}"`).join(', ')} ${parsed.unknown.length === 1 ? 'is not a province or state' : 'are not provinces or states'} (for example AB or Montana)`,
      );
    }
    return parsed.places;
  };
  const origins = places('loadsIn', fromText);
  const destinations = places('deliversTo', toText);
  if (fromText !== null && toText === null) r.issue('deliversTo', 'is needed with Loads in');
  if (toText !== null && fromText === null) r.issue('loadsIn', 'is needed with Delivers to');
  const transport = parseLaneMode(modeText);
  if (transport === undefined) {
    r.issue('laneMode', `"${modeText ?? ''}" must be Truck, Rail or Both, or left empty`);
  } else if (modeText !== null && fromText === null && toText === null) {
    r.issue('laneMode', 'is for a lane; give Loads in and Delivers to');
  }
  const lanes = origins.flatMap((origin) =>
    destinations.map((destination) => ({ origin, destination, transport: transport ?? null })),
  );
  return { equipment, lanes };
}

/** A contact, or null when no contact field has a value. */
function readContact(r: FieldReader): ContactInput | null {
  if (!CONTACT_FIELD_IDS.some((field) => r.value(field) !== null)) return null;
  const name = r.label('contactName');
  const email = r.value('contactEmail');
  if (r.value('contactName') === null)
    r.issue('contactName', 'is required when other contact details are given');
  if (email !== null && (email.length > 254 || !EMAIL.test(email)))
    r.issue('contactEmail', `"${email}" is not an email address`);
  const phone = readPhone(r, 'contactPhone');
  return name === null ? null : { name, role: r.label('contactRole'), email, phone };
}

/**
 * A location, or null when no location field has a value. Its country is the location's own
 * or, when not given, `fallbackCountry` (the counterparty's).
 */
function readFacility(r: FieldReader, fallbackCountry: CountryCode | null): FacilityInput | null {
  const servedByText = r.importing ? r.value('servedBy') : null;
  if (!FACILITY_FIELD_IDS.some((field) => r.value(field) !== null)) {
    if (servedByText !== null) r.issue('servedBy', 'is for a location; give its address or city');
    return null;
  }
  const transportAccess = parseLaneMode(servedByText);
  if (transportAccess === undefined)
    r.issue('servedBy', `"${servedByText ?? ''}" must be Rail, Truck or Both, or left empty`);

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
    // Only a spreadsheet's filled Served by cell says it; otherwise the form's or kept.
    ...(transportAccess !== null && transportAccess !== undefined && { transportAccess }),
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
  options: { defaultTypes?: readonly CounterpartyType[]; importing?: boolean } = {},
):
  | { status: 'ok'; record: DirectoryRecord; notices: FieldIssue[] }
  | { status: 'empty' }
  | { status: 'invalid'; issues: FieldIssue[] } {
  const r = new FieldReader(values, options.importing === true);
  if (FIELD_IDS.every((field) => r.value(field) === null)) return { status: 'empty' };
  r.checkLengths(FIELD_IDS);
  const counterparty = readCounterparty(r, options.defaultTypes);
  const contact = readContact(r);
  const countryText = r.value('country');
  const facility = readFacility(r, countryText === null ? null : normalizeCountry(countryText));
  const commodities = readCommodities(r, counterparty?.types ?? []);
  const { equipment, lanes } = readCarrierColumns(r, counterparty?.types ?? []);
  if (r.issues.length > 0 || counterparty === null) return { status: 'invalid', issues: r.issues };
  return {
    status: 'ok',
    record: { counterparty, contact, facility, commodities, equipment, lanes },
    notices: r.notices,
  };
}

/** Validates one mapped spreadsheet row; rows without a type are buyers unless `defaultTypes` says otherwise. */
export function parseImportRow(
  line: number,
  values: ImportRowValues,
  options: { defaultTypes?: readonly CounterpartyType[] } = {},
): ParseRowResult {
  const result = parseDirectoryRecord(values, {
    defaultTypes: options.defaultTypes ?? ['buyer'],
    importing: true,
  });
  if (result.status === 'empty') return result;
  if (result.status === 'invalid') {
    return { status: 'invalid', issues: result.issues.map((issue) => ({ line, ...issue })) };
  }
  return {
    status: 'ok',
    row: {
      line,
      ...result.record,
      givenVerification: (values.verificationStatus ?? '').trim() !== '',
      notices: result.notices.map((notice) => ({ line, ...notice })),
    },
  };
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

/** Company name endings written several ways, each read as one. */
const NAME_ENDINGS: Record<string, string> = {
  limited: 'ltd',
  incorporated: 'inc',
  corporation: 'corp',
  company: 'co',
};

/**
 * A company's name as it is matched (owner's answer, 2026-10-30): without case, accents,
 * punctuation or extra spaces, "&" read as "and", and Limited, Incorporated, Corporation and
 * Company read as Ltd, Inc, Corp and Co. So "Prairie Feeds Ltd." and "PRAIRIE FEEDS LIMITED"
 * are one company.
 */
export function companyNameKey(legalName: string): string {
  return (
    legalName
      .normalize('NFD')
      // Accents only: other scripts keep their marks and letters, so "北京 Grain" and
      // "上海 Grain" stay two companies (Codex's review of ivanmueller/gss#88).
      .replace(/[\u0300-\u036f]/g, '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .trim()
      .split(' ')
      .map((word) => NAME_ENDINGS[word] ?? word)
      .join(' ')
  );
}

/**
 * The key a company is matched by in an import, within the file and against the list:
 * its country and its name as companyNameKey reads it.
 */
export function counterpartyKey(country: string, legalName: string): string {
  return `${country}:${companyNameKey(legalName)}`;
}

/**
 * A location as it is matched: its name and where it is, ignoring case and spacing. One with
 * no name or address is matched by its coordinates, so two such places stay two (Codex's
 * review of ivanmueller/gss#88); one with a name or address is the same place whether or not
 * its coordinates were found since.
 */
export function facilityKey(
  facility: Pick<
    FacilityInput,
    'name' | 'addressLine' | 'city' | 'region' | 'postalCode' | 'country' | 'latitude' | 'longitude'
  >,
): string {
  const words = [
    facility.name,
    facility.addressLine,
    facility.city,
    facility.region,
    facility.postalCode,
  ].map((part) => (part ?? '').toLowerCase().replace(/\s+/g, ' ').trim());
  const at = words.every((part) => part === '')
    ? [facility.latitude, facility.longitude].map((part) =>
        part === null ? '' : Number(part).toFixed(6),
      )
    : [];
  return [...words, facility.country.toLowerCase(), ...at].join('|');
}

/** A contact as it is matched: by email when it has one, else by name and phone. */
export function contactKey(contact: Pick<ContactInput, 'name' | 'email' | 'phone'>): string {
  return contact.email?.toLowerCase() ?? `${contact.name.toLowerCase()}|${contact.phone ?? ''}`;
}

export interface ImportGroup {
  key: string;
  counterparty: CounterpartyInput;
  /** Whether its first row gave a verification status (ParsedImportRow). */
  givenVerification: boolean;
  contacts: ContactInput[];
  facilities: FacilityInput[];
  /** Every row's commodities, each once. */
  commodities: CommodityInterest[];
  /** Every row's equipment, each once, and lanes, each pair of places once. */
  equipment: Equipment[];
  lanes: CarrierLane[];
  lines: number[];
}

/**
 * Rows with the same legal name and country become one counterparty with several
 * contacts and locations. The first row's company details are used; a later row that
 * disagrees produces a warning, not an error. Repeated contacts and locations are kept once;
 * every row's commodities are kept, each once.
 */
export function groupImportRows(rows: ParsedImportRow[]): {
  groups: ImportGroup[];
  warnings: ImportIssue[];
  /** Rows that cannot join their company as given (a carrier's columns on a non-carrier). */
  issues: ImportIssue[];
} {
  const groups = new Map<string, ImportGroup>();
  const warnings: ImportIssue[] = [];
  const issues: ImportIssue[] = [];
  const contactKeys = new Map<string, Set<string>>();
  const facilityKeys = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = counterpartyKey(row.counterparty.primaryCountry, row.counterparty.legalName);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        counterparty: row.counterparty,
        givenVerification: row.givenVerification,
        contacts: [],
        facilities: [],
        commodities: [],
        equipment: [],
        lanes: [],
        lines: [],
      };
      groups.set(key, group);
      contactKeys.set(key, new Set());
      facilityKeys.set(key, new Set());
    } else {
      const first = group.counterparty;
      const firstLine = group.lines[0] ?? row.line;
      const compare: [ImportFieldId, string | null, string | null][] = [
        // Capitals alone are not worth a note; other spelling differences are.
        ['legalName', first.legalName.toLowerCase(), row.counterparty.legalName.toLowerCase()],
        ['tradingName', first.tradingName, row.counterparty.tradingName],
        ['types', first.types.join(', '), row.counterparty.types.join(', ')],
        ['verificationStatus', first.verificationStatus, row.counterparty.verificationStatus],
        ['website', first.website, row.counterparty.website],
        ['companyPhone', first.phone, row.counterparty.phone],
        ['markets', first.markets.join(', '), row.counterparty.markets.join(', ') || null],
        ['tier', first.tier, row.counterparty.tier],
        ['grainTypes', first.grainTypes.join(', '), row.counterparty.grainTypes.join(', ') || null],
        ['sellerKind', first.sellerKind, row.counterparty.sellerKind],
        [
          'annualTonnes',
          first.annualTonnes === null ? null : String(first.annualTonnes),
          row.counterparty.annualTonnes === null ? null : String(row.counterparty.annualTonnes),
        ],
        ['organicCertifier', first.organicCertifier, row.counterparty.organicCertifier],
        [
          'organicCertifiedUntil',
          first.organicCertifiedUntil,
          row.counterparty.organicCertifiedUntil,
        ],
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
    warnings.push(...row.notices);

    if (row.contact) {
      const contactMatch = contactKey(row.contact);
      const seen = contactKeys.get(key);
      if (seen && !seen.has(contactMatch)) {
        seen.add(contactMatch);
        group.contacts.push(row.contact);
      }
    }
    for (const interest of row.commodities) {
      const listed = group.commodities.some(
        (kept) => kept.commodity === interest.commodity && kept.direction === interest.direction,
      );
      if (!listed) group.commodities.push(interest);
    }
    // The first row's type is the company's: a later row's equipment and lanes need it to be
    // a carrier too (Codex's review of 08a3957).
    if (
      (row.equipment.length > 0 || row.lanes.length > 0) &&
      !group.counterparty.types.includes('carrier')
    ) {
      issues.push({
        line: row.line,
        field: 'types',
        message: `differs from line ${String(group.lines[0] ?? row.line)}, whose type is the company's: equipment and lanes need it to be a carrier there too`,
      });
      continue;
    }
    group.equipment = EQUIPMENT_ORDER.filter(
      (item) => group.equipment.includes(item) || row.equipment.includes(item),
    );
    for (const lane of row.lanes) {
      const kept = group.lanes.find(
        (other) => other.origin === lane.origin && other.destination === lane.destination,
      );
      if (!kept) group.lanes.push(lane);
      // A lane given twice: the first stated truck or rail is kept.
      else if (kept.transport === null) kept.transport = lane.transport;
      else if (lane.transport !== null && lane.transport !== kept.transport) {
        warnings.push({
          line: row.line,
          field: 'laneMode',
          message: `differs from an earlier line for the same lane; the earlier Mode is used`,
        });
      }
    }
    if (row.facility) {
      const facilityMatch = facilityKey(row.facility);
      const seen = facilityKeys.get(key);
      if (seen && !seen.has(facilityMatch)) {
        seen.add(facilityMatch);
        group.facilities.push(row.facility);
      }
    }
  }
  return { groups: [...groups.values()], warnings, issues };
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
