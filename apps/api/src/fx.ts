import { isCalendarDate, ottawaDate, type FxQuoteList } from '@grain/domain';
import { Hono } from 'hono';

import type { BankOfCanadaRate, FxStoreOutcome } from './fx-db';
import { failureSummary, withDatabase, type ApiEnv, type DatabaseFactory } from './respond';

// The Bank of Canada's daily USD/CAD rate (GT-052; the owner's decision of 2026-10-27,
// docs/DECISIONS.md). The Bank publishes each business day's average by 16:30 Ottawa time
// through its Valet API, which needs no key. The Worker's scheduled job (wrangler.jsonc,
// triggers) fetches the latest ten observations twice a day and stores the days it does not
// have yet, so a missed run or a rate the Bank publishes late is picked up by the next run.
// A failed fetch stores nothing and invents nothing: the last stored rate stays in use until
// it is stale (FX_STALE_AFTER_DAYS in @grain/domain).

export const VALET_URL = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=10';
const SERIES = 'FXUSDCAD';
const TIMEOUT_MS = 20_000;
/** CAD per USD as the Bank publishes it: plain decimal text, four places today. */
const RATE = /^\d{1,2}\.\d{1,10}$/;

/** The Bank's answer could not be used; `status` is its HTTP status, 0 without an answer. */
export class BankOfCanadaError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'malformed',
    readonly status: number,
  ) {
    super(`Bank of Canada ${kind} (${String(status)})`);
    this.name = 'BankOfCanadaError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * The USD/CAD rates in a Valet answer, oldest first, read defensively. A day without a value
 * (the Bank marks late days "not available"), with a value that is not a plausible rate, or
 * after `today` in Ottawa is left out and counted in `skipped`, never guessed.
 */
export function parseValetObservations(
  body: unknown,
  today: string,
): { rates: BankOfCanadaRate[]; skipped: number } {
  const observations = record(body)?.observations;
  if (!Array.isArray(observations)) throw new BankOfCanadaError('malformed', 200);
  const byDate = new Map<string, string>();
  let skipped = 0;
  for (const observation of observations) {
    const date = record(observation)?.d;
    const value = record(record(observation)?.[SERIES])?.v;
    const valid =
      typeof date === 'string' &&
      date <= today &&
      isCalendarDate(date) &&
      typeof value === 'string' &&
      RATE.test(value) &&
      /[1-9]/.test(value) &&
      !byDate.has(date);
    if (valid) byDate.set(date, value);
    else skipped += 1;
  }
  const rates = [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cadPerUsd]) => ({ date, cadPerUsd }));
  return { rates, skipped };
}

/** Fetches the latest observations from the Bank's Valet API. */
export async function fetchBankOfCanadaRates(
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ rates: BankOfCanadaRate[]; skipped: number }> {
  let res: Response;
  try {
    res = await fetchImpl(VALET_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new BankOfCanadaError('unavailable', 0);
  }
  if (!res.ok) throw new BankOfCanadaError('unavailable', res.status);
  const body: unknown = await res.json().catch(() => null);
  if (body === null) throw new BankOfCanadaError('malformed', res.status);
  return parseValetObservations(body, ottawaDate(now));
}

export interface RefreshSummary {
  status: 'done' | 'not_configured' | 'bank_failed' | 'database_failed';
  counts: Record<FxStoreOutcome | 'refused' | 'skipped', number>;
}

/**
 * The scheduled job: fetches the Bank's latest rates and stores the new days. Logs one
 * secret-free line with what it did; rates are public, so their days may be logged.
 */
export async function refreshFxRates(
  env: ApiEnv['Bindings'],
  openDatabase: DatabaseFactory,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshSummary> {
  const counts = { stored: 0, unchanged: 0, differs: 0, refused: 0, skipped: 0 };
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) {
    console.error('Bank of Canada USD/CAD not refreshed: the database is not configured');
    return { status: 'not_configured', counts };
  }
  let fetched: { rates: BankOfCanadaRate[]; skipped: number };
  try {
    fetched = await fetchBankOfCanadaRates(now, fetchImpl);
  } catch (error) {
    if (!(error instanceof BankOfCanadaError)) throw error;
    console.error(
      `Bank of Canada USD/CAD not refreshed: the Bank's answer was ${error.kind}, status=${String(error.status)}`,
    );
    return { status: 'bank_failed', counts };
  }
  counts.skipped = fetched.skipped;
  let db;
  try {
    db = openDatabase(url, { viaHyperdrive: env.HYPERDRIVE !== undefined });
  } catch {
    // The error can carry the whole URL, password included, so it is not logged.
    console.error('Bank of Canada USD/CAD not refreshed: the database is not configured correctly');
    return { status: 'not_configured', counts };
  }
  try {
    for (const { rate, outcome } of await db.storeBankOfCanadaRates(fetched.rates)) {
      counts[outcome] += 1;
      if (outcome === 'differs' || outcome === 'refused') {
        console.warn(
          `Bank of Canada USD/CAD for ${rate.date}: ${outcome === 'differs' ? 'differs from the stored rate, which is kept' : 'refused by the database'}`,
        );
      }
    }
  } catch (error) {
    console.error(`Bank of Canada USD/CAD not stored: ${failureSummary(error)}`);
    return { status: 'database_failed', counts };
  } finally {
    await db.close().catch(() => undefined);
  }
  const latest = fetched.rates.at(-1)?.date ?? 'none';
  console.log(
    `Bank of Canada USD/CAD refreshed: ${String(fetched.rates.length)} published, ` +
      `${String(counts.stored)} stored, ${String(counts.unchanged)} unchanged, ` +
      `${String(counts.differs)} differ, ${String(counts.refused)} refused, ` +
      `${String(counts.skipped)} skipped; latest ${latest}`,
  );
  return { status: 'done', counts };
}

/** /api/v1/fx-quotes: the latest stored reference rates. Mounted after requireUser. */
export function fxQuoteRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();
  routes.get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) =>
      c.json({ rates: await db.listFxQuotes(ctx) } satisfies FxQuoteList),
    );
  });
  return routes;
}
