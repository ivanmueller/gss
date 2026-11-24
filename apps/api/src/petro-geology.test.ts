import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { GEOLOGY_SCHEMA_VERSION, geologyAnswer, lateralOf } from './petro-geology';
import type { GeologyOfWell } from './petro-geology-db';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// A well's Geology section (F-287 part 2): the Survey's picks, its play's zone in the model and
// the nearest samples, membership first. Made-up wells, picks and samples only.

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
const UWI = '00/11-23-030-27W4/0';
const PATH = `/api/v1/petroleum/geology/well?uwi=${encodeURIComponent(UWI)}`;

/** Zone 68's top and base in a cell, every other zone absent. */
function cell(x: number, y: number, top: number, base: number) {
  const tops = new Array<number | null>(90).fill(null);
  const bases = new Array<number | null>(90).fill(null);
  tops[67] = top;
  bases[67] = base;
  return { x, y, tops, bases };
}

// The well: surface and bottom 0.032° apart in longitude (two lattice columns), at 54.2°N.
const SURFACE: [number, number] = [-116.512, 54.198];
const BOTTOM: [number, number] = [-116.48, 54.198];
const cx = (lon: number) => Math.round(lon / 0.016);
const cy = (lat: number) => Math.round(lat / 0.009);

function data(over: Partial<GeologyOfWell> = {}): GeologyOfWell {
  return {
    well: {
      uwi: UWI,
      licenceNumber: '0999999',
      formation: 'duvernay',
      surface: SURFACE,
      bottom: BOTTOM,
      groundElevationM: 800,
    },
    legs: [
      {
        uwi: UWI,
        kbElevationM: 805,
        points: [
          [SURFACE[0], SURFACE[1], 805],
          [SURFACE[0], SURFACE[1], -2000],
          [-116.496, 54.198, -2230],
          [BOTTOM[0], BOTTOM[1], -2235],
        ],
      },
    ],
    picked: [
      {
        uwi: '00/06-23-030-27W4/0',
        licenceNumber: '0999999',
        longitude: SURFACE[0],
        latitude: SURFACE[1],
        kbElevationM: 805,
        names: [2, 1],
        tvdM: [3010.5, 3030.1],
        sources: [1, 2],
      },
      // About 1.3 km east of the bottom hole.
      {
        uwi: '00/01-24-030-27W4/0',
        licenceNumber: '0111111',
        longitude: -116.46,
        latitude: 54.198,
        kbElevationM: null,
        names: [1],
        tvdM: [3040],
        sources: [0],
      },
      // About 13 km away: out of reach.
      {
        uwi: '00/01-01-031-27W4/0',
        licenceNumber: '0222222',
        longitude: -116.3,
        latitude: 54.198,
        kbElevationM: null,
        names: [1],
        tvdM: [3050],
        sources: [1],
      },
    ],
    names: [
      { id: 1, name: 'Duvernay Formation top', surface: '68_D_Dv_Mu_top' },
      { id: 2, name: 'Ireton Formation top', surface: '67_D_Ir_FS_Gr_G_top' },
    ],
    samples: [
      {
        sampleId: 7,
        run: 1,
        uwi: null,
        site: 'well',
        longitude: -116.4,
        latitude: 54.3,
        topDepthM: '3050.00',
        unit: 'Duvernay',
        lithology: 'shale',
        collectedOn: '2007-09-01',
        tmaxC: '460',
        s2: '3.2',
        tocPct: '4.25',
        hydrogenIndex: '120',
      },
      {
        sampleId: 8,
        run: 1,
        uwi: null,
        site: 'well',
        longitude: -116.45,
        latitude: 54.2,
        topDepthM: '2900.00',
        unit: 'Ireton',
        lithology: 'shale',
        collectedOn: null,
        tmaxC: '440',
        s2: '1',
        tocPct: '0.5',
        hydrogenIndex: null,
      },
      {
        sampleId: 9,
        run: 2,
        uwi: UWI,
        site: 'well',
        longitude: SURFACE[0],
        latitude: SURFACE[1],
        topDepthM: '3040.00',
        unit: 'Majeau Lake',
        lithology: 'shale',
        collectedOn: null,
        tmaxC: '455',
        s2: '0.1',
        tocPct: '1',
        hydrogenIndex: null,
      },
    ],
    cells: [
      cell(cx(SURFACE[0]), cy(SURFACE[1]), -2210, -2260),
      cell(cx(-116.496), cy(54.198), -2210, -2260),
      cell(cx(BOTTOM[0]), cy(BOTTOM[1]), -2200, -2257),
    ],
    loads: {
      picks: { loadedAt: '2030-01-02T00:00:00.000Z', sourceDate: '2026-10-31' },
      samples: { loadedAt: '2030-01-02T00:00:00.000Z', sourceDate: '2024-11-30' },
      model: { loadedAt: '2030-01-01T00:00:00.000Z', sourceDate: null },
    },
    ...over,
  };
}

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  petroleum.schemaVersion.mockResolvedValue(GEOLOGY_SCHEMA_VERSION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  petroleum = fakePetroleum();
  openPetroleum.mockClear();
});

describe('geologyAnswer', () => {
  it("gives the play's zone under the bottom hole: depth from the ground and thickness", () => {
    const answer = geologyAnswer(data());
    expect(answer.play).toEqual({ key: 'duvernay', zone: 68, name: 'Duvernay / Muskwa' });
    expect(answer.zoneHere).toEqual({ topElevationM: -2200, topDepthM: 3000, thicknessM: 57 });
  });

  it("measures each leg's lateral against the zone, point by point", () => {
    const [leg] = geologyAnswer(data()).legs;
    expect(leg).toEqual({ uwi: UWI, points: 2, inside: 2, belowTopM: 28, aboveBaseM: 26 });
  });

  it("lists the licence's own picks first, then the nearest within reach, each named", () => {
    const { picked } = geologyAnswer(data());
    expect(picked.map((p) => [p.uwi, p.own, p.distanceKm])).toEqual([
      ['00/06-23-030-27W4/0', true, 0],
      ['00/01-24-030-27W4/0', false, 1.3],
    ]);
    expect(picked[0]?.picks).toEqual([
      {
        name: 'Ireton Formation top',
        zone: 67,
        tvdM: 3010.5,
        elevationM: -2205.5,
        source: 'Survey',
      },
      {
        name: 'Duvernay Formation top',
        zone: 68,
        tvdM: 3030.1,
        elevationM: -2225.1,
        source: 'AER',
      },
    ]);
  });

  it("gives the well's own samples, then the play's nearest, each with its maturity", () => {
    const { samples } = geologyAnswer(data());
    expect(samples.map((s) => [s.sampleId, s.own, s.unit, s.ro, s.window, s.note])).toEqual([
      [9, true, 'Majeau Lake', 1.03, null, 'small-s2'],
      [7, false, 'Duvernay', 1.12, 'condensate', null],
    ]);
  });

  it('names the Survey, and has nothing to say of a well with no play', () => {
    const base = data().well;
    if (!base) throw new Error('the test well');
    const answer = geologyAnswer(data({ well: { ...base, formation: null } }));
    expect(answer.source.picks.name).toContain('Alberta Geological Survey');
    expect(answer.source.samples.sourceDate).toBe('2024-11-30');
    expect(answer.play).toBeNull();
    expect(answer.zoneHere).toBeNull();
    expect(answer.legs).toEqual([]);
    expect(answer.samples.map((s) => s.sampleId)).toEqual([9]);
  });

  it('takes the lateral as the points within 100 m of the deepest', () => {
    expect(
      lateralOf([
        [0, 0, 800],
        [0, 0, -2000],
        [0, 0, -2150],
        [0, 0, -2240],
      ]),
    ).toEqual([
      [0, 0, -2150],
      [0, 0, -2240],
    ]);
    expect(lateralOf([])).toEqual([]);
  });
});

describe('GET /api/v1/petroleum/geology/well', () => {
  it('sends a member the section', async () => {
    petroleum.geologyOfWell.mockResolvedValueOnce(data());
    const res = await app.request(PATH, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    const body = await res.json<{ picked: unknown[] }>();
    expect(body.picked).toHaveLength(2);
    expect(petroleum.geologyOfWell).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        organizationId: 'org-a',
        role: 'trader',
        requestId: expect.any(String) as string,
      },
      UWI,
    );
  });

  it('answers 404 for a well not loaded', async () => {
    const res = await app.request(PATH, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(404);
  });

  it('refuses a malformed UWI, and a person who is not a member', async () => {
    const bad = await app.request(
      '/api/v1/petroleum/geology/well?uwi=x%27',
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
    petroleum.schemaVersion.mockResolvedValue(21);
    const res = await app.request(PATH, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(503);
    expect(petroleum.geologyOfWell).not.toHaveBeenCalled();
  });
});
