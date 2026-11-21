import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import type { PetroleumFactory } from './petroleum-db';
import { parseUwi, PRODUCTION_SCHEMA_VERSION, productionAnswer } from './production';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// Monthly production by well (F-252 step 3). Made-up volumes only.

const env = {
  ...ENV,
  DATABASE_URL: 'postgresql://app_api:x@db.example.test/postgres',
  PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
};
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };
const UWI = '00/11-23-030-27W4/2';
const WELL = `/api/v1/petroleum/production/well?uwi=${encodeURIComponent(UWI)}`;
const FORMATION = '/api/v1/petroleum/production/formation?formation=duvernay';
const LOAD = {
  loadedAt: '2026-11-20T22:00:00.000Z',
  formation: 'duvernay',
  firstMonth: '2022-01',
  lastMonth: '2026-09',
};

let grain = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => grain);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);

beforeEach(() => {
  grain = fakeDatabase();
  petroleum = fakePetroleum();
  petroleum.schemaVersion.mockResolvedValue(PRODUCTION_SCHEMA_VERSION);
  openPetroleum.mockClear();
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
});

describe('parseUwi', () => {
  it('takes a well identifier and refuses anything else', () => {
    expect(parseUwi(` ${UWI} `)).toEqual({ uwi: UWI });
    for (const raw of [undefined, '', 'abc', "00/11-23-030-27W4/2'; --", '100112303027W402']) {
      expect(parseUwi(raw)).toMatch(/well identifier/);
    }
  });
});

describe('productionAnswer', () => {
  it('names the source, its units and the months the load covers', () => {
    const answer = productionAnswer(LOAD, []);
    expect(answer.source.name).toMatch(/Petrinex.*Government of Alberta/);
    expect(answer.source).toMatchObject({ firstMonth: '2022-01', lastMonth: '2026-09' });
    expect(answer.units).toEqual({ oil: 'm3', gas: 'e3m3', water: 'm3', condensate: 'm3' });
    expect(productionAnswer(null, []).source.loadedAt).toBeNull();
  });
});

describe('GET /api/v1/petroleum/production', () => {
  const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });
  const viewer = () => {
    grain.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
  };

  it('refuses a non-member without opening the oil and gas database', async () => {
    for (const path of [WELL, FORMATION]) {
      grain.memberships.mockResolvedValueOnce([]);
      const res = await app.request(path, { headers: AUTH }, env);
      expect(res.status).toBe(403);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses a bad well identifier before any database', async () => {
    const res = await app.request(
      '/api/v1/petroleum/production/well?uwi=nope',
      { headers: AUTH },
      env,
    );
    expect(res.status).toBe(400);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('waits for its migration', async () => {
    viewer();
    petroleum.schemaVersion.mockResolvedValue(PRODUCTION_SCHEMA_VERSION - 1);
    const res = await app.request(WELL, { headers: AUTH }, env);
    expect(res.status).toBe(503);
    expect(petroleum.wellProduction).not.toHaveBeenCalled();
  });

  it("gives a viewer a well's months, asked as that member", async () => {
    viewer();
    const months = [
      { month: '2026-08', oil: 310.5, gas: 120.25, water: null, condensate: null, hours: 744 },
    ];
    petroleum.wellProduction.mockResolvedValue({ load: LOAD, months });
    const res = await app.request(WELL, { headers: AUTH }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json<ReturnType<typeof productionAnswer>>();
    expect(body.months).toEqual(months);
    expect(body.source.lastMonth).toBe('2026-09');
    expect(petroleum.wellProduction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      UWI,
    );
  });

  it("gives the formation's total by month", async () => {
    viewer();
    const months = [
      { month: '2026-08', oil: 1000, gas: 5000, water: 300, condensate: 50, wells: 12 },
    ];
    petroleum.formationProduction.mockResolvedValue({ load: LOAD, months });
    const res = await app.request(FORMATION, { headers: AUTH }, env);
    expect(res.status).toBe(200);
    expect((await res.json<ReturnType<typeof productionAnswer>>()).months).toEqual(months);
    expect(petroleum.formationProduction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a' }),
      'duvernay',
    );
  });

  it('refuses a total without the key of a play', async () => {
    for (const query of ['', '?formation=Not%20A%20Key']) {
      const res = await app.request(
        `/api/v1/petroleum/production/formation${query}`,
        { headers: AUTH },
        env,
      );
      expect(res.status).toBe(400);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
  });
});
