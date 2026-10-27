import { afterEach, describe, expect, it, vi } from 'vitest';

import { postgresDatabase, type Database } from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, token, USER_ID } from './testing/helpers';

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

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
    const fetchMock = mockAuthServer(
      Response.json({
        id: USER_ID,
        email: 'alice@example.test',
        user_metadata: { first_name: ' Alice ', last_name: 'Synthetic' },
      }),
    );
    const res = await get('/api/v1/me', `Bearer ${valid}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      id: USER_ID,
      email: 'alice@example.test',
      firstName: 'Alice',
      lastName: 'Synthetic',
      organizations: [{ id: 'org-a', name: 'Synthetic Org A', role: 'trader' }],
    });
    expect(fetchMock).toHaveBeenCalledWith('https://example-project.supabase.co/auth/v1/user', {
      headers: { apikey: 'sb_publishable_test', Authorization: `Bearer ${valid}` },
    });
    expect(openDatabase).toHaveBeenCalledWith(ENV.DATABASE_URL, { viaHyperdrive: false });
    expect(db.memberships).toHaveBeenCalledWith(USER_ID);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('returns no name when the user has none or it is unusable', async () => {
    mockAuthServer(
      Response.json({ id: USER_ID, user_metadata: { first_name: '   ', last_name: 42 } }),
    );
    const res = await get('/api/v1/me', `Bearer ${valid}`);

    expect(await res.json()).toMatchObject({ firstName: null, lastName: null });
  });

  it('uses the Hyperdrive binding when the Worker has one', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    const hyperdrive = 'postgresql://app_api:local@hyperdrive.example.test:5432/postgres';
    await app.request(
      '/api/v1/me',
      { headers: { Authorization: `Bearer ${valid}` } },
      { ...ENV, HYPERDRIVE: { connectionString: hyperdrive } },
    );

    expect(openDatabase).toHaveBeenCalledWith(hyperdrive, { viaHyperdrive: true });
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
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.memberships.mockRejectedValueOnce(new Error('connection refused'));
    const res = await get('/api/v1/me', `Bearer ${valid}`);
    vi.restoreAllMocks();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      Object.assign(new Error('password authentication failed for user "app_api"'), {
        code: '28P01',
      }),
      'code=28P01 kind=authentication',
    ],
    [
      Object.assign(new Error('Tenant or user not found'), { code: 'XX000' }),
      'code=XX000 kind=unknown_user',
    ],
    [
      new Error('TLS handshake failed: invalid peer certificate: UnknownIssuer'),
      'code=none kind=tls',
    ],
    [
      Object.assign(new Error('write CONNECT_TIMEOUT db.example.test:6543'), {
        code: 'CONNECT_TIMEOUT',
      }),
      'code=CONNECT_TIMEOUT kind=timeout',
    ],
    [
      Object.assign(new Error('postgresql://u:secret@h'), { code: 'not a code' }),
      'code=none kind=other',
    ],
    [new Error('internal error; reference = abc123'), 'code=none kind=runtime_socket'],
  ])('logs why the database failed, without the message (%s)', async (error, summary) => {
    mockAuthServer(Response.json({ id: USER_ID }));
    const logged: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(...args);
    });
    db.memberships.mockRejectedValueOnce(error);
    const res = await get('/api/v1/me', `Bearer ${valid}`);
    vi.restoreAllMocks();

    expect(res.status).toBe(503);
    expect(logged).toEqual([
      `Database unavailable in request ${res.headers.get('x-request-id') ?? ''}: ${summary}`,
    ]);
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

describe('a malformed database URL', () => {
  it('answers MISCONFIGURED without logging or returning the URL', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    const logged: unknown[] = [];
    for (const method of ['error', 'warn', 'log', 'info'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    const real = createApp(postgresDatabase);
    const res = await real.request(
      '/api/v1/me',
      { headers: { Authorization: `Bearer ${token({ sub: USER_ID, aal: 'aal2' })}` } },
      {
        ...ENV,
        DATABASE_URL: 'postgresql://app_api:synthetic-leak-check@[not-a-host:6543/postgres',
      },
    );
    const body = await res.text();
    vi.restoreAllMocks();

    expect(res.status).toBe(500);
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'MISCONFIGURED' } });
    expect(body).not.toContain('synthetic-leak-check');
    expect(JSON.stringify(logged, Object.getOwnPropertyNames(new Error()))).not.toContain(
      'synthetic-leak-check',
    );
    expect(logged.map(String).join(' ')).not.toContain('synthetic-leak-check');
  });
});

describe('an unexpected error', () => {
  it('is answered as JSON and logged by type only', async () => {
    mockAuthServer(Response.json({ id: USER_ID }));
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(...args);
    });
    // A failure no handler catches: disconnecting throws an error that carries a secret.
    const leaky = fakeDatabase();
    leaky.close.mockRejectedValueOnce(
      Object.assign(new Error('synthetic-leak-check'), { input: 'synthetic-leak-check' }),
    );
    const failing = createApp(() => leaky);
    const res = await failing.request(
      '/api/v1/me',
      { headers: { Authorization: `Bearer ${token({ sub: USER_ID, aal: 'aal2' })}` } },
      ENV,
    );
    vi.restoreAllMocks();

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    });
    expect(body).not.toContain('synthetic-leak-check');
    expect(errors).toEqual([`Unhandled Error in request ${res.headers.get('x-request-id') ?? ''}`]);
  });
});
