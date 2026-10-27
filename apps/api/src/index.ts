import { Hono } from 'hono';

import { type AuthBindings, type AuthUser, requireUser } from './auth';
import { type Database, postgresDatabase } from './db';

export interface ApiEnv {
  Bindings: AuthBindings & {
    /** Postgres URL for the `app_api` role (Worker secret). */
    DATABASE_URL?: string;
  };
  Variables: { user: AuthUser };
}

export type DatabaseFactory = (url: string) => Database;

export function createApp(openDatabase: DatabaseFactory) {
  const app = new Hono<ApiEnv>().basePath('/api/v1');

  // Public liveness probe. It reads nothing and returns no tenant or
  // environment data, so it needs no authentication.
  app.get('/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok', service: 'api' });
  });

  // Everything registered after this line requires a signed-in user with MFA,
  // including unknown paths, so a new route cannot be left public by mistake.
  app.use('*', requireUser);

  app.get('/me', async (c) => {
    const user = c.get('user');
    c.header('Cache-Control', 'no-store');
    if (!c.env.DATABASE_URL) {
      return c.json(
        { error: { code: 'MISCONFIGURED', message: 'The database is not configured.' } },
        500,
      );
    }
    const db = openDatabase(c.env.DATABASE_URL);
    try {
      const organizations = await db.memberships(user.id);
      return c.json({
        id: user.id,
        email: user.email,
        organizations: organizations.map((m) => ({
          id: m.organizationId,
          name: m.organizationName,
          role: m.role,
        })),
      });
    } catch {
      return c.json(
        { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' } },
        503,
      );
    } finally {
      await db.close();
    }
  });

  return app;
}

export const app = createApp(postgresDatabase);

export default app;
