import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import {
  BankOfCanadaError,
  fetchBankOfCanadaRates,
  parseValetObservations,
  refreshFxRates,
  VALET_URL,
} from './fx';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Synthetic rates only, in the shape of the Bank of Canada's Valet answer.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

// Thursday 29 October 2026, 22:15 UTC: 18:15 in Ottawa.
const NOW = new Date('2026-10-29T22:15:00Z');

function valet(observations: unknown[]) {
  return {
    terms: { url: 'https://www.bankofcanada.ca/terms/' },
    seriesDetail: { FXUSDCAD: { label: 'USD/CAD', description: 'US dollar to Canadian dollar' } },
    observations,
  };
}

const obs = (d: string, v: string) => ({ d, FXUSDCAD: { v } });

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  db = fakeDatabase();
  openDatabase.mockClear();
});

describe('parseValetObservations', () => {
  it('reads the rates oldest first, exactly as published', () => {
    const body = valet([obs('2026-10-28', '1.3912'), obs('2026-10-27', '1.3900')]);
    expect(parseValetObservations(body, '2026-10-29')).toEqual({
      rates: [
        { date: '2026-10-27', cadPerUsd: '1.3900' },
        { date: '2026-10-28', cadPerUsd: '1.3912' },
      ],
      skipped: 0,
    });
  });

  it.each([
    ['a day without a value', { d: '2026-10-28', FXUSDCAD: {} }],
    ['an empty value', obs('2026-10-28', '')],
    ['a value that is not a decimal', obs('2026-10-28', '1,3912')],
    ['an exponent', obs('2026-10-28', '1.3e0')],
    ['a negative rate', obs('2026-10-28', '-1.3912')],
    ['a zero rate', obs('2026-10-28', '0.0000')],
    ['an implausibly large rate', obs('2026-10-28', '139.12')],
    ['a number instead of text', { d: '2026-10-28', FXUSDCAD: { v: 1.3912 } }],
    ['another series', { d: '2026-10-28', FXEURCAD: { v: '1.5' } }],
    ['a malformed day', obs('28/10/2026', '1.3912')],
    ['an impossible day', obs('2026-02-30', '1.3912')],
    ['a day after today in Ottawa', obs('2026-10-30', '1.3912')],
    ['an entry that is not an object', 'nonsense'],
  ])('skips %s, never guessing a rate', (_, observation) => {
    const body = valet([obs('2026-10-27', '1.3900'), observation]);
    expect(parseValetObservations(body, '2026-10-29')).toEqual({
      rates: [{ date: '2026-10-27', cadPerUsd: '1.3900' }],
      skipped: 1,
    });
  });

  it('keeps the first of two values for the same day', () => {
    const body = valet([obs('2026-10-28', '1.3912'), obs('2026-10-28', '1.5000')]);
    expect(parseValetObservations(body, '2026-10-29').rates).toEqual([
      { date: '2026-10-28', cadPerUsd: '1.3912' },
    ]);
  });

  it.each([[null], [{}], [{ observations: 'none' }], [[]]])(
    'refuses an answer without observations: %j',
    (body) => {
      expect(() => parseValetObservations(body, '2026-10-29')).toThrow(BankOfCanadaError);
    },
  );
});

describe('fetchBankOfCanadaRates', () => {
  it('asks Valet for the latest ten FXUSDCAD observations and reads today in Ottawa', async () => {
    const fetchImpl = fakeFetch(Response.json(valet([obs('2026-10-29', '1.3912')])));
    // 01:00 UTC on 30 October is still 29 October in Ottawa, so that day is not in the future.
    const result = await fetchBankOfCanadaRates(new Date('2026-10-30T01:00:00Z'), fetchImpl);
    expect(result.rates).toEqual([{ date: '2026-10-29', cadPerUsd: '1.3912' }]);
    expect(VALET_URL).toBe(
      'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=10',
    );
    expect(fetchImpl).toHaveBeenCalledWith(VALET_URL, expect.objectContaining({}));
  });

  it.each([
    ['no answer', new TypeError('network'), 'unavailable', 0],
    ['an error status', new Response('busy', { status: 503 }), 'unavailable', 503],
    ['an answer that is not JSON', new Response('<html>', { status: 200 }), 'malformed', 200],
  ])('fails on %s', async (_, response, kind, status) => {
    await expect(fetchBankOfCanadaRates(NOW, fakeFetch(response))).rejects.toMatchObject({
      kind,
      status,
    });
  });
});

describe('refreshFxRates', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const published = () =>
    fakeFetch(Response.json(valet([obs('2026-10-28', '1.3912'), obs('2026-10-29', '1.3900')])));

  it('stores the days fetched, through Hyperdrive when it is bound, and closes the database', async () => {
    db.storeBankOfCanadaRates.mockResolvedValueOnce([
      { rate: { date: '2026-10-28', cadPerUsd: '1.3912' }, outcome: 'unchanged' },
      { rate: { date: '2026-10-29', cadPerUsd: '1.3900' }, outcome: 'stored' },
    ]);
    const env = { ...ENV, HYPERDRIVE: { connectionString: 'postgresql://hyperdrive.test/db' } };
    const summary = await refreshFxRates(env, openDatabase, NOW, published());
    expect(summary).toEqual({
      status: 'done',
      counts: { stored: 1, unchanged: 1, differs: 0, refused: 0, skipped: 0 },
    });
    expect(openDatabase).toHaveBeenCalledWith('postgresql://hyperdrive.test/db', {
      viaHyperdrive: true,
    });
    expect(db.storeBankOfCanadaRates).toHaveBeenCalledWith([
      { date: '2026-10-28', cadPerUsd: '1.3912' },
      { date: '2026-10-29', cadPerUsd: '1.3900' },
    ]);
    expect(db.close).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      'Bank of Canada USD/CAD refreshed: 2 published, 1 stored, 1 unchanged, 0 differ, 0 refused, 0 skipped; latest 2026-10-29',
    );
  });

  it('keeps a stored rate the Bank later publishes differently, and says so', async () => {
    db.storeBankOfCanadaRates.mockResolvedValueOnce([
      { rate: { date: '2026-10-28', cadPerUsd: '1.3912' }, outcome: 'differs' },
      { rate: { date: '2026-10-29', cadPerUsd: '1.3900' }, outcome: 'refused' },
    ]);
    const summary = await refreshFxRates(ENV, openDatabase, NOW, published());
    expect(summary.counts).toMatchObject({ differs: 1, refused: 1 });
    expect(console.warn).toHaveBeenCalledWith(
      'Bank of Canada USD/CAD for 2026-10-28: differs from the stored rate, which is kept',
    );
    expect(console.warn).toHaveBeenCalledWith(
      'Bank of Canada USD/CAD for 2026-10-29: refused by the database',
    );
  });

  it('stores nothing and opens no database when the Bank fails', async () => {
    const summary = await refreshFxRates(
      ENV,
      openDatabase,
      NOW,
      fakeFetch(new Response('down', { status: 502 })),
    );
    expect(summary.status).toBe('bank_failed');
    expect(openDatabase).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Bank of Canada USD/CAD not refreshed: the Bank's answer was unavailable, status=502",
    );
  });

  it('does nothing without a database', async () => {
    const fetchImpl = published();
    const env = {
      SUPABASE_URL: ENV.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: ENV.SUPABASE_PUBLISHABLE_KEY,
    };
    expect((await refreshFxRates(env, openDatabase, NOW, fetchImpl)).status).toBe('not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('logs a database failure without its message, and still closes the connection', async () => {
    db.storeBankOfCanadaRates.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED postgresql://app_api:secret@db'), {
        code: 'ECONNREFUSED',
      }),
    );
    const summary = await refreshFxRates(ENV, openDatabase, NOW, published());
    expect(summary.status).toBe('database_failed');
    expect(db.close).toHaveBeenCalled();
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain(
      'Bank of Canada USD/CAD not stored: code=ECONNREFUSED kind=connection_refused',
    );
    expect(logged).not.toContain('secret');
  });
});

describe('/api/v1/fx-quotes', () => {
  it('requires sign-in', async () => {
    const res = await app.request('/api/v1/fx-quotes', {}, ENV);
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('lists the stored rates as the signed-in user, never cached', async () => {
    mockAuthServer(Response.json({ id: USER_ID, email: 'tess@example.test' }));
    const rate = {
      base: 'USD' as const,
      quote: 'CAD' as const,
      rate: '1.3912',
      rateDate: '2026-10-28',
      source: 'bank_of_canada' as const,
      series: 'FXUSDCAD',
      fetchedAt: '2026-10-28T22:15:03.000Z',
    };
    db.listFxQuotes.mockResolvedValueOnce([rate]);
    const res = await app.request(
      '/api/v1/fx-quotes',
      { headers: { Authorization: `Bearer ${VALID_TOKEN}` } },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ rates: [rate] });
    expect(db.listFxQuotes).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
  });
});
