import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import {
  LAND_MAX,
  LAND_SCHEMA_VERSION,
  landAnswer,
  landLimits,
  parseLandKinds,
  parseLandRights,
} from './land';
import type { LandAgreementRow, LandFreeholdRow } from './land-db';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// Land held today on the oil and gas map (F-241). Made-up land only.

const env = {
  ...ENV,
  DATABASE_URL: 'postgresql://app_api:x@db.example.test/postgres',
  PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
};
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };
const BOX = 'west=-117&south=54&east=-116&north=55';
const SHAPE: LandAgreementRow['shape'] = [
  [
    [
      [-116.1, 54],
      [-116, 54],
      [-116, 54.1],
      [-116.1, 54],
    ],
  ],
];

const agreement = (id: string): LandAgreementRow => ({
  id,
  rights: 'png',
  agreementType: '002',
  agreementNumber: '924',
  tract: '00',
  group: 'LEASE',
  status: 'ACTIVE',
  vintage: null,
  holder: 'EXAMPLE ENERGY LTD.',
  parties: 'EXAMPLE ENERGY LTD. 100%',
  zone: 'PNG TO BASE EXAMPLE',
  areaHa: 256,
  termDate: '2020-02-17',
  continuationDate: null,
  expiryText: 'INDEFINITE',
  shape: SHAPE,
});
const freehold = (id: string): LandFreeholdRow => ({
  id,
  substances: 'ALL MINERALS',
  nationalPark: null,
  reserveNumber: null,
  reserveName: null,
  shape: SHAPE,
});

let grain = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => grain);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);

beforeEach(() => {
  grain = fakeDatabase();
  petroleum = fakePetroleum();
  petroleum.schemaVersion.mockResolvedValue(LAND_SCHEMA_VERSION);
  openPetroleum.mockClear();
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
});

describe('parseLandKinds', () => {
  it('reads the kinds asked for, in the usual order', () => {
    expect(parseLandKinds('freehold, agreements')).toEqual(['agreements', 'freehold']);
    expect(parseLandKinds('offsets')).toEqual(['offsets']);
  });

  it('refuses none, or a kind it does not know', () => {
    expect(typeof parseLandKinds(undefined)).toBe('string');
    expect(typeof parseLandKinds(' , ')).toBe('string');
    expect(typeof parseLandKinds('agreements,coal')).toBe('string');
  });
});

describe('parseLandRights', () => {
  it('reads a play, or none', () => {
    expect(parseLandRights(undefined)).toEqual({ pattern: null });
    expect(parseLandRights('duvernay')).toEqual({
      pattern: expect.stringContaining('IN THE DUVERNAY') as string,
    });
  });

  it('refuses a play it does not know', () => {
    expect(typeof parseLandRights('montney')).toBe('string');
    expect(typeof parseLandRights('constructor')).toBe('string');
  });
});

describe('landLimits and landAnswer', () => {
  it('asks only for the kinds named', () => {
    expect(landLimits(['offsets'])).toEqual({
      agreements: 0,
      offsets: LAND_MAX.offsets,
      freehold: 0,
    });
  });

  it('names the department and cuts a kind that fills the view', () => {
    const many = Array.from({ length: LAND_MAX.freehold + 1 }, (_, i) => freehold(String(i)));
    const answer = landAnswer({
      loads: [],
      agreements: [agreement('1')],
      offsets: [],
      freehold: many,
    });
    expect(answer.source.name).toBe('Alberta Energy and Minerals, Government of Alberta');
    expect(answer.agreements).toEqual({ truncated: false, items: [agreement('1')] });
    expect(answer.freehold.truncated).toBe(true);
    expect(answer.freehold.items).toHaveLength(LAND_MAX.freehold);
  });
});

describe('GET /api/v1/petroleum/land', () => {
  const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });
  const viewer = () => {
    grain.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
  };
  const get = (query: string) =>
    app.request(`/api/v1/petroleum/land?${query}`, { headers: AUTH }, env);

  it('refuses a non-member without opening the oil and gas database', async () => {
    grain.memberships.mockResolvedValueOnce([]);
    const res = await get(`${BOX}&layers=agreements`);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses a bad box or no layers before any database', async () => {
    expect((await get('west=1&south=2&layers=agreements')).status).toBe(400);
    expect((await get(BOX)).status).toBe(400);
    expect((await get(`${BOX}&layers=coal`)).status).toBe(400);
    expect((await get(`${BOX}&layers=agreements&rights=montney`)).status).toBe(400);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('waits for its migration', async () => {
    viewer();
    petroleum.schemaVersion.mockResolvedValue(LAND_SCHEMA_VERSION - 1);
    const res = await get(`${BOX}&layers=agreements`);
    expect(res.status).toBe(503);
    expect(petroleum.land).not.toHaveBeenCalled();
  });

  it('gives a viewer the land in the box, asked as that member and only the kinds named', async () => {
    viewer();
    petroleum.land.mockResolvedValue({
      loads: [
        {
          layer: 'png_agreements',
          loadedAt: '2026-11-21T18:00:00.000Z',
          area: { west: -118.75, south: 51.57, east: -112.9, north: 55.28 },
          shapes: 1,
        },
      ],
      agreements: [agreement('7')],
      offsets: [],
      freehold: [],
    });
    const res = await get(`${BOX}&layers=agreements,offsets`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json<ReturnType<typeof landAnswer>>();
    expect(body.agreements.items).toEqual([agreement('7')]);
    expect(body.source.loads[0]?.layer).toBe('png_agreements');
    expect(petroleum.land).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      { west: -117, south: 54, east: -116, north: 55 },
      { agreements: LAND_MAX.agreements, offsets: LAND_MAX.offsets, freehold: 0 },
      null,
    );
    await get(`${BOX}&layers=agreements&rights=duvernay`);
    expect(petroleum.land).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.stringContaining('TO THE BASE OF THE DUVERNAY'),
    );
  });
});
