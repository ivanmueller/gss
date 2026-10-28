import {
  createQuoteSchema,
  parseQuoteTerms,
  QUOTE_SIDE_LABELS,
  QUOTE_SIDES,
  reviseQuoteSchema,
  SIDE_COUNTERPARTY_TYPES,
  type QuoteIssue,
  type QuoteSide,
} from '@grain/domain';
import { Hono } from 'hono';

import type { AuthUser } from './auth';
import type { Database, RequestContext } from './db';
import { QUOTE_LIST_LIMIT, type QuoteWriteResult } from './quotes-db';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

const MAX_BODY_BYTES = 64 * 1024;
const FORBIDDEN = 'Only traders and admins enter, revise and withdraw bids and offers.';
const COMMODITY = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * The name recorded with a revision or a withdrawal: the person's name from their login, or
 * their email when they have none. Taken from the verified user, never from the request.
 */
export function recorderName(user: AuthUser): string {
  const name = [user.firstName, user.lastName]
    .filter((part): part is string => part !== null)
    .join(' ')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  const text = name !== '' ? name : (user.email ?? '').trim();
  return (text === '' ? 'GSS staff member' : text).slice(0, 200).trim();
}

function malformed(c: ApiContext, error: { issues: { path: PropertyKey[] }[] }) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.', {
    fields: error.issues.slice(0, 20).map((issue) => issue.path.map(String).join('.')),
  });
}

function invalid(c: ApiContext, issues: QuoteIssue[]) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'Some fields need fixing.', { issues });
}

/** After a change: the quote as it now is, with every revision. */
async function savedQuote(
  c: ApiContext,
  db: Database,
  ctx: RequestContext,
  id: string,
  result: QuoteWriteResult,
  status: 200 | 201 = 200,
) {
  switch (result.status) {
    case 'saved': {
      const quote = await db.getQuote(ctx, id);
      return quote ? c.json(quote, status) : apiError(c, 404, 'NOT_FOUND', 'No such quote.');
    }
    case 'not_found':
      return apiError(c, 404, 'NOT_FOUND', 'No such quote.');
    case 'forbidden':
      return apiError(c, 403, 'FORBIDDEN', FORBIDDEN);
    case 'changed':
      return apiError(
        c,
        409,
        'QUOTE_CHANGED',
        'Someone recorded new terms after you opened this quote. Reload the page to see them, then make your change again.',
        { currentRevision: result.currentRevision },
      );
    case 'withdrawn':
      return apiError(c, 409, 'WITHDRAWN', 'This quote was withdrawn. Enter a new one instead.');
    case 'archived':
      return apiError(
        c,
        409,
        'ARCHIVED',
        'This counterparty is archived. Restore it before changing its bids and offers.',
      );
  }
}

/** /api/v1/commodities: the commodity list for the bid and offer forms. */
export function commodityRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();
  routes.get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) =>
      c.json({ commodities: await db.listCommodities(ctx) }),
    );
  });
  return routes;
}

/** /api/v1/quotes (GT-031). Mounted after requireUser, so every route needs a signed-in user. */
export function quoteRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const query = c.req.query();
    const organizationId = query.organization_id ?? null;
    const counterpartyId = query.counterparty_id ?? null;
    const side = query.side ?? null;
    const commodity = query.commodity ?? null;
    const status = query.status ?? 'live';
    if (
      (organizationId !== null && !isUuid(organizationId)) ||
      (counterpartyId !== null && !isUuid(counterpartyId)) ||
      (side !== null && !(QUOTE_SIDES as readonly string[]).includes(side)) ||
      (commodity !== null && !COMMODITY.test(commodity)) ||
      (status !== 'live' && status !== 'all')
    ) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        'organization_id and counterparty_id must be UUIDs, side bid or offer, status live or all.',
      );
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const quotes = await db.listQuotes(ctx, {
        organizationId,
        counterpartyId,
        side: side as QuoteSide | null,
        commodity,
        // Withdrawn and expired quotes only when asked for (section 13, Phase 3 gate).
        liveOnly: status === 'live',
      });
      return c.json({
        quotes: quotes.slice(0, QUOTE_LIST_LIMIT),
        truncated: quotes.length > QUOTE_LIST_LIMIT,
      });
    });
  });

  routes.get('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such quote.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const quote = await db.getQuote(ctx, id);
      return quote ? c.json(quote) : apiError(c, 404, 'NOT_FOUND', 'No such quote.');
    });
  });

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createQuoteSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseQuoteTerms(request.data.values, new Date());
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    const { organizationId, counterpartyId, side, commodity } = request.data;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const created = await db.createQuote(ctx, {
        organizationId,
        counterpartyId,
        facilityId: request.data.facilityId ?? null,
        side,
        commodity,
        terms: parsed.value,
        recordedByName: recorderName(c.get('user')),
      });
      switch (created.status) {
        case 'created': {
          const quote = await db.getQuote(ctx, created.id);
          return quote
            ? c.json(quote, 201)
            : apiError(c, 404, 'NOT_FOUND', 'The new quote could not be read back.');
        }
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', FORBIDDEN);
        case 'counterparty_not_found':
          return apiError(c, 422, 'COUNTERPARTY_NOT_FOUND', 'Choose a counterparty from the list.');
        case 'archived':
          return apiError(
            c,
            409,
            'ARCHIVED',
            'This counterparty is archived. Restore it before entering bids or offers.',
          );
        case 'wrong_type': {
          const wanted = SIDE_COUNTERPARTY_TYPES[side][0] ?? side;
          return apiError(
            c,
            422,
            'WRONG_COUNTERPARTY_TYPE',
            `${QUOTE_SIDE_LABELS[side]}s come from a ${wanted} or broker. Mark this counterparty as a ${wanted} on its page first.`,
          );
        }
        case 'facility_not_found':
          return apiError(
            c,
            422,
            'FACILITY_NOT_FOUND',
            'Choose one of this counterparty’s locations, or none.',
          );
        case 'commodity_not_found':
          return apiError(c, 422, 'COMMODITY_NOT_FOUND', 'Choose a commodity from the list.');
      }
    });
  });

  // New terms: a new revision; the earlier ones stay as they were.
  routes.post('/:id/revisions', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such quote.');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = reviseQuoteSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseQuoteTerms(request.data.values, new Date());
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.reviseQuote(
        ctx,
        id,
        request.data.basedOnRevision,
        parsed.value,
        recorderName(c.get('user')),
      );
      return savedQuote(c, db, ctx, id, result, 201);
    });
  });

  // Withdrawn for good; the quote and its history stay readable.
  routes.post('/:id/withdraw', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such quote.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.withdrawQuote(ctx, id, recorderName(c.get('user')));
      return savedQuote(c, db, ctx, id, result);
    });
  });

  return routes;
}
