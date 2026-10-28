import { addMemberSchema, updateMemberSchema } from '@grain/domain';
import { Hono } from 'hono';

import { createLogin, LoginServiceError, secretKey, temporaryPassword } from './logins';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

const FORBIDDEN = 'Only admins manage the team.';
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

  // Adds a person to the team. Without a login yet, one is made with a temporary password,
  // returned once for the admin to pass on in person; the person replaces it at first
  // sign-in. Making logins needs the Worker secret SUPABASE_SECRET_KEY.
  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = addMemberSchema.safeParse(body.value);
    if (!request.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'Give an email address and a role.');
    }
    const { organizationId, email, role } = request.data;
    const firstName = request.data.firstName ?? null;
    const lastName = request.data.lastName ?? null;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      // Admins only, before anything else; the database checks it again on every write.
      if (!(await db.isOrgAdmin(ctx, organizationId))) {
        return apiError(c, 403, 'FORBIDDEN', FORBIDDEN);
      }
      let result = await db.addMember(ctx, organizationId, email, role);
      let password: string | null = null;
      if (result.status === 'no_account') {
        const key = secretKey(c.env);
        if (key === null) {
          return apiError(
            c,
            503,
            'LOGINS_NOT_CONFIGURED',
            'Making logins from the app is not set up yet: an admin adds the Supabase secret key in Cloudflare (README, “Sign-in”).',
          );
        }
        if (firstName === null) {
          return apiError(c, 422, 'NAME_REQUIRED', 'Give their first name: the app shows it.');
        }
        password = temporaryPassword();
        try {
          const created = await createLogin(c.env, key, { email, password, firstName, lastName });
          // Made by someone else meanwhile: add that login, without a password to pass on.
          if (created.status === 'exists') password = null;
        } catch (error) {
          if (!(error instanceof LoginServiceError)) throw error;
          console.error(
            `Supabase Auth refused making a login in request ${c.get('requestId')}: status=${String(error.status)}`,
          );
          return apiError(
            c,
            502,
            'LOGIN_SERVICE_FAILED',
            'Supabase did not make the login. Check the Supabase secret key in Cloudflare, or try again later.',
          );
        }
        result = await db.addMember(ctx, organizationId, email, role);
      }
      switch (result.status) {
        case 'added':
          // An existing login gets the names given here; a new one was made with them.
          if (password === null && firstName !== null) {
            await db.setMemberNames(ctx, organizationId, result.id, firstName, lastName);
          }
          return c.json(
            { id: result.id, ...(password !== null && { temporaryPassword: password }) },
            201,
          );
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', FORBIDDEN);
        case 'no_account':
          return apiError(c, 503, 'LOGIN_SERVICE_FAILED', 'The new login could not be found.');
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
