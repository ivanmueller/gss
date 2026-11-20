import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { PETROLEUM_SCHEMA_VERSION, type PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';
import { refreshWells, WELLS_SERVICE, WELLS_SIZE_BUDGET_BYTES } from './wells';
import type { WellLoad } from './wells-db';

// Every Alberta well (F-243 part 3): the shared size guard, paging, the monthly rule, and the
// status route. Made-up wells only.

const env = {
  ...ENV,
  DATABASE_URL: 'postgresql://app_api:x@db.example.test/postgres',
  PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
};
const NOW = new Date('2026-11-20T14:15:00Z');

const running: WellLoad = {
  id: 1,
  status: 'running',
  startedAt: '2026-11-20T14:15:00.000Z',
  finishedAt: null,
  lastObjectId: 0,
  rowsSaved: 0,
  rowsUnidentified: 0,
  rowsInvalid: 0,
};

const feature = (objectId: number) => ({
  attributes: {
    OBJECTID: objectId,
    UWI: `05142509${String(objectId).padStart(5, '0')}`,
    WELL_NAME: 'EXAMPLE',
    OPERATOR: 'A62D',
    OPERATOR_NAME: 'Example Energy Ltd.',
    WELLTYPE: 'Oil',
    CURRENT_STATUS: '0111000000',
    WELL_STATUS: 'Oil',
    FINAL_DRILL_DATE: '1999-01-01',
    SURFACE_LONGITUDE: 113.6,
    SURFACE_LATITUDE: 53.4,
  },
});

let grain = fakeDatabase();
let petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => grain);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);
let logs: string[] = [];

beforeEach(() => {
  grain = fakeDatabase();
  petroleum = fakePetroleum();
  logs = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pages(...answers: unknown[]) {
  return vi.fn<typeof fetch>(() => {
    const next = answers.shift();
    return Promise.resolve(
      next === undefined ? new Response('down', { status: 500 }) : Response.json(next),
    );
  });
}

describe('refreshWells', () => {
  it('stops at the shared size limit before fetching anything, and stays stopped', async () => {
    petroleum.latestWellLoad.mockResolvedValue(running);
    grain.databaseSize.mockResolvedValue(WELLS_SIZE_BUDGET_BYTES - 1000);
    petroleum.databaseSize.mockResolvedValue(1000);
    const fetchImpl = pages();
    expect(await refreshWells(env, openDatabase, openPetroleum, NOW, fetchImpl)).toEqual({
      status: 'stopped_size',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(petroleum.stopWellLoad).toHaveBeenCalledWith(1, 'stopped_size');
    expect(logs.join('\n')).toContain('stopped at the size limit: grain');

    // Next run: a load stopped at the limit is never restarted by itself.
    petroleum.latestWellLoad.mockResolvedValue({ ...running, status: 'stopped_size' });
    expect(await refreshWells(env, openDatabase, openPetroleum, NOW, fetchImpl)).toEqual({
      status: 'stopped_size',
    });
    expect(petroleum.startWellLoad).not.toHaveBeenCalled();
  });

  it('never loads blind: an unreadable size stops the run', async () => {
    petroleum.latestWellLoad.mockResolvedValue(running);
    grain.databaseSize.mockRejectedValue(new Error('down'));
    const fetchImpl = pages();
    expect(await refreshWells(env, openDatabase, openPetroleum, NOW, fetchImpl)).toEqual({
      status: 'size_unknown',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pages from the cursor, checking the sizes before each page, until the last page', async () => {
    petroleum.latestWellLoad.mockResolvedValue({ ...running, lastObjectId: 100 });
    const fetchImpl = pages(
      { features: [feature(101), feature(102)], exceededTransferLimit: true },
      { features: [feature(103)], exceededTransferLimit: false },
    );
    expect(await refreshWells(env, openDatabase, openPetroleum, NOW, fetchImpl)).toEqual({
      status: 'ran',
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(WELLS_SERVICE);
    const first = fetchImpl.mock.calls[0]?.[1]?.body;
    expect(first instanceof URLSearchParams && first.get('where')).toBe('OBJECTID > 100');
    expect(petroleum.saveWellPage).toHaveBeenNthCalledWith(1, 1, 100, expect.anything());
    expect(petroleum.saveWellPage).toHaveBeenNthCalledWith(2, 1, 102, expect.anything());
    expect(grain.databaseSize).toHaveBeenCalledTimes(2);
    expect(logs.join('\n')).toContain('Wells load 1 finished');
  });

  it('stops when another run moved the load on, and when the service fails', async () => {
    petroleum.latestWellLoad.mockResolvedValue(running);
    petroleum.saveWellPage.mockResolvedValueOnce('moved');
    const moved = pages({ features: [feature(1)], exceededTransferLimit: true }, { features: [] });
    await refreshWells(env, openDatabase, openPetroleum, NOW, moved);
    expect(moved).toHaveBeenCalledTimes(1);

    petroleum.saveWellPage.mockClear();
    const down = pages();
    expect(await refreshWells(env, openDatabase, openPetroleum, NOW, down)).toEqual({
      status: 'ran',
    });
    expect(petroleum.saveWellPage).not.toHaveBeenCalled();
  });

  it('starts a monthly load only when due', async () => {
    const done: WellLoad = {
      ...running,
      status: 'done',
      finishedAt: '2026-11-10T00:00:00.000Z',
    };
    petroleum.latestWellLoad.mockResolvedValue(done);
    petroleum.lastDoneWellLoad.mockResolvedValue(done);
    expect(await refreshWells(env, openDatabase, openPetroleum, NOW, pages())).toEqual({
      status: 'idle',
    });
    expect(petroleum.startWellLoad).not.toHaveBeenCalled();
    const later = new Date('2026-12-09T00:00:00Z');
    await refreshWells(env, openDatabase, openPetroleum, later, pages());
    expect(petroleum.startWellLoad).toHaveBeenCalled();
  });

  it('does nothing before the migration or without the databases', async () => {
    expect(await refreshWells(ENV, openDatabase, openPetroleum, NOW, pages())).toEqual({
      status: 'not_configured',
    });
    petroleum.schemaVersion.mockResolvedValue(PETROLEUM_SCHEMA_VERSION - 1);
    expect(await refreshWells(env, openDatabase, openPetroleum, NOW, pages())).toEqual({
      status: 'not_ready',
    });
  });
});

describe('GET /api/v1/petroleum/wells/status', () => {
  const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });
  const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };

  beforeEach(() => {
    mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  });

  it('refuses a non-member without opening the oil and gas database', async () => {
    grain.memberships.mockResolvedValueOnce([]);
    const res = await app.request('/api/v1/petroleum/wells/status', { headers: AUTH }, env);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('tells a viewer the load and how many wells are current', async () => {
    openPetroleum.mockClear();
    grain.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
    petroleum.wellsStatus.mockResolvedValue({
      load: { ...running, rowsSaved: 4000 },
      current: 4000,
    });
    const res = await app.request('/api/v1/petroleum/wells/status', { headers: AUTH }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      current: 4000,
      load: {
        status: 'running',
        startedAt: running.startedAt,
        finishedAt: null,
        rowsSaved: 4000,
      },
    });
  });
});
