import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';

const ENV = {
  SUPABASE_URL: 'https://example-project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  DATABASE_URL: 'postgresql://app_api.ref:secret@db.example.test:6543/postgres',
};
const USER_ID = '00000000-0000-4000-8000-00000000a11c';

function fakeDatabase(): Database & {
  memberships: ReturnType<typeof vi.fn<Database['memberships']>>;
  close: ReturnType<typeof vi.fn<Database['close']>>;
} {
  return {
    memberships: vi.fn<Database['memberships']>(() =>
      Promise.resolve([
        { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'trader' },
      ]),
    ),
    close: vi.fn<Database['close']>(() => Promise.resolve()),
  };
}

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

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
  db = fakeDatabase();
  openDatabase.mockClear();
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

  it('returns the verified user and their organizations', async () => {
    const fetchMock = mockAuthServer(Response.json({ id: USER_ID, email: 'alice@example.test' }));
    const res = await get('/api/v1/me', `Bearer ${valid}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      id: USER_ID,
      email: 'alice@example.test',
      organizations: [{ id: 'org-a', name: 'Synthetic Org A', role: 'trader' }],
    });
    expect(fetchMock).toHaveBeenCalledWith('https://example-project.supabase.co/auth/v1/user', {
      headers: { apikey: 'sb_publishable_test', Authorization: `Bearer ${valid}` },
    });
    expect(openDatabase).toHaveBeenCalledWith(ENV.DATABASE_URL);
    expect(db.memberships).toHaveBeenCalledWith(USER_ID);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('asks the database only about the verified user', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    await app.request(
      '/api/v1/me?user_id=00000000-0000-4000-8000-000000000b0b',
      {
        headers: {
          Authorization: `Bearer ${valid}`,
          'X-User-Id': '00000000-0000-4000-8000-000000000b0b',
        },
      },
      ENV,
    );

    expect(db.memberships).toHaveBeenCalledTimes(1);
    expect(db.memberships).toHaveBeenCalledWith(USER_ID);
  });

  it('does not open the database for a refused request', async () => {
    mockAuthServer(Response.json({ msg: 'invalid JWT' }, { status: 401 }));
    await get('/api/v1/me', `Bearer ${valid}`);

    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('reports a missing database configuration', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    const res = await app.request(
      '/api/v1/me',
      { headers: { Authorization: `Bearer ${valid}` } },
      { ...ENV, DATABASE_URL: '' },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'MISCONFIGURED' } });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('fails closed and still disconnects when the database errors', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    db.memberships.mockRejectedValueOnce(new Error('connection refused'));
    const res = await get('/api/v1/me', `Bearer ${valid}`);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
    expect(db.close).toHaveBeenCalledTimes(1);
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
      { SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', DATABASE_URL: ENV.DATABASE_URL },
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
