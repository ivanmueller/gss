import {
  createFreightSchema,
  FREIGHT_MODES,
  parseFreightTerms,
  reviseFreightSchema,
  type FreightIssue,
  type FreightMode,
} from '@grain/domain';
import { Hono } from 'hono';

import type { Database, RequestContext } from './db';
import { FREIGHT_LIST_LIMIT, type FreightWriteResult } from './freight-db';
import { recorderName } from './quotes';
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
const FORBIDDEN = 'Only traders, operations and admins enter, revise and withdraw freight rates.';
const NOT_FOUND = 'No such freight rate.';

function malformed(c: ApiContext, error: { issues: { path: PropertyKey[] }[] }) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.', {
    fields: error.issues.slice(0, 20).map((issue) => issue.path.map(String).join('.')),
  });
}

function invalid(c: ApiContext, issues: FreightIssue[]) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'Some fields need fixing.', { issues });
}

/** After a change: the freight quote as it now is, with every revision. */
async function savedFreight(
  c: ApiContext,
  db: Database,
  ctx: RequestContext,
  id: string,
  result: FreightWriteResult,
  status: 200 | 201 = 200,
) {
  switch (result.status) {
    case 'saved': {
      const freight = await db.getFreight(ctx, id);
      return freight ? c.json(freight, status) : apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    }
    case 'not_found':
      return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    case 'forbidden':
      return apiError(c, 403, 'FORBIDDEN', FORBIDDEN);
    case 'changed':
      return apiError(
        c,
        409,
        'QUOTE_CHANGED',
        'Someone recorded new terms after you opened this freight rate. Reload the page to see them, then make your change again.',
        { currentRevision: result.currentRevision },
      );
    case 'withdrawn':
      return apiError(
        c,
        409,
        'WITHDRAWN',
        'This freight rate was withdrawn. Enter a new one instead.',
      );
    case 'archived':
      return apiError(
        c,
        409,
        'ARCHIVED',
        'This carrier is archived. Restore it before changing its freight rates.',
      );
  }
}

/**
 * /api/v1/freight-quotes: carrier freight rates by route (part of GT-050). Mounted after
 * requireUser, so every route needs a signed-in user.
 */
export function freightRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const query = c.req.query();
    const organizationId = query.organization_id ?? null;
    const carrierId = query.carrier_id ?? null;
    const facilityId = query.facility_id ?? null;
    const counterpartyId = query.counterparty_id ?? null;
    const mode = query.mode ?? null;
    const status = query.status ?? 'live';
    if (
      (organizationId !== null && !isUuid(organizationId)) ||
      (carrierId !== null && !isUuid(carrierId)) ||
      (facilityId !== null && !isUuid(facilityId)) ||
      (counterpartyId !== null && !isUuid(counterpartyId)) ||
      (mode !== null && !(FREIGHT_MODES as readonly string[]).includes(mode)) ||
      (status !== 'live' && status !== 'all')
    ) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        'organization_id, carrier_id, facility_id and counterparty_id must be UUIDs, mode truck or rail, status live or all.',
      );
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const freight = await db.listFreight(ctx, {
        organizationId,
        carrierId,
        facilityId,
        counterpartyId,
        mode: mode as FreightMode | null,
        // Withdrawn and expired rates only when asked for, so neither passes for a live one.
        liveOnly: status === 'live',
      });
      return c.json({
        freight: freight.slice(0, FREIGHT_LIST_LIMIT),
        truncated: freight.length > FREIGHT_LIST_LIMIT,
      });
    });
  });

  routes.get('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const freight = await db.getFreight(ctx, id);
      return freight ? c.json(freight) : apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    });
  });

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createFreightSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseFreightTerms(request.data.values, new Date());
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    const { organizationId, carrierId, originFacilityId, destinationFacilityId, mode } =
      request.data;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const created = await db.createFreight(ctx, {
        organizationId,
        carrierId,
        originFacilityId,
        destinationFacilityId,
        mode,
        terms: parsed.value,
        recordedByName: recorderName(c.get('user')),
      });
      switch (created.status) {
        case 'created': {
          const freight = await db.getFreight(ctx, created.id);
          return freight
            ? c.json(freight, 201)
            : apiError(c, 404, 'NOT_FOUND', 'The new freight rate could not be read back.');
        }
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', FORBIDDEN);
        case 'carrier_not_found':
          return apiError(c, 422, 'CARRIER_NOT_FOUND', 'Choose a carrier from the list.');
        case 'not_a_carrier':
          return apiError(
            c,
            422,
            'NOT_A_CARRIER',
            'Freight rates come from a carrier. Mark this counterparty as a carrier on its page first.',
          );
        case 'archived':
          return apiError(
            c,
            409,
            'ARCHIVED',
            'The carrier or a counterparty of the route is archived. Restore it before entering freight.',
          );
        case 'origin_not_found':
          return apiError(
            c,
            422,
            'ORIGIN_NOT_FOUND',
            'Choose the location the freight leaves from.',
          );
        case 'destination_not_found':
          return apiError(
            c,
            422,
            'DESTINATION_NOT_FOUND',
            'Choose the location the freight goes to.',
          );
        case 'same_location':
          return apiError(
            c,
            422,
            'SAME_LOCATION',
            'A route goes from one location to another; choose two different locations.',
          );
      }
    });
  });

  // New terms: a new revision; the earlier ones stay as they were.
  routes.post('/:id/revisions', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = reviseFreightSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseFreightTerms(request.data.values, new Date());
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.reviseFreight(
        ctx,
        id,
        request.data.basedOnRevision,
        parsed.value,
        recorderName(c.get('user')),
      );
      return savedFreight(c, db, ctx, id, result, 201);
    });
  });

  // Withdrawn for good; the freight quote and its history stay readable.
  routes.post('/:id/withdraw', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.withdrawFreight(ctx, id, recorderName(c.get('user')));
      return savedFreight(c, db, ctx, id, result);
    });
  });

  return routes;
}
