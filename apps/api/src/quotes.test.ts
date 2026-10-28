import type { QuoteDetail } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { recorderName } from './quotes';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Synthetic values only; no market prices.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const COUNTERPARTY = '00000000-0000-4000-8000-00000000c1aa';
const FACILITY = '00000000-0000-4000-8000-000000000f1a';
const QUOTE = '00000000-0000-4000-8000-00000000a001';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

function future(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

const VALUES = {
  firmness: 'firm',
  price: '725.00',
  currency: 'USD',
  priceUnit: 'MT',
  deliveryBasis: 'delivered',
  quantityMax: '84',
  sourceType: 'phone',
  validUntil: future(48),
};

const DETAIL: QuoteDetail = {
  id: QUOTE,
  side: 'bid',
  commodity: { code: 'flaxseed', name: 'Flaxseed' },
  counterparty: {
    id: COUNTERPARTY,
    legalName: 'Synthetic Buyer',
    tradingName: null,
    archived: false,
  },
  facility: null,
  status: 'firm',
  withdrawnAt: null,
  createdAt: '2026-10-28T14:00:00.000Z',
  current: {
    id: '00000000-0000-4000-8000-0000000000r1',
    revisionNumber: 1,
    firmness: 'firm',
    price: '725.00',
    currency: 'USD',
    priceUnit: 'MT',
    grade: null,
    deliveryBasis: 'delivered',
    basisLocation: null,
    quantityMinMt: null,
    quantityMaxMt: '84.000',
    deliveryStart: null,
    deliveryEnd: null,
    quotedAt: '2026-10-28T14:00:00.000Z',
    validUntil: '2026-10-30T14:00:00.000Z',
    sourceType: 'phone',
    sourceReference: null,
    notes: null,
    recordedByName: 'Tess Trader',
    recordedAt: '2026-10-28T14:00:00.000Z',
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

const newQuote = (extra: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  counterpartyId: COUNTERPARTY,
  side: 'bid',
  commodity: 'flaxseed',
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

describe('/api/v1/quotes', () => {
  it.each([
    ['GET', '/quotes'],
    ['GET', `/quotes/${QUOTE}`],
    ['POST', '/quotes'],
    ['POST', `/quotes/${QUOTE}/revisions`],
    ['POST', `/quotes/${QUOTE}/withdraw`],
    ['GET', '/commodities'],
  ])('%s %s requires sign-in', async (method, path) => {
    const res = await app.request(`/api/v1${path}`, { method }, ENV);
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('lists live quotes by default and everything when asked, with the filters given', async () => {
    const res = await request('GET', `/quotes?organization_id=${ORG}&side=bid&commodity=flaxseed`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quotes: [], truncated: false });
    expect(db.listQuotes).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }), {
      organizationId: ORG,
      counterpartyId: null,
      side: 'bid',
      commodity: 'flaxseed',
      liveOnly: true,
    });
    await request('GET', `/quotes?counterparty_id=${COUNTERPARTY}&status=all`);
    expect(db.listQuotes).toHaveBeenLastCalledWith(expect.anything(), {
      organizationId: null,
      counterpartyId: COUNTERPARTY,
      side: null,
      commodity: null,
      liveOnly: false,
    });
  });

  it.each([
    '?organization_id=org-a',
    '?counterparty_id=1',
    '?side=ask',
    '?commodity=Flax%20seed',
    '?status=expired',
  ])('refuses the filter %s', async (query) => {
    expect((await request('GET', `/quotes${query}`)).status).toBe(422);
    expect(db.listQuotes).not.toHaveBeenCalled();
  });

  it('answers one quote, or 404 for a missing or malformed id', async () => {
    db.getQuote.mockResolvedValueOnce(DETAIL);
    const res = await request('GET', `/quotes/${QUOTE}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DETAIL);
    expect((await request('GET', `/quotes/${QUOTE}`)).status).toBe(404);
    expect((await request('GET', '/quotes/not-a-uuid')).status).toBe(404);
  });

  it('enters a quote with the checked terms and the recorder’s name from their login', async () => {
    db.getQuote.mockResolvedValueOnce(DETAIL);
    const res = await request('POST', '/quotes', newQuote({ facilityId: FACILITY }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(DETAIL);
    expect(db.createQuote).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }), {
      organizationId: ORG,
      counterpartyId: COUNTERPARTY,
      facilityId: FACILITY,
      side: 'bid',
      commodity: 'flaxseed',
      terms: expect.objectContaining({
        price: '725.00',
        currency: 'USD',
        quantityMaxMt: '84',
        validUntil: VALUES.validUntil,
      }) as unknown,
      recordedByName: 'Tess Trader',
    });
  });

  it('ignores a recorder name sent in the request', async () => {
    await request('POST', '/quotes', newQuote({ recordedByName: 'Someone Else' }));
    expect(db.createQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recordedByName: 'Tess Trader' }),
    );
  });

  it('answers each field problem in place and writes nothing', async () => {
    const res = await request(
      'POST',
      '/quotes',
      newQuote({ values: { ...VALUES, price: '0', validUntil: '2020-01-01T00:00:00Z' } }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
      issues: [
        { field: 'price', message: 'must be more than zero' },
        { field: 'validUntil', message: 'must be later than now' },
      ],
    });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('refuses a malformed request before reading the terms', async () => {
    for (const body of [
      newQuote({ side: 'ask' }),
      newQuote({ organizationId: 'org-a' }),
      newQuote({ values: { price: 725 } }),
      { values: VALUES },
    ]) {
      expect((await request('POST', '/quotes', body)).status).toBe(422);
    }
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'forbidden' }, 403, 'FORBIDDEN'],
    [{ status: 'counterparty_not_found' }, 422, 'COUNTERPARTY_NOT_FOUND'],
    [{ status: 'archived' }, 409, 'ARCHIVED'],
    [{ status: 'wrong_type', types: ['seller'] }, 422, 'WRONG_COUNTERPARTY_TYPE'],
    [{ status: 'facility_not_found' }, 422, 'FACILITY_NOT_FOUND'],
    [{ status: 'commodity_not_found' }, 422, 'COMMODITY_NOT_FOUND'],
  ] as const)('answers %o with %i %s', async (result, status, code) => {
    db.createQuote.mockResolvedValueOnce(result as never);
    const res = await request('POST', '/quotes', newQuote());
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: { code } });
  });

  it('says what a bid needs from its counterparty', async () => {
    db.createQuote.mockResolvedValueOnce({ status: 'wrong_type', types: ['seller'] });
    const res = await request('POST', '/quotes', newQuote());
    expect(await res.json()).toMatchObject({
      error: {
        message:
          'Bids come from a buyer or broker. Mark this counterparty as a buyer on its page first.',
      },
    });
  });

  it('records new terms on the revision the person saw', async () => {
    db.getQuote.mockResolvedValueOnce(DETAIL);
    const res = await request('POST', `/quotes/${QUOTE}/revisions`, {
      basedOnRevision: 1,
      values: { ...VALUES, price: '730.50' },
    });
    expect(res.status).toBe(201);
    expect(db.reviseQuote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      QUOTE,
      1,
      expect.objectContaining({ price: '730.50' }),
      'Tess Trader',
    );
    // Without the revision it was based on, new terms are refused.
    expect((await request('POST', `/quotes/${QUOTE}/revisions`, { values: VALUES })).status).toBe(
      422,
    );
  });

  it.each([
    [{ status: 'not_found' }, 404, 'NOT_FOUND'],
    [{ status: 'forbidden' }, 403, 'FORBIDDEN'],
    [{ status: 'changed', currentRevision: 3 }, 409, 'QUOTE_CHANGED'],
    [{ status: 'withdrawn' }, 409, 'WITHDRAWN'],
    [{ status: 'archived' }, 409, 'ARCHIVED'],
  ] as const)('answers a revision result %o with %i %s', async (result, status, code) => {
    db.reviseQuote.mockResolvedValueOnce(result);
    const res = await request('POST', `/quotes/${QUOTE}/revisions`, {
      basedOnRevision: 1,
      values: VALUES,
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: { code } });
  });

  it('withdraws a quote in the name of the signed-in person', async () => {
    db.getQuote.mockResolvedValueOnce({ ...DETAIL, status: 'withdrawn' });
    const res = await request('POST', `/quotes/${QUOTE}/withdraw`);
    expect(res.status).toBe(200);
    expect(db.withdrawQuote).toHaveBeenCalledWith(expect.anything(), QUOTE, 'Tess Trader');
    db.withdrawQuote.mockResolvedValueOnce({ status: 'forbidden' });
    expect((await request('POST', `/quotes/${QUOTE}/withdraw`)).status).toBe(403);
  });

  it('lists commodities for a signed-in user', async () => {
    db.listCommodities.mockResolvedValueOnce([{ code: 'flaxseed', name: 'Flaxseed' }]);
    const res = await request('GET', '/commodities');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commodities: [{ code: 'flaxseed', name: 'Flaxseed' }] });
  });

  it('maps a revision refused by the database for a withdrawn quote, and a location with quotes', async () => {
    db.reviseQuote.mockRejectedValueOnce(Object.assign(new Error('withdrawn'), { code: 'GS002' }));
    const res = await request('POST', `/quotes/${QUOTE}/revisions`, {
      basedOnRevision: 1,
      values: VALUES,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'WITHDRAWN' } });

    db.removeFacility.mockRejectedValueOnce(
      Object.assign(new Error('fk'), { code: '23503', constraint_name: 'quotes_facility_fkey' }),
    );
    const removed = await request(
      'DELETE',
      `/counterparties/${COUNTERPARTY}/facilities/${FACILITY}`,
    );
    expect(removed.status).toBe(409);
    expect(await removed.json()).toMatchObject({ error: { code: 'LOCATION_HAS_QUOTES' } });
  });
});

describe('recorderName', () => {
  const user = { id: USER_ID, email: 'tess@example.test', mustChangePassword: false };

  it('is the name from the login, or the email without one', () => {
    expect(recorderName({ ...user, firstName: 'Tess', lastName: 'Trader' })).toBe('Tess Trader');
    expect(recorderName({ ...user, firstName: 'Tess', lastName: null })).toBe('Tess');
    expect(recorderName({ ...user, firstName: null, lastName: null })).toBe('tess@example.test');
    expect(recorderName({ ...user, email: null, firstName: null, lastName: null })).toBe(
      'GSS staff member',
    );
  });

  it('fits the database’s label: one line, at most 200 characters', () => {
    expect(recorderName({ ...user, firstName: 'Tess\n\u0007', lastName: 'x'.repeat(300) })).toMatch(
      /^Tess x{195}$/,
    );
  });
});
