import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from './index';
import { ENV } from './testing/helpers';
import { refreshWells } from './wells';

// The twice-daily trigger (F-243): the province-service wells job is switched off, as the AER's
// ST37 list replaces it (the owner, 2026-11-19); its space on the free plan is kept for ST37.

vi.mock('./wells', async (original) => ({
  ...(await original<typeof import('./wells')>()),
  refreshWells: vi.fn(() => Promise.resolve({ status: 'idle' })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the twice-daily trigger', () => {
  it('no longer starts the province-service wells job', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 404 }))),
    );
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation(() => undefined);
    }
    const waits: Promise<unknown>[] = [];
    worker.scheduled(
      { cron: '15 14,22 * * *', scheduledTime: Date.now(), noRetry: () => undefined },
      ENV,
      {
        waitUntil: (p: Promise<unknown>) => waits.push(p),
        passThroughOnException: () => undefined,
        props: {},
      } as unknown as ExecutionContext,
    );
    await Promise.allSettled(waits);
    expect(waits.length).toBeGreaterThan(0);
    expect(refreshWells).not.toHaveBeenCalled();
  });
});

describe('the hourly trigger (F-282)', () => {
  it('runs the AER lists alone, not the exchange rate', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 404 })));
    vi.stubGlobal('fetch', fetchImpl);
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation(() => undefined);
    }
    const waits: Promise<unknown>[] = [];
    worker.scheduled(
      { cron: '30 * * * *', scheduledTime: Date.now(), noRetry: () => undefined },
      ENV,
      {
        waitUntil: (p: Promise<unknown>) => waits.push(p),
        passThroughOnException: () => undefined,
        props: {},
      } as unknown as ExecutionContext,
    );
    await Promise.allSettled(waits);
    expect(waits).toHaveLength(1);
    const asked = fetchImpl.mock.calls.map(([u]) =>
      typeof u === 'string' ? u : u instanceof URL ? u.href : u.url,
    );
    expect(asked.some((u) => u.includes('bankofcanada'))).toBe(false);
  });
});
