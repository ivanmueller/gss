import { describe, expect, it } from 'vitest';

import { app } from './index';

describe('GET /api/v1/health', () => {
  it('returns ok as uncached JSON', async () => {
    const res = await app.request('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', service: 'api' });
  });

  it('is read-only', async () => {
    const res = await app.request('/api/v1/health', { method: 'POST' });

    expect(res.status).toBe(404);
  });
});

describe('unknown routes', () => {
  it('return 404', async () => {
    expect((await app.request('/api/v1/nope')).status).toBe(404);
    expect((await app.request('/health')).status).toBe(404);
  });
});
