import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { FRAC_SCHEMA_VERSION, fracAnswer, parseLicence } from './petro-frac';
import type { FracDbRow } from './petro-frac-db';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// The frac route (F-288): the AER's frac data of one licence's well events, membership first.
// Made-up wells only.

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
const PATH = '/api/v1/petroleum/frac/licence?licence=0999999';

const ROW: FracDbRow = {
  uwi: '00/11-23-030-27W4/0',
  first_frac_date: '2030-01-02',
  last_frac_date: '2030-01-20',
  fracs: 1,
  stages: 30,
  water_m3: '40000.500',
  proppant_t: '4784.900',
  upgrade_hint_t: '0.000',
  refrac_proppant_t: '0.000',
  max_tvd_m: '2233.00',
  suspect: false,
};
const LOAD = { loadedAt: '2030-02-01T15:30:00.000Z', sourceDate: '2030-01-28', wells: 1 };

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  petroleum.schemaVersion.mockResolvedValue(FRAC_SCHEMA_VERSION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  petroleum = fakePetroleum();
  openPetroleum.mockClear();
});

describe('fracAnswer', () => {
  it('names the AER and gives each well event as stored', () => {
    const answer = fracAnswer(LOAD, [ROW]);
    expect(answer.source).toMatchObject({
      loadedAt: LOAD.loadedAt,
      sourceDate: '2030-01-28',
      page: expect.stringMatching(/^https:\/\/www\.aer\.ca\//) as string,
    });
    expect(answer.source.name).toContain('Alberta Energy Regulator');
    expect(answer.wells).toEqual([
      {
        uwi: ROW.uwi,
        firstFracDate: '2030-01-02',
        lastFracDate: '2030-01-20',
        fracs: 1,
        stages: 30,
        waterM3: '40000.500',
        proppantT: '4784.900',
        upgradeHintT: '0.000',
        refracProppantT: '0.000',
        maxTvdM: '2233.00',
        suspect: false,
      },
    ]);
    expect(fracAnswer(null, []).source.loadedAt).toBeNull();
  });

  it('takes only a licence number', () => {
    expect(parseLicence(' 0509395 ')).toEqual({ licence: '0509395' });
    expect(typeof parseLicence('05093;95')).toBe('string');
    expect(typeof parseLicence(undefined)).toBe('string');
  });
});

describe('GET /api/v1/petroleum/frac/licence', () => {
  it("sends a member the licence's well events", async () => {
    petroleum.fracOfLicence.mockResolvedValueOnce({ load: LOAD, rows: [ROW] });
    const res = await app.request(PATH, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    const body = await res.json<{ wells: unknown[] }>();
    expect(body.wells).toHaveLength(1);
    expect(petroleum.fracOfLicence).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organizationId: 'org-a',
        role: 'trader',
        requestId: expect.any(String) as string,
      },
      '0999999',
    );
  });

  it('refuses a malformed licence, and a person who is not a member', async () => {
    const bad = await app.request(
      '/api/v1/petroleum/frac/licence?licence=x%27',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(bad.status).toBe(400);
    db.memberships.mockResolvedValueOnce([]);
    const res = await app.request(PATH, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
    expect((await app.request(PATH, {}, WITH_PETROLEUM)).status).toBe(401);
  });

  it('waits for the migration it needs', async () => {
    petroleum.schemaVersion.mockResolvedValue(19);
    const res = await app.request(PATH, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'PETROLEUM_NOT_READY' } });
    expect(petroleum.fracOfLicence).not.toHaveBeenCalled();
  });
});
