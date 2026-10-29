import type { FreightDetail } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Synthetic values only; no real freight rates.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const CARRIER = '00000000-0000-4000-8000-00000000d1aa';
const COUNTERPARTY = '00000000-0000-4000-8000-00000000c1aa';
const ORIGIN = '00000000-0000-4000-8000-000000000f2a';
const DESTINATION = '00000000-0000-4000-8000-000000000f1a';
const FREIGHT = '00000000-0000-4000-8000-00000000e001';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

function future(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

const VALUES = {
  firmness: 'firm',
  rate: '105.00',
  currency: 'CAD',
  rateUnit: 'MT',
  sourceType: 'email',
  validUntil: future(48),
};

const DETAIL: FreightDetail = {
  id: FREIGHT,
  mode: 'truck',
  carrier: { id: CARRIER, legalName: 'Synthetic Carrier', tradingName: null, archived: false },
  origin: {
    id: ORIGIN,
    name: null,
    city: 'Synthetic City',
    region: 'SK',
    country: 'CA',
    counterparty: { id: COUNTERPARTY, legalName: 'Synthetic Seller', archived: false },
  },
  destination: {
    id: DESTINATION,
    name: 'Synthetic Mill',
    city: 'Synthetic Town',
    region: 'MN',
    country: 'US',
    counterparty: { id: COUNTERPARTY, legalName: 'Synthetic Buyer', archived: false },
  },
  status: 'firm',
  withdrawnAt: null,
  createdAt: '2026-10-29T14:00:00.000Z',
  current: {
    id: '00000000-0000-4000-8000-0000000000e1',
    revisionNumber: 1,
    firmness: 'firm',
    rate: '105.00',
    currency: 'CAD',
    rateUnit: 'MT',
    payload: null,
    payloadUnit: null,
    inclusions: null,
    quotedAt: '2026-10-29T14:00:00.000Z',
    validUntil: '2026-11-05T14:00:00.000Z',
    sourceType: 'email',
    sourceReference: null,
    notes: null,
    recordedByName: 'Tess Trader',
    recordedAt: '2026-10-29T14:00:00.000Z',
  },
  revisions: [],
  withdrawnByName: null,
};

function request(method: string, path: string, body?: unknown) {
  return app.request(
    `/api/v1${path}`,
    { method, headers: AUTH, ...(body !== undefined && { body: JSON.stringify(body) }) },
    ENV,
  );
}

const newFreight = (extra: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  carrierId: CARRIER,
  originFacilityId: ORIGIN,
  destinationFacilityId: DESTINATION,
  mode: 'truck',
  values: VALUES,
  ...extra,
});

beforeEach(() => {
  mockAuthServer(
    Response.json({
      id: USER_ID,
      email: 'tess@example.test',
      user_metadata: { first_name: 'Tess', last_name: 'Trader' },
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  openDatabase.mockClear();
});

describe('/api/v1/freight-quotes', () => {
  it.each([
    ['GET', '/freight-quotes'],
    ['GET', `/freight-quotes/${FREIGHT}`],
    ['POST', '/freight-quotes'],
    ['POST', `/freight-quotes/${FREIGHT}/revisions`],
    ['POST', `/freight-quotes/${FREIGHT}/withdraw`],
  ])('%s %s requires sign-in', async (method, path) => {
    const res = await app.request(`/api/v1${path}`, { method }, ENV);
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('lists live rates by default and everything when asked, with the filters given', async () => {
    const res = await request(
      'GET',
      `/freight-quotes?organization_id=${ORG}&carrier_id=${CARRIER}&mode=rail`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ freight: [], truncated: false });
    expect(db.listFreight).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }), {
      organizationId: ORG,
      carrierId: CARRIER,
      facilityId: null,
      counterpartyId: null,
      mode: 'rail',
      liveOnly: true,
    });
    await request(
      'GET',
      `/freight-quotes?facility_id=${ORIGIN}&counterparty_id=${COUNTERPARTY}&status=all`,
    );
    expect(db.listFreight).toHaveBeenLastCalledWith(expect.anything(), {
      organizationId: null,
      carrierId: null,
      facilityId: ORIGIN,
      counterpartyId: COUNTERPARTY,
      mode: null,
      liveOnly: false,
    });
  });

  it.each([
    '?organization_id=org-a',
    '?carrier_id=1',
    '?facility_id=x',
    '?counterparty_id=y',
    '?mode=barge',
    '?status=expired',
  ])('refuses the filter %s', async (query) => {
    expect((await request('GET', `/freight-quotes${query}`)).status).toBe(422);
    expect(db.listFreight).not.toHaveBeenCalled();
  });

  it('says when the list is cut', async () => {
    db.listFreight.mockResolvedValueOnce(Array.from({ length: 2001 }, () => DETAIL));
    const body: { freight: unknown[]; truncated: boolean } = await (
      await request('GET', '/freight-quotes')
    ).json();
    expect(body.freight).toHaveLength(2000);
    expect(body.truncated).toBe(true);
  });

  it('answers one rate, or 404 for a missing or malformed id', async () => {
    db.getFreight.mockResolvedValueOnce(DETAIL);
    const res = await request('GET', `/freight-quotes/${FREIGHT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DETAIL);
    expect((await request('GET', `/freight-quotes/${FREIGHT}`)).status).toBe(404);
    expect((await request('GET', '/freight-quotes/not-a-uuid')).status).toBe(404);
  });

  it('enters a rate with the checked terms and the recorder’s name from their login', async () => {
    db.getFreight.mockResolvedValueOnce(DETAIL);
    const res = await request(
      'POST',
      '/freight-quotes',
      newFreight({
        recordedByName: 'Someone Else',
        values: { ...VALUES, rateUnit: 'LOAD', payload: '48000', payloadUnit: 'LB' },
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(DETAIL);
    expect(db.createFreight).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }), {
      organizationId: ORG,
      carrierId: CARRIER,
      originFacilityId: ORIGIN,
      destinationFacilityId: DESTINATION,
      mode: 'truck',
      terms: expect.objectContaining({
        rate: '105.00',
        rateUnit: 'LOAD',
        payload: '48000',
        payloadUnit: 'LB',
        validUntil: VALUES.validUntil,
      }) as unknown,
      recordedByName: 'Tess Trader',
    });
  });

  it('answers each field problem in place and writes nothing', async () => {
    const res = await request(
      'POST',
      '/freight-quotes',
      newFreight({ values: { ...VALUES, rate: '0', rateUnit: 'LOAD' } }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
      issues: [
        { field: 'rate', message: 'must be more than zero' },
        { field: 'payload', message: 'is required for a rate per load' },
        { field: 'payloadUnit', message: 'is required' },
      ],
    });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('refuses a malformed request before reading the terms', async () => {
    for (const body of [
      newFreight({ mode: 'barge' }),
      newFreight({ carrierId: 'k1a' }),
      newFreight({ originFacilityId: undefined }),
      newFreight({ values: { rate: 105 } }),
      { values: VALUES },
    ]) {
      expect((await request('POST', '/freight-quotes', body)).status).toBe(422);
    }
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'forbidden' }, 403, 'FORBIDDEN'],
    [{ status: 'carrier_not_found' }, 422, 'CARRIER_NOT_FOUND'],
    [{ status: 'not_a_carrier' }, 422, 'NOT_A_CARRIER'],
    [{ status: 'archived' }, 409, 'ARCHIVED'],
    [{ status: 'origin_not_found' }, 422, 'ORIGIN_NOT_FOUND'],
    [{ status: 'destination_not_found' }, 422, 'DESTINATION_NOT_FOUND'],
    [{ status: 'same_location' }, 422, 'SAME_LOCATION'],
  ] as const)('answers %o with %i %s', async (result, status, code) => {
    db.createFreight.mockResolvedValueOnce(result);
    const res = await request('POST', '/freight-quotes', newFreight());
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: { code } });
  });

  it('records new terms on the revision the person saw', async () => {
    db.getFreight.mockResolvedValueOnce(DETAIL);
    const res = await request('POST', `/freight-quotes/${FREIGHT}/revisions`, {
      basedOnRevision: 1,
      values: { ...VALUES, rate: '98.50' },
    });
    expect(res.status).toBe(201);
    expect(db.reviseFreight).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      FREIGHT,
      1,
      expect.objectContaining({ rate: '98.50' }),
      'Tess Trader',
    );
    expect(
      (await request('POST', `/freight-quotes/${FREIGHT}/revisions`, { values: VALUES })).status,
    ).toBe(422);
  });

  it.each([
    [{ status: 'not_found' }, 404, 'NOT_FOUND'],
    [{ status: 'forbidden' }, 403, 'FORBIDDEN'],
    [{ status: 'changed', currentRevision: 3 }, 409, 'QUOTE_CHANGED'],
    [{ status: 'withdrawn' }, 409, 'WITHDRAWN'],
    [{ status: 'archived' }, 409, 'ARCHIVED'],
  ] as const)('answers a revision result %o with %i %s', async (result, status, code) => {
    db.reviseFreight.mockResolvedValueOnce(result);
    const res = await request('POST', `/freight-quotes/${FREIGHT}/revisions`, {
      basedOnRevision: 1,
      values: VALUES,
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: { code } });
  });

  it('withdraws a rate in the name of the signed-in person', async () => {
    db.getFreight.mockResolvedValueOnce({ ...DETAIL, status: 'withdrawn' });
    const res = await request('POST', `/freight-quotes/${FREIGHT}/withdraw`);
    expect(res.status).toBe(200);
    expect(db.withdrawFreight).toHaveBeenCalledWith(expect.anything(), FREIGHT, 'Tess Trader');
    db.withdrawFreight.mockResolvedValueOnce({ status: 'forbidden' });
    expect((await request('POST', `/freight-quotes/${FREIGHT}/withdraw`)).status).toBe(403);
  });

  it('maps a revision refused for a withdrawn rate, and a location with freight', async () => {
    db.reviseFreight.mockRejectedValueOnce(
      Object.assign(new Error('withdrawn'), { code: 'GS003' }),
    );
    const res = await request('POST', `/freight-quotes/${FREIGHT}/revisions`, {
      basedOnRevision: 1,
      values: VALUES,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'WITHDRAWN' } });

    for (const constraint of ['freight_quotes_origin_fkey', 'freight_quotes_destination_fkey']) {
      db.removeFacility.mockRejectedValueOnce(
        Object.assign(new Error('fk'), { code: '23503', constraint_name: constraint }),
      );
      const removed = await request(
        'DELETE',
        `/counterparties/${COUNTERPARTY}/facilities/${DESTINATION}`,
      );
      expect(removed.status).toBe(409);
      expect(await removed.json()).toMatchObject({ error: { code: 'LOCATION_HAS_FREIGHT' } });
    }
  });
});
