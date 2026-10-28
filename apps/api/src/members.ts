import { addMemberSchema, updateMemberSchema } from '@grain/domain';
import { Hono } from 'hono';

import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

const FORBIDDEN = 'Only admins of this organization manage its team.';
const MAX_BODY_BYTES = 8 * 1024;

/** /api/v1/members (GT-013). Mounted after requireUser; every route is for org admins only. */
export function memberRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? '';
    if (!isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const members = await db.listMembers(ctx, organizationId);
      return members === null ? apiError(c, 403, 'FORBIDDEN', FORBIDDEN) : c.json({ members });
    });
  });

  // Adds a person who already has a login (made in the Supabase dashboard).
  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = addMemberSchema.safeParse(body.value);
    if (!request.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'Give an email address and a role.');
    }
    const { organizationId, email, role } = request.data;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.addMember(ctx, organizationId, email, role);
      switch (result.status) {
        case 'added':
          return c.json({ id: result.id }, 201);
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', FORBIDDEN);
        case 'no_account':
          return apiError(
            c,
            404,
            'NO_ACCOUNT',
            'No one can sign in with this email yet. Create their login in Supabase first, then add them here.',
          );
        case 'already_member':
          return apiError(c, 409, 'ALREADY_MEMBER', 'This person is already on the team.');
      }
    });
  });

  routes.patch('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such member.');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = updateMemberSchema.safeParse(body.value);
    if (!request.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'The change is malformed.', {
        fields: request.error.issues.slice(0, 10).map((issue) => issue.path.join('.')),
      });
    }
    const { organizationId, version, ...changes } = request.data;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.updateMember(ctx, organizationId, id, version, changes);
      switch (result.status) {
        case 'saved':
          return c.json({ saved: true });
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', 'No such member.');
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', FORBIDDEN);
        case 'changed':
          return apiError(
            c,
            409,
            'RECORD_CHANGED',
            'Someone changed this member after you opened it. Reload the page and try again.',
          );
        case 'self':
          return apiError(
            c,
            409,
            'OWN_MEMBERSHIP',
            'You cannot change your own role or suspend yourself. Ask another admin.',
          );
      }
    });
  });

  return routes;
}
