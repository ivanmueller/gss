import { choosePasswordSchema, MIN_PASSWORD_LENGTH } from '@grain/domain';
import { Hono } from 'hono';

import { requireUser } from './auth';
import { counterpartyRoutes } from './counterparties';
import { postgresDatabase } from './db';
import { facilityRoutes } from './facilities';
import { freightRoutes } from './freight';
import { fxQuoteRoutes, refreshFxRates } from './fx';
import { LoginServiceError, secretKey, setOwnPassword } from './logins';
import { memberRoutes } from './members';
import { commodityRoutes, quoteRoutes } from './quotes';
import { apiError, readJson, withDatabase, type ApiEnv, type DatabaseFactory } from './respond';

export type { ApiEnv, DatabaseFactory } from './respond';

export function createApp(openDatabase: DatabaseFactory) {
  const app = new Hono<ApiEnv>().basePath('/api/v1');

  // Every response carries a request id; writes record it in the audit trail.
  app.use('*', async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    await next();
  });

  // Errors no route handled. Only the error's type is logged: an error object can carry
  // configuration such as a connection string, and its message can echo request data.
  app.onError((error, c) => {
    console.error(`Unhandled ${error.name} in request ${c.get('requestId')}`);
    return apiError(c, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  });

  // Public liveness probe. It reads nothing and returns no tenant or
  // environment data, so it needs no authentication.
  app.get('/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok', service: 'api' });
  });

  // Everything registered after this line requires a signed-in user with MFA,
  // including unknown paths, so a new route cannot be left public by mistake.
  app.use('*', requireUser);

  app.get('/me', (c) => {
    const user = c.get('user');
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db) => {
      const organizations = await db.memberships(user.id);
      return c.json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        mustChangePassword: user.mustChangePassword,
        organizations: organizations.map((m) => ({
          id: m.organizationId,
          name: m.organizationName,
          role: m.role,
        })),
      });
    });
  });

  // The person's own password, replacing the temporary one their login was made with.
  app.post('/me/password', async (c) => {
    c.header('Cache-Control', 'no-store');
    const user = c.get('user');
    if (!user.mustChangePassword) {
      return apiError(c, 409, 'NOT_NEEDED', 'Your password is already your own.');
    }
    const key = secretKey(c.env);
    if (key === null) {
      return apiError(c, 503, 'LOGINS_NOT_CONFIGURED', 'Choosing a password is not set up yet.');
    }
    const body = await readJson(c, 2048);
    if (!body.ok) return body.response;
    const request = choosePasswordSchema.safeParse(body.value);
    if (!request.success) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        `Choose a password of at least ${String(MIN_PASSWORD_LENGTH)} characters.`,
      );
    }
    try {
      const result = await setOwnPassword(c.env, key, user.id, request.data.password);
      return result === 'saved'
        ? c.json({ saved: true })
        : apiError(c, 422, 'WEAK_PASSWORD', 'Supabase refused this password. Choose a longer one.');
    } catch (error) {
      if (!(error instanceof LoginServiceError)) throw error;
      console.error(
        `Supabase Auth refused a password in request ${c.get('requestId')}: status=${String(error.status)}`,
      );
      return apiError(
        c,
        502,
        'LOGIN_SERVICE_FAILED',
        'The password could not be saved. Try again.',
      );
    }
  });

  app.route('/counterparties', counterpartyRoutes(openDatabase));
  app.route('/facilities', facilityRoutes(openDatabase));
  app.route('/members', memberRoutes(openDatabase));
  app.route('/quotes', quoteRoutes(openDatabase));
  app.route('/commodities', commodityRoutes(openDatabase));
  app.route('/freight-quotes', freightRoutes(openDatabase));
  app.route('/fx-quotes', fxQuoteRoutes(openDatabase));

  return app;
}

export const app = createApp(postgresDatabase);

export default {
  fetch: app.fetch,
  // The Bank of Canada's USD/CAD rate, twice a day (wrangler.jsonc, triggers).
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshFxRates(env, postgresDatabase, new Date()));
  },
} satisfies ExportedHandler<ApiEnv['Bindings']>;
