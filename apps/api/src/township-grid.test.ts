import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';
import {
  gridPointUrl,
  gridSquareUrl,
  gridTag,
  parseGridPoint,
  parseGridSquare,
} from './township-grid';

// The township grid's squares (F-240, F-271): the province's service asked by the Worker only,
// from fixed values and the square; the membership checked first; nothing stored.

let db = fakeDatabase();
const petroleum = fakePetroleum();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);
const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });

const WITH_PETROLEUM = {
  ...ENV,
  PETROLEUM_DATABASE_URL: 'postgresql://petro_api.ref:secret@db.example.test:5432/postgres',
};
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };
// A section square near Fox Creek, zoom 11.
const SQUARE = '/api/v1/petroleum/grid/section/11/359/652';
const GEOJSON = '{"type":"FeatureCollection","features":[]}';

let grid: Response | Error;
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) => {
  if (url.startsWith('https://geospatial.alberta.ca/')) {
    return grid instanceof Error ? Promise.reject(grid) : Promise.resolve(grid.clone());
  }
  return Promise.resolve(Response.json({ id: USER_ID, email: 'adam@example.test' }));
});
const gridCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url.startsWith('https://geospatial.alberta.ca/'));

beforeEach(() => {
  grid = new Response(GEOJSON, { headers: { 'Content-Type': 'application/geo+json' } });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  db = fakeDatabase();
  openPetroleum.mockClear();
});

describe('GET /api/v1/petroleum/grid/:level/:z/:x/:y', () => {
  it('passes the square on to a member, kept by the browser until the week turns', async () => {
    const res = await app.request(SQUARE, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(GEOJSON);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(res.headers.get('Vary')).toContain('Authorization');
    expect(res.headers.get('ETag')).toMatch(/^"grid-1-section-11-359-652-\d+"$/);
    expect(db.memberships).toHaveBeenCalledWith(USER_ID);
    // Nothing is stored: the oil and gas database is not opened.
    expect(openPetroleum).not.toHaveBeenCalled();
    const [url] = gridCalls()[0] ?? [];
    expect(String(url)).toBe(gridSquareUrl('section', { z: 11, x: 359, y: 652 }));
  });

  it('answers "not modified" for the same square in the same week, without asking the province', async () => {
    const tag = gridTag('section', { z: 11, x: 359, y: 652 });
    const res = await app.request(
      SQUARE,
      { headers: { ...AUTH, 'If-None-Match': tag } },
      WITH_PETROLEUM,
    );
    expect(res.status).toBe(304);
    expect(gridCalls()).toHaveLength(0);
  });

  it('requires sign-in and a membership before asking the province', async () => {
    expect((await app.request(SQUARE, {}, WITH_PETROLEUM)).status).toBe(401);
    db.memberships.mockResolvedValueOnce([]);
    const res = await app.request(SQUARE, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(403);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(gridCalls()).toHaveLength(0);
  });

  it('refuses another level, a zoom the level is not asked at, or a square outside Alberta', async () => {
    for (const path of [
      '/api/v1/petroleum/grid/parcel/11/359/652',
      '/api/v1/petroleum/grid/section/10/179/326',
      '/api/v1/petroleum/grid/section/11/359/652.5',
      '/api/v1/petroleum/grid/township/9/70/170',
    ]) {
      const res = await app.request(path, { headers: AUTH }, WITH_PETROLEUM);
      expect(res.status, path).toBe(404);
    }
    expect(gridCalls()).toHaveLength(0);
  });

  it('says plainly when the province fails or answers with its own error', async () => {
    grid = new Response('{"error":{"code":500}}', {
      headers: { 'Content-Type': 'application/json' },
    });
    let res = await app.request(SQUARE, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ error: { code: 'GRID_SERVICE_FAILED' } });
    grid = new Error('down');
    res = await app.request(SQUARE, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(502);
  });
});

describe('GET /api/v1/petroleum/grid/at', () => {
  const AT = '/api/v1/petroleum/grid/at?lon=-116.8&lat=54.4';
  const LSD = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-116.795088, 54.403176],
              [-116.801102, 54.403175],
              [-116.801102, 54.399561],
              [-116.795088, 54.403176],
            ],
          ],
        },
        properties: { M: 5, RGE: 19, TWP: 62, SEC: 33, QS: 'SW', LS: 4 },
      },
    ],
  });

  it('names the legal subdivision under the point, with its outline', async () => {
    grid = new Response(LSD, { headers: { 'Content-Type': 'application/geo+json' } });
    const res = await app.request(AT, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      square: {
        meridian: 5,
        range: 19,
        township: 62,
        section: 33,
        quarter: 'SW',
        lsd: 4,
        legal: '04-33-062-19W5',
        shape: {
          type: 'Polygon',
          coordinates: [
            [
              [-116.795088, 54.403176],
              [-116.801102, 54.403175],
              [-116.801102, 54.399561],
              [-116.795088, 54.403176],
            ],
          ],
        },
      },
    });
    const [url] = gridCalls()[0] ?? [];
    expect(url).toBe(gridPointUrl({ lon: -116.8, lat: 54.4 }));
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('answers no square on a road allowance, and says when the province fails', async () => {
    let res = await app.request(AT, { headers: AUTH }, WITH_PETROLEUM);
    expect(await res.json()).toEqual({ square: null });
    grid = new Response('{"error":{"code":400}}', {
      headers: { 'Content-Type': 'application/json' },
    });
    res = await app.request(AT, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(502);
  });

  it('refuses a point outside Alberta or a person who is not a member, asking nothing', async () => {
    for (const path of [
      '/api/v1/petroleum/grid/at?lon=-100&lat=54',
      '/api/v1/petroleum/grid/at?lon=-116.8',
      '/api/v1/petroleum/grid/at?lon=1e2&lat=54',
    ]) {
      expect((await app.request(path, { headers: AUTH }, WITH_PETROLEUM)).status, path).toBe(400);
    }
    db.memberships.mockResolvedValueOnce([]);
    expect((await app.request(AT, { headers: AUTH }, WITH_PETROLEUM)).status).toBe(403);
    expect(gridCalls()).toHaveLength(0);
  });
});

describe('the square asked of the province', () => {
  it('is built from fixed values: the level, its fields, the land without road allowances', () => {
    const url = new URL(gridSquareUrl('section', { z: 11, x: 359, y: 652 }));
    expect(url.origin + url.pathname).toBe(
      'https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer/18/query',
    );
    expect(url.searchParams.get('outFields')).toBe('M,RGE,TWP,SEC');
    expect(url.searchParams.get('where')).toBe("RA = ' '");
    expect(url.searchParams.get('f')).toBe('geojson');
    const township = new URL(gridSquareUrl('township', { z: 9, x: 89, y: 162 }));
    expect(township.pathname).toMatch(/\/MapServer\/14\/query$/);
    expect(township.searchParams.get('where')).toBe('1=1');
  });

  it('is only a square of the level, at its zoom, inside Alberta', () => {
    // Fox Creek's square at zoom 13, and the one holding it at zoom 12.
    expect(parseGridSquare('lsd', '13', '1438', '2614')).toEqual({ z: 13, x: 1438, y: 2614 });
    expect(parseGridSquare('lsd', '12', '719', '1307')).toBeNull();
    expect(parseGridSquare('township', '9', '-1', '162')).toBeNull();
    expect(parseGridSquare('township', '9', '1e2', '162')).toBeNull();
  });

  it('asks for the legal subdivision at a point, the land without road allowances', () => {
    const url = new URL(gridPointUrl({ lon: -116.8, lat: 54.4 }));
    expect(url.pathname).toMatch(/\/MapServer\/20\/query$/);
    expect(url.searchParams.get('geometryType')).toBe('esriGeometryPoint');
    expect(url.searchParams.get('geometry')).toBe('-116.800000,54.400000');
    expect(url.searchParams.get('where')).toBe("RA = ' '");
    expect(parseGridPoint('-116.8', '54.4')).toEqual({ lon: -116.8, lat: 54.4 });
    expect(parseGridPoint('-116.8', '61')).toBeNull();
    expect(parseGridPoint(undefined, '54')).toBeNull();
  });
});
