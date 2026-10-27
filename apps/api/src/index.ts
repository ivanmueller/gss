import { Hono } from 'hono';

import { requireUser } from './auth';
import { counterpartyRoutes } from './counterparties';
import { postgresDatabase } from './db';
import { facilityRoutes } from './facilities';
import { apiError, withDatabase, type ApiEnv, type DatabaseFactory } from './respond';

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
        organizations: organizations.map((m) => ({
          id: m.organizationId,
          name: m.organizationName,
          role: m.role,
        })),
      });
    });
  });

  app.route('/counterparties', counterpartyRoutes(openDatabase));
  app.route('/facilities', facilityRoutes(openDatabase));

  return app;
}

export const app = createApp(postgresDatabase);

export default app;
