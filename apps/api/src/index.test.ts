import { afterEach, describe, expect, it, vi } from 'vitest';

import { app } from './index';

const ENV = {
  SUPABASE_URL: 'https://example-project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};
const USER_ID = '00000000-0000-4000-8000-00000000a11c';

/** An unsigned token with the given claims; only Supabase Auth (mocked here) judges validity. */
function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.signature`;
}

function mockAuthServer(response: Response | Error) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function get(path: string, authorization?: string) {
  const headers: Record<string, string> = authorization ? { Authorization: authorization } : {};
  return app.request(path, { headers }, ENV);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/v1/health', () => {
  it('returns ok as uncached JSON without authentication', async () => {
    const fetchMock = mockAuthServer(new Error('must not be called'));
    const res = await get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', service: 'api' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is read-only', async () => {
    const res = await app.request('/api/v1/health', { method: 'POST' }, ENV);

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/me', () => {
  const valid = token({ sub: USER_ID, aal: 'aal2' });

  it('returns the user when Supabase accepts an aal2 token', async () => {
    const fetchMock = mockAuthServer(Response.json({ id: USER_ID, email: 'alice@example.test' }));
    const res = await get('/api/v1/me', `Bearer ${valid}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ id: USER_ID, email: 'alice@example.test' });
    expect(fetchMock).toHaveBeenCalledWith('https://example-project.supabase.co/auth/v1/user', {
      headers: { apikey: 'sb_publishable_test', Authorization: `Bearer ${valid}` },
    });
  });

  it('rejects a request without a token', async () => {
    const fetchMock = mockAuthServer(new Error('must not be called'));
    const res = await get('/api/v1/me');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([`Basic ${valid}`, 'Bearer', 'Bearer not a token', `bearer ${valid}`])(
    'rejects a malformed Authorization header (%s)',
    async (header) => {
      mockAuthServer(new Error('must not be called'));
      expect((await get('/api/v1/me', header)).status).toBe(401);
    },
  );

  it.each([401, 403])('rejects a token Supabase refuses with %i', async (status) => {
    mockAuthServer(Response.json({ msg: 'invalid JWT' }, { status }));
    const res = await get('/api/v1/me', `Bearer ${valid}`);

    expect(res.status).toBe(401);
  });

  it('rejects a token whose subject is not the user Supabase returns', async () => {
    mockAuthServer(Response.json({ id: '00000000-0000-4000-8000-000000000b0b' }));
    const res = await get('/api/v1/me', `Bearer ${valid}`);

    expect(res.status).toBe(401);
  });

  it('requires two-factor authentication (aal2)', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    const res = await get('/api/v1/me', `Bearer ${token({ sub: USER_ID, aal: 'aal1' })}`);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'MFA_REQUIRED', message: 'Complete two-factor authentication first.' },
    });
  });

  it('rejects a token without an assurance level', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    const res = await get('/api/v1/me', `Bearer ${token({ sub: USER_ID })}`);

    expect(res.status).toBe(403);
  });

  it('fails closed when the sign-in service is unreachable', async () => {
    mockAuthServer(new TypeError('network down'));
    const res = await get('/api/v1/me', `Bearer ${valid}`);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'AUTH_UNAVAILABLE' } });
  });

  it('fails closed when the sign-in service errors', async () => {
    mockAuthServer(new Response('upstream error', { status: 502 }));
    expect((await get('/api/v1/me', `Bearer ${valid}`)).status).toBe(503);
  });

  it('refuses to run without configuration', async () => {
    mockAuthServer(new Error('must not be called'));
    const res = await app.request(
      '/api/v1/me',
      { headers: { Authorization: `Bearer ${valid}` } },
      { SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' },
    );

    expect(res.status).toBe(500);
  });
});

describe('unknown routes', () => {
  it('require authentication instead of revealing whether they exist', async () => {
    mockAuthServer(new Error('must not be called'));
    expect((await get('/api/v1/nope')).status).toBe(401);
  });

  it('return 404 to an authenticated user', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    const res = await get('/api/v1/nope', `Bearer ${token({ sub: USER_ID, aal: 'aal2' })}`);

    expect(res.status).toBe(404);
  });

  it('outside /api/v1 are not served by the API', async () => {
    expect((await get('/health')).status).toBe(404);
  });
});
