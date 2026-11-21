import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import type { PetroleumFactory } from './petroleum-db';
import {
  clearSt37Zones,
  parseSt37Box,
  ST37_MAX_WELLS,
  ST37_SCHEMA_VERSION,
  st37Answer,
  st37LoadZones,
} from './st37';
import type { St37Load, St37WellRow } from './st37-db';
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
  licenceDate: null,
  plannedOperation: null,
  plannedFormation: null,
  plannedDepthM: null,
  plannedBottom: null,
  formation: 'duvernay',
  fieldCode: 990002,
  fieldName: 'EXAMPLE SOUTH',
  poolCode: 728001,
  poolName: 'EXAMPLE A',
});

let grain = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => grain);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);

beforeEach(() => {
  grain = fakeDatabase();
  petroleum = fakePetroleum();
  petroleum.schemaVersion.mockResolvedValue(ST37_SCHEMA_VERSION);
  clearSt37Zones();
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

const DUVERNAY: St37Load = {
  id: '7',
  loadedAt: '2026-11-20T06:00:00.000Z',
  sourceDate: '2026-11-01',
  area: { west: -118.75, south: 51.57, east: -112.9, north: 55.28 },
  formation: 'duvernay',
  totals: { producing: 3, licensed: 2 },
};
/** Sixty made-up wells about 1 km apart: one zone. */
const DRILLED = Array.from({ length: 60 }, (_, i) => ({
  surface: [-116 + i * 0.015, 54] as const,
  bottom: [-116 + i * 0.015, 54.02] as const,
}));

describe('st37Answer', () => {
  it('names the source and cuts a full view', () => {
    const rows = Array.from({ length: ST37_MAX_WELLS + 1 }, (_, i) => well(`u${String(i)}`));
    const answer = st37Answer([], new Map(), rows);
    expect(answer.truncated).toBe(true);
    expect(answer.wells).toHaveLength(ST37_MAX_WELLS);
    expect(answer.source.name).toMatch(/Alberta Energy Regulator/);
    expect(answer.formations).toEqual([]);
    expect(answer.source.licenceSource).toBeNull();
  });

  it('names each play loaded whole, with its area, its wells by status and its zones', () => {
    const other: St37Load = { ...DUVERNAY, id: '9', formation: 'example_play', totals: {} };
    const rectangle: St37Load = {
      ...DUVERNAY,
      id: '3',
      formation: null,
      area: { west: -114, south: 53, east: -113, north: 54 },
    };
    const zone = { wells: 50, ring: [] };
    const answer = st37Answer([other, DUVERNAY, rectangle], new Map([['duvernay', [zone]]]), []);
    expect(answer.formations).toEqual([
      // A play the code has no name for is shown by its key.
      expect.objectContaining({ key: 'example_play', name: 'example_play', zones: [] }),
      {
        key: 'duvernay',
        name: 'Duvernay',
        area: DUVERNAY.area,
        loadedAt: DUVERNAY.loadedAt,
        totals: { producing: 3, licensed: 2 },
        zones: [zone],
      },
    ]);
    // The rectangle beside the plays keeps its own area.
    expect(answer.source.area).toEqual(rectangle.area);
    expect(answer.source.licenceSource).toMatch(/Petrinex.*Government of Alberta/);
  });
});

describe('st37LoadZones', () => {
  beforeEach(() => {
    clearSt37Zones();
  });

  it("works a play's zones out once for a load, and again for its next load", async () => {
    const drilled = vi.fn(() => Promise.resolve(DRILLED));
    const first = await st37LoadZones(DUVERNAY, drilled);
    // The smallest area holding about four in five of the cluster's wells.
    expect(first).toHaveLength(1);
    expect(first[0]?.wells).toBeGreaterThan(40);
    expect(await st37LoadZones(DUVERNAY, drilled)).toBe(first);
    expect(drilled).toHaveBeenCalledTimes(1);
    expect(drilled).toHaveBeenCalledWith('duvernay');
    await st37LoadZones({ ...DUVERNAY, id: '8' }, drilled);
    expect(drilled).toHaveBeenCalledTimes(2);
  });

  it('gives a rectangle no zones and reads nothing for it', async () => {
    const drilled = vi.fn(() => Promise.resolve(DRILLED));
    expect(await st37LoadZones({ ...DUVERNAY, formation: null }, drilled)).toEqual([]);
    expect(drilled).not.toHaveBeenCalled();
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
      loads: [DUVERNAY],
      wells: [well('00/09-07-030-26W4/0')],
    });
    petroleum.st37Drilled.mockResolvedValue(DRILLED);
    const res = await app.request(`/api/v1/petroleum/st37/wells?${BOX}`, { headers: AUTH }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json<ReturnType<typeof st37Answer>>();
    expect(body.truncated).toBe(false);
    expect(body.wells).toEqual([well('00/09-07-030-26W4/0')]);
    expect(body.source).toMatchObject({ sourceDate: '2026-11-01' });
    // The play's zones, worked out from its drilled wells, read as the same member.
    expect(body.formations.map((f) => [f.key, f.zones.length])).toEqual([['duvernay', 1]]);
    expect(petroleum.st37Drilled).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      'duvernay',
    );
    expect(petroleum.st37Wells).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      { west: -114, south: 53, east: -113, north: 54 },
      ST37_MAX_WELLS,
    );
  });
});
