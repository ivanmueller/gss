import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { PRICES_SCHEMA_VERSION, pricesAnswer } from './petro-prices';
import type { PriceDbRow } from './petro-prices-db';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// The prices route (F-285): Alberta's royalty prices by month, membership first, in one answer
// the browser keeps. Made-up prices only.

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
const GAS = 'https://www.alberta.ca/alberta-natural-gas-reference-price';
const LETTER = 'https://inform.energy.gov.ab.ca/Documents/Published/IL-2030-43.pdf';

const row = (over: Partial<PriceDbRow>): PriceDbRow => ({
  series: 'gas_reference',
  month: '2030-01',
  price: '1.1100',
  unit: '$/GJ',
  source_url: GAS,
  ...over,
});
const LOAD = {
  loadedAt: '2030-02-01T15:30:00.000Z',
  prices: 3,
  firstMonth: '2030-01',
  lastMonth: '2031-01',
  unread: 1,
};

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  petroleum.schemaVersion.mockResolvedValue(PRICES_SCHEMA_VERSION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  petroleum = fakePetroleum();
  openPetroleum.mockClear();
});

describe('pricesAnswer', () => {
  it('lists the series in their own order, each month in order, each source once', () => {
    const answer = pricesAnswer(LOAD, [
      row({
        series: 'oil_light_par',
        month: '2031-01',
        price: '0.0000',
        unit: '$/m3',
        source_url: LETTER,
      }),
      row({ month: '2030-02', price: '2.2200' }),
      row({}),
    ]);
    expect(answer.sources).toEqual([LETTER, GAS]);
    expect(answer.series).toEqual([
      {
        key: 'gas_reference',
        name: 'Gas reference price',
        unit: '$/GJ',
        points: [
          ['2030-01', '1.1100', 1],
          ['2030-02', '2.2200', 1],
        ],
      },
      {
        key: 'oil_light_par',
        name: 'Light oil par price',
        unit: '$/m3',
        points: [['2031-01', '0.0000', 0]],
      },
    ]);
  });

  it('leaves out a series it does not know', () => {
    expect(pricesAnswer(null, [row({ series: 'gold' })]).series).toEqual([]);
  });
});

describe('GET /api/v1/petroleum/prices', () => {
  it('sends a member every price of the latest load, kept until it changes', async () => {
    petroleum.prices.mockResolvedValueOnce({ load: LOAD, rows: [row({})] });
    const res = await app.request('/api/v1/petroleum/prices', { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    const tag = res.headers.get('ETag');
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/);
    const body = await res.json<{ load: unknown; series: unknown[] }>();
    expect(body.load).toEqual(LOAD);
    expect(body.series).toHaveLength(1);
    expect(petroleum.prices).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: 'org-a',
      role: 'trader',
      requestId: expect.any(String) as string,
    });

    petroleum.prices.mockResolvedValueOnce({ load: LOAD, rows: [row({})] });
    const again = await app.request(
      '/api/v1/petroleum/prices',
      { headers: { ...AUTH, 'If-None-Match': tag ?? '' } },
      WITH_PETROLEUM,
    );
    expect(again.status).toBe(304);
  });

  it('refuses a person who is not a member, without opening the oil and gas database', async () => {
    db.memberships.mockResolvedValueOnce([]);
    const res = await app.request('/api/v1/petroleum/prices', { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
    expect((await app.request('/api/v1/petroleum/prices', {}, WITH_PETROLEUM)).status).toBe(401);
  });

  it('waits for the migration it needs', async () => {
    petroleum.schemaVersion.mockResolvedValue(18);
    const res = await app.request('/api/v1/petroleum/prices', { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'PETROLEUM_NOT_READY' } });
    expect(petroleum.prices).not.toHaveBeenCalled();
  });
});
