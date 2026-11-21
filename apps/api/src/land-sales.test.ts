import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import {
  LAND_SALES_MAX,
  LAND_SALES_SCHEMA_VERSION,
  landSalesAnswer,
  type landSaleSummaryAnswer,
  parseSince,
} from './land-sales';
import type { LandSaleParcelRow } from './land-sales-db';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// Crown land sales on the oil and gas map (F-242). Made-up parcels, buyers and prices only.

const env = {
  ...ENV,
  DATABASE_URL: 'postgresql://app_api:x@db.example.test/postgres',
  PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
};
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };
const BOX = 'west=-117&south=54&east=-116&north=55';

const parcel = (id: string): LandSaleParcelRow => ({
  id,
  saleDate: '2026-11-04',
  contractNo: 'A0001',
  contractType: 'LEASE',
  region: 'PLAINS',
  hectares: '256.0000',
  zone: 'PETROLEUM AND NATURAL GAS FROM SURFACE TO BASEMENT',
  land: '51806024',
  inexact: false,
  status: 'ACCEPTED',
  bonus: '56888.32',
  dollarsPerHectare: '222.22',
  buyers: 'EXAMPLE LAND LTD. 100%',
  shape: [
    [
      [
        [-116.1, 54],
        [-116, 54],
        [-116, 54.1],
        [-116.1, 54],
      ],
    ],
  ],
});

let grain = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => grain);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);

beforeEach(() => {
  grain = fakeDatabase();
  petroleum = fakePetroleum();
  petroleum.schemaVersion.mockResolvedValue(LAND_SALES_SCHEMA_VERSION);
  openPetroleum.mockClear();
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
});

describe('parseSince', () => {
  it('reads a date, or none', () => {
    expect(parseSince(undefined)).toEqual({ since: null });
    expect(parseSince(' 2024-11-22 ')).toEqual({ since: '2024-11-22' });
  });

  it('refuses what is no date', () => {
    expect(typeof parseSince('2024-02-30')).toBe('string');
    expect(typeof parseSince('last year')).toBe('string');
  });
});

describe('landSalesAnswer', () => {
  it('names the department and cuts a full view', () => {
    const many = Array.from({ length: LAND_SALES_MAX + 1 }, (_, i) => parcel(String(i)));
    const answer = landSalesAnswer(null, many);
    expect(answer.source.name).toContain('Alberta Energy and Minerals');
    expect(answer.truncated).toBe(true);
    expect(answer.parcels).toHaveLength(LAND_SALES_MAX);
    expect(landSalesAnswer(null, [parcel('1')]).truncated).toBe(false);
  });
});

describe('GET /api/v1/petroleum/land-sales', () => {
  const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });
  const viewer = () => {
    grain.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
  };
  const get = (path: string) => app.request(`/api/v1/petroleum/${path}`, { headers: AUTH }, env);

  it('refuses a non-member without opening the oil and gas database', async () => {
    grain.memberships.mockResolvedValue([]);
    expect((await get(`land-sales?${BOX}`)).status).toBe(403);
    expect((await get('land-sales/summary')).status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses a bad box, play or date before any database', async () => {
    expect((await get('land-sales?west=1')).status).toBe(400);
    expect((await get(`land-sales?${BOX}&rights=montney`)).status).toBe(400);
    expect((await get('land-sales/summary?since=soon')).status).toBe(400);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('waits for its migration', async () => {
    viewer();
    petroleum.schemaVersion.mockResolvedValue(LAND_SALES_SCHEMA_VERSION - 1);
    expect((await get(`land-sales?${BOX}`)).status).toBe(503);
    expect(petroleum.landSales).not.toHaveBeenCalled();
  });

  it('gives a viewer the parcels in the box, asked as that member with the filters', async () => {
    viewer();
    petroleum.landSales.mockResolvedValue({
      load: {
        loadedAt: '2026-11-21T20:00:00.000Z',
        firstSale: '2003-01-08',
        lastSale: '2026-12-16',
        area: { west: -118.75, south: 51.57, east: -112.9, north: 55.28 },
      },
      parcels: [parcel('7')],
    });
    const res = await get(`land-sales?${BOX}&rights=duvernay&since=2024-11-22`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json<ReturnType<typeof landSalesAnswer>>();
    expect(body.parcels).toEqual([parcel('7')]);
    expect(body.source).toMatchObject({ firstSale: '2003-01-08', lastSale: '2026-12-16' });
    expect(petroleum.landSales).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      { west: -117, south: 54, east: -116, north: 55 },
      { zonePattern: expect.stringContaining('IN THE DUVERNAY') as string, since: '2024-11-22' },
      LAND_SALES_MAX,
    );
  });

  it('gives the totals as the database summed them, money as text', async () => {
    viewer();
    petroleum.landSaleSummary.mockResolvedValue({
      offered: 3,
      sold: 2,
      bonus: '66888.32',
      hectaresSold: '512.0000',
      averagePerHectare: '130.64',
      highPerHectare: '222.22',
      nextSale: { date: '2026-12-02', parcels: 4 },
      quarters: [{ quarter: '2026-Q4', bonus: '66888.32', sold: 2 }],
    });
    const res = await get('land-sales/summary');
    expect(res.status).toBe(200);
    const body = await res.json<ReturnType<typeof landSaleSummaryAnswer>>();
    expect(body).toMatchObject({
      currency: 'CAD',
      sold: 2,
      bonus: '66888.32',
      averagePerHectare: '130.64',
      nextSale: { date: '2026-12-02', parcels: 4 },
    });
    expect(petroleum.landSaleSummary).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a' }),
      { zonePattern: null, since: null },
    );
  });
});
