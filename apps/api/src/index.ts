import { Hono } from 'hono';

import { type AuthEnv, requireUser } from './auth';

export const app = new Hono<AuthEnv>().basePath('/api/v1');

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
  return c.json({ id: user.id, email: user.email });
});

export default app;
