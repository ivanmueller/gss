import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { FACILITIES_SCHEMA_VERSION, facilitiesAnswer } from './petro-facilities';
import type { FacilityDbRow } from './petro-facilities-db';
import type { PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// The facilities route (F-278): the AER's facility list for the area loaded, membership first,
// in one small answer the browser keeps. Made-up facilities only.

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

const row = (over: Partial<FacilityDbRow>): FacilityDbRow => ({
  facility_id: 'ABBT0000001',
  name: 'EXAMPLE 14-29 BATTERY',
  operator_code: 'A0X1',
  operator: 'Example Energy Ltd.',
  sub_code: 311,
  sub_type: 'Crude Oil Single-Well Battery',
  licence_number: '6422',
  licence_type: 'F',
  licensee_code: 'A0X1',
  licensee: 'Example Energy Ltd.',
  status: 'Active',
  location_source: 'Facility Licence',
  longitude: '-116.500000',
  latitude: '54.200000',
  ...over,
});
const LOAD = {
  loadedAt: '2026-11-23T04:00:00.000Z',
  fileDate: '2026-11-02',
  area: { west: -119.86, south: 51.32, east: -110.97, north: 56.23 },
  facilities: 2,
};

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  petroleum.schemaVersion.mockResolvedValue(FACILITIES_SCHEMA_VERSION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  petroleum = fakePetroleum();
  openPetroleum.mockClear();
});

describe('facilitiesAnswer', () => {
  it('writes each subtype, status and company once and points to them', () => {
    const answer = facilitiesAnswer(LOAD, [
      row({}),
      row({
        facility_id: 'ABGP0000002',
        name: null,
        sub_code: 401,
        sub_type: 'Gas Plant Sweet',
        operator_code: 'B0Y2',
        operator: 'Other Example Corp.',
        licence_number: null,
        licence_type: null,
        licensee_code: null,
        licensee: null,
        status: 'Suspended',
        location_source: 'LSD Centre',
        longitude: '-115.500000',
        latitude: '53.500000',
      }),
    ]);
    expect(answer.subtypes).toEqual([
      { code: 311, name: 'Crude Oil Single-Well Battery', group: 'oil_battery' },
      { code: 401, name: 'Gas Plant Sweet', group: 'gas_plant' },
    ]);
    expect(answer.statuses).toEqual(['Active', 'Suspended']);
    expect(answer.companies).toEqual([
      { code: 'A0X1', name: 'Example Energy Ltd.' },
      { code: 'B0Y2', name: 'Other Example Corp.' },
    ]);
    expect(answer.located).toEqual([
      'Well Licence',
      'Facility Licence',
      'LSD Centre',
      'Section Centre',
    ]);
    expect(answer.facilities).toEqual([
      ['ABBT0000001', 'EXAMPLE 14-29 BATTERY', -116.5, 54.2, 0, 0, 0, 0, 'F 6422', 1],
      ['ABGP0000002', null, -115.5, 53.5, 1, 1, 1, -1, null, 2],
    ]);
  });
});

describe('GET /api/v1/petroleum/facilities', () => {
  it('sends a member every facility of the latest load, kept until it changes', async () => {
    petroleum.facilities.mockResolvedValueOnce({ load: LOAD, rows: [row({})] });
    const res = await app.request(
      '/api/v1/petroleum/facilities',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    const tag = res.headers.get('ETag');
    expect(tag).toMatch(/^"[0-9a-f]{32}"$/);
    const body = await res.json<{ load: unknown; facilities: unknown[] }>();
    expect(body.load).toEqual(LOAD);
    expect(body.facilities).toHaveLength(1);
    expect(petroleum.facilities).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: 'org-a',
      role: 'trader',
      requestId: expect.any(String) as string,
    });

    petroleum.facilities.mockResolvedValueOnce({ load: LOAD, rows: [row({})] });
    const again = await app.request(
      '/api/v1/petroleum/facilities',
      { headers: { ...AUTH, 'If-None-Match': tag ?? '' } },
      WITH_PETROLEUM,
    );
    expect(again.status).toBe(304);
  });

  it('refuses a person who is not a member, without opening the oil and gas database', async () => {
    db.memberships.mockResolvedValueOnce([]);
    const res = await app.request(
      '/api/v1/petroleum/facilities',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(res.status).toBe(403);
    expect(openPetroleum).not.toHaveBeenCalled();
    expect((await app.request('/api/v1/petroleum/facilities', {}, WITH_PETROLEUM)).status).toBe(
      401,
    );
  });

  it('waits for the migration it needs', async () => {
    petroleum.schemaVersion.mockResolvedValue(14);
    const res = await app.request(
      '/api/v1/petroleum/facilities',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'PETROLEUM_NOT_READY' } });
    expect(petroleum.facilities).not.toHaveBeenCalled();
  });
});
