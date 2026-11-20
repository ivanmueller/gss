import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import type { PetroleumFactory } from './petroleum-db';
import { parseSt37Box, ST37_MAX_WELLS, ST37_SCHEMA_VERSION, st37Answer } from './st37';
import type { St37WellRow } from './st37-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// The AER's ST37 wells on the oil and gas map (F-243 part 4). Made-up wells only.

const env = {
  ...ENV,
  DATABASE_URL: 'postgresql://app_api:x@db.example.test/postgres',
  PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
};
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };
const BOX = 'west=-114&south=53&east=-113&north=54';

const well = (uwi: string): St37WellRow => ({
  uwi,
  licenceNumber: '0509395',
  wellName: 'EXAMPLE HZ',
  licensee: 'Example Energy Ltd.',
  statusClass: 'producing',
  statusFluid: 'Crude oil',
  statusType: null,
  spudDate: '2023-09-03',
  totalDepthM: 5846,
  trueVerticalDepthM: 2233,
  surface: [-113.6, 53.3],
  bottom: [-113.62, 53.3],
  path: [
    [-113.6, 53.3],
    [-113.62, 53.3],
  ],
});

let grain = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => grain);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);

beforeEach(() => {
  grain = fakeDatabase();
  petroleum = fakePetroleum();
  petroleum.schemaVersion.mockResolvedValue(ST37_SCHEMA_VERSION);
  openPetroleum.mockClear();
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
});

describe('parseSt37Box', () => {
  it('reads a box in degrees', () => {
    expect(parseSt37Box({ west: '-114', south: '53', east: '-113', north: '54' })).toEqual({
      west: -114,
      south: 53,
      east: -113,
      north: 54,
    });
  });

  it('refuses a missing, inverted or impossible box', () => {
    for (const query of [
      { west: '-114', south: '53', east: '-113' },
      { west: '-113', south: '53', east: '-114', north: '54' },
      { west: '-200', south: '53', east: '-113', north: '54' },
      { west: 'x', south: '53', east: '-113', north: '54' },
    ]) {
      expect(typeof parseSt37Box(query)).toBe('string');
    }
  });
});

describe('st37Answer', () => {
  it('names the source and cuts a full view', () => {
    const rows = Array.from({ length: ST37_MAX_WELLS + 1 }, (_, i) => well(`u${String(i)}`));
    const answer = st37Answer(null, rows);
    expect(answer.truncated).toBe(true);
    expect(answer.wells).toHaveLength(ST37_MAX_WELLS);
    expect(answer.source.name).toMatch(/Alberta Energy Regulator/);
  });
});

describe('GET /api/v1/petroleum/st37/wells', () => {
  const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });
  const viewer = () => {
    grain.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
  };

  it('refuses a non-member without opening the oil and gas database', async () => {
    grain.memberships.mockResolvedValueOnce([]);
    const res = await app.request(`/api/v1/petroleum/st37/wells?${BOX}`, { headers: AUTH }, env);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses a bad box before any database', async () => {
    const res = await app.request(
      '/api/v1/petroleum/st37/wells?west=1&south=2',
      { headers: AUTH },
      env,
    );
    expect(res.status).toBe(400);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('waits for its migration', async () => {
    viewer();
    petroleum.schemaVersion.mockResolvedValue(ST37_SCHEMA_VERSION - 1);
    const res = await app.request(`/api/v1/petroleum/st37/wells?${BOX}`, { headers: AUTH }, env);
    expect(res.status).toBe(503);
    expect(petroleum.st37Wells).not.toHaveBeenCalled();
  });

  it('gives a viewer the wells in the box, asked as that member', async () => {
    viewer();
    petroleum.st37Wells.mockResolvedValue({
      load: {
        loadedAt: '2026-11-20T06:00:00.000Z',
        sourceDate: '2026-11-01',
        area: { west: -113.95, south: 53.12, east: -113.25, north: 53.48 },
      },
      wells: [well('00/09-07-030-26W4/0')],
    });
    const res = await app.request(`/api/v1/petroleum/st37/wells?${BOX}`, { headers: AUTH }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json<ReturnType<typeof st37Answer>>();
    expect(body.truncated).toBe(false);
    expect(body.wells).toEqual([well('00/09-07-030-26W4/0')]);
    expect(body.source).toMatchObject({ sourceDate: '2026-11-01' });
    expect(petroleum.st37Wells).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      { west: -114, south: 53, east: -113, north: 54 },
      ST37_MAX_WELLS,
    );
  });
});
