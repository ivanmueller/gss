import type {
  Bbox,
  ContactInput,
  CounterpartyInput,
  FacilityInput,
  FacilityType,
  LocationPrecision,
} from '@grain/domain';
import postgres from 'postgres';

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
}

export interface Contact extends ContactInput {
  id: string;
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
}

export interface CounterpartyDetail extends CounterpartySummary {
  notes: string | null;
  contacts: Contact[];
  facilities: Facility[];
}

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

/** Largest list returned by listCounterparties. */
export const LIST_LIMIT = 5000;

/** Largest number of facilities returned for one map view. */
export const MAP_LIMIT = 5000;

/** What the API reads from and writes to Postgres. Every call runs as the given, already verified user. */
export interface Database {
  memberships: (userId: string) => Promise<Membership[]>;
  canEditDirectory: (ctx: RequestContext, organizationId: string) => Promise<boolean>;
  listCounterparties: (
    ctx: RequestContext,
    organizationId: string | null,
  ) => Promise<CounterpartySummary[]>;
  getCounterparty: (ctx: RequestContext, id: string) => Promise<CounterpartyDetail | null>;
  facilitiesInBbox: (
    ctx: RequestContext,
    organizationId: string | null,
    bbox: Bbox,
  ) => Promise<MapFacilities>;
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
  };
}

/** Postgres array literal for a list of enum labels from a fixed set. */
function enumArray(values: readonly string[]): string {
  return `{${values.join(',')}}`;
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
    l.sha256 as logo_sha256
  `;

  return {
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
        const [row] = await tx<(SummaryRow & { notes: string | null })[]>`
          select ${summaryColumns(tx)}, c.notes
          from app.counterparties c
          left join app.counterparty_logos l on l.counterparty_id = c.id
          where c.id = ${id}
        `;
        if (!row) return null;
        const contacts = await tx<Contact[]>`
          select id, name, role, email, phone
          from app.counterparty_contacts where counterparty_id = ${id}
          order by lower(name), id
        `;
        const facilities = await tx<Facility[]>`
          select id, name, facility_type::text as "facilityType", address_line as "addressLine",
                 city, region, postal_code as "postalCode", country,
                 latitude::text as latitude, longitude::text as longitude,
                 location_precision::text as "locationPrecision"
          from app.facilities where counterparty_id = ${id}
          order by country, region nulls last, city nulls last, id
        `;
        return {
          ...summary(row),
          notes: row.notes,
          contacts: [...contacts],
          facilities: [...facilities],
        };
      });
    },

    facilitiesInBbox(ctx, organizationId, bbox) {
      return asUser(ctx, async (tx) => {
        const inOrganization = () =>
          organizationId === null ? tx`true` : tx`f.organization_id = ${organizationId}`;
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
            and ${inOrganization()}
          order by lower(c.legal_name), c.id, lower(f.name), f.id
          limit ${MAP_LIMIT + 1}
        `;
        const [missing] = await tx<{ count: number }[]>`
          select count(*)::int as count from app.facilities f
          where f.location is null and ${inOrganization()}`;
        return { facilities: [...facilities], withoutCoordinates: missing?.count ?? 0 };
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
            geocoding_source: f.latitude === null ? null : 'file_import',
            created_by: ctx.userId,
          })),
        );
        for (const part of chunks(facilities)) {
          await tx`insert into app.facilities ${tx(part)}`;
        }
        return batchId;
      });
    },

    close: () => sql.end({ timeout: 5 }),
  };
}
