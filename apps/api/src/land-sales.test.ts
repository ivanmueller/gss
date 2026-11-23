import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { clearLandRightsZones } from './land';
import { createApp } from './index';
import {
  LAND_SALES_MAX,
  LAND_SALES_SCHEMA_VERSION,
  landSalesAnswer,
  type landSaleSummaryAnswer,
  parseSince,
  saleDocuments,
} from './land-sales';
import type { LandSaleParcelRow } from './land-sales-db';
import type { PetroleumFactory } from './petroleum-db';
import { PLAY_OUTLINES } from './play-outlines';
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
  restrictions: 'SHA010301 SHA010401',
  reversionZones: 'D00004',
  tractRights: ['PETROLEUM AND NATURAL GAS FROM SURFACE; TO BASEMENT'],
  heldAgreement: '0126110001',
  heldBy: 'SAMPLE RESOURCES INC.',
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
  clearLandRightsZones();
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

describe('saleDocuments (F-265)', () => {
  const kept = {
    '2026-11-04': {
      notice: '/download/?s=png&id=20261104PON&ft=.pdf',
      results: '/download/?s=png&id=20261104PSR&ft=.pdf',
    },
    '2004-01-07': { notice: '/download/?s=png&id=20040107PON&ft=.PDF&y=2004' },
    '2026-12-02': { notice: 'https://example.test/notice.pdf', results: 7 },
    '2020-01-08': { notice: '/download/?s=png&id=20200108PON&ft=.pdf&y=2020' },
  };

  it('gives the addresses of the sales asked for, on the department\u2019s site', () => {
    expect(saleDocuments(kept, ['2026-11-04', '2026-11-04', '2004-01-07'])).toEqual({
      '2026-11-04': {
        notice: 'https://content2.energy.alberta.ca/download/?s=png&id=20261104PON&ft=.pdf',
        results: 'https://content2.energy.alberta.ca/download/?s=png&id=20261104PSR&ft=.pdf',
      },
      '2004-01-07': {
        notice: 'https://content2.energy.alberta.ca/download/?s=png&id=20040107PON&ft=.PDF&y=2004',
        results: null,
      },
    });
  });

  it('links nothing in another form, and nothing when the load kept no documents', () => {
    expect(saleDocuments(kept, ['2026-12-02', '1999-01-01', 'toString'])).toEqual({});
    expect(saleDocuments(null, ['2026-11-04'])).toEqual({});
    expect(saleDocuments('x', ['2026-11-04'])).toEqual({});
  });

  it('goes with the parcels sent: the documents of their sales only', () => {
    const load = {
      loadedAt: '2026-11-22T00:00:00.000Z',
      firstSale: '2003-01-08',
      lastSale: '2026-12-02',
      area: { west: -117, south: 53, east: -115, north: 55 },
      documents: kept,
    };
    expect(Object.keys(landSalesAnswer(load, [parcel('1')]).documents)).toEqual(['2026-11-04']);
    expect(landSalesAnswer(null, [parcel('1')]).documents).toEqual({});
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
    expect((await get(`land-sales?${BOX}&until=later`)).status).toBe(400);
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
        documents: { '2026-11-04': { notice: '/download/?s=png&id=20261104PON&ft=.pdf' } },
      },
      parcels: [parcel('7')],
    });
    const zone = 'PETROLEUM AND NATURAL GAS IN THE DUVERNAY FM';
    petroleum.landZones.mockResolvedValue([
      { zone, hash: 'abc' },
      { zone: 'PETROLEUM AND NATURAL GAS IN THE EXAMPLE FM', hash: 'def' },
    ]);
    const res = await get(`land-sales?${BOX}&rights=duvernay&since=2024-11-22`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    const body = await res.json<ReturnType<typeof landSalesAnswer>>();
    expect(body.parcels).toEqual([parcel('7')]);
    expect(body.source).toMatchObject({ firstSale: '2003-01-08', lastSale: '2026-12-16' });
    // The sale's notice as a link to the department's own site (F-265).
    expect(body.documents).toEqual({
      '2026-11-04': {
        notice: 'https://content2.energy.alberta.ca/download/?s=png&id=20261104PON&ft=.pdf',
        results: null,
      },
    });
    expect(petroleum.landSales).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      { west: -117, south: 54, east: -116, north: 55 },
      // With a play's rights, only the parcels inside its outline (F-264).
      { zones: ['abc'], since: '2024-11-22', until: null, outline: PLAY_OUTLINES.duvernay },
      LAND_SALES_MAX,
    );
    // Without, every parcel of the box.
    await get(`land-sales?${BOX}`);
    expect(petroleum.landSales).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      { zones: null, since: null, until: null, outline: null },
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
      sales: [{ date: '2026-12-02', parcels: 4, sold: 0, held: false }],
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
      sales: [{ date: '2026-12-02', parcels: 4, sold: 0, held: false }],
    });
    expect(petroleum.landSaleSummary).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a' }),
      { zones: null, since: null, until: null, outline: null },
    );
    // One sale's totals: from its day to the day after (F-267).
    await get('land-sales/summary?since=2026-11-18&until=2026-11-19');
    expect(petroleum.landSaleSummary).toHaveBeenLastCalledWith(expect.anything(), {
      zones: null,
      since: '2026-11-18',
      until: '2026-11-19',
      outline: null,
    });
  });
});
