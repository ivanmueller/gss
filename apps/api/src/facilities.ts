import {
  COUNTERPARTY_TYPES,
  GEOCODE_LIMIT,
  geocodeRequestSchema,
  parseBbox,
  saveCoordinatesRequestSchema,
  type GeocodeLookup,
  type SaveCoordinatesResult,
} from '@grain/domain';
import { Hono } from 'hono';

import { MAP_LIMIT } from './db';
import { GeocoderError, matchSigner, proposeCoordinates } from './geocoding';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

/** Largest request body for saving coordinates (1,000 matches of about 400 bytes). */
const MAX_SAVE_BODY_BYTES = 1024 * 1024;

const FORBIDDEN_MESSAGE = 'Only operations and admin members can find and save coordinates.';

function notConfigured(c: ApiContext) {
  return apiError(
    c,
    503,
    'GEOCODING_NOT_CONFIGURED',
    'Finding coordinates is not set up: an administrator adds the Geocodio key in Cloudflare (README, “Map”).',
  );
}

/** Geocodio failed for the whole request. Only its HTTP status is logged, never addresses. */
function geocoderFailure(c: ApiContext, error: GeocoderError) {
  console.error(
    `Geocodio ${error.kind} in request ${c.get('requestId')}: status=${String(error.status)}`,
  );
  return error.kind === 'refused'
    ? apiError(
        c,
        502,
        'GEOCODER_REFUSED',
        'Geocodio refused the request. Check the Geocodio key in Cloudflare; or the free daily allowance (2,500 lookups) is used up, so try again tomorrow.',
      )
    : apiError(
        c,
        502,
        'GEOCODER_UNAVAILABLE',
        'Geocodio could not be reached or failed. Try again later.',
      );
}

/** /api/v1/facilities. Mounted after requireUser, so every route needs a signed-in user. */
export function facilityRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  // The located facilities inside a map view (GT-022), optionally only those of buyers,
  // sellers, brokers or carriers. Quote filters (side, commodity, as_of in docs/API.md)
  // arrive with quotes.
  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? null;
    if (organizationId !== null && !isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    const typeText = c.req.query('type') ?? null;
    const type = COUNTERPARTY_TYPES.find((known) => known === typeText) ?? null;
    if (typeText !== null && type === null) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        'type must be buyer, seller, broker or carrier.',
      );
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
      const result = await db.facilitiesInBbox(ctx, organizationId, bbox, type);
      return c.json({
        facilities: result.facilities.slice(0, MAP_LIMIT),
        truncated: result.facilities.length > MAP_LIMIT,
        withoutCoordinates: result.withoutCoordinates,
      });
    });
  });

  // Looks the organization's facilities without coordinates up with Geocodio and returns
  // signed matches for review. Nothing is saved (GT-021).
  routes.post('/geocode', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, 10_000);
    if (!body.ok) return body.response;
    const request = geocodeRequestSchema.safeParse(body.value);
    if (!request.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organizationId must be a UUID.');
    }
    const { organizationId } = request.data;
    const apiKey = c.env.GEOCODIO_API_KEY?.trim();
    return withDatabase(c, openDatabase, async (db, ctx) => {
      if (!(await db.canEditDirectory(ctx, organizationId))) {
        return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_MESSAGE);
      }
      if (!apiKey) return notConfigured(c);
      const facilities = await db.facilitiesWithoutCoordinates(ctx, organizationId, GEOCODE_LIMIT);
      try {
        const proposals = await proposeCoordinates(
          apiKey,
          organizationId,
          facilities.slice(0, GEOCODE_LIMIT),
          new Date(),
        );
        const lookup: GeocodeLookup = { proposals, truncated: facilities.length > GEOCODE_LIMIT };
        return c.json(lookup);
      } catch (error) {
        if (error instanceof GeocoderError) return geocoderFailure(c, error);
        throw error;
      }
    });
  });

  // Saves the matches the reviewer chose, exactly as /geocode signed them, for facilities
  // that still have no coordinates.
  routes.post('/coordinates', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_SAVE_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = saveCoordinatesRequestSchema.safeParse(body.value);
    if (!request.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'The coordinates to save are malformed.', {
        fields: request.error.issues.slice(0, 20).map((issue) => issue.path.join('.')),
      });
    }
    const { organizationId, matches } = request.data;
    if (new Set(matches.map((match) => match.facilityId)).size !== matches.length) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'A location appears more than once.');
    }
    const apiKey = c.env.GEOCODIO_API_KEY?.trim();
    return withDatabase(c, openDatabase, async (db, ctx) => {
      if (!(await db.canEditDirectory(ctx, organizationId))) {
        return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_MESSAGE);
      }
      if (!apiKey) return notConfigured(c);
      const now = Date.now();
      if (matches.some((match) => Date.parse(match.expiresAt) < now)) {
        return apiError(
          c,
          422,
          'MATCH_EXPIRED',
          'These results are more than an hour old. Look the addresses up again.',
        );
      }
      const signer = await matchSigner(apiKey);
      const genuine = await Promise.all(
        matches.map((match) => signer.verify(organizationId, match)),
      );
      if (genuine.includes(false)) {
        return apiError(
          c,
          422,
          'INVALID_MATCH',
          'Some results were not looked up by this app, or were changed. Look the addresses up again.',
        );
      }
      const saved = await db.saveCoordinates(ctx, organizationId, matches);
      const result: SaveCoordinatesResult = {
        saved: saved.length,
        skipped: matches.length - saved.length,
      };
      return c.json(result);
    });
  });

  return routes;
}
