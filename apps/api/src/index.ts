import { Hono } from 'hono';

export const app = new Hono().basePath('/api/v1');

// Public liveness probe. It reads nothing and returns no tenant or
// environment data, so it needs no authentication.
app.get('/health', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ status: 'ok', service: 'api' });
});

export default app;
