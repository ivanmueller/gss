import {
  freightOutdatedSince,
  freightStatus,
  type FreightDetail,
  type FreightEnd,
  type FreightLocation,
  type FreightMode,
  type FreightRateUnit,
  type FreightRevision,
  type FreightSummary,
  type FreightTerms,
  type PayloadUnit,
  type QuoteCurrency,
  type QuoteFirmness,
  type QuoteSource,
} from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

// Freight rates in Postgres (20261029020000_freight_quotes.sql; areas, any quoting company and
// an optional valid-until since 20261119010000_freight_areas.sql, F-235). Every call runs as
// the verified user, so row level security decides what is visible and writable; the checks
// here only choose the answer to give.

/** Largest list returned by listFreight. */
export const FREIGHT_LIST_LIMIT = 2000;

export interface FreightFilter {
  organizationId: string | null;
  carrierId: string | null;
  /** Routes that start or end at this location. */
  facilityId: string | null;
  /** Rates this counterparty quoted, and routes that start or end at one of its locations. */
  counterpartyId: string | null;
  mode: FreightMode | null;
  /**
   * Only firm and indicative rates not withdrawn and not expired (outdated ones included,
   * tagged); otherwise withdrawn and expired too.
   */
  liveOnly: boolean;
}

/**
 * One end of a new route: a saved location, or an area with its province or state and the
 * point the Worker signed for it (never one sent by the browser).
 */
export type NewFreightEnd =
  | { kind: 'facility'; facilityId: string }
  | {
      kind: 'area';
      text: string;
      region: string;
      point: { latitude: string; longitude: string; precision: 'exact' | 'approximate' } | null;
    };

export interface NewFreight {
  organizationId: string;
  /** The company quoting the rate: any company that is not archived (F-235). */
  carrierId: string;
  origin: NewFreightEnd;
  destination: NewFreightEnd;
  mode: FreightMode;
  terms: FreightTerms;
  /** The recorder's name as shown with the revision. */
  recordedByName: string;
}

export type CreateFreightResult =
  | { status: 'created'; id: string }
  | { status: 'forbidden' }
  | { status: 'carrier_not_found' }
  /** The quoting company, or the counterparty of a location, is archived. */
  | { status: 'archived' }
  | { status: 'origin_not_found' }
  | { status: 'destination_not_found' }
  | { status: 'same_location' };

export type FreightWriteResult =
  | { status: 'saved' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  /** New terms were recorded after the revision the person was looking at. */
  | { status: 'changed'; currentRevision: number }
  | { status: 'withdrawn' }
  | { status: 'archived' };

export interface FreightDatabase {
  /** Freight quotes with their latest terms, newest quoted first, up to FREIGHT_LIST_LIMIT + 1. */
  listFreight: (ctx: RequestContext, filter: FreightFilter) => Promise<FreightSummary[]>;
  /** A freight quote with every revision; null when missing or not visible. */
  getFreight: (ctx: RequestContext, id: string) => Promise<FreightDetail | null>;
  createFreight: (ctx: RequestContext, freight: NewFreight) => Promise<CreateFreightResult>;
  /** Whether the user may enter freight rates in the organization (app.can_enter_freight). */
  canEnterFreight: (ctx: RequestContext, organizationId: string) => Promise<boolean>;
  /** Appends new terms, unless someone recorded newer ones than `basedOnRevision`. */
  reviseFreight: (
    ctx: RequestContext,
    id: string,
    basedOnRevision: number,
    terms: FreightTerms,
    recordedByName: string,
  ) => Promise<FreightWriteResult>;
  /** Withdraws a freight quote for good; withdrawing a withdrawn one changes nothing. */
  withdrawFreight: (
    ctx: RequestContext,
    id: string,
    withdrawnByName: string,
  ) => Promise<FreightWriteResult>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

interface RevisionRow {
  revision_id: string;
  revision_number: number;
  firmness: QuoteFirmness;
  rate: string;
  currency: QuoteCurrency;
  rate_unit: FreightRateUnit;
  payload: string | null;
  payload_unit: PayloadUnit | null;
  inclusions: string | null;
  quoted_at: Date;
  valid_until: Date | null;
  source_type: QuoteSource;
  source_reference: string | null;
  notes: string | null;
  recorded_by_name: string;
  recorded_at: Date;
}

interface FreightRow extends RevisionRow {
  id: string;
  mode: FreightMode;
  carrier_id: string;
  carrier_legal_name: string;
  carrier_trading_name: string | null;
  carrier_archived: boolean;
  origin: EndRow;
  destination: EndRow;
  withdrawn_at: Date | null;
  withdrawn_by_name: string | null;
  created_at: Date;
  as_of: Date;
}

/** One end as read: a saved location's columns, or an area's. */
type EndRow =
  | (Omit<FreightLocation, 'counterparty' | 'kind'> & {
      kind: 'facility';
      counterparty_id: string;
      legal_name: string;
      archived: boolean;
    })
  | {
      kind: 'area';
      text: string;
      region: string;
      latitude: string | null;
      longitude: string | null;
      precision: 'exact' | 'approximate' | null;
    };

/** The revision columns, read from a row aliased `r`. Decimals and dates as text, as stored. */
const revisionColumns = (tx: postgres.TransactionSql) => tx`
  r.id as revision_id, r.revision_number, r.firmness::text as firmness, r.rate::text as rate,
  r.currency, r.rate_unit, r.payload::text as payload, r.payload_unit, r.inclusions,
  r.quoted_at, r.valid_until, r.source_type::text as source_type, r.source_reference, r.notes,
  r.recorded_by_name, r.created_at as recorded_at
`;

/**
 * One end of the route as JSON: the location aliased `f` with its counterparty `c` when the
 * end is a saved location, else the area's columns (`origin` or `destination`) of `q`.
 */
const endJson = (tx: postgres.TransactionSql, f: string, c: string, end: string) => tx`
  case when ${tx(f)}.id is not null then jsonb_build_object(
    'kind', 'facility',
    'id', ${tx(f)}.id, 'name', ${tx(f)}.name, 'city', ${tx(f)}.city,
    'region', ${tx(f)}.region, 'country', ${tx(f)}.country,
    'counterparty_id', ${tx(c)}.id, 'legal_name', ${tx(c)}.legal_name,
    'archived', ${tx(c)}.archived_at is not null)
  else jsonb_build_object(
    'kind', 'area',
    'text', q.${tx(`${end}_area_text`)}, 'region', q.${tx(`${end}_area_region`)}::text,
    'latitude', q.${tx(`${end}_area_latitude`)}::text,
    'longitude', q.${tx(`${end}_area_longitude`)}::text,
    'precision', q.${tx(`${end}_area_precision`)}::text)
  end
`;

function revision(row: RevisionRow): FreightRevision {
  return {
    id: row.revision_id,
    revisionNumber: row.revision_number,
    firmness: row.firmness,
    rate: row.rate,
    currency: row.currency,
    rateUnit: row.rate_unit,
    payload: row.payload,
    payloadUnit: row.payload_unit,
    inclusions: row.inclusions,
    quotedAt: row.quoted_at.toISOString(),
    validUntil: row.valid_until?.toISOString() ?? null,
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    notes: row.notes,
    recordedByName: row.recorded_by_name,
    recordedAt: row.recorded_at.toISOString(),
  };
}

function routeEnd(end: EndRow): FreightEnd {
  if (end.kind === 'area') {
    return {
      kind: 'area',
      text: end.text,
      region: end.region,
      point:
        end.latitude !== null && end.longitude !== null && end.precision !== null
          ? { latitude: end.latitude, longitude: end.longitude, precision: end.precision }
          : null,
    };
  }
  return {
    kind: 'facility',
    id: end.id,
    name: end.name,
    city: end.city,
    region: end.region,
    country: end.country,
    counterparty: { id: end.counterparty_id, legalName: end.legal_name, archived: end.archived },
  };
}

function summary(row: FreightRow): FreightSummary {
  const current = revision(row);
  const withdrawnAt = row.withdrawn_at?.toISOString() ?? null;
  return {
    id: row.id,
    mode: row.mode,
    carrier: {
      id: row.carrier_id,
      legalName: row.carrier_legal_name,
      tradingName: row.carrier_trading_name,
      archived: row.carrier_archived,
    },
    origin: routeEnd(row.origin),
    destination: routeEnd(row.destination),
    // The database's clock decides what has expired or is outdated, the same for every rate
    // in an answer.
    status: freightStatus(
      { withdrawnAt, validUntil: current.validUntil, firmness: current.firmness },
      row.as_of,
    ),
    outdatedSince: freightOutdatedSince(current, row.as_of),
    withdrawnAt,
    createdAt: row.created_at.toISOString(),
    current,
  };
}

/** Whether both ends are the same place: one saved location, or one area in one region. */
function sameEnd(a: NewFreightEnd, b: NewFreightEnd): boolean {
  if (a.kind === 'facility' && b.kind === 'facility') return a.facilityId === b.facilityId;
  if (a.kind === 'area' && b.kind === 'area') {
    return a.region === b.region && a.text.toLowerCase() === b.text.toLowerCase();
  }
  return false;
}

/** An end's columns for the insert; nulls for the kind it is not. */
function endColumns(end: NewFreightEnd) {
  if (end.kind === 'facility') {
    return {
      facilityId: end.facilityId,
      text: null,
      region: null,
      latitude: null,
      longitude: null,
      precision: null,
    };
  }
  return {
    facilityId: null,
    text: end.text,
    region: end.region,
    latitude: end.point?.latitude ?? null,
    longitude: end.point?.longitude ?? null,
    precision: end.point?.precision ?? null,
  };
}

async function insertRevision(
  tx: postgres.TransactionSql,
  organizationId: string,
  freightId: string,
  terms: FreightTerms,
  recordedByName: string,
) {
  // revision_number is set by the database (app.number_freight_revision); 1 is a placeholder.
  await tx`
    insert into app.freight_quote_revisions
      (organization_id, freight_quote_id, revision_number, firmness, rate, currency, rate_unit,
       payload, payload_unit, inclusions, quoted_at, valid_from, valid_until, source_type,
       source_reference, notes, recorded_by, recorded_by_name)
    values (${organizationId}, ${freightId}, 1, ${terms.firmness}::app.quote_firmness,
            ${terms.rate}::numeric, ${terms.currency}, ${terms.rateUnit},
            ${terms.payload}::numeric, ${terms.payloadUnit}, ${terms.inclusions},
            ${terms.quotedAt}::timestamptz, ${terms.quotedAt}::timestamptz,
            ${terms.validUntil}::timestamptz, ${terms.sourceType}::app.quote_source,
            ${terms.sourceReference}, ${terms.notes}, app.current_user_id(), ${recordedByName})
  `;
}

export function freightQueries(asUser: AsUser): FreightDatabase {
  const freightSelect = (tx: postgres.TransactionSql) => tx`
    select q.id, q.mode::text as mode, q.carrier_id, k.legal_name as carrier_legal_name,
           k.trading_name as carrier_trading_name, k.archived_at is not null as carrier_archived,
           ${endJson(tx, 'o', 'oc', 'origin')} as origin,
           ${endJson(tx, 'd', 'dc', 'destination')} as destination,
           q.withdrawn_at, q.withdrawn_by_name, q.created_at, now() as as_of,
           ${revisionColumns(tx)}
    from app.freight_quotes q
    join app.counterparties k on k.id = q.carrier_id
    left join app.facilities o on o.id = q.origin_facility_id
    left join app.counterparties oc on oc.id = o.counterparty_id
    left join app.facilities d on d.id = q.destination_facility_id
    left join app.counterparties dc on dc.id = d.counterparty_id
    join lateral (
      select * from app.freight_quote_revisions x where x.freight_quote_id = q.id
      order by x.revision_number desc limit 1
    ) r on true
  `;

  return {
    listFreight(ctx, filter) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<FreightRow[]>`
          ${freightSelect(tx)}
          where ${filter.organizationId === null ? tx`true` : tx`q.organization_id = ${filter.organizationId}`}
            and ${filter.carrierId === null ? tx`true` : tx`q.carrier_id = ${filter.carrierId}`}
            and ${
              filter.facilityId === null
                ? tx`true`
                : tx`(q.origin_facility_id = ${filter.facilityId} or q.destination_facility_id = ${filter.facilityId})`
            }
            and ${
              filter.counterpartyId === null
                ? tx`true`
                : tx`(q.carrier_id = ${filter.counterpartyId} or o.counterparty_id = ${filter.counterpartyId} or d.counterparty_id = ${filter.counterpartyId})`
            }
            and ${filter.mode === null ? tx`true` : tx`q.mode = ${filter.mode}::app.freight_mode`}
            and ${filter.liveOnly ? tx`q.withdrawn_at is null and (r.valid_until is null or r.valid_until > now())` : tx`true`}
          order by r.quoted_at desc, q.id
          limit ${FREIGHT_LIST_LIMIT + 1}
        `;
        return rows.map(summary);
      });
    },

    getFreight(ctx, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<FreightRow[]>`${freightSelect(tx)} where q.id = ${id}`;
        if (!row) return null;
        const revisions = await tx<RevisionRow[]>`
          select ${revisionColumns(tx)} from app.freight_quote_revisions r
          where r.freight_quote_id = ${id} order by r.revision_number desc`;
        return {
          ...summary(row),
          revisions: revisions.map(revision),
          withdrawnByName: row.withdrawn_by_name,
        };
      });
    },

    canEnterFreight(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [check] = await tx<{ allowed: boolean }[]>`
          select app.can_enter_freight(${organizationId}) as allowed`;
        return check?.allowed === true;
      });
    },

    createFreight(ctx, freight) {
      return asUser(ctx, async (tx): Promise<CreateFreightResult> => {
        const org = freight.organizationId;
        const [check] = await tx<{ allowed: boolean }[]>`
          select app.can_enter_freight(${org}) as allowed`;
        if (check?.allowed !== true) return { status: 'forbidden' };
        const [carrier] = await tx<{ archived: boolean }[]>`
          select archived_at is not null as archived
          from app.counterparties where id = ${freight.carrierId} and organization_id = ${org}`;
        if (!carrier) return { status: 'carrier_not_found' };
        if (carrier.archived) return { status: 'archived' };
        if (sameEnd(freight.origin, freight.destination)) return { status: 'same_location' };
        const facilityIds = [freight.origin, freight.destination].flatMap((end) =>
          end.kind === 'facility' ? [end.facilityId] : [],
        );
        const ends =
          facilityIds.length === 0
            ? []
            : await tx<{ id: string; archived: boolean }[]>`
                select f.id, c.archived_at is not null as archived
                from app.facilities f join app.counterparties c on c.id = f.counterparty_id
                where f.organization_id = ${org}
                  and f.id in (${facilityIds[0] ?? null}, ${facilityIds[1] ?? facilityIds[0] ?? null})`;
        const found = (end: NewFreightEnd) =>
          end.kind === 'area' ? { archived: false } : ends.find((e) => e.id === end.facilityId);
        const origin = found(freight.origin);
        const destination = found(freight.destination);
        if (!origin) return { status: 'origin_not_found' };
        if (!destination) return { status: 'destination_not_found' };
        if (origin.archived || destination.archived) return { status: 'archived' };
        const o = endColumns(freight.origin);
        const d = endColumns(freight.destination);
        const [created] = await tx<{ id: string }[]>`
          insert into app.freight_quotes
            (organization_id, carrier_id, origin_facility_id, destination_facility_id, mode,
             created_by,
             origin_area_text, origin_area_region, origin_area_latitude, origin_area_longitude,
             origin_area_precision,
             destination_area_text, destination_area_region, destination_area_latitude,
             destination_area_longitude, destination_area_precision)
          values (${org}, ${freight.carrierId}, ${o.facilityId}, ${d.facilityId},
                  ${freight.mode}::app.freight_mode, app.current_user_id(),
                  ${o.text}, ${o.region}, ${o.latitude}::numeric, ${o.longitude}::numeric,
                  ${o.precision}::app.location_precision,
                  ${d.text}, ${d.region}, ${d.latitude}::numeric, ${d.longitude}::numeric,
                  ${d.precision}::app.location_precision)
          returning id`;
        if (!created) throw new Error('freight quote was not created');
        await insertRevision(tx, org, created.id, freight.terms, freight.recordedByName);
        return { status: 'created', id: created.id };
      });
    },

    reviseFreight(ctx, id, basedOnRevision, terms, recordedByName) {
      return asUser(ctx, async (tx): Promise<FreightWriteResult> => {
        const [freight] = await tx<{ organization_id: string; allowed: boolean }[]>`
          select organization_id, app.can_enter_freight(organization_id) as allowed
          from app.freight_quotes where id = ${id}`;
        if (!freight) return { status: 'not_found' };
        if (!freight.allowed) return { status: 'forbidden' };
        // Lock the freight quote, so revising and withdrawing it happen one after the other,
        // then read its state in a statement of its own, as reviseQuote does (a statement that
        // waits for a lock would miss a revision recorded meanwhile).
        const lock = await tx`select 1 from app.freight_quotes where id = ${id} for no key update`;
        if (lock.length === 0) return { status: 'not_found' };
        const [locked] = await tx<{ withdrawn: boolean; archived: boolean; current: number }[]>`
          select q.withdrawn_at is not null as withdrawn,
                 exists (select 1 from app.counterparties c
                          where c.id = q.carrier_id and c.archived_at is not null) as archived,
                 (select max(r.revision_number) from app.freight_quote_revisions r
                   where r.freight_quote_id = q.id) as current
          from app.freight_quotes q where q.id = ${id}`;
        if (!locked) return { status: 'not_found' };
        if (locked.withdrawn) return { status: 'withdrawn' };
        if (locked.archived) return { status: 'archived' };
        if (locked.current !== basedOnRevision) {
          return { status: 'changed', currentRevision: locked.current };
        }
        await insertRevision(tx, freight.organization_id, id, terms, recordedByName);
        return { status: 'saved' };
      });
    },

    withdrawFreight(ctx, id, withdrawnByName) {
      return asUser(ctx, async (tx): Promise<FreightWriteResult> => {
        const [freight] = await tx<{ allowed: boolean }[]>`
          select app.can_enter_freight(organization_id) as allowed
          from app.freight_quotes where id = ${id}`;
        if (!freight) return { status: 'not_found' };
        if (!freight.allowed) return { status: 'forbidden' };
        await tx`
          update app.freight_quotes
          set withdrawn_at = now(), withdrawn_by = app.current_user_id(),
              withdrawn_by_name = ${withdrawnByName}
          where id = ${id} and withdrawn_at is null`;
        return { status: 'saved' };
      });
    },
  };
}
