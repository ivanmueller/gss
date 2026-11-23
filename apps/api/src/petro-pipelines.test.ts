import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import {
  parsePipelineId,
  parsePipelineSquare,
  PIPELINE_SQUARE_MAX,
  PIPELINES_SCHEMA_VERSION,
  pipelineSegmentAnswer,
  pipelineSquareAnswer,
} from './petro-pipelines';
import type { PipelineLineRow, PipelineSegmentRow } from './petro-pipelines-db';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// The pipelines routes (F-249): the AER's pipelines of the area loaded, square by square, and
// one segment's details; membership first. Made-up segments only.

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

/** A square of every line near Fox Creek, and the larger squares of the large and long lines. */
const ALL_SQUARE = '/api/v1/petroleum/pipelines/10/178/327';
const MID_SQUARE = '/api/v1/petroleum/pipelines/8/44/81';
const FAR_SQUARE = '/api/v1/petroleum/pipelines/6/11/20';

const line = (over: Partial<PipelineLineRow>): PipelineLineRow => ({
  id: '1',
  licence_number: '11130',
  line_number: '1',
  licensee_code: 'A0X1',
  licensee: 'Example Pipelines Ltd.',
  status: 'Operating',
  substance: 'Natural Gas',
  diameter_mm: 323.9,
  path: [-11650000, 5410000, -11640000, 5420000],
  breaks: [],
  ...over,
});
const LOAD = {
  loadedAt: '2026-11-23T04:00:00.000Z',
  fileDate: '2026-11-22',
  area: { west: -119.86, south: 51.32, east: -110.97, north: 56.23 },
  segments: 2,
};

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  petroleum.schemaVersion.mockResolvedValue(PIPELINES_SCHEMA_VERSION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  petroleum = fakePetroleum();
  openPetroleum.mockClear();
});

describe('parsePipelineSquare', () => {
  it('takes the four square zooms the map asks at, in Alberta, and nothing else', () => {
    expect(parsePipelineSquare('10', '178', '327')).toEqual({
      level: 'all',
      tile: { z: 10, x: 178, y: 327 },
    });
    expect(parsePipelineSquare('9', '89', '163')).toEqual({
      level: 'near',
      tile: { z: 9, x: 89, y: 163 },
    });
    expect(parsePipelineSquare('8', '44', '81')).toEqual({
      level: 'mid',
      tile: { z: 8, x: 44, y: 81 },
    });
    expect(parsePipelineSquare('6', '11', '20')).toEqual({
      level: 'far',
      tile: { z: 6, x: 11, y: 20 },
    });
    expect(parsePipelineSquare('7', '22', '40')).toBeNull();
    expect(parsePipelineSquare('11', '356', '654')).toBeNull();
    // Toronto, at a zoom the map asks at.
    expect(parsePipelineSquare('10', '284', '374')).toBeNull();
    expect(parsePipelineSquare('10', '-1', '327')).toBeNull();
    expect(parsePipelineSquare('10', '178.5', '327')).toBeNull();
    expect(parsePipelineSquare('10', '178', '1024')).toBeNull();
  });

  it('reads a segment id as whole digits only', () => {
    expect(parsePipelineId('42')).toBe('42');
    expect(parsePipelineId('0')).toBeNull();
    expect(parsePipelineId('4.2')).toBeNull();
    expect(parsePipelineId('1234567890123')).toBeNull();
    expect(parsePipelineId(undefined)).toBeNull();
  });
});

describe('pipelineSquareAnswer', () => {
  it('writes each status, substance and company once and points to them', () => {
    const answer = pipelineSquareAnswer('all', LOAD, [
      line({}),
      line({
        id: '2',
        licence_number: '3115',
        line_number: null,
        licensee_code: null,
        licensee: null,
        status: 'Abandoned',
        substance: 'Sour Natural Gas',
        diameter_mm: null,
        path: [-11590000, 5360000, -11585000, 5365000, -11585000, 5365000, -11580000, 5370000],
        breaks: [2],
      }),
      line({ id: '3', line_number: '2' }),
    ]);
    expect(answer.statuses).toEqual(['Operating', 'Abandoned']);
    expect(answer.substances).toEqual(['Natural Gas', 'Sour Natural Gas']);
    expect(answer.companies).toEqual([{ code: 'A0X1', name: 'Example Pipelines Ltd.' }]);
    expect(answer.truncated).toBe(false);
    expect(answer.lines).toEqual([
      [1, '11130-1', 0, 0, 0, 323.9, [-11650000, 5410000, -11640000, 5420000], []],
      [
        2,
        '3115',
        1,
        1,
        -1,
        null,
        [-11590000, 5360000, -11585000, 5365000, -11585000, 5365000, -11580000, 5370000],
        [2],
      ],
      [3, '11130-2', 0, 0, 0, 323.9, [-11650000, 5410000, -11640000, 5420000], []],
    ]);
  });

  it('thins the large lines further, as the map draws them from farther out', () => {
    // Three points almost in line: the middle one 5 m off it, kept close in, dropped far out.
    const path = [-11650000, 5410000, -11645000, 5410005, -11640000, 5410000];
    expect(pipelineSquareAnswer('all', LOAD, [line({ path })]).lines[0]?.[6]).toEqual(path);
    expect(pipelineSquareAnswer('mid', LOAD, [line({ path })]).lines[0]?.[6]).toEqual([
      -11650000, 5410000, -11640000, 5410000,
    ]);
  });

  it('says when a square holds more lines than it sends', () => {
    const rows = [line({ id: '1' }), line({ id: '2' }), line({ id: '3' })];
    const answer = pipelineSquareAnswer('all', LOAD, rows, 2);
    expect(answer.lines).toHaveLength(2);
    expect(answer.truncated).toBe(true);
  });
});

describe('pipelineSegmentAnswer', () => {
  it('gives every column, numbers without trailing zeros', () => {
    const row: PipelineSegmentRow = {
      id: '7',
      segment_id: '51822',
      licence_number: '11130',
      line_number: '1',
      federal: false,
      licensee_code: 'A0X1',
      licensee: 'Example Pipelines Ltd.',
      status: 'Operating',
      substances: ['Natural Gas'],
      from_facility: 'Regulator Station',
      from_location: '16-33-044-24W4',
      to_facility: 'Regulator Station',
      to_location: '01-24-045-25W4',
      length_km: '10.270',
      diameter_mm: '508.00',
      wall_mm: '2.160',
      material: 'Steel',
      pipe_type: '5LX',
      pipe_grade: 'X42',
      max_pressure: '3100.00',
      h2s: '0.000',
      field_centre: 'Edmonton',
      licence_approved: '2002-09-20',
      last_occurrence_year: 1977,
      geometry_source: 'Mapping',
      west: -116.5,
      south: 54.1,
      east: -116.4,
      north: 54.2,
    };
    expect(pipelineSegmentAnswer(row)).toEqual({
      id: 7,
      segmentId: '51822',
      licence: '11130',
      line: '1',
      federal: false,
      licensee: { code: 'A0X1', name: 'Example Pipelines Ltd.' },
      status: 'Operating',
      substances: ['Natural Gas'],
      from: { facility: 'Regulator Station', location: '16-33-044-24W4' },
      to: { facility: 'Regulator Station', location: '01-24-045-25W4' },
      lengthKm: '10.27',
      diameterMm: '508',
      wallMm: '2.16',
      material: 'Steel',
      pipeType: '5LX',
      pipeGrade: 'X42',
      maxPressure: '3100',
      h2s: '0',
      fieldCentre: 'Edmonton',
      licenceApproved: '2002-09-20',
      lastOccurrenceYear: 1977,
      geometrySource: 'Mapping',
      bounds: [-116.5, 54.1, -116.4, 54.2],
    });
  });
});

describe('GET /api/v1/petroleum/pipelines/:z/:x/:y', () => {
  it('sends a member the lines touching a square, kept until they change', async () => {
    petroleum.pipelineSquare.mockResolvedValueOnce({ load: LOAD, rows: [line({})] });
    const res = await app.request(ALL_SQUARE, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    const tag = res.headers.get('ETag');
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/);
    const body = await res.json<{ load: unknown; level: string; lines: unknown[] }>();
    expect(body.load).toEqual(LOAD);
    expect(body.level).toBe('all');
    expect(body.lines).toHaveLength(1);
    // Every line, one more than is sent to know whether the square holds more.
    const [ctx, box, minimum, limit] = petroleum.pipelineSquare.mock.calls[0] ?? [];
    expect(ctx).toEqual({
      userId: USER_ID,
      organizationId: 'org-a',
      role: 'trader',
      requestId: expect.any(String) as string,
    });
    expect(box?.west).toBeCloseTo(-117.421875, 6);
    expect(box?.east).toBeCloseTo(-117.0703125, 6);
    expect(minimum).toEqual({ minDiameterMm: 0, minLengthKm: 0 });
    expect(limit).toBe(PIPELINE_SQUARE_MAX + 1);

    petroleum.pipelineSquare.mockResolvedValueOnce({ load: LOAD, rows: [line({})] });
    const again = await app.request(
      ALL_SQUARE,
      { headers: { ...AUTH, 'If-None-Match': tag ?? '' } },
      WITH_PETROLEUM,
    );
    expect(again.status).toBe(304);
  });

  it('asks for the large and long lines only in the farther squares', async () => {
    expect((await app.request(MID_SQUARE, { headers: AUTH }, WITH_PETROLEUM)).status).toBe(200);
    expect(petroleum.pipelineSquare.mock.calls[0]?.[2]).toEqual({
      minDiameterMm: 168.3,
      minLengthKm: 2,
    });
    expect((await app.request(FAR_SQUARE, { headers: AUTH }, WITH_PETROLEUM)).status).toBe(200);
    expect(petroleum.pipelineSquare.mock.calls[1]?.[2]).toEqual({
      minDiameterMm: 219.1,
      minLengthKm: 5,
    });
  });

  it('refuses another square without opening any database', async () => {
    for (const path of [
      '/api/v1/petroleum/pipelines/7/22/40',
      '/api/v1/petroleum/pipelines/10/284/374',
      '/api/v1/petroleum/pipelines/10/x/327',
    ]) {
      const res = await app.request(path, { headers: AUTH }, WITH_PETROLEUM);
      expect(res.status).toBe(404);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses a person who is not a member, without opening the oil and gas database', async () => {
    db.memberships.mockResolvedValueOnce([]);
    const res = await app.request(ALL_SQUARE, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
    expect((await app.request(ALL_SQUARE, {}, WITH_PETROLEUM)).status).toBe(401);
  });

  it('waits for the migration it needs', async () => {
    petroleum.schemaVersion.mockResolvedValue(PIPELINES_SCHEMA_VERSION - 1);
    const res = await app.request(ALL_SQUARE, { headers: AUTH }, WITH_PETROLEUM);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'PETROLEUM_NOT_READY' } });
    expect(petroleum.pipelineSquare).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/petroleum/pipelines/segment/:id', () => {
  it('answers 404 for a segment not loaded, and for an id that is not one', async () => {
    const res = await app.request(
      '/api/v1/petroleum/pipelines/segment/42',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(res.status).toBe(404);
    expect(petroleum.pipelineSegment.mock.calls[0]?.[1]).toBe('42');
    const odd = await app.request(
      '/api/v1/petroleum/pipelines/segment/4x',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(odd.status).toBe(404);
  });

  it('refuses a person who is not a member, without opening the oil and gas database', async () => {
    db.memberships.mockResolvedValueOnce([]);
    const res = await app.request(
      '/api/v1/petroleum/pipelines/segment/42',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
  });
});
