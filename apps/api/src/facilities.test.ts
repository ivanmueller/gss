import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAP_LIMIT, type Database, type MapFacility } from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };
const PRAIRIES = '-110,49,-95,60';

function facility(name: string): MapFacility {
  return {
    id: '00000000-0000-4000-8000-00000000fac1',
    counterpartyId: '00000000-0000-4000-8000-00000000c0aa',
    legalName: 'Synthetic Prairie Mills',
    tradingName: null,
    counterpartyTypes: ['buyer'],
    name,
    facilityType: 'elevator',
    city: 'Synthetic Town',
    region: 'SK',
    country: 'CA',
    latitude: '52.133214',
    longitude: '-106.670046',
    locationPrecision: 'exact',
  };
}

function request(query: string, init: RequestInit = { headers: AUTH }) {
  return app.request(`/api/v1/facilities${query}`, init, ENV);
}

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'olivia@example.test' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  openDatabase.mockClear();
});

describe('GET /api/v1/facilities', () => {
  it('requires sign-in', async () => {
    const res = await request(`?bbox=${PRAIRIES}`, {});
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('returns the facilities in the box for the verified user, uncached', async () => {
    db.facilitiesInBbox.mockResolvedValueOnce({
      facilities: [facility('Synthetic Elevator')],
      withoutCoordinates: 2,
    });
    const res = await request(`?bbox=${PRAIRIES}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      facilities: [facility('Synthetic Elevator')],
      truncated: false,
      withoutCoordinates: 2,
    });
    const requestId = res.headers.get('x-request-id');
    expect(db.facilitiesInBbox).toHaveBeenCalledWith({ userId: USER_ID, requestId }, null, {
      west: -110,
      south: 49,
      east: -95,
      north: 60,
    });
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('filters by organization and refuses a malformed organization id', async () => {
    await request(`?bbox=${PRAIRIES}&organization_id=${ORG}`);
    expect(db.facilitiesInBbox).toHaveBeenCalledWith(expect.anything(), ORG, expect.anything());

    openDatabase.mockClear();
    const res = await request(`?bbox=${PRAIRIES}&organization_id=org-a`);
    expect(res.status).toBe(422);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'missing'],
    ['?bbox=', 'empty'],
    ['?bbox=-110,49,-95', 'incomplete'],
    ['?bbox=170,49,-170,60', 'crossing the antimeridian'],
  ])('refuses a bbox that is %s without asking the database (%s)', async (query) => {
    const res = await request(query);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('says when the facilities were cut at the limit', async () => {
    db.facilitiesInBbox.mockResolvedValueOnce({
      facilities: Array.from({ length: MAP_LIMIT + 1 }, (_, index) =>
        facility(`Synthetic ${String(index)}`),
      ),
      withoutCoordinates: 0,
    });
    const body: { facilities: unknown[]; truncated: boolean } = await (
      await request(`?bbox=${PRAIRIES}`)
    ).json();
    expect(body.facilities).toHaveLength(MAP_LIMIT);
    expect(body.truncated).toBe(true);
  });

  it('fails closed and disconnects when the database errors', async () => {
    db.facilitiesInBbox.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(`?bbox=${PRAIRIES}`);
    expect(res.status).toBe(503);
    expect(db.close).toHaveBeenCalledTimes(1);
  });
});
