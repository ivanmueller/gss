import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import {
  FORMATION_MAX_CELLS_A_SIDE,
  FORMATION_SCHEMA_VERSION,
  formationAnswer,
  formationRange,
} from './formation';
import type { FormationCellRow, FormationLoad } from './formation-db';
import { createApp } from './index';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// The layers of the ground under a well's 3D view (F-261 part 2). Made-up layers only.

const env = {
  ...ENV,
  DATABASE_URL: 'postgresql://app_api:x@db.example.test/postgres',
  PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
};
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };
const BOX = 'west=-116.92&south=54.37&east=-116.88&north=54.4';

const LOAD: FormationLoad = {
  loadedAt: '2026-11-22T22:00:00.000Z',
  sourceDate: '2026-11-02',
  model: 'Geological Framework of Alberta, Version 4',
  lonStep: 0.016,
  latStep: 0.009,
};

/** A cell with the zones given, [zone, top, base], and every other zone absent. */
const cell = (x: number, y: number, zones: [number, number, number][]): FormationCellRow => {
  const tops = new Array<number | null>(90).fill(null);
  const bases = new Array<number | null>(90).fill(null);
  for (const [zone, top, base] of zones) {
    tops[zone - 1] = top;
    bases[zone - 1] = base;
  }
  return { x, y, tops, bases };
};

let grain = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => grain);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);

beforeEach(() => {
  grain = fakeDatabase();
  petroleum = fakePetroleum();
  petroleum.schemaVersion.mockResolvedValue(FORMATION_SCHEMA_VERSION);
  openPetroleum.mockClear();
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
});

describe('formationRange', () => {
  it('covers a box with one cell beyond each edge', () => {
    expect(formationRange({ west: -116.92, south: 54.37, east: -116.88, north: 54.4 })).toEqual({
      x0: -7308,
      x1: -7305,
      y0: 6041,
      y1: 6045,
    });
  });

  it('refuses a box too large for one answer', () => {
    const side = FORMATION_MAX_CELLS_A_SIDE * 0.016;
    expect(typeof formationRange({ west: -117, south: 54, east: -117 + side, north: 54.1 })).toBe(
      'string',
    );
    expect(typeof formationRange({ west: -117, south: 54, east: -116.9, north: 54.7 })).toBe(
      'string',
    );
  });
});

describe('formationAnswer', () => {
  const range = { x0: 10, x1: 11, y0: 20, y1: 21 };

  it('lays each zone present over the grid, the south row first, absent where it is not', () => {
    const answer = formationAnswer(range, LOAD, [
      cell(10, 20, [
        [1, 840, 830],
        [68, -2252, -2310],
      ]),
      // The Duvernay ends before this cell; and the cell (10, 21) is not kept at all.
      cell(11, 20, [[1, 838, 829]]),
      cell(11, 21, [
        [1, 835, 827],
        [68, -2240, -2295],
      ]),
    ]);
    expect(answer.grid).toEqual({
      lonStep: 0.016,
      latStep: 0.009,
      x0: 10,
      y0: 20,
      columns: 2,
      rows: 2,
    });
    expect(answer.cells).toBe(3);
    expect(answer.zones).toEqual([
      { zone: 1, tops: [840, 838, null, 835], bases: [830, 829, null, 827] },
      { zone: 68, tops: [-2252, null, null, -2240], bases: [-2310, null, null, -2295] },
    ]);
    expect(answer.source).toMatchObject({
      model: 'Geological Framework of Alberta, Version 4',
      loadedAt: '2026-11-22T22:00:00.000Z',
      sourceDate: '2026-11-02',
    });
    // The Survey is named, for the depths and for the rock types.
    expect(answer.source.name).toContain('Alberta Geological Survey');
    expect(answer.source.rocks).toContain('Alberta Table of Formations');
  });

  it('says so when nothing is loaded there', () => {
    const answer = formationAnswer(range, null, []);
    expect(answer.cells).toBe(0);
    expect(answer.zones).toEqual([]);
    expect(answer.source.loadedAt).toBeNull();
    expect(answer.grid).toMatchObject({ lonStep: 0.016, latStep: 0.009, columns: 2, rows: 2 });
  });
});

describe('GET /api/v1/petroleum/formation-layers', () => {
  const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });
  const path = `/api/v1/petroleum/formation-layers?${BOX}`;
  const viewer = () => {
    grain.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
  };

  it('refuses a non-member without opening the oil and gas database', async () => {
    grain.memberships.mockResolvedValueOnce([]);
    const res = await app.request(path, { headers: AUTH }, env);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses a bad or too large box before any database', async () => {
    for (const query of ['west=1&south=2', 'west=-118&south=54&east=-116&north=54.1']) {
      const res = await app.request(
        `/api/v1/petroleum/formation-layers?${query}`,
        { headers: AUTH },
        env,
      );
      expect(res.status).toBe(400);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('waits for its migration', async () => {
    viewer();
    petroleum.schemaVersion.mockResolvedValue(FORMATION_SCHEMA_VERSION - 1);
    const res = await app.request(path, { headers: AUTH }, env);
    expect(res.status).toBe(503);
    expect(petroleum.formationCells).not.toHaveBeenCalled();
  });

  it('gives a viewer the layers of the box, asked as that member', async () => {
    viewer();
    petroleum.formationCells.mockResolvedValue({
      load: LOAD,
      cells: [cell(-7306, 6043, [[68, -2252, -2310]])],
    });
    const res = await app.request(path, { headers: AUTH }, env);
    expect(res.status).toBe(200);
    // Kept by the member's own browser, asked about before each use (F-263).
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    const body = await res.json<ReturnType<typeof formationAnswer>>();
    expect(body.grid).toMatchObject({ x0: -7308, y0: 6041, columns: 4, rows: 5 });
    expect(body.zones.map((zone) => zone.zone)).toEqual([68]);
    // Cell (-7306, 6043): the third column of the third row.
    expect(body.zones[0]?.tops[2 * 4 + 2]).toBe(-2252);
    expect(petroleum.formationCells).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-a', role: 'viewer' }),
      { x0: -7308, x1: -7305, y0: 6041, y1: 6045 },
    );
  });
});
