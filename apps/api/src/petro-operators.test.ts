import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { OPERATORS_SCHEMA_VERSION } from './petro-operators';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// The operators route (F-302): every operator of what is stored, membership first, its names
// joined across the AER's lists. Made-up companies only.

let db = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);
const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });

const WITH_PETROLEUM = {
  ...ENV,
  PETROLEUM_DATABASE_URL: 'postgresql://petro_api.ref:secret@db.example.test:5432/postgres',
};
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  petroleum.schemaVersion.mockResolvedValue(OPERATORS_SCHEMA_VERSION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  petroleum = fakePetroleum();
  openPetroleum.mockClear();
});

describe('GET /api/v1/petroleum/operators', () => {
  it('sends a member every operator, joined across the lists, kept until it changes', async () => {
    petroleum.operators.mockResolvedValue([
      { source: 'wells', code: null, name: 'EXAMPLE ENERGY LTD.', count: 40 },
      { source: 'facilities', code: 'A0X1', name: 'Example Energy Ltd.', count: 5 },
      { source: 'pipelines', code: 'B0Y2', name: 'Sample Midstream Ltd.', count: 80 },
      { source: 'land', code: null, name: 'EXAMPLE ENERGY LTD.', count: 3 },
    ]);
    const res = await app.request('/api/v1/petroleum/operators', { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(await res.json()).toEqual({
      operators: [
        {
          name: 'Sample Midstream Ltd.',
          codes: ['B0Y2'],
          wells: 0,
          facilities: 0,
          pipelines: 80,
          land: 0,
        },
        {
          name: 'Example Energy Ltd.',
          codes: ['A0X1'],
          wells: 40,
          facilities: 5,
          pipelines: 0,
          land: 3,
        },
      ],
    });
    expect(petroleum.operators).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: 'org-a',
      role: 'trader',
      requestId: expect.any(String) as string,
    });
    const tag = res.headers.get('ETag') ?? '';
    const again = await app.request(
      '/api/v1/petroleum/operators',
      { headers: { ...AUTH, 'If-None-Match': tag } },
      WITH_PETROLEUM,
    );
    expect(again.status).toBe(304);
  });

  it('refuses a person who is not a member, without opening the oil and gas database', async () => {
    db.memberships.mockResolvedValueOnce([]);
    const res = await app.request('/api/v1/petroleum/operators', { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
    expect((await app.request('/api/v1/petroleum/operators', {}, WITH_PETROLEUM)).status).toBe(401);
  });

  it('waits for the migration it needs', async () => {
    petroleum.schemaVersion.mockResolvedValue(OPERATORS_SCHEMA_VERSION - 1);
    const res = await app.request('/api/v1/petroleum/operators', { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(503);
    expect(petroleum.operators).not.toHaveBeenCalled();
  });
});
