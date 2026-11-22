import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import type { PetroleumFactory } from './petroleum-db';
import {
  clearSt37Zones,
  parseSt37Box,
  ST37_3D_MAX_NEARBY,
  ST37_3D_NEARBY_KM,
  ST37_3D_SCHEMA_VERSION,
  ST37_MAX_WELLS,
  ST37_SCHEMA_VERSION,
  st37Answer,
  st37LoadZones,
  st37Well3dAnswer,
} from './st37';
import type { St37DeepLeg, St37Load, St37WellRow } from './st37-db';
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
    // The member's own browser may keep it, and asks before each use (F-263).
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    const tag = res.headers.get('ETag') ?? '';
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/);
    const body = await res.json<ReturnType<typeof st37Answer>>();
    // A browser holding these bytes is told so, also when the tag came back weak; the sign-in
    // and the membership were checked again first.
    for (const held of [tag, `W/${tag}`, `"other", W/${tag}`]) {
      const again = await app.request(
        `/api/v1/petroleum/st37/wells?${BOX}`,
        { headers: { ...AUTH, 'If-None-Match': held } },
        env,
      );
      expect(again.status).toBe(304);
      expect(await again.text()).toBe('');
    }
    const other = await app.request(
      `/api/v1/petroleum/st37/wells?${BOX}`,
      { headers: { ...AUTH, 'If-None-Match': '"something-else"' } },
      env,
    );
    expect(other.status).toBe(200);
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

// A well under the ground, in 3D (F-261). Made-up wells only.
const MAIN = '00/09-07-030-26W4/0';
const deepLeg = (uwi: string, extra: Partial<St37DeepLeg> = {}): St37DeepLeg => ({
  uwi,
  licenceNumber: '0509395',
  licensee: 'Example Energy Ltd.',
  statusClass: 'producing',
  surveyed: true,
  own: true,
  surface: [-113.6, 53.3],
  kbElevationM: 904.1,
  groundElevationM: 898.5,
  points: [
    [-113.6, 53.3, 904.1],
    [-113.6, 53.3, -1300],
    [-113.62, 53.3, -1355.8],
  ],
  ...extra,
});

describe('st37Well3dAnswer', () => {
  it('gives the well, its legs and the wells nearby, without the legs that have no depths', () => {
    const answer = st37Well3dAnswer(MAIN, '2026-11-22T06:00:00.000Z', [
      deepLeg(MAIN, { kbElevationM: null }),
      deepLeg('02/09-07-030-26W4/0', { points: null, kbElevationM: 905 }),
      deepLeg('00/01-08-030-26W4/0', { own: false, licenceNumber: '0509400' }),
    ]);
    expect(answer?.well).toEqual({
      uwi: MAIN,
      licenceNumber: '0509395',
      surface: [-113.6, 53.3],
      // The leg asked for has none: another leg of the well gives it.
      kbElevationM: 905,
      groundElevationM: 898.5,
    });
    expect(answer?.legs.map((leg) => [leg.uwi, leg.own])).toEqual([
      [MAIN, true],
      ['00/01-08-030-26W4/0', false],
    ]);
    expect(answer?.nearbyKm).toBe(ST37_3D_NEARBY_KM);
    expect(answer?.truncated).toBe(false);
    expect(answer?.source.name).toContain('Alberta Energy Regulator');
  });

  it('says when more wells lie nearby than it holds, and nothing for a well not loaded', () => {
    const many = Array.from({ length: ST37_3D_MAX_NEARBY + 1 }, (_, i) =>
      deepLeg(`n${String(i)}`, { own: false, licenceNumber: `9${String(i)}` }),
    );
    const answer = st37Well3dAnswer(MAIN, null, [deepLeg(MAIN), ...many]);
    expect(answer?.truncated).toBe(true);
    expect(answer?.legs).toHaveLength(1 + ST37_3D_MAX_NEARBY);
    expect(st37Well3dAnswer(MAIN, null, [])).toBeNull();
    expect(st37Well3dAnswer(MAIN, null, many)).toBeNull();
  });
});

describe('GET /api/v1/petroleum/st37/well-3d', () => {
  const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });
  const path = `/api/v1/petroleum/st37/well-3d?uwi=${encodeURIComponent(MAIN)}`;
  const viewer = () => {
    grain.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
    petroleum.schemaVersion.mockResolvedValue(ST37_3D_SCHEMA_VERSION);
  };

  it('refuses a non-member without opening the oil and gas database', async () => {
    grain.memberships.mockResolvedValueOnce([]);
    const res = await app.request(path, { headers: AUTH }, env);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses what is not a well identifier before any database', async () => {
    const res = await app.request(
      '/api/v1/petroleum/st37/well-3d?uwi=x%27%3B--',
      { headers: AUTH },
      env,
    );
    expect(res.status).toBe(400);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('waits for its migration', async () => {
    viewer();
    petroleum.schemaVersion.mockResolvedValue(ST37_3D_SCHEMA_VERSION - 1);
    const res = await app.request(path, { headers: AUTH }, env);
    expect(res.status).toBe(503);
    expect(petroleum.st37Well3d).not.toHaveBeenCalled();
  });

  it('says so when the well is not loaded', async () => {
    viewer();
    const res = await app.request(path, { headers: AUTH }, env);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('gives a viewer the well with its depths, asked as that member', async () => {
    viewer();
    petroleum.st37Well3d.mockResolvedValue({
      loadedAt: '2026-11-22T06:00:00.000Z',
      legs: [deepLeg(MAIN), deepLeg('00/01-08-030-26W4/0', { own: false })],
    });
    const res = await app.request(path, { headers: AUTH }, env);
    expect(res.status).toBe(200);
    // Kept by the member's own browser, asked about before each use (F-263).
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    const body = await res.json<NonNullable<ReturnType<typeof st37Well3dAnswer>>>();
    expect(body.legs).toHaveLength(2);
    expect(body.legs[0]?.points[2]).toEqual([-113.62, 53.3, -1355.8]);
    expect(petroleum.st37Well3d).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      MAIN,
      ST37_3D_NEARBY_KM,
      ST37_3D_MAX_NEARBY,
    );
  });
});
