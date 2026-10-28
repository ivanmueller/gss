import {
  quoteStatus,
  SIDE_COUNTERPARTY_TYPES,
  type Commodity,
  type CounterpartyType,
  type DeliveryBasis,
  type PriceUnit,
  type QuoteCurrency,
  type QuoteDetail,
  type QuoteFirmness,
  type QuoteRevision,
  type QuoteSide,
  type QuoteSource,
  type QuoteSummary,
  type QuoteTerms,
} from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

// Bids and offers in Postgres (20261028040000_quotes.sql). Every call runs as the verified
// user, so row level security decides what is visible and writable; the checks here only
// choose the answer to give.

/** Largest list returned by listQuotes. */
export const QUOTE_LIST_LIMIT = 2000;

export interface QuoteFilter {
  organizationId: string | null;
  counterpartyId: string | null;
  side: QuoteSide | null;
  commodity: string | null;
  /** Only firm and indicative quotes still valid now; otherwise withdrawn and expired too. */
  liveOnly: boolean;
}

export interface NewQuote {
  organizationId: string;
  counterpartyId: string;
  facilityId: string | null;
  side: QuoteSide;
  commodity: string;
  terms: QuoteTerms;
  /** The recorder's name as shown with the revision. */
  recordedByName: string;
}

export type CreateQuoteResult =
  | { status: 'created'; id: string }
  | { status: 'forbidden' }
  | { status: 'counterparty_not_found' }
  | { status: 'archived' }
  /** A bid needs a buyer (or broker), an offer a seller (or broker). */
  | { status: 'wrong_type'; types: CounterpartyType[] }
  | { status: 'facility_not_found' }
  | { status: 'commodity_not_found' };

export type QuoteWriteResult =
  | { status: 'saved' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  /** New terms were recorded after the revision the person was looking at. */
  | { status: 'changed'; currentRevision: number }
  | { status: 'withdrawn' }
  | { status: 'archived' };

export interface QuoteDatabase {
  listCommodities: (ctx: RequestContext) => Promise<Commodity[]>;
  canEnterQuotes: (ctx: RequestContext, organizationId: string) => Promise<boolean>;
  /** Quotes with their latest terms, newest quoted first, up to QUOTE_LIST_LIMIT + 1. */
  listQuotes: (ctx: RequestContext, filter: QuoteFilter) => Promise<QuoteSummary[]>;
  /** A quote with every revision; null when missing or not visible. */
  getQuote: (ctx: RequestContext, id: string) => Promise<QuoteDetail | null>;
  createQuote: (ctx: RequestContext, quote: NewQuote) => Promise<CreateQuoteResult>;
  /** Appends new terms, unless someone recorded newer ones than `basedOnRevision`. */
  reviseQuote: (
    ctx: RequestContext,
    id: string,
    basedOnRevision: number,
    terms: QuoteTerms,
    recordedByName: string,
  ) => Promise<QuoteWriteResult>;
  /** Withdraws a quote for good; withdrawing a withdrawn quote changes nothing. */
  withdrawQuote: (
    ctx: RequestContext,
    id: string,
    withdrawnByName: string,
  ) => Promise<QuoteWriteResult>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

interface RevisionRow {
  revision_id: string;
  revision_number: number;
  firmness: QuoteFirmness;
  price: string;
  currency: QuoteCurrency;
  price_unit: PriceUnit;
  grade: string | null;
  delivery_basis: DeliveryBasis;
  basis_location: string | null;
  quantity_min_mt: string | null;
  quantity_max_mt: string;
  delivery_start: string | null;
  delivery_end: string | null;
  quoted_at: Date;
  valid_until: Date;
  source_type: QuoteSource;
  source_reference: string | null;
  notes: string | null;
  recorded_by_name: string;
  recorded_at: Date;
}

interface QuoteRow extends RevisionRow {
  id: string;
  side: QuoteSide;
  commodity_code: string;
  commodity_name: string;
  counterparty_id: string;
  legal_name: string;
  trading_name: string | null;
  archived: boolean;
  facility_id: string | null;
  facility_name: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  withdrawn_at: Date | null;
  withdrawn_by_name: string | null;
  created_at: Date;
  as_of: Date;
}

/** The revision columns, read from a row aliased `r`. Decimals and dates as text, as stored. */
const revisionColumns = (tx: postgres.TransactionSql) => tx`
  r.id as revision_id, r.revision_number, r.firmness::text as firmness, r.price::text as price,
  r.currency, r.price_unit, r.grade, r.delivery_basis::text as delivery_basis, r.basis_location,
  r.quantity_min_mt::text as quantity_min_mt, r.quantity_max_mt::text as quantity_max_mt,
  to_char(r.delivery_start, 'YYYY-MM-DD') as delivery_start,
  to_char(r.delivery_end, 'YYYY-MM-DD') as delivery_end,
  r.quoted_at, r.valid_until, r.source_type::text as source_type, r.source_reference, r.notes,
  r.recorded_by_name, r.created_at as recorded_at
`;

function revision(row: RevisionRow): QuoteRevision {
  return {
    id: row.revision_id,
    revisionNumber: row.revision_number,
    firmness: row.firmness,
    price: row.price,
    currency: row.currency,
    priceUnit: row.price_unit,
    grade: row.grade,
    deliveryBasis: row.delivery_basis,
    basisLocation: row.basis_location,
    quantityMinMt: row.quantity_min_mt,
    quantityMaxMt: row.quantity_max_mt,
    deliveryStart: row.delivery_start,
    deliveryEnd: row.delivery_end,
    quotedAt: row.quoted_at.toISOString(),
    validUntil: row.valid_until.toISOString(),
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    notes: row.notes,
    recordedByName: row.recorded_by_name,
    recordedAt: row.recorded_at.toISOString(),
  };
}

function summary(row: QuoteRow): QuoteSummary {
  const current = revision(row);
  const withdrawnAt = row.withdrawn_at?.toISOString() ?? null;
  return {
    id: row.id,
    side: row.side,
    commodity: { code: row.commodity_code, name: row.commodity_name },
    counterparty: {
      id: row.counterparty_id,
      legalName: row.legal_name,
      tradingName: row.trading_name,
      archived: row.archived,
    },
    facility:
      row.facility_id === null
        ? null
        : {
            id: row.facility_id,
            name: row.facility_name,
            city: row.city,
            region: row.region,
            country: row.country ?? '',
          },
    // The database's clock decides what has expired, the same for every quote in an answer.
    status: quoteStatus(
      { withdrawnAt, validUntil: current.validUntil, firmness: current.firmness },
      row.as_of,
    ),
    withdrawnAt,
    createdAt: row.created_at.toISOString(),
    current,
  };
}

async function insertRevision(
  tx: postgres.TransactionSql,
  organizationId: string,
  quoteId: string,
  terms: QuoteTerms,
  recordedByName: string,
) {
  // revision_number is set by the database (app.number_quote_revision); 1 is a placeholder.
  await tx`
    insert into app.quote_revisions
      (organization_id, quote_id, revision_number, firmness, price, currency, price_unit, grade,
       delivery_basis, basis_location, quantity_min_mt, quantity_max_mt, delivery_start,
       delivery_end, quoted_at, valid_from, valid_until, source_type, source_reference, notes,
       recorded_by, recorded_by_name)
    values (${organizationId}, ${quoteId}, 1, ${terms.firmness}::app.quote_firmness,
            ${terms.price}::numeric, ${terms.currency}, ${terms.priceUnit}, ${terms.grade},
            ${terms.deliveryBasis}::app.delivery_basis, ${terms.basisLocation},
            ${terms.quantityMinMt}::numeric, ${terms.quantityMaxMt}::numeric,
            ${terms.deliveryStart}::date, ${terms.deliveryEnd}::date,
            ${terms.quotedAt}::timestamptz, ${terms.quotedAt}::timestamptz,
            ${terms.validUntil}::timestamptz, ${terms.sourceType}::app.quote_source,
            ${terms.sourceReference}, ${terms.notes}, app.current_user_id(), ${recordedByName})
  `;
}

export function quoteQueries(asUser: AsUser): QuoteDatabase {
  const quoteSelect = (tx: postgres.TransactionSql) => tx`
    select q.id, q.side::text as side, q.commodity_code, cm.display_name as commodity_name,
           q.counterparty_id, c.legal_name, c.trading_name, c.archived_at is not null as archived,
           q.facility_id, f.name as facility_name, f.city, f.region, f.country,
           q.withdrawn_at, q.withdrawn_by_name, q.created_at, now() as as_of,
           ${revisionColumns(tx)}
    from app.quotes q
    join app.commodities cm on cm.code = q.commodity_code
    join app.counterparties c on c.id = q.counterparty_id
    left join app.facilities f on f.id = q.facility_id
    join lateral (
      select * from app.quote_revisions x where x.quote_id = q.id
      order by x.revision_number desc limit 1
    ) r on true
  `;

  return {
    listCommodities(ctx) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<Commodity[]>`
          select code, display_name as name from app.commodities
          where active order by sort_order, code`;
        return [...rows];
      });
    },

    canEnterQuotes(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ allowed: boolean }[]>`
          select app.can_enter_quotes(${organizationId}) as allowed`;
        return row?.allowed === true;
      });
    },

    listQuotes(ctx, filter) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<QuoteRow[]>`
          ${quoteSelect(tx)}
          where ${filter.organizationId === null ? tx`true` : tx`q.organization_id = ${filter.organizationId}`}
            and ${filter.counterpartyId === null ? tx`true` : tx`q.counterparty_id = ${filter.counterpartyId}`}
            and ${filter.side === null ? tx`true` : tx`q.side = ${filter.side}::app.quote_side`}
            and ${filter.commodity === null ? tx`true` : tx`q.commodity_code = ${filter.commodity}`}
            and ${filter.liveOnly ? tx`q.withdrawn_at is null and r.valid_until > now()` : tx`true`}
          order by r.quoted_at desc, q.id
          limit ${QUOTE_LIST_LIMIT + 1}
        `;
        return rows.map(summary);
      });
    },

    getQuote(ctx, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<QuoteRow[]>`${quoteSelect(tx)} where q.id = ${id}`;
        if (!row) return null;
        const revisions = await tx<RevisionRow[]>`
          select ${revisionColumns(tx)} from app.quote_revisions r
          where r.quote_id = ${id} order by r.revision_number desc`;
        return {
          ...summary(row),
          revisions: revisions.map(revision),
          withdrawnByName: row.withdrawn_by_name,
        };
      });
    },

    createQuote(ctx, quote) {
      return asUser(ctx, async (tx): Promise<CreateQuoteResult> => {
        const org = quote.organizationId;
        const [check] = await tx<{ allowed: boolean }[]>`
          select app.can_enter_quotes(${org}) as allowed`;
        if (check?.allowed !== true) return { status: 'forbidden' };
        const [counterparty] = await tx<{ types: CounterpartyType[]; archived: boolean }[]>`
          select to_jsonb(types::text[]) as types, archived_at is not null as archived
          from app.counterparties where id = ${quote.counterpartyId} and organization_id = ${org}`;
        if (!counterparty) return { status: 'counterparty_not_found' };
        if (counterparty.archived) return { status: 'archived' };
        const allowed = SIDE_COUNTERPARTY_TYPES[quote.side];
        if (!counterparty.types.some((type) => allowed.includes(type))) {
          return { status: 'wrong_type', types: counterparty.types };
        }
        if (quote.facilityId !== null) {
          const facilities = await tx`
            select 1 from app.facilities
            where id = ${quote.facilityId} and counterparty_id = ${quote.counterpartyId}`;
          if (facilities.length !== 1) return { status: 'facility_not_found' };
        }
        const commodities = await tx`
          select 1 from app.commodities where code = ${quote.commodity} and active`;
        if (commodities.length !== 1) return { status: 'commodity_not_found' };
        const [created] = await tx<{ id: string }[]>`
          insert into app.quotes
            (organization_id, counterparty_id, facility_id, side, commodity_code, created_by)
          values (${org}, ${quote.counterpartyId}, ${quote.facilityId},
                  ${quote.side}::app.quote_side, ${quote.commodity}, app.current_user_id())
          returning id`;
        if (!created) throw new Error('quote was not created');
        await insertRevision(tx, org, created.id, quote.terms, quote.recordedByName);
        return { status: 'created', id: created.id };
      });
    },

    reviseQuote(ctx, id, basedOnRevision, terms, recordedByName) {
      return asUser(ctx, async (tx): Promise<QuoteWriteResult> => {
        const [quote] = await tx<{ organization_id: string; allowed: boolean }[]>`
          select organization_id, app.can_enter_quotes(organization_id) as allowed
          from app.quotes where id = ${id}`;
        if (!quote) return { status: 'not_found' };
        if (!quote.allowed) return { status: 'forbidden' };
        // Lock the quote, so revising and withdrawing it happen one after the other. Its
        // state is read in a statement of its own once the lock is held: a statement that
        // waits for a lock reads everything but the locked row as it was before waiting, so
        // it would miss a revision recorded meanwhile (Codex's review of ivanmueller/gss#46).
        const lock = await tx`select 1 from app.quotes where id = ${id} for no key update`;
        if (lock.length === 0) return { status: 'not_found' };
        const [locked] = await tx<{ withdrawn: boolean; archived: boolean; current: number }[]>`
          select q.withdrawn_at is not null as withdrawn,
                 exists (select 1 from app.counterparties c
                          where c.id = q.counterparty_id and c.archived_at is not null) as archived,
                 (select max(r.revision_number) from app.quote_revisions r
                   where r.quote_id = q.id) as current
          from app.quotes q where q.id = ${id}`;
        if (!locked) return { status: 'not_found' };
        if (locked.withdrawn) return { status: 'withdrawn' };
        if (locked.archived) return { status: 'archived' };
        if (locked.current !== basedOnRevision) {
          return { status: 'changed', currentRevision: locked.current };
        }
        await insertRevision(tx, quote.organization_id, id, terms, recordedByName);
        return { status: 'saved' };
      });
    },

    withdrawQuote(ctx, id, withdrawnByName) {
      return asUser(ctx, async (tx): Promise<QuoteWriteResult> => {
        const [quote] = await tx<{ allowed: boolean }[]>`
          select app.can_enter_quotes(organization_id) as allowed from app.quotes where id = ${id}`;
        if (!quote) return { status: 'not_found' };
        if (!quote.allowed) return { status: 'forbidden' };
        await tx`
          update app.quotes
          set withdrawn_at = now(), withdrawn_by = app.current_user_id(),
              withdrawn_by_name = ${withdrawnByName}
          where id = ${id} and withdrawn_at is null`;
        return { status: 'saved' };
      });
    },
  };
}
