import { isLaneRegion } from '@grain/domain';
import type {
  CarrierLane,
  Equipment,
  LaneChangeInput,
  ListedLane,
  Member,
  MemberRole,
  MemberStatus,
  Bbox,
  CommodityChange,
  CommodityDirection,
  CommodityInterest,
  ContactInput,
  CounterpartyType,
  SignedMatch,
  CounterpartyInput,
  FacilityInput,
  FacilityType,
  GeocodeScope,
  LocationPrecision,
  Market,
  Tier,
  TransportAccess,
  GrainType,
  ImportSummary,
  SellerKind,
  UndoImportPlan,
  VerificationStatus,
} from '@grain/domain';
import postgres from 'postgres';

import { callbackQueries, type CallbacksDatabase } from './callbacks-db';
import { callQueries, type CallsDatabase } from './calls-db';
import { readingQueries, type ReadingsDatabase } from './readings-db';
import { summaryQueries, type SummariesDatabase } from './summaries-db';
import { crmQueries, type CrmDatabase } from './crm-db';
import { freightQueries, type FreightDatabase } from './freight-db';
import { fxQueries, type FxDatabase } from './fx-db';
import { emailQueries, type EmailsDatabase } from './emails-db';
import { forwardingQueries, type ForwardingDatabase } from './forwarding-db';
import { autoDraftQueries, type AutoDraftsDatabase } from './email-auto-drafts-db';
import { mapLayerQueries, type MapLayersDatabase } from './map-layers-db';
import type { FacilityAddress } from './geocoding';
import { quoteQueries, type QuoteDatabase } from './quotes-db';

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: string;
}

/** The verified user a query runs as, and the request it belongs to (for the audit trail). */
export interface RequestContext {
  userId: string;
  requestId: string;
}

export interface CounterpartySummary {
  id: string;
  organizationId: string;
  legalName: string;
  tradingName: string | null;
  types: string[];
  primaryCountry: string;
  verificationStatus: string;
  source: string;
  createdAt: string;
  contactCount: number;
  facilityCount: number;
  /** Provinces and states of the counterparty's facilities. */
  regions: string[];
  logoSha256: string | null;
  /** When it was archived; archived counterparties are left off the map. */
  archivedAt: string | null;
  /** The commodities it buys and sells (codes), in the commodity list's order. */
  buys: string[];
  sells: string[];
  /** The markets it serves (pet, bird, …) and its tier (A, B, C or null). */
  markets: string[];
  tier: string | null;
  /** A seller's grain types (GRAIN_TYPES order), kind, tonnes a year and organic certificate. */
  grainTypes: string[];
  sellerKind: string | null;
  annualTonnes: number | null;
  organicCertifier: string | null;
  /** A calendar date, YYYY-MM-DD. */
  organicCertifiedUntil: string | null;
  /** A carrier's equipment, in EQUIPMENT order (@grain/domain). */
  equipment: string[];
  /** A carrier's lanes as entered, by origin and destination, verified or not. */
  lanes: ListedLane[];
  /**
   * The places its freight rates run between (from their locations' provinces and states),
   * withdrawn and expired ones too; derived, never stored.
   */
  quotedLanes: CarrierLane[];
}

export interface Contact extends ContactInput {
  id: string;
  /** The counterparty's main contact, shown at the top of its page; at most one. */
  isMain: boolean;
  /** Its last change time, sent back with an edit so a stale edit is refused (VERSION in @grain/domain). */
  version: string;
}

export interface Facility {
  id: string;
  name: string | null;
  facilityType: FacilityType | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  latitude: string | null;
  longitude: string | null;
  locationPrecision: LocationPrecision | null;
  /** Where the coordinates came from: 'geocodio', 'manual' or 'file_import'. */
  geocodingSource: string | null;
  /** Rail, truck or both; null when not known. */
  transportAccess: TransportAccess | null;
  version: string;
}

export interface CounterpartyDetail extends CounterpartySummary {
  /** A public http or https address (parseWebsite in @grain/domain). */
  website: string | null;
  /** The company's main phone number. */
  phone: string | null;
  notes: string | null;
  version: string;
  contacts: Contact[];
  facilities: Facility[];
  /** What it buys and sells, in the commodity list's order, buys first. */
  commodities: CounterpartyCommodity[];
}

export interface CounterpartyCommodity {
  code: string;
  name: string;
  direction: CommodityDirection;
  /** When someone on the team verified it; null while unverified (e.g. from a spreadsheet). */
  verifiedAt: string | null;
}

/** The outcome of a change to a counterparty, its contacts or its locations. */
/** What a counterparty has that keeps it from being deleted: records that keep their history. */
export type CounterpartyHistory =
  'quotes' | 'freight' | 'contact_log' | 'follow_ups' | 'calls' | 'emails';

export type DeleteResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  /** The user is not an admin of its organization. */
  | { status: 'forbidden' }
  | { status: 'not_archived' }
  | { status: 'has_history'; history: CounterpartyHistory[] };

export type UndoImportResult =
  | { status: 'ok'; committed: boolean; plan: UndoImportPlan }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'undone' }
  /** It no longer removes what was previewed: the new plan, nothing written. */
  | { status: 'changed'; plan: UndoImportPlan };

export type WriteResult =
  | { status: 'saved' }
  /** The counterparty (or its contact or location) does not exist or is not visible. */
  | { status: 'not_found' }
  /** The user may read but not change the organization's directory. */
  | { status: 'forbidden' }
  /** The record changed after the version the user edited. */
  | { status: 'changed' }
  /** Archived counterparties are restored before they are changed. */
  | { status: 'archived' };

export type CreateResult = { status: 'created'; id: string } | { status: 'forbidden' };

export interface Logo {
  data: Uint8Array;
  sha256: string;
}

export type PutLogoResult =
  { status: 'saved'; sha256: string } | { status: 'not_found' } | { status: 'forbidden' };

export interface NewCounterparty {
  counterparty: CounterpartyInput;
  contacts: ContactInput[];
  facilities: FacilityInput[];
  commodities: CommodityInterest[];
  /** A carrier's equipment and first lanes (each pair of places once). */
  equipment?: Equipment[];
  lanes?: CarrierLane[];
}

export interface ImportBatchInput {
  organizationId: string;
  fileName: string;
  contentSha256: string;
  rowCount: number;
  /** Keys (counterpartyKey) that already exist and are skipped. */
  skippedCount: number;
  counterparties: NewCounterparty[];
  /**
   * New locations, contacts and commodities for companies already in the list (owner's
   * answer, 2026-10-30); their own details are never changed. A company archived meanwhile
   * gets nothing.
   */
  additions: ImportAddition[];
}

export interface ImportAddition {
  counterpartyId: string;
  /**
   * Its own details the file changes, filled cells winning (owner's answer, 2026-10-31); only
   * the fields given are written, none is ever cleared. Null when none changes.
   */
  details: CounterpartyChanges | null;
  contacts: ContactInput[];
  facilities: FacilityInput[];
  commodities: CommodityInterest[];
  /** Its contacts the file changes: only the fields given. */
  /** A carrier's lanes the file adds, unverified; listed ones are left as they are. */
  lanes?: CarrierLane[];
  /**
   * What undoing the import takes off again, recorded with it (app.import_additions): the
   * types it adds, whether it fills in seller details the company has none of, and what else
   * it replaces, to check by hand (Codex's review of a62e00a).
   */
  provenance?: { addedTypes: CounterpartyType[]; sellerDetails: boolean; replaced: string[] };
  contactUpdates: {
    id: string;
    changes: Partial<Pick<ContactInput, 'role' | 'email' | 'phone'>>;
  }[];
  /** Its locations the file changes: only the fields given. */
  facilityUpdates: { id: string; changes: FacilityChanges }[];
}

export type CounterpartyChanges = Partial<
  Pick<
    CounterpartyInput,
    | 'types'
    | 'verificationStatus'
    | 'website'
    | 'phone'
    | 'markets'
    | 'tier'
    | 'grainTypes'
    | 'sellerKind'
    | 'annualTonnes'
    | 'organicCertifier'
    | 'organicCertifiedUntil'
    | 'notes'
  > & {
    /** A carrier's equipment with the file's added: never removed by a file. */
    equipment: Equipment[];
  }
>;

/** A location's type, missing address parts, rail or truck access, or coordinates (given together). */
export type FacilityChanges = Partial<
  Pick<FacilityInput, 'facilityType' | 'addressLine' | 'postalCode'> & {
    transportAccess: TransportAccess;
  }
> & {
  coordinates?: Pick<FacilityInput, 'latitude' | 'longitude' | 'locationPrecision'>;
};

/** A company already in the list, with what it has, to match an import against. */
export interface ExistingCounterparty {
  id: string;
  primaryCountry: string;
  legalName: string;
  archived: boolean;
  types: CounterpartyType[];
  verificationStatus: VerificationStatus;
  website: string | null;
  phone: string | null;
  markets: Market[];
  tier: Tier | null;
  grainTypes: GrainType[];
  sellerKind: SellerKind | null;
  annualTonnes: number | null;
  organicCertifier: string | null;
  organicCertifiedUntil: string | null;
  notes: string | null;
  equipment: Equipment[];
  facilities: ExistingFacility[];
  contacts: (ContactInput & { id: string })[];
  commodities: CommodityInterest[];
  /** Its lanes' places, to leave the listed ones as they are. */
  lanes: Pick<CarrierLane, 'origin' | 'destination'>[];
}

/** A location as an import matches and updates it. */
export type ExistingFacility = Pick<
  FacilityInput,
  | 'name'
  | 'facilityType'
  | 'addressLine'
  | 'city'
  | 'region'
  | 'postalCode'
  | 'country'
  | 'latitude'
  | 'longitude'
  | 'locationPrecision'
> & { id: string; transportAccess: TransportAccess | null };

/** A located facility for a map pin, with the counterparty it belongs to. */
export interface MapFacility {
  id: string;
  counterpartyId: string;
  legalName: string;
  tradingName: string | null;
  counterpartyTypes: string[];
  name: string | null;
  facilityType: FacilityType | null;
  city: string | null;
  region: string | null;
  country: string;
  latitude: string;
  longitude: string;
  locationPrecision: LocationPrecision;
}

export interface MapFacilities {
  /** Facilities inside the box, up to MAP_LIMIT + 1 so the caller can tell there were more. */
  facilities: MapFacility[];
  /** Facilities the user can see that have no coordinates, so no map can show them. */
  withoutCoordinates: number;
}

export type AddMemberResult =
  | { status: 'added'; id: string }
  | { status: 'forbidden' }
  /** No login has this email: it is created in the Supabase dashboard first. */
  | { status: 'no_account' }
  | { status: 'already_member' };

export interface MemberChanges {
  role?: MemberRole | undefined;
  status?: MemberStatus | undefined;
  /** null removes the name; undefined leaves it. */
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
}

export type UpdateMemberResult =
  | { status: 'saved' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'changed' }
  /** Admins change their own name, but not their own role or status. */
  | { status: 'self' };

/** Largest list returned by listCounterparties. */
export const LIST_LIMIT = 5000;

/** Largest number of facilities returned for one map view. */
export const MAP_LIMIT = 5000;

/** What the API reads from and writes to Postgres. Every call runs as the given, already verified user. */
export interface Database
  extends
    QuoteDatabase,
    FreightDatabase,
    FxDatabase,
    CrmDatabase,
    CallsDatabase,
    CallbacksDatabase,
    ReadingsDatabase,
    SummariesDatabase,
    MapLayersDatabase,
    EmailsDatabase,
    AutoDraftsDatabase,
    ForwardingDatabase {
  memberships: (userId: string) => Promise<Membership[]>;
  canEditDirectory: (ctx: RequestContext, organizationId: string) => Promise<boolean>;
  listCounterparties: (
    ctx: RequestContext,
    organizationId: string | null,
  ) => Promise<CounterpartySummary[]>;
  getCounterparty: (ctx: RequestContext, id: string) => Promise<CounterpartyDetail | null>;
  /** Located facilities in the box, of counterparties with the given type when one is given; archived counterparties are left out. */
  facilitiesInBbox: (
    ctx: RequestContext,
    organizationId: string | null,
    bbox: Bbox,
    type: CounterpartyType | null,
  ) => Promise<MapFacilities>;
  /**
   * The organization's facilities without coordinates, up to `limit` + 1, by counterparty;
   * only one counterparty's or one import's when `scope` says so.
   */
  facilitiesWithoutCoordinates: (
    ctx: RequestContext,
    organizationId: string,
    limit: number,
    scope?: GeocodeScope,
    /** Only facilities whose id comes after this one: pages in id order. */
    after?: string,
  ) => Promise<FacilityAddress[]>;
  /**
   * Saves geocoded coordinates for facilities of the organization that still have none;
   * returns the ids of the facilities saved.
   */
  saveCoordinates: (
    ctx: RequestContext,
    organizationId: string,
    matches: SignedMatch[],
  ) => Promise<string[]>;
  getLogo: (ctx: RequestContext, counterpartyId: string) => Promise<Logo | null>;
  putLogo: (
    ctx: RequestContext,
    counterpartyId: string,
    data: Uint8Array,
  ) => Promise<PutLogoResult>;
  /** The organization's counterparties with their locations, contacts and commodities. */
  existingCounterparties: (
    ctx: RequestContext,
    organizationId: string,
  ) => Promise<ExistingCounterparty[]>;
  /** Creates the batch and its counterparties in one transaction; returns the batch id. */
  /**
   * Imports a file, one import at a time per organization: under the organization's import
   * lock it reads the companies already listed, asks `plan` what to write given them, and
   * writes it, all in one transaction. Null when `plan` finds nothing to write.
   */
  importCounterparties: (
    ctx: RequestContext,
    organizationId: string,
    plan: (existing: ExistingCounterparty[]) => ImportBatchInput | null,
    /** Runs on the plan kept, before anything is written; throwing writes nothing. */
    check?: (batch: ImportBatchInput | null) => Promise<void>,
  ) => Promise<string | null>;
  isOrgAdmin: (ctx: RequestContext, organizationId: string) => Promise<boolean>;
  /** Sets a member's names (null removes one); false when not allowed or not a member. */
  setMemberNames: (
    ctx: RequestContext,
    organizationId: string,
    memberId: string,
    firstName: string | null,
    lastName: string | null,
  ) => Promise<boolean>;
  /** The organization's members for its admins; null when the user is not one. */
  listMembers: (ctx: RequestContext, organizationId: string) => Promise<Member[] | null>;
  addMember: (
    ctx: RequestContext,
    organizationId: string,
    email: string,
    role: MemberRole,
  ) => Promise<AddMemberResult>;
  updateMember: (
    ctx: RequestContext,
    organizationId: string,
    memberId: string,
    version: string,
    changes: MemberChanges,
  ) => Promise<UpdateMemberResult>;
  /** One counterparty entered by hand, with its first contact and location, in one transaction. */
  createCounterparty: (
    ctx: RequestContext,
    organizationId: string,
    record: NewCounterparty,
  ) => Promise<CreateResult>;
  /** A carrier's equipment changes too when given; left out, it is kept. */
  updateCounterparty: (
    ctx: RequestContext,
    id: string,
    version: string,
    input: CounterpartyInput,
    equipment?: Equipment[],
  ) => Promise<WriteResult>;
  /** Archives or restores a counterparty; doing what is already done changes nothing. */
  setArchived: (ctx: RequestContext, id: string, archived: boolean) => Promise<WriteResult>;
  /**
   * Deletes an archived counterparty with its contacts, locations, commodities and logo; only
   * an admin of its organization may (owner's request, 2026-10-31). One with bids or offers,
   * freight rates, a contact history or follow-ups is kept.
   */
  deleteCounterparty: (ctx: RequestContext, id: string) => Promise<DeleteResult>;
  /** The organization's spreadsheet imports, latest first; admins only. */
  listImports: (ctx: RequestContext, organizationId: string) => Promise<ImportSummary[] | null>;
  /**
   * What undoing an import removes (`commit` false), or removes it (`commit` true, only when it
   * still deletes `expected` companies), under the import lock and the admin's membership lock.
   */
  undoImport: (
    ctx: RequestContext,
    batchId: string,
    commit: boolean,
    expected?: number,
  ) => Promise<UndoImportResult>;
  addContact: (
    ctx: RequestContext,
    counterpartyId: string,
    input: ContactInput,
  ) => Promise<WriteResult>;
  updateContact: (
    ctx: RequestContext,
    counterpartyId: string,
    contactId: string,
    version: string,
    input: ContactInput,
  ) => Promise<WriteResult>;
  removeContact: (
    ctx: RequestContext,
    counterpartyId: string,
    contactId: string,
  ) => Promise<WriteResult>;
  /**
   * Adds, removes and verifies commodities a counterparty buys or sells; any active member
   * of its organization may. One added is verified by whoever adds it. Adding one already
   * listed, removing one that is not, or verifying one already verified, changes nothing.
   */
  changeCommodities: (
    ctx: RequestContext,
    counterpartyId: string,
    change: CommodityChange,
  ) => Promise<WriteResult>;
  /**
   * Adds, changes the transport of, and removes a carrier's lanes; traders, operations and
   * admins may (owner's request, 2026-11-01). Removals first; adding a lane already listed
   * changes its transport; removing one that is not listed changes nothing.
   */
  changeLanes: (
    ctx: RequestContext,
    carrierId: string,
    change: LaneChangeInput,
  ) => Promise<WriteResult | { status: 'not_carrier' }>;
  /** Makes one of its contacts the main contact (any other stops being it), or none (null). */
  setMainContact: (
    ctx: RequestContext,
    counterpartyId: string,
    contactId: string | null,
  ) => Promise<WriteResult>;
  addFacility: (
    ctx: RequestContext,
    counterpartyId: string,
    input: FacilityInput,
  ) => Promise<WriteResult>;
  /** Coordinates that change get the source 'manual'; unchanged ones keep theirs. */
  updateFacility: (
    ctx: RequestContext,
    counterpartyId: string,
    facilityId: string,
    version: string,
    input: FacilityInput,
  ) => Promise<WriteResult>;
  removeFacility: (
    ctx: RequestContext,
    counterpartyId: string,
    facilityId: string,
  ) => Promise<WriteResult>;
  close: () => Promise<void>;
}

function isLocalHost(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

// Postgres caps one statement at 65535 parameters; facilities use 14 per row.
const INSERT_CHUNK = 1000;

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += INSERT_CHUNK) {
    result.push(items.slice(index, index + INSERT_CHUNK));
  }
  return result;
}

interface SummaryRow {
  id: string;
  organization_id: string;
  legal_name: string;
  trading_name: string | null;
  types: string[];
  primary_country: string;
  verification_status: string;
  source: string;
  created_at: Date;
  contact_count: number;
  facility_count: number;
  regions: string[];
  logo_sha256: string | null;
  archived_at: Date | null;
  buys: string[];
  sells: string[];
  markets: string[];
  tier: string | null;
  grain_types: string[];
  seller_kind: string | null;
  annual_tonnes: number | null;
  organic_certifier: string | null;
  organic_certified_until: string | null;
  equipment: string[];
  lanes: ListedLane[];
  quoted_lanes: CarrierLane[];
}

/** Only the lanes between known places (a location's province may be any short code). */
function knownLanes(lanes: CarrierLane[]): CarrierLane[] {
  return lanes.filter((lane) => isLaneRegion(lane.origin) && isLaneRegion(lane.destination));
}

function summary(row: SummaryRow): CounterpartySummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    legalName: row.legal_name,
    tradingName: row.trading_name,
    types: row.types,
    primaryCountry: row.primary_country,
    verificationStatus: row.verification_status,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    contactCount: row.contact_count,
    facilityCount: row.facility_count,
    regions: row.regions,
    logoSha256: row.logo_sha256,
    archivedAt: row.archived_at?.toISOString() ?? null,
    buys: row.buys,
    sells: row.sells,
    markets: row.markets,
    tier: row.tier,
    grainTypes: row.grain_types,
    sellerKind: row.seller_kind,
    annualTonnes: row.annual_tonnes,
    organicCertifier: row.organic_certifier,
    organicCertifiedUntil: row.organic_certified_until,
    equipment: row.equipment,
    lanes: row.lanes,
    quotedLanes: knownLanes(row.quoted_lanes),
  };
}

/** Postgres array literal for a list of enum labels from a fixed set. */
function enumArray(values: readonly string[]): string {
  return `{${values.join(',')}}`;
}

/**
 * A record's version is its updated_at to the microsecond, in UTC, as text from Postgres;
 * VERSION in @grain/domain checks its form. Versions are compared as text: postgres.js
 * sends a timestamptz parameter through a JavaScript Date, which keeps only milliseconds.
 */
const VERSION_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** Coordinates entered by hand or imported get that as their source; none, none. */
function enteredSource(facility: FacilityInput, source: 'manual' | 'file_import'): string | null {
  return facility.latitude === null ? null : source;
}

/** Thrown to end a transaction without its writes, answering with `result`. */
class RolledBack<T> extends Error {
  constructor(readonly result: T) {
    super('rolled back');
  }
}

/**
 * Every update an import plans changes its row (Codex's review of ivanmueller/gss#95): if row
 * level security skips one, the whole import is rolled back and refused, as a refused insert
 * already is, rather than recorded without it.
 */
function updated(rows: readonly unknown[]): void {
  if (rows.length !== 1) {
    throw Object.assign(new Error('an update in the import was refused'), { code: '42501' });
  }
}

const SAVED = { status: 'saved' } as const;
const NOT_FOUND = { status: 'not_found' } as const;
const CHANGED = { status: 'changed' } as const;

/**
 * Whether the user may change this counterparty and what lies under it: it is visible, the
 * user is an editor of its organization and, unless `whenArchived`, it is not archived.
 * Row level security enforces the first two again on every write.
 */
async function editable(
  tx: postgres.TransactionSql,
  counterpartyId: string,
  options: { whenArchived?: boolean } = {},
): Promise<
  | { status: 'ok'; organizationId: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'archived' }
> {
  const [row] = await tx<{ organization_id: string; allowed: boolean }[]>`
    select organization_id, app.can_edit_directory(organization_id) as allowed
    from app.counterparties where id = ${counterpartyId}`;
  if (!row) return NOT_FOUND;
  if (!row.allowed) return { status: 'forbidden' };
  // Lock the counterparty for the rest of the transaction and read it again: archiving it
  // and changing it or anything under it then happen one after the other, so a change
  // never lands on a counterparty archived in the meantime. (Locking needs the update
  // policy, which only editors pass, hence the unlocked read above for the answers.)
  const [locked] = await tx<{ archived: boolean }[]>`
    select archived_at is not null as archived
    from app.counterparties where id = ${counterpartyId}
    for no key update`;
  if (!locked) return NOT_FOUND;
  if (locked.archived && options.whenArchived !== true) return { status: 'archived' };
  return { status: 'ok', organizationId: row.organization_id };
}

/** Whether a contact or facility of the counterparty exists (and is visible). */
async function exists(
  tx: postgres.TransactionSql,
  table: 'counterparty_contacts' | 'facilities',
  counterpartyId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx`
    select 1 from ${tx(`app.${table}`)} where id = ${id} and counterparty_id = ${counterpartyId}`;
  return rows.length === 1;
}

async function insertContact(
  tx: postgres.TransactionSql,
  organizationId: string,
  counterpartyId: string,
  contact: ContactInput,
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into app.counterparty_contacts
      (organization_id, counterparty_id, name, role, email, phone, created_by)
    values (${organizationId}, ${counterpartyId}, ${contact.name}, ${contact.role},
            ${contact.email}, ${contact.phone}, app.current_user_id())
    returning id
  `;
  if (!row) throw new Error('contact was not created');
  return row.id;
}

/**
 * Adds a contact inside the caller's transaction: the same checks as
 * POST /counterparties/{id}/contacts. Used by addContact and by verifying one of Claude's drafts.
 */
export async function addContactIn(
  tx: postgres.TransactionSql,
  counterpartyId: string,
  input: ContactInput,
): Promise<
  { status: 'added'; id: string } | Exclude<WriteResult, { status: 'saved' | 'changed' }>
> {
  const target = await editable(tx, counterpartyId);
  if (target.status !== 'ok') return target;
  const id = await insertContact(tx, target.organizationId, counterpartyId, input);
  return { status: 'added', id };
}

/**
 * Changes a contact inside the caller's transaction, refused when it changed after `version`:
 * the same checks as PATCH /counterparties/{id}/contacts/{contactId}.
 */
export async function updateContactIn(
  tx: postgres.TransactionSql,
  counterpartyId: string,
  contactId: string,
  version: string,
  input: ContactInput,
): Promise<WriteResult> {
  const target = await editable(tx, counterpartyId);
  if (target.status !== 'ok') return target;
  const rows = await tx`
    update app.counterparty_contacts
    set name = ${input.name}, role = ${input.role}, email = ${input.email},
        phone = ${input.phone}
    where id = ${contactId} and counterparty_id = ${counterpartyId}
      and to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) = ${version}
    returning id
  `;
  if (rows.length === 1) return SAVED;
  return (await exists(tx, 'counterparty_contacts', counterpartyId, contactId))
    ? CHANGED
    : NOT_FOUND;
}

async function insertFacility(
  tx: postgres.TransactionSql,
  organizationId: string,
  counterpartyId: string,
  facility: FacilityInput,
) {
  await tx`
    insert into app.facilities
      (organization_id, counterparty_id, name, facility_type, address_line, city, region,
       postal_code, country, latitude, longitude, location_precision, geocoding_source,
       transport_access, created_by)
    values (${organizationId}, ${counterpartyId}, ${facility.name},
            ${facility.facilityType}::app.facility_type, ${facility.addressLine},
            ${facility.city}, ${facility.region}, ${facility.postalCode}, ${facility.country},
            ${facility.latitude}::numeric, ${facility.longitude}::numeric,
            ${facility.locationPrecision}::app.location_precision,
            ${enteredSource(facility, 'manual')}, ${facility.transportAccess ?? null},
            app.current_user_id())
  `;
}

/**
 * Driver settings for the API: no prepared statements (transaction pooler), one connection.
 * Through Hyperdrive the Worker talks to Cloudflare's own endpoint, and Hyperdrive makes the
 * verified TLS connection to the database, so the driver itself uses no TLS.
 */
export function connectionOptions(
  url: string,
  viaHyperdrive = false,
): postgres.Options<Record<string, never>> {
  return {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    fetch_types: false,
    // verify-full checks the certificate chain and host name; postgres.js 'require' does not.
    ssl: viaHyperdrive || isLocalHost(url) ? false : 'verify-full',
  };
}

/**
 * Connects as `app_api` (docs/DECISIONS.md, database access model). Each call runs in a
 * transaction that first sets `app.user_id` (and `app.request_id` for the audit trail), so
 * row level security decides what is visible and writable. Uses the Supabase transaction
 * pooler, hence no prepared statements; TLS with certificate verification is required for
 * anything that is not local.
 */
export function postgresDatabase(url: string, options: { viaHyperdrive?: boolean } = {}): Database {
  return createDatabase(postgres(url, connectionOptions(url, options.viaHyperdrive)));
}

/** The Database over an existing connection; tests use it to inspect that connection. */
export function createDatabase(sql: postgres.Sql): Database {
  function asUser<T>(ctx: RequestContext, run: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${ctx.userId}, true),
                      set_config('app.request_id', ${ctx.requestId}, true)`;
      return run(tx);
    }) as Promise<T>;
  }

  /** The companies already in an organization's list, with what each has. */
  async function readExisting(
    tx: postgres.TransactionSql,
    organizationId: string,
  ): Promise<ExistingCounterparty[]> {
    const companies = await tx<
      (Omit<
        ExistingCounterparty,
        'primaryCountry' | 'legalName' | 'facilities' | 'contacts' | 'commodities' | 'lanes'
      > & { primary_country: string; legal_name: string })[]
    >`
      select id, primary_country, legal_name, archived_at is not null as archived,
             to_jsonb(types::text[]) as types,
             verification_status::text as "verificationStatus", website, phone,
             to_jsonb(markets) as markets, tier, to_jsonb(grain_types) as "grainTypes",
             seller_kind as "sellerKind", annual_tonnes as "annualTonnes",
             organic_certifier as "organicCertifier",
             to_char(organic_certified_until, 'YYYY-MM-DD') as "organicCertifiedUntil",
             notes, to_jsonb(equipment) as equipment
      from app.counterparties where organization_id = ${organizationId}`;
    const facilities = await tx<
      (ExistingCounterparty['facilities'][number] & { counterparty_id: string })[]
    >`
      select counterparty_id, id, name, facility_type::text as "facilityType",
             address_line as "addressLine", city, region, postal_code as "postalCode", country,
             latitude::text as latitude, longitude::text as longitude,
             location_precision::text as "locationPrecision",
             transport_access as "transportAccess"
      from app.facilities where organization_id = ${organizationId}`;
    const contacts = await tx<
      (ExistingCounterparty['contacts'][number] & { counterparty_id: string })[]
    >`
      select counterparty_id, id, name, role, email, phone
      from app.counterparty_contacts where organization_id = ${organizationId}`;
    const commodities = await tx<
      {
        counterparty_id: string;
        commodity: CommodityInterest['commodity'];
        direction: CommodityDirection;
      }[]
    >`
      select counterparty_id, commodity_code as commodity, direction
      from app.counterparty_commodities where organization_id = ${organizationId}`;
    const lanes = await tx<{ carrier_id: string; origin: string; destination: string }[]>`
      select carrier_id, origin::text as origin, destination::text as destination
      from app.carrier_lanes where organization_id = ${organizationId}`;
    const byId = new Map<string, ExistingCounterparty>(
      companies.map(({ primary_country, legal_name, ...row }) => [
        row.id,
        {
          ...row,
          primaryCountry: primary_country,
          legalName: legal_name,
          facilities: [],
          contacts: [],
          commodities: [],
          lanes: [],
        },
      ]),
    );
    for (const { carrier_id, ...lane } of lanes) {
      byId.get(carrier_id)?.lanes.push(lane);
    }
    for (const { counterparty_id, ...facility } of facilities) {
      byId.get(counterparty_id)?.facilities.push(facility);
    }
    for (const { counterparty_id, ...contact } of contacts) {
      byId.get(counterparty_id)?.contacts.push(contact);
    }
    for (const { counterparty_id, ...interest } of commodities) {
      byId.get(counterparty_id)?.commodities.push(interest);
    }
    return [...byId.values()];
  }

  // Arrays come back as JSON: without fetch_types, postgres.js returns array columns as text.
  const summaryColumns = (tx: postgres.TransactionSql) => tx`
    c.id, c.organization_id, c.legal_name, c.trading_name, to_jsonb(c.types::text[]) as types,
    c.primary_country, c.verification_status::text as verification_status,
    c.source::text as source, c.created_at,
    (select count(*)::int from app.counterparty_contacts k where k.counterparty_id = c.id) as contact_count,
    (select count(*)::int from app.facilities f where f.counterparty_id = c.id) as facility_count,
    to_jsonb(array(select distinct f.region::text from app.facilities f
                    where f.counterparty_id = c.id and f.region is not null order by 1)) as regions,
    l.sha256 as logo_sha256, c.archived_at,
    to_jsonb(array(select k.commodity_code from app.counterparty_commodities k
                   join app.commodities m on m.code = k.commodity_code
                   where k.counterparty_id = c.id and k.direction = 'buys'
                   order by m.sort_order)) as buys,
    to_jsonb(array(select k.commodity_code from app.counterparty_commodities k
                   join app.commodities m on m.code = k.commodity_code
                   where k.counterparty_id = c.id and k.direction = 'sells'
                   order by m.sort_order)) as sells,
    to_jsonb(c.markets) as markets, c.tier, to_jsonb(c.grain_types) as grain_types,
    c.seller_kind, c.annual_tonnes, c.organic_certifier,
    to_char(c.organic_certified_until, 'YYYY-MM-DD') as organic_certified_until,
    to_jsonb(c.equipment) as equipment,
    coalesce((select jsonb_agg(jsonb_build_object(
                'origin', k.origin::text, 'destination', k.destination::text,
                'transport', k.transport, 'verifiedAt', k.verified_at)
                order by k.origin, k.destination)
              from app.carrier_lanes k where k.carrier_id = c.id), '[]') as lanes,
    coalesce((select jsonb_agg(jsonb_build_object(
                'origin', r.origin, 'destination', r.destination,
                'transport', case when r.truck and r.rail then 'rail_and_truck'
                                  when r.rail then 'rail' else 'truck' end)
                order by r.origin, r.destination)
              from (select e.origin, e.destination,
                           bool_or(e.mode = 'truck') as truck, bool_or(e.mode = 'rail') as rail
                    -- Each end's province or state: its saved location's, or its area's (F-235).
                    from (select q.mode,
                                 coalesce(o.country || '-' || o.region::text,
                                          q.origin_area_region::text) as origin,
                                 coalesce(d.country || '-' || d.region::text,
                                          q.destination_area_region::text) as destination
                          from app.freight_quotes q
                          left join app.facilities o on o.id = q.origin_facility_id
                          left join app.facilities d on d.id = q.destination_facility_id
                          where q.carrier_id = c.id) e
                    where e.origin is not null and e.destination is not null
                    group by 1, 2) r), '[]') as quoted_lanes
  `;

  return {
    ...quoteQueries(asUser),
    ...freightQueries(asUser),
    ...crmQueries(asUser),
    ...fxQueries(asUser, sql),
    ...callQueries(asUser, sql),
    ...callbackQueries(asUser, sql),
    ...readingQueries(asUser, sql),
    ...summaryQueries(asUser, sql),
    ...mapLayerQueries(asUser),
    ...emailQueries(asUser, sql),
    ...autoDraftQueries(asUser, sql),
    ...forwardingQueries(asUser),

    async memberships(userId) {
      const rows = await sql.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${userId}, true)`;
        return tx<{ organization_id: string; display_name: string; role: string }[]>`
          select o.id as organization_id, o.display_name, m.role::text as role
          from app.organization_members m
          join app.organizations o on o.id = m.organization_id
          where m.user_id = app.current_user_id() and m.status = 'active'
          order by o.display_name
        `;
      });
      return rows.map((row) => ({
        organizationId: row.organization_id,
        organizationName: row.display_name,
        role: row.role,
      }));
    },

    canEditDirectory(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ allowed: boolean }[]>`
          select app.can_edit_directory(${organizationId}) as allowed`;
        return row?.allowed === true;
      });
    },

    listCounterparties(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<SummaryRow[]>`
          select ${summaryColumns(tx)}
          from app.counterparties c
          left join app.counterparty_logos l on l.counterparty_id = c.id
          where ${organizationId === null ? tx`true` : tx`c.organization_id = ${organizationId}`}
          order by lower(c.legal_name), c.primary_country, c.id
          limit ${LIST_LIMIT + 1}
        `;
        return rows.map(summary);
      });
    },

    getCounterparty(ctx, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<
          (SummaryRow & {
            website: string | null;
            phone: string | null;
            notes: string | null;
            version: string;
          })[]
        >`
          select ${summaryColumns(tx)}, c.website, c.phone, c.notes,
                 to_char(c.updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
          from app.counterparties c
          left join app.counterparty_logos l on l.counterparty_id = c.id
          where c.id = ${id}
        `;
        if (!row) return null;
        const contacts = await tx<Contact[]>`
          select id, name, role, email, phone, is_main as "isMain",
                 to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
          from app.counterparty_contacts where counterparty_id = ${id}
          order by is_main desc, lower(name), id
        `;
        const facilities = await tx<Facility[]>`
          select id, name, facility_type::text as "facilityType", address_line as "addressLine",
                 city, region, postal_code as "postalCode", country,
                 latitude::text as latitude, longitude::text as longitude,
                 location_precision::text as "locationPrecision",
                 geocoding_source as "geocodingSource",
                 transport_access as "transportAccess",
                 to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
          from app.facilities where counterparty_id = ${id}
          order by country, region nulls last, city nulls last, id
        `;
        const commodities = await tx<
          (Omit<CounterpartyCommodity, 'verifiedAt'> & {
            verified_at: Date | null;
          })[]
        >`
          select k.commodity_code as code, m.display_name as name, k.direction, k.verified_at
          from app.counterparty_commodities k
          join app.commodities m on m.code = k.commodity_code
          where k.counterparty_id = ${id}
          order by k.direction, m.sort_order
        `;
        return {
          ...summary(row),
          website: row.website,
          phone: row.phone,
          notes: row.notes,
          version: row.version,
          contacts: [...contacts],
          facilities: [...facilities],
          commodities: commodities.map(({ verified_at, ...item }) => ({
            ...item,
            verifiedAt: verified_at?.toISOString() ?? null,
          })),
        };
      });
    },

    facilitiesInBbox(ctx, organizationId, bbox, type) {
      return asUser(ctx, async (tx) => {
        // Facilities shown: of the organization, of a counterparty that is not archived
        // and, when asked, has the type.
        const shown = () => tx`
          c.archived_at is null
          and ${organizationId === null ? tx`true` : tx`f.organization_id = ${organizationId}`}
          and ${type === null ? tx`true` : tx`${type}::app.counterparty_type = any (c.types)`}`;
        // app.location_in_bbox wraps PostGIS, which app_api cannot reach directly.
        const facilities = await tx<MapFacility[]>`
          select f.id, f.counterparty_id as "counterpartyId", c.legal_name as "legalName",
                 c.trading_name as "tradingName",
                 to_jsonb(c.types::text[]) as "counterpartyTypes",
                 f.name, f.facility_type::text as "facilityType", f.city, f.region, f.country,
                 f.latitude::text as latitude, f.longitude::text as longitude,
                 f.location_precision::text as "locationPrecision"
          from app.facilities f
          join app.counterparties c on c.id = f.counterparty_id
          where app.location_in_bbox(f.location, ${bbox.west}, ${bbox.south},
                                     ${bbox.east}, ${bbox.north})
            and ${shown()}
          order by lower(c.legal_name), c.id, lower(f.name), f.id
          limit ${MAP_LIMIT + 1}
        `;
        const [missing] = await tx<{ count: number }[]>`
          select count(*)::int as count from app.facilities f
          join app.counterparties c on c.id = f.counterparty_id
          where f.location is null and ${shown()}`;
        return { facilities: [...facilities], withoutCoordinates: missing?.count ?? 0 };
      });
    },

    facilitiesWithoutCoordinates(ctx, organizationId, limit, scope = null, after) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<FacilityAddress[]>`
          select f.id as "facilityId", f.counterparty_id as "counterpartyId",
                 c.legal_name as "legalName", f.name as "facilityName",
                 f.address_line as "addressLine", f.city, f.region,
                 f.postal_code as "postalCode", f.country,
                 to_char(f.updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
          from app.facilities f
          join app.counterparties c on c.id = f.counterparty_id
          where f.organization_id = ${organizationId} and f.latitude is null
            and c.archived_at is null
            and ${
              scope === null
                ? tx`true`
                : 'counterpartyId' in scope
                  ? tx`c.id = ${scope.counterpartyId}`
                  : tx`(f.import_batch_id = ${scope.importBatchId} or c.import_batch_id = ${scope.importBatchId})`
            }
            and ${after === undefined ? tx`true` : tx`f.id > ${after}`}
          order by f.id
          limit ${limit + 1}
        `;
        return [...rows];
      });
    },

    saveCoordinates(ctx, organizationId, matches) {
      return asUser(ctx, async (tx) => {
        const values = matches.map((match) => ({
          id: match.facilityId,
          latitude: match.latitude,
          longitude: match.longitude,
          precision: match.precision,
          accuracy_type: match.accuracyType,
          confidence: match.confidence,
          version: match.facilityVersion,
        }));
        // Their counterparties are locked first, so archiving one waits for this save or
        // this save sees it archived (as editable() does for every other change).
        await tx`
          select c.id from app.counterparties c
          where c.id in (select f.counterparty_id from app.facilities f
                          where f.id in ${tx(values.map((value) => value.id))})
          order by c.id
          for no key update`;
        // One statement for the whole batch, saving only facilities that still have no
        // coordinates, are unchanged since the lookup (the address looked up is the one
        // saved against) and belong to a counterparty that is not archived. The database
        // also refuses a geocoding result over existing coordinates.
        const rows = await tx<{ id: string }[]>`
          update app.facilities f
          set latitude = v.latitude, longitude = v.longitude, location_precision = v.precision,
              geocoding_source = 'geocodio', geocoding_accuracy = v.accuracy_type,
              geocoding_confidence = v.confidence
          from jsonb_to_recordset(${tx.json(values)}::jsonb) as v(
            id uuid, latitude numeric, longitude numeric, precision app.location_precision,
            accuracy_type text, confidence numeric, version text
          ), app.counterparties c
          where f.id = v.id and f.organization_id = ${organizationId} and f.latitude is null
            and to_char(f.updated_at at time zone 'UTC', ${VERSION_FORMAT}) = v.version
            and c.id = f.counterparty_id and c.archived_at is null
          returning f.id
        `;
        return rows.map((row) => row.id);
      });
    },

    getLogo(ctx, counterpartyId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ data: Uint8Array; sha256: string }[]>`
          select data, sha256 from app.counterparty_logos where counterparty_id = ${counterpartyId}`;
        return row ? { data: row.data, sha256: row.sha256 } : null;
      });
    },

    putLogo(ctx, counterpartyId, data) {
      return asUser(ctx, async (tx): Promise<PutLogoResult> => {
        const [counterparty] = await tx<{ organization_id: string; allowed: boolean }[]>`
          select organization_id, app.can_edit_directory(organization_id) as allowed
          from app.counterparties where id = ${counterpartyId}`;
        if (!counterparty) return { status: 'not_found' };
        if (!counterparty.allowed) return { status: 'forbidden' };
        const [saved] = await tx<{ sha256: string }[]>`
          insert into app.counterparty_logos (counterparty_id, organization_id, data, updated_by)
          values (${counterpartyId}, ${counterparty.organization_id}, ${data}, app.current_user_id())
          on conflict (counterparty_id)
            do update set data = excluded.data, updated_by = excluded.updated_by
          returning sha256
        `;
        if (!saved) throw new Error('logo was not saved');
        return { status: 'saved', sha256: saved.sha256 };
      });
    },

    existingCounterparties(ctx, organizationId) {
      return asUser(ctx, (tx) => readExisting(tx, organizationId));
    },

    importCounterparties(ctx, organizationId, plan, check) {
      return asUser(ctx, async (tx) => {
        // Matching and writing happen under the lock, so an import running at the same time
        // waits and then sees this one's companies (Codex's review of ivanmueller/gss#88).
        await tx`select app.lock_counterparty_import(${organizationId})`;
        const org = organizationId;
        // The companies it adds to are locked before anything is written: archiving one and
        // every change to its locations, contacts and commodities lock it too (editable()), so
        // none can change under the import. The plan is kept only once it was made from a
        // read taken with all its companies already locked; otherwise their locks are taken
        // and it is made again. What is written, the answer and NOTHING_TO_IMPORT then agree,
        // and an import that would write nothing records nothing (Codex's third and fourth
        // reviews of ivanmueller/gss#88).
        const locked = new Set<string>();
        let batch: ImportBatchInput | null;
        for (let attempt = 1; ; attempt += 1) {
          batch = plan(await readExisting(tx, org));
          if (batch === null) {
            await check?.(null);
            return null;
          }
          if (batch.organizationId !== org) throw new Error('import for another organization');
          const unlocked = batch.additions
            .map((item) => item.counterpartyId)
            .filter((counterpartyId) => !locked.has(counterpartyId));
          if (unlocked.length === 0) break;
          if (attempt === 10) throw new Error('the companies kept changing during the import');
          const open = await tx<{ id: string }[]>`
            select id from app.counterparties
            where organization_id = ${org} and id in ${tx(unlocked)} and archived_at is null
            order by id
            for no key update`;
          for (const row of open) locked.add(row.id);
        }

        await check?.(batch);
        const [created] = await tx<{ id: string }[]>`
          insert into app.import_batches
            (organization_id, kind, file_name, content_sha256, row_count, created_count,
             skipped_count, created_by, records_additions)
          values (${org}, 'counterparties', ${batch.fileName}, ${batch.contentSha256},
                  ${batch.rowCount}, ${batch.counterparties.length}, ${batch.skippedCount},
                  app.current_user_id(), true)
          returning id
        `;
        if (!created) throw new Error('import batch was not created');
        const batchId = created.id;

        const withIds = batch.counterparties.map((item) => ({ id: crypto.randomUUID(), ...item }));
        for (const part of chunks(withIds)) {
          const rows = part.map(({ id, counterparty: c, ...item }) => ({
            id,
            organization_id: org,
            legal_name: c.legalName,
            trading_name: c.tradingName,
            types: enumArray(c.types),
            primary_country: c.primaryCountry,
            verification_status: c.verificationStatus,
            website: c.website,
            phone: c.phone,
            markets: `{${c.markets.join(',')}}`,
            tier: c.tier,
            grain_types: `{${c.grainTypes.join(',')}}`,
            seller_kind: c.sellerKind,
            annual_tonnes: c.annualTonnes,
            organic_certifier: c.organicCertifier,
            organic_certified_until: c.organicCertifiedUntil,
            equipment: `{${(item.equipment ?? []).join(',')}}`,
            notes: c.notes,
            source: 'file_import',
            import_batch_id: batchId,
            created_by: ctx.userId,
          }));
          await tx`insert into app.counterparties ${tx(rows)}`;
        }

        const targets = [
          ...withIds,
          ...batch.additions.map(({ counterpartyId, ...item }) => ({
            id: counterpartyId,
            ...item,
          })),
        ];

        const contacts = targets.flatMap(({ id, contacts: list }) =>
          list.map((k) => ({
            organization_id: org,
            counterparty_id: id,
            name: k.name,
            role: k.role,
            email: k.email,
            phone: k.phone,
            created_by: ctx.userId,
          })),
        );
        for (const part of chunks(contacts)) {
          await tx`insert into app.counterparty_contacts ${tx(part)}`;
        }

        const facilities = targets.flatMap(({ id, facilities: list }) =>
          list.map((f) => ({
            organization_id: org,
            counterparty_id: id,
            name: f.name,
            facility_type: f.facilityType,
            address_line: f.addressLine,
            city: f.city,
            region: f.region,
            postal_code: f.postalCode,
            country: f.country,
            latitude: f.latitude,
            longitude: f.longitude,
            location_precision: f.locationPrecision,
            geocoding_source: enteredSource(f, 'file_import'),
            // So the import's coordinates step finds it, on a company already listed too.
            import_batch_id: batchId,
            created_by: ctx.userId,
          })),
        );
        for (const part of chunks(facilities)) {
          await tx`insert into app.facilities ${tx(part)}`;
        }

        const commodities = targets.flatMap(({ id, commodities: list }) =>
          list.map((k) => ({
            organization_id: org,
            counterparty_id: id,
            commodity_code: k.commodity,
            direction: k.direction,
            created_by: ctx.userId,
            // Which import added it, to undo it (2026-11-04).
            import_batch_id: batchId,
          })),
        );
        for (const part of chunks(commodities)) {
          // Unverified; one a company already lists stays as it is.
          await tx`insert into app.counterparty_commodities ${tx(part)} on conflict do nothing`;
        }

        // What the file changes on companies already listed, filled cells winning (owner's
        // answer, 2026-10-31): only the fields given, never cleared. The plan was made under
        // their locks, so it is what they have now.
        for (const {
          counterpartyId: id,
          details,
          contactUpdates,
          facilityUpdates,
        } of batch.additions) {
          if (details !== null) {
            updated(
              await tx`
              update app.counterparties
              set types = coalesce(
                    ${details.types ? enumArray(details.types) : null}::app.counterparty_type[], types),
                  verification_status = coalesce(
                    ${details.verificationStatus ?? null}::app.verification_status,
                    verification_status),
                  website = coalesce(${details.website ?? null}, website),
                  phone = coalesce(${details.phone ?? null}, phone),
                  markets = coalesce(
                    ${details.markets ? `{${details.markets.join(',')}}` : null}::text[], markets),
                  tier = coalesce(${details.tier ?? null}, tier),
                  grain_types = coalesce(
                    ${details.grainTypes ? `{${details.grainTypes.join(',')}}` : null}::text[],
                    grain_types),
                  seller_kind = coalesce(${details.sellerKind ?? null}, seller_kind),
                  annual_tonnes = coalesce(${details.annualTonnes ?? null}::integer, annual_tonnes),
                  organic_certifier = coalesce(${details.organicCertifier ?? null}, organic_certifier),
                  organic_certified_until = coalesce(
                    ${details.organicCertifiedUntil ?? null}::date, organic_certified_until),
                  equipment = coalesce(
                    ${details.equipment ? `{${details.equipment.join(',')}}` : null}::text[],
                    equipment),
                  notes = coalesce(${details.notes ?? null}, notes)
              where id = ${id} and organization_id = ${org}
              returning id`,
            );
          }
          for (const { id: contactId, changes } of contactUpdates) {
            updated(
              await tx`
              update app.counterparty_contacts
              set role = coalesce(${changes.role ?? null}, role),
                  email = coalesce(${changes.email ?? null}, email),
                  phone = coalesce(${changes.phone ?? null}, phone)
              where id = ${contactId} and counterparty_id = ${id} and organization_id = ${org}
              returning id`,
            );
          }
          for (const { id: facilityId, changes } of facilityUpdates) {
            const at = changes.coordinates;
            updated(
              await tx`
              update app.facilities
              set facility_type = coalesce(
                    ${changes.facilityType ?? null}::app.facility_type, facility_type),
                  address_line = coalesce(${changes.addressLine ?? null}, address_line),
                  postal_code = coalesce(${changes.postalCode ?? null}, postal_code),
                  transport_access = coalesce(${changes.transportAccess ?? null}, transport_access)
                  ${
                    at
                      ? tx`, latitude = ${at.latitude}::numeric, longitude = ${at.longitude}::numeric,
                          location_precision = ${at.locationPrecision}::app.location_precision,
                          geocoding_source = 'file_import', geocoding_accuracy = null,
                          geocoding_confidence = null`
                      : tx``
                  }
              where id = ${facilityId} and counterparty_id = ${id} and organization_id = ${org}
              returning id`,
            );
          }
        }
        // What it adds to companies already listed, for undoing it exactly (2026-11-04).
        // Each company row's version as this import leaves it, to know later whether anything
        // changed it since (Codex's re-review of c4d4808).
        const versions = new Map(
          (
            await tx<{ id: string; version: string }[]>`
              select id, xmin::text as version from app.counterparties
              where id = any (${`{${batch.additions.map((a) => a.counterpartyId).join(',')}}`}::uuid[])`
          ).map((row) => [row.id, row.version]),
        );
        const provenance = batch.additions.flatMap(({ counterpartyId, provenance: p }) =>
          p && (p.addedTypes.length > 0 || p.sellerDetails || p.replaced.length > 0)
            ? [
                {
                  organization_id: org,
                  import_batch_id: batchId,
                  counterparty_id: counterpartyId,
                  added_types: enumArray(p.addedTypes),
                  seller_details: p.sellerDetails,
                  replaced: `{${p.replaced.map((r) => JSON.stringify(r)).join(',')}}`,
                  row_version: versions.get(counterpartyId) ?? null,
                },
              ]
            : [],
        );
        for (const part of chunks(provenance)) {
          await tx`insert into app.import_additions ${tx(part)}`;
        }
        // A carrier's lanes, unverified until someone on the team verifies them (owner's
        // request, 2026-11-01); one a carrier already lists stays as it is. Written after the
        // details above, so a listed company the file makes a carrier is one by then (Codex's
        // review of 08a3957).
        const lanes = targets.flatMap(({ id, lanes: list = [] }) =>
          list.map((lane) => ({
            organization_id: org,
            carrier_id: id,
            origin: lane.origin,
            destination: lane.destination,
            transport: lane.transport,
            created_by: ctx.userId,
          })),
        );
        for (const part of chunks(lanes)) {
          await tx`insert into app.carrier_lanes ${tx(part)} on conflict do nothing`;
        }
        return batchId;
      });
    },

    isOrgAdmin(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ allowed: boolean }[]>`
          select app.is_org_admin(${organizationId}) as allowed`;
        return row?.allowed === true;
      });
    },

    setMemberNames(ctx, organizationId, memberId, firstName, lastName) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ saved: boolean }[]>`
          select app.set_member_name(${organizationId}, ${memberId}, ${firstName}, ${lastName})
            as saved`;
        return row?.saved === true;
      });
    },

    listMembers(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [check] = await tx<{ allowed: boolean }[]>`
          select app.is_org_admin(${organizationId}) as allowed`;
        if (check?.allowed !== true) return null;
        const rows = await tx<Omit<Member, 'isYou'>[]>`
          select id, user_id as "userId", email, first_name as "firstName",
                 last_name as "lastName", role::text as role, status::text as status,
                 joined_at as "joinedAt", version
          from app.member_directory(${organizationId})`;
        return rows.map((row) => ({
          ...row,
          joinedAt: row.joinedAt === null ? null : new Date(row.joinedAt).toISOString(),
          isYou: row.userId === ctx.userId,
        }));
      });
    },

    addMember(ctx, organizationId, email, role) {
      return asUser(ctx, async (tx): Promise<AddMemberResult> => {
        const [check] = await tx<{ allowed: boolean; login: string | null }[]>`
          select app.is_org_admin(${organizationId}) as allowed,
                 app.find_login(${organizationId}, ${email}) as login`;
        if (check?.allowed !== true) return { status: 'forbidden' };
        if (check.login === null) return { status: 'no_account' };
        const rows = await tx<{ id: string }[]>`
          insert into app.organization_members
            (organization_id, user_id, role, status, joined_at, created_by)
          values (${organizationId}, ${check.login}, ${role}::app.member_role, 'active', now(),
                  app.current_user_id())
          on conflict (organization_id, user_id) do nothing
          returning id`;
        const [added] = rows;
        return added ? { status: 'added', id: added.id } : { status: 'already_member' };
      });
    },

    updateMember(ctx, organizationId, memberId, version, changes) {
      return asUser(ctx, async (tx): Promise<UpdateMemberResult> => {
        const [check] = await tx<{ allowed: boolean }[]>`
          select app.is_org_admin(${organizationId}) as allowed`;
        if (check?.allowed !== true) return { status: 'forbidden' };
        const [member] = await tx<{ user_id: string; version: string }[]>`
          select user_id, to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
          from app.organization_members
          where id = ${memberId} and organization_id = ${organizationId}
          for no key update`;
        if (!member) return NOT_FOUND;
        if (member.version !== version) return CHANGED;
        const roleOrStatus = changes.role !== undefined || changes.status !== undefined;
        if (roleOrStatus && member.user_id === ctx.userId) return { status: 'self' };
        if (roleOrStatus) {
          await tx`
            update app.organization_members
            set role = coalesce(${changes.role ?? null}::app.member_role, role),
                status = coalesce(${changes.status ?? null}::app.member_status, status)
            where id = ${memberId} and organization_id = ${organizationId}`;
        }
        if (changes.firstName !== undefined || changes.lastName !== undefined) {
          const [names] = await tx<{ first_name: string | null; last_name: string | null }[]>`
            select first_name, last_name from app.member_directory(${organizationId})
            where id = ${memberId}`;
          await tx`
            select app.set_member_name(
              ${organizationId}, ${memberId},
              ${changes.firstName === undefined ? (names?.first_name ?? null) : changes.firstName},
              ${changes.lastName === undefined ? (names?.last_name ?? null) : changes.lastName})`;
        }
        return SAVED;
      });
    },

    createCounterparty(ctx, organizationId, record) {
      return asUser(ctx, async (tx): Promise<CreateResult> => {
        const [check] = await tx<{ allowed: boolean }[]>`
          select app.can_edit_directory(${organizationId}) as allowed`;
        if (check?.allowed !== true) return { status: 'forbidden' };
        const c = record.counterparty;
        const [created] = await tx<{ id: string }[]>`
          insert into app.counterparties
            (organization_id, legal_name, trading_name, types, primary_country,
             verification_status, website, phone, markets, tier, grain_types, seller_kind,
             annual_tonnes, organic_certifier, organic_certified_until, equipment, notes, source,
             created_by)
          values (${organizationId}, ${c.legalName}, ${c.tradingName},
                  ${enumArray(c.types)}::app.counterparty_type[], ${c.primaryCountry},
                  ${c.verificationStatus}::app.verification_status, ${c.website}, ${c.phone},
                  ${`{${c.markets.join(',')}}`}::text[], ${c.tier},
                  ${`{${c.grainTypes.join(',')}}`}::text[], ${c.sellerKind}, ${c.annualTonnes},
                  ${c.organicCertifier}, ${c.organicCertifiedUntil}::date,
                  ${`{${(record.equipment ?? []).join(',')}}`}::text[],
                  ${c.notes}, 'manual', app.current_user_id())
          returning id
        `;
        if (!created) throw new Error('counterparty was not created');
        for (const contact of record.contacts) {
          await insertContact(tx, organizationId, created.id, contact);
        }
        for (const facility of record.facilities) {
          await insertFacility(tx, organizationId, created.id, facility);
        }
        // A carrier's first lanes: operations and admins add counterparties, and may add
        // lanes too; nobody else sees the new carrier until this commits.
        for (const lane of record.lanes ?? []) {
          await tx`
            insert into app.carrier_lanes
              (organization_id, carrier_id, origin, destination, transport, created_by,
               verified_by)
            values (${organizationId}, ${created.id}, ${lane.origin}, ${lane.destination},
                    ${lane.transport}, app.current_user_id(), app.current_user_id())`;
        }
        // Chosen by the person adding it, so verified by them.
        for (const interest of record.commodities) {
          await tx`
            insert into app.counterparty_commodities
              (organization_id, counterparty_id, commodity_code, direction, created_by,
               verified_by)
            values (${organizationId}, ${created.id}, ${interest.commodity}, ${interest.direction},
                    app.current_user_id(), app.current_user_id())`;
        }
        return { status: 'created', id: created.id };
      });
    },

    updateCounterparty(ctx, id, version, input, equipment) {
      return asUser(ctx, async (tx) => {
        const target = await editable(tx, id);
        if (target.status !== 'ok') return target;
        const rows = await tx`
          update app.counterparties
          set legal_name = ${input.legalName}, trading_name = ${input.tradingName},
              types = ${enumArray(input.types)}::app.counterparty_type[],
              primary_country = ${input.primaryCountry},
              verification_status = ${input.verificationStatus}::app.verification_status,
              website = ${input.website}, phone = ${input.phone},
              markets = ${`{${input.markets.join(',')}}`}::text[], tier = ${input.tier},
              grain_types = ${`{${input.grainTypes.join(',')}}`}::text[],
              seller_kind = ${input.sellerKind}, annual_tonnes = ${input.annualTonnes},
              organic_certifier = ${input.organicCertifier},
              organic_certified_until = ${input.organicCertifiedUntil}::date,
              equipment = ${
                equipment === undefined ? tx`equipment` : tx`${`{${equipment.join(',')}}`}::text[]`
              },
              notes = ${input.notes}
          where id = ${id} and to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) = ${version}
          returning id
        `;
        return rows.length === 1 ? SAVED : CHANGED;
      });
    },

    setArchived(ctx, id, archived) {
      return asUser(ctx, async (tx) => {
        const target = await editable(tx, id, { whenArchived: true });
        if (target.status !== 'ok') return target;
        // Only a real change is written (and audited).
        await tx`
          update app.counterparties
          set archived_at = ${archived ? tx`now()` : null}
          where id = ${id} and (archived_at is null) = ${archived}
        `;
        return SAVED;
      });
    },

    listImports(ctx, organizationId) {
      return asUser(ctx, async (tx): Promise<ImportSummary[] | null> => {
        const [check] = await tx<{ allowed: boolean }[]>`
          select app.is_org_admin(${organizationId}) as allowed`;
        if (check?.allowed !== true) return null;
        const rows = await tx<
          {
            id: string;
            fileName: string;
            createdAt: Date;
            undoneAt: Date | null;
            companies: number;
          }[]
        >`
          select b.id, b.file_name as "fileName", b.created_at as "createdAt",
                 b.undone_at as "undoneAt",
                 (select count(*)::int from app.counterparties c
                   where c.organization_id = b.organization_id and c.import_batch_id = b.id)
                   as companies
          from app.import_batches b
          where b.organization_id = ${organizationId}
          order by b.created_at desc
          limit 50`;
        return rows.map((row) => ({
          id: row.id,
          fileName: row.fileName,
          createdAt: row.createdAt.toISOString(),
          undoneAt: row.undoneAt?.toISOString() ?? null,
          companies: row.companies,
        }));
      });
    },

    undoImport(ctx, batchId, commit, expected) {
      return asUser(ctx, async (tx): Promise<UndoImportResult> => {
        const [batch] = await tx<
          {
            org: string;
            fileName: string;
            createdAt: Date;
            undone: boolean;
            recordsAdditions: boolean;
          }[]
        >`
          select organization_id as org, file_name as "fileName", created_at as "createdAt",
                 undone_at is not null as undone, records_additions as "recordsAdditions"
          from app.import_batches where id = ${batchId}`;
        if (!batch) return { status: 'not_found' };
        const [allowed] = await tx<{ allowed: boolean }[]>`
          select app.is_org_admin(${batch.org}) as allowed`;
        if (allowed?.allowed !== true) return { status: 'forbidden' };
        // No import runs while it is undone, and the admin stays an admin until it is done
        // (as for deleting a counterparty, Codex's review of ivanmueller/gss#93).
        await tx`select app.lock_counterparty_import(${batch.org})`;
        const [admin] = await tx`
          select m.id from app.organization_members m
          where m.organization_id = ${batch.org}
            and m.user_id = app.current_user_id()
            and m.role = 'org_admin' and m.status = 'active'
            and app.is_org_admin(m.organization_id)
          for share of m`;
        if (!admin) return { status: 'forbidden' };
        // Locked, and refused by the update policy once undone.
        const [open] = await tx`
          select id from app.import_batches where id = ${batchId} and undone_at is null
          for update`;
        if (!open) return { status: 'undone' };

        const ids = (list: readonly string[]) => `{${list.join(',')}}`;
        const created = await tx<{ id: string; name: string; types: string[] }[]>`
          select id, legal_name as name, to_jsonb(types::text[]) as types
          from app.counterparties
          where organization_id = ${batch.org} and import_batch_id = ${batchId}
          order by id
          for update`;
        const createdIds = new Set(created.map((row) => row.id));
        const retyped = new Set(
          (await tx<{ id: string }[]>`select app.import_retyped(${batchId}) as id`).map(
            (row) => row.id,
          ),
        );
        const withHistory = new Set(
          (
            await tx<{ id: string }[]>`
              select c.id from app.counterparties c
              where c.id = any (${ids([...createdIds])}::uuid[])
                and (exists (select from app.quotes q where q.counterparty_id = c.id)
                  or exists (select from app.freight_quotes q
                             where q.carrier_id = c.id
                                or exists (select from app.facilities f
                                           where f.counterparty_id = c.id
                                             and f.id in (q.origin_facility_id,
                                                          q.destination_facility_id)))
                  or exists (select from app.contact_log_entries e where e.counterparty_id = c.id)
                  or exists (select from app.follow_ups u where u.counterparty_id = c.id)
                  or exists (select from app.calls k where k.counterparty_id = c.id)
                  or exists (select from app.emails m where m.counterparty_id = c.id))`
          ).map((row) => row.id),
        );
        const kept = created.flatMap((row): UndoImportPlan['kept'] =>
          withHistory.has(row.id)
            ? [{ id: row.id, name: row.name, reason: 'history' as const }]
            : retyped.has(row.id)
              ? [{ id: row.id, name: row.name, reason: 'retyped' as const }]
              : [],
        );
        const keptIds = new Set(kept.map((row) => row.id));
        const removing = created.filter((row) => !keptIds.has(row.id)).map((row) => row.id);
        const [located] = await tx<{ count: number }[]>`
          select count(*)::int as count from app.facilities
          where counterparty_id = any (${ids(removing)}::uuid[])`;

        // Companies already listed that it added to: what it recorded (2026-11-04), never
        // guessed from timestamps (Codex's review of a62e00a).
        const notCreated = ids([...createdIds]);
        const addedFacilities = await tx<{ id: string; counterpartyId: string; used: boolean }[]>`
          select f.id, f.counterparty_id as "counterpartyId",
                 (exists (select from app.quotes q where q.facility_id = f.id)
                  or exists (select from app.freight_quotes q
                             where f.id in (q.origin_facility_id, q.destination_facility_id)))
                   as used
          from app.facilities f
          where f.organization_id = ${batch.org} and f.import_batch_id = ${batchId}
            and not (f.counterparty_id = any (${notCreated}::uuid[]))`;
        const addedGrains = await tx<{ id: string; counterpartyId: string }[]>`
          select id, counterparty_id as "counterpartyId" from app.counterparty_commodities
          where organization_id = ${batch.org} and import_batch_id = ${batchId}
            and not (counterparty_id = any (${notCreated}::uuid[]))`;
        const recorded = await tx<
          {
            counterpartyId: string;
            addedTypes: string[];
            sellerDetails: boolean;
            replaced: string[];
            rowVersion: string | null;
          }[]
        >`
          select counterparty_id as "counterpartyId",
                 to_jsonb(added_types::text[]) as "addedTypes",
                 seller_details as "sellerDetails", to_jsonb(replaced) as replaced,
                 row_version as "rowVersion"
          from app.import_additions
          where organization_id = ${batch.org} and import_batch_id = ${batchId}`;
        const touched = new Set<string>([
          ...addedFacilities.map((f) => f.counterpartyId),
          ...addedGrains.map((g) => g.counterpartyId),
          ...recorded.map((r) => r.counterpartyId),
        ]);
        // Locked, with each row's version as locked: an edit committed while this waited for
        // the lock is the version compared (Codex's re-review of 439d845).
        const listedRows = await tx<
          { id: string; name: string; types: string[]; version: string }[]
        >`
          select id, legal_name as name, to_jsonb(types::text[]) as types, xmin::text as version
          from app.counterparties
          where id = any (${ids([...touched])}::uuid[])
          order by lower(legal_name), id
          for update`;
        const listed = listedRows.map((row) => {
          const found = recorded.find((r) => r.counterpartyId === row.id);
          // Unchanged since the import wrote it: what it added is still its own.
          const record = found && { ...found, current: found.rowVersion === row.version };
          // A type it added is taken off while another one remains, and only while nothing
          // changed the company since (a later import may have added it again).
          const added = (record?.addedTypes ?? []).filter((type) => row.types.includes(type));
          const removedTypes =
            record?.current === true && row.types.some((type) => !added.includes(type))
              ? added
              : [];
          const sellerDetails = record?.sellerDetails === true && removedTypes.includes('seller');
          const check = [...(record?.replaced ?? [])];
          if (added.length > 0 && removedTypes.length === 0) {
            check.push(
              record?.current === true
                ? 'Type'
                : 'Type (changed since this import, so left as it is)',
            );
          }
          if (record?.sellerDetails === true && !sellerDetails) check.push('Seller details');
          if (!batch.recordsAdditions) {
            check.push(
              'Type, seller details, grains, tier and notes (not recorded by this import)',
            );
          }
          if (addedFacilities.some((f) => f.counterpartyId === row.id && f.used))
            check.push('A location it added that a bid, offer or freight rate uses (kept)');
          return {
            id: row.id,
            name: row.name,
            locations: addedFacilities.filter((f) => f.counterpartyId === row.id && !f.used).length,
            grains: addedGrains.filter((g) => g.counterpartyId === row.id).length,
            removedTypes,
            sellerDetails,
            check,
          };
        });
        const plan: UndoImportPlan = {
          fileName: batch.fileName,
          createdAt: batch.createdAt.toISOString(),
          // Made before imports recorded what they add: some of its changes to companies
          // already listed may not be found at all (Codex's re-review of c4d4808).
          recordsAdditions: batch.recordsAdditions,
          companies: removing.length,
          locations: located?.count ?? 0,
          kept,
          listed,
        };
        if (!commit) return { status: 'ok', committed: false, plan };
        if (expected !== removing.length) return { status: 'changed', plan };

        // The companies it created: archived, then deleted with what they have.
        const gone = ids(removing);
        await tx`update app.counterparties set archived_at = now()
                 where id = any (${gone}::uuid[]) and archived_at is null`;
        await tx`select id from app.facilities where counterparty_id = any (${gone}::uuid[])
                 order by id for update`;
        await tx`delete from app.counterparty_commodities where counterparty_id = any (${gone}::uuid[])`;
        await tx`delete from app.carrier_lanes where carrier_id = any (${gone}::uuid[])`;
        await tx`delete from app.counterparty_contacts where counterparty_id = any (${gone}::uuid[])`;
        await tx`delete from app.facilities where counterparty_id = any (${gone}::uuid[])`;
        await tx`delete from app.counterparty_logos where counterparty_id = any (${gone}::uuid[])`;
        const deleted = await tx`delete from app.counterparties where id = any (${gone}::uuid[])
                                 returning id`;
        if (deleted.length !== removing.length) throw new Error('not every company was deleted');
        // What it added to companies already listed.
        await tx`delete from app.facilities
                 where id = any (${ids(addedFacilities.filter((f) => !f.used).map((f) => f.id))}::uuid[])`;
        await tx`delete from app.counterparty_commodities
                 where id = any (${ids(addedGrains.map((g) => g.id))}::uuid[])`;
        for (const company of listed) {
          if (company.removedTypes.length === 0) continue;
          const row = listedRows.find((r) => r.id === company.id);
          const types = (row?.types ?? []).filter((type) => !company.removedTypes.includes(type));
          await tx`
            update app.counterparties
            set types = ${enumArray(types)}::app.counterparty_type[]
                ${
                  company.sellerDetails
                    ? tx`, grain_types = '{}', seller_kind = null, annual_tonnes = null,
                         organic_certifier = null, organic_certified_until = null`
                    : tx``
                }
            where id = ${company.id}`;
        }
        await tx`update app.import_batches
                 set undone_at = now(), undone_by = app.current_user_id()
                 where id = ${batchId}`;
        return { status: 'ok', committed: true, plan };
      });
    },

    deleteCounterparty(ctx, id) {
      return asUser(ctx, async (tx): Promise<DeleteResult> => {
        const [row] = await tx<{ organization_id: string }[]>`
          select organization_id from app.counterparties where id = ${id}`;
        if (!row) return NOT_FOUND;
        // The person's own admin membership, locked for the rest of the transaction: their
        // role or status cannot change while the delete waits or runs, and a change made just
        // before is seen here (the conditions are checked again on the row's latest version).
        // Otherwise RLS could refuse the last delete after the first ones (Codex's review of
        // ivanmueller/gss#93). Locking needs the members update policy, which only admins pass.
        const [admin] = await tx`
          select m.id from app.organization_members m
          where m.organization_id = ${row.organization_id}
            and m.user_id = app.current_user_id()
            and m.role = 'org_admin' and m.status = 'active'
            and app.is_org_admin(m.organization_id)
          for share of m`;
        if (!admin) return { status: 'forbidden' };
        // It and its locations are locked for the rest of the transaction: restoring it, a
        // change under it, and a bid, offer or freight rate naming it or one of its locations
        // wait for this delete and then find it gone, or happened first and are seen below.
        const [locked] = await tx<{ archived: boolean }[]>`
          select archived_at is not null as archived
          from app.counterparties where id = ${id}
          for update`;
        if (!locked) return NOT_FOUND;
        if (!locked.archived) return { status: 'not_archived' };
        await tx`select id from app.facilities where counterparty_id = ${id} order by id for update`;
        const [kept] = await tx<Record<CounterpartyHistory, boolean>[]>`
          select
            exists (select from app.quotes where counterparty_id = ${id}) as quotes,
            exists (
              select from app.freight_quotes q
              where q.carrier_id = ${id}
                 or exists (select from app.facilities f
                            where f.counterparty_id = ${id}
                              and f.id in (q.origin_facility_id, q.destination_facility_id))
            ) as freight,
            exists (select from app.contact_log_entries where counterparty_id = ${id}) as contact_log,
            exists (select from app.follow_ups where counterparty_id = ${id}) as follow_ups,
            exists (select from app.calls where counterparty_id = ${id}) as calls,
            exists (select from app.emails where counterparty_id = ${id}) as emails`;
        const history = (
          ['quotes', 'freight', 'contact_log', 'follow_ups', 'calls', 'emails'] as const
        ).filter((what) => kept?.[what] === true);
        if (history.length > 0) return { status: 'has_history', history };
        await tx`delete from app.counterparty_commodities where counterparty_id = ${id}`;
        await tx`delete from app.carrier_lanes where carrier_id = ${id}`;
        await tx`delete from app.counterparty_contacts where counterparty_id = ${id}`;
        await tx`delete from app.facilities where counterparty_id = ${id}`;
        await tx`delete from app.counterparty_logos where counterparty_id = ${id}`;
        const deleted = await tx`delete from app.counterparties where id = ${id} returning id`;
        // What went before is kept only with the counterparty itself.
        if (deleted.length !== 1) throw new RolledBack<DeleteResult>({ status: 'forbidden' });
        return { status: 'deleted' };
      }).catch((error: unknown) => {
        if (error instanceof RolledBack) return error.result as DeleteResult;
        throw error;
      });
    },

    addContact(ctx, counterpartyId, input) {
      return asUser(ctx, async (tx) => {
        const added = await addContactIn(tx, counterpartyId, input);
        return added.status === 'added' ? SAVED : added;
      });
    },

    updateContact(ctx, counterpartyId, contactId, version, input) {
      return asUser(ctx, (tx) => updateContactIn(tx, counterpartyId, contactId, version, input));
    },

    removeContact(ctx, counterpartyId, contactId) {
      return asUser(ctx, async (tx) => {
        const target = await editable(tx, counterpartyId);
        if (target.status !== 'ok') return target;
        const rows = await tx`
          delete from app.counterparty_contacts
          where id = ${contactId} and counterparty_id = ${counterpartyId}
          returning id
        `;
        return rows.length === 1 ? SAVED : NOT_FOUND;
      });
    },

    changeCommodities(ctx, counterpartyId, change) {
      return asUser(ctx, async (tx) => {
        // Visible only to members of its organization; the database refuses an archived one
        // (GS005) after waiting for any archiving under way, so this answer is the usual case.
        const [row] = await tx<{ organization_id: string; archived: boolean }[]>`
          select organization_id, archived_at is not null as archived
          from app.counterparties where id = ${counterpartyId}`;
        if (!row) return NOT_FOUND;
        if (row.archived) return { status: 'archived' };
        for (const { commodity, direction } of change.remove) {
          await tx`
            delete from app.counterparty_commodities
            where counterparty_id = ${counterpartyId} and commodity_code = ${commodity}
              and direction = ${direction}`;
        }
        // Ticked by hand, so verified by whoever ticked it.
        for (const { commodity, direction } of change.add) {
          await tx`
            insert into app.counterparty_commodities
              (organization_id, counterparty_id, commodity_code, direction, created_by,
               verified_by)
            values (${row.organization_id}, ${counterpartyId}, ${commodity}, ${direction},
                    app.current_user_id(), app.current_user_id())
            on conflict (organization_id, counterparty_id, commodity_code, direction) do nothing`;
        }
        for (const { commodity, direction } of change.verify ?? []) {
          await tx`
            update app.counterparty_commodities set verified_by = app.current_user_id()
            where counterparty_id = ${counterpartyId} and commodity_code = ${commodity}
              and direction = ${direction} and verified_by is null`;
        }
        return SAVED;
      });
    },

    changeLanes(ctx, carrierId, change) {
      return asUser(ctx, async (tx) => {
        // The person's membership and the carrier are locked for the rest of the transaction
        // (Codex's review of ba68201): a demotion or an archiving waits for this change, or
        // came first and is answered here, so the change is all done or not at all.
        const [row] = await tx<{ state: string; organization_id: string | null }[]>`
          select app.begin_lane_change(${carrierId}) as state,
                 (select organization_id from app.counterparties where id = ${carrierId})
                   as organization_id`;
        switch (row?.state) {
          case 'carrier':
          case 'not_carrier':
            break;
          case 'forbidden':
            return { status: 'forbidden' };
          case 'archived':
            return { status: 'archived' };
          default:
            return NOT_FOUND;
        }
        const organizationId = row.organization_id;
        if (organizationId === null) return NOT_FOUND;
        if (row.state === 'not_carrier' && change.add.length > 0) return { status: 'not_carrier' };
        for (const { origin, destination } of change.remove) {
          await tx`
            delete from app.carrier_lanes
            where carrier_id = ${carrierId} and origin = ${origin}
              and destination = ${destination}`;
        }
        // Added or changed by hand, so verified by whoever does it (owner's request,
        // 2026-11-01). Only a real change is written (and audited).
        for (const { origin, destination, transport } of change.add) {
          await tx`
            insert into app.carrier_lanes
              (organization_id, carrier_id, origin, destination, transport, created_by,
               verified_by)
            values (${organizationId}, ${carrierId}, ${origin}, ${destination},
                    ${transport}, app.current_user_id(), app.current_user_id())
            on conflict (organization_id, carrier_id, origin, destination) do update
              set transport = excluded.transport,
                  verified_by = coalesce(app.carrier_lanes.verified_by, excluded.verified_by)
              where app.carrier_lanes.transport is distinct from excluded.transport
                 or app.carrier_lanes.verified_by is null`;
        }
        for (const { origin, destination } of change.verify ?? []) {
          await tx`
            update app.carrier_lanes set verified_by = app.current_user_id()
            where carrier_id = ${carrierId} and origin = ${origin}
              and destination = ${destination} and verified_by is null`;
        }
        return SAVED;
      });
    },

    setMainContact(ctx, counterpartyId, contactId) {
      return asUser(ctx, async (tx) => {
        // The counterparty is locked, so two choices of main contact happen one after the other.
        const target = await editable(tx, counterpartyId);
        if (target.status !== 'ok') return target;
        if (
          contactId !== null &&
          !(await exists(tx, 'counterparty_contacts', counterpartyId, contactId))
        ) {
          return NOT_FOUND;
        }
        // The old main contact first: at most one is main at any moment (a unique index).
        // Only real changes are written (and audited).
        await tx`
          update app.counterparty_contacts set is_main = false
          where counterparty_id = ${counterpartyId} and is_main
            and id is distinct from ${contactId}::uuid
        `;
        if (contactId !== null) {
          await tx`
            update app.counterparty_contacts set is_main = true
            where id = ${contactId} and counterparty_id = ${counterpartyId} and not is_main
          `;
        }
        return SAVED;
      });
    },

    addFacility(ctx, counterpartyId, input) {
      return asUser(ctx, async (tx) => {
        const target = await editable(tx, counterpartyId);
        if (target.status !== 'ok') return target;
        await insertFacility(tx, target.organizationId, counterpartyId, input);
        return SAVED;
      });
    },

    updateFacility(ctx, counterpartyId, facilityId, version, input) {
      return asUser(ctx, async (tx) => {
        const target = await editable(tx, counterpartyId);
        if (target.status !== 'ok') return target;
        const latitude = input.latitude;
        const longitude = input.longitude;
        // On the right of SET, columns hold the values before the update.
        // A fresh fragment for each use: postgres.js numbers a fragment's parameters once.
        const sameSpot = () =>
          tx`latitude = ${latitude}::numeric and longitude = ${longitude}::numeric`;
        const rows = await tx`
          update app.facilities
          set name = ${input.name},
              facility_type = ${input.facilityType}::app.facility_type,
              address_line = ${input.addressLine}, city = ${input.city},
              region = ${input.region}, postal_code = ${input.postalCode},
              country = ${input.country},
              latitude = ${latitude}::numeric, longitude = ${longitude}::numeric,
              location_precision = ${input.locationPrecision}::app.location_precision,
              transport_access = ${
                input.transportAccess === undefined
                  ? tx`transport_access`
                  : tx`${input.transportAccess}`
              },
              geocoding_source = case
                when ${latitude}::numeric is null then null
                when ${sameSpot()} then geocoding_source
                else 'manual' end,
              geocoding_accuracy = case
                when ${latitude}::numeric is not null and ${sameSpot()} then geocoding_accuracy end,
              geocoding_confidence = case
                when ${latitude}::numeric is not null and ${sameSpot()} then geocoding_confidence end
          where id = ${facilityId} and counterparty_id = ${counterpartyId}
            and to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) = ${version}
          returning id
        `;
        if (rows.length === 1) return SAVED;
        return (await exists(tx, 'facilities', counterpartyId, facilityId)) ? CHANGED : NOT_FOUND;
      });
    },

    removeFacility(ctx, counterpartyId, facilityId) {
      return asUser(ctx, async (tx) => {
        const target = await editable(tx, counterpartyId);
        if (target.status !== 'ok') return target;
        const rows = await tx`
          delete from app.facilities
          where id = ${facilityId} and counterparty_id = ${counterpartyId}
          returning id
        `;
        return rows.length === 1 ? SAVED : NOT_FOUND;
      });
    },

    close: () => sql.end({ timeout: 5 }),
  };
}
