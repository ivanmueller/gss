import type {
  Member,
  MemberRole,
  MemberStatus,
  Bbox,
  ContactInput,
  CounterpartyType,
  SignedMatch,
  CounterpartyInput,
  FacilityInput,
  FacilityType,
  LocationPrecision,
} from '@grain/domain';
import postgres from 'postgres';

import { fxQueries, type FxDatabase } from './fx-db';
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
}

export interface Contact extends ContactInput {
  id: string;
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
  version: string;
}

export interface CounterpartyDetail extends CounterpartySummary {
  notes: string | null;
  version: string;
  contacts: Contact[];
  facilities: Facility[];
}

/** The outcome of a change to a counterparty, its contacts or its locations. */
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
}

export interface ImportBatchInput {
  organizationId: string;
  fileName: string;
  contentSha256: string;
  rowCount: number;
  /** Keys (counterpartyKey) that already exist and are skipped. */
  skippedCount: number;
  counterparties: NewCounterparty[];
}

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
export interface Database extends QuoteDatabase, FxDatabase {
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
  /** The organization's facilities without coordinates, up to `limit` + 1, by counterparty. */
  facilitiesWithoutCoordinates: (
    ctx: RequestContext,
    organizationId: string,
    limit: number,
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
  /** counterpartyKey values of the organization's existing counterparties. */
  counterpartyKeys: (ctx: RequestContext, organizationId: string) => Promise<Set<string>>;
  /** Creates the batch and its counterparties in one transaction; returns the batch id. */
  importCounterparties: (ctx: RequestContext, batch: ImportBatchInput) => Promise<string>;
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
  updateCounterparty: (
    ctx: RequestContext,
    id: string,
    version: string,
    input: CounterpartyInput,
  ) => Promise<WriteResult>;
  /** Archives or restores a counterparty; doing what is already done changes nothing. */
  setArchived: (ctx: RequestContext, id: string, archived: boolean) => Promise<WriteResult>;
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
) {
  await tx`
    insert into app.counterparty_contacts
      (organization_id, counterparty_id, name, role, email, phone, created_by)
    values (${organizationId}, ${counterpartyId}, ${contact.name}, ${contact.role},
            ${contact.email}, ${contact.phone}, app.current_user_id())
  `;
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
       created_by)
    values (${organizationId}, ${counterpartyId}, ${facility.name},
            ${facility.facilityType}::app.facility_type, ${facility.addressLine},
            ${facility.city}, ${facility.region}, ${facility.postalCode}, ${facility.country},
            ${facility.latitude}::numeric, ${facility.longitude}::numeric,
            ${facility.locationPrecision}::app.location_precision,
            ${enteredSource(facility, 'manual')}, app.current_user_id())
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

  // Arrays come back as JSON: without fetch_types, postgres.js returns array columns as text.
  const summaryColumns = (tx: postgres.TransactionSql) => tx`
    c.id, c.organization_id, c.legal_name, c.trading_name, to_jsonb(c.types::text[]) as types,
    c.primary_country, c.verification_status::text as verification_status,
    c.source::text as source, c.created_at,
    (select count(*)::int from app.counterparty_contacts k where k.counterparty_id = c.id) as contact_count,
    (select count(*)::int from app.facilities f where f.counterparty_id = c.id) as facility_count,
    to_jsonb(array(select distinct f.region::text from app.facilities f
                    where f.counterparty_id = c.id and f.region is not null order by 1)) as regions,
    l.sha256 as logo_sha256, c.archived_at
  `;

  return {
    ...quoteQueries(asUser),
    ...fxQueries(asUser, sql),

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
        const [row] = await tx<(SummaryRow & { notes: string | null; version: string })[]>`
          select ${summaryColumns(tx)}, c.notes,
                 to_char(c.updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
          from app.counterparties c
          left join app.counterparty_logos l on l.counterparty_id = c.id
          where c.id = ${id}
        `;
        if (!row) return null;
        const contacts = await tx<Contact[]>`
          select id, name, role, email, phone,
                 to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
          from app.counterparty_contacts where counterparty_id = ${id}
          order by lower(name), id
        `;
        const facilities = await tx<Facility[]>`
          select id, name, facility_type::text as "facilityType", address_line as "addressLine",
                 city, region, postal_code as "postalCode", country,
                 latitude::text as latitude, longitude::text as longitude,
                 location_precision::text as "locationPrecision",
                 geocoding_source as "geocodingSource",
                 to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
          from app.facilities where counterparty_id = ${id}
          order by country, region nulls last, city nulls last, id
        `;
        return {
          ...summary(row),
          notes: row.notes,
          version: row.version,
          contacts: [...contacts],
          facilities: [...facilities],
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

    facilitiesWithoutCoordinates(ctx, organizationId, limit) {
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
          order by lower(c.legal_name), c.id, lower(f.name), f.id
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

    counterpartyKeys(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<{ key: string }[]>`
          select primary_country || ':' || lower(legal_name) as key
          from app.counterparties where organization_id = ${organizationId}`;
        return new Set(rows.map((row) => row.key));
      });
    },

    importCounterparties(ctx, batch) {
      return asUser(ctx, async (tx) => {
        const org = batch.organizationId;
        const [created] = await tx<{ id: string }[]>`
          insert into app.import_batches
            (organization_id, kind, file_name, content_sha256, row_count, created_count,
             skipped_count, created_by)
          values (${org}, 'counterparties', ${batch.fileName}, ${batch.contentSha256},
                  ${batch.rowCount}, ${batch.counterparties.length}, ${batch.skippedCount},
                  app.current_user_id())
          returning id
        `;
        if (!created) throw new Error('import batch was not created');
        const batchId = created.id;

        const withIds = batch.counterparties.map((item) => ({ id: crypto.randomUUID(), ...item }));
        for (const part of chunks(withIds)) {
          const rows = part.map(({ id, counterparty: c }) => ({
            id,
            organization_id: org,
            legal_name: c.legalName,
            trading_name: c.tradingName,
            types: enumArray(c.types),
            primary_country: c.primaryCountry,
            verification_status: c.verificationStatus,
            notes: c.notes,
            source: 'file_import',
            import_batch_id: batchId,
            created_by: ctx.userId,
          }));
          await tx`insert into app.counterparties ${tx(rows)}`;
        }

        const contacts = withIds.flatMap(({ id, contacts: list }) =>
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

        const facilities = withIds.flatMap(({ id, facilities: list }) =>
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
            created_by: ctx.userId,
          })),
        );
        for (const part of chunks(facilities)) {
          await tx`insert into app.facilities ${tx(part)}`;
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
             verification_status, notes, source, created_by)
          values (${organizationId}, ${c.legalName}, ${c.tradingName},
                  ${enumArray(c.types)}::app.counterparty_type[], ${c.primaryCountry},
                  ${c.verificationStatus}::app.verification_status, ${c.notes}, 'manual',
                  app.current_user_id())
          returning id
        `;
        if (!created) throw new Error('counterparty was not created');
        for (const contact of record.contacts) {
          await insertContact(tx, organizationId, created.id, contact);
        }
        for (const facility of record.facilities) {
          await insertFacility(tx, organizationId, created.id, facility);
        }
        return { status: 'created', id: created.id };
      });
    },

    updateCounterparty(ctx, id, version, input) {
      return asUser(ctx, async (tx) => {
        const target = await editable(tx, id);
        if (target.status !== 'ok') return target;
        const rows = await tx`
          update app.counterparties
          set legal_name = ${input.legalName}, trading_name = ${input.tradingName},
              types = ${enumArray(input.types)}::app.counterparty_type[],
              primary_country = ${input.primaryCountry},
              verification_status = ${input.verificationStatus}::app.verification_status,
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

    addContact(ctx, counterpartyId, input) {
      return asUser(ctx, async (tx) => {
        const target = await editable(tx, counterpartyId);
        if (target.status !== 'ok') return target;
        await insertContact(tx, target.organizationId, counterpartyId, input);
        return SAVED;
      });
    },

    updateContact(ctx, counterpartyId, contactId, version, input) {
      return asUser(ctx, async (tx) => {
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
      });
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
