import { parseBbox } from '@grain/domain';
import { Hono } from 'hono';

import { MAP_LIMIT } from './db';
import { apiError, isUuid, withDatabase, type ApiEnv, type DatabaseFactory } from './respond';

/** /api/v1/facilities. Mounted after requireUser, so every route needs a signed-in user. */
export function facilityRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  // The located facilities inside a map view (GT-022). Quote filters (side, commodity,
  // as_of in docs/API.md) arrive with quotes.
  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? null;
    if (organizationId !== null && !isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    const bbox = parseBbox(c.req.query('bbox') ?? '');
    if (!bbox) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        'bbox must be west,south,east,north in degrees, with west < east and south < north.',
      );
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.facilitiesInBbox(ctx, organizationId, bbox);
      return c.json({
        facilities: result.facilities.slice(0, MAP_LIMIT),
        truncated: result.facilities.length > MAP_LIMIT,
        withoutCoordinates: result.withoutCoordinates,
      });
    });
  });

  return routes;
}
