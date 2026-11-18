import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import {
  PETROLEUM_SCHEMA_VERSION,
  type PetroleumDatabase,
  type PetroleumFactory,
} from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// The oil and gas database's routes (F-247-1): its readiness check, and the signed-in health
// check that loads the membership from grain's database before opening the oil and gas one.

function fakePetroleum() {
  return {
    schemaVersion: vi.fn<PetroleumDatabase['schemaVersion']>(() =>
      Promise.resolve(PETROLEUM_SCHEMA_VERSION),
    ),
    organizationSeen: vi.fn<PetroleumDatabase['organizationSeen']>((ctx) =>
      Promise.resolve(ctx.organizationId),
    ),
    close: vi.fn<PetroleumDatabase['close']>(() => Promise.resolve()),
  };
}

let db = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);
const app = createApp(openDatabase, { petroleum: openPetroleum });

const PETRO_URL = 'postgresql://petro_api.ref:secret@db.example.test:5432/postgres';
const WITH_PETROLEUM = { ...ENV, PETROLEUM_DATABASE_URL: PETRO_URL };
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db = fakeDatabase();
  petroleum = fakePetroleum();
  openDatabase.mockClear();
  openPetroleum.mockClear();
});

describe('GET /api/v1/petroleum/ready', () => {
  it('answers ok without sign-in once the database is reachable and migrated', async () => {
    const res = await app.request('/api/v1/petroleum/ready', {}, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'petroleum' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(openPetroleum).toHaveBeenCalledWith(PETRO_URL, { viaHyperdrive: false });
    expect(openDatabase).not.toHaveBeenCalled();
    expect(petroleum.close).toHaveBeenCalled();
  });

  it('prefers the Hyperdrive binding', async () => {
    const env = { ...WITH_PETROLEUM, PETROLEUM: { connectionString: 'postgresql://hyperdrive/x' } };
    expect((await app.request('/api/v1/petroleum/ready', {}, env)).status).toBe(200);
    expect(openPetroleum).toHaveBeenCalledWith('postgresql://hyperdrive/x', {
      viaHyperdrive: true,
    });
  });

  it('says "not set up" without a binding or URL, and grain is untouched', async () => {
    const res = await app.request('/api/v1/petroleum/ready', {}, ENV);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'PETROLEUM_NOT_SET_UP' } });
    expect(openPetroleum).not.toHaveBeenCalled();
    expect((await app.request('/api/v1/health', {}, ENV)).status).toBe(200);
  });

  it('answers 503 and logs no message when the database is unreachable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    petroleum.schemaVersion.mockRejectedValueOnce(
      Object.assign(new Error('connect to secret-host failed: timeout'), {
        code: 'CONNECT_TIMEOUT',
      }),
    );
    const res = await app.request('/api/v1/petroleum/ready', {}, WITH_PETROLEUM);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
    const line = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(line).toMatch(/database=petroleum code=CONNECT_TIMEOUT kind=timeout/);
    expect(line).not.toMatch(/secret-host/);
  });

  // F-247-1-R3-01: a database behind the schema version this code needs is "not ready", on every
  // oil and gas route, so new code never runs against an old schema after a failed migration.
  it('answers "not ready" while the database is behind the schema version the code needs', async () => {
    petroleum.schemaVersion.mockResolvedValue(PETROLEUM_SCHEMA_VERSION - 1);
    const res = await app.request('/api/v1/petroleum/ready', {}, WITH_PETROLEUM);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'PETROLEUM_NOT_READY' } });
    const health = await app.request(
      '/api/v1/petroleum/health',
      { headers: { Authorization: `Bearer ${VALID_TOKEN}` } },
      WITH_PETROLEUM,
    );
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ error: { code: 'PETROLEUM_NOT_READY' } });
    expect(petroleum.organizationSeen).not.toHaveBeenCalled();
  });

  it('accepts a database ahead of the code (a newer migration applied first)', async () => {
    petroleum.schemaVersion.mockResolvedValue(PETROLEUM_SCHEMA_VERSION + 1);
    expect((await app.request('/api/v1/petroleum/ready', {}, WITH_PETROLEUM)).status).toBe(200);
  });
});

describe('GET /api/v1/petroleum/health', () => {
  it('requires sign-in, as every other oil and gas path', async () => {
    for (const path of ['/api/v1/petroleum/health', '/api/v1/petroleum/no-such-path']) {
      const res = await app.request(path, {}, WITH_PETROLEUM);
      expect(res.status).toBe(401);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('tells the oil and gas database who is asking, from the membership in grain', async () => {
    db.memberships.mockResolvedValueOnce([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
    const res = await app.request('/api/v1/petroleum/health', { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(db.memberships).toHaveBeenCalledWith(USER_ID);
    expect(petroleum.organizationSeen).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: 'org-a',
      role: 'viewer',
      requestId: expect.any(String) as string,
    });
  });

  it('refuses a signed-in person with no active membership and never opens the database', async () => {
    db.memberships.mockResolvedValueOnce([]);
    const res = await app.request('/api/v1/petroleum/health', { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses an organization the person does not belong to, without opening the database', async () => {
    const res = await app.request(
      '/api/v1/petroleum/health?organization_id=org-b',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('answers 503 when the database sees another organization, and when it is not set up', async () => {
    petroleum.organizationSeen.mockResolvedValueOnce(null);
    expect(
      (await app.request('/api/v1/petroleum/health', { headers: AUTH }, WITH_PETROLEUM)).status,
    ).toBe(503);
    const res = await app.request('/api/v1/petroleum/health', { headers: AUTH }, ENV);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'PETROLEUM_NOT_SET_UP' } });
  });
});
