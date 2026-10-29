import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { postgresDatabase } from './db';

// Integration test: storing and reading reference rates as the real `app_api` role, against
// the real migration. The rates are synthetic, on days of January 2017 that no other test
// uses. Stored rates cannot be deleted, even by the table owner, so cleanup turns triggers
// off for its own session (a superuser's replication role) to remove them.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const DAYS = ['2017-01-04', '2017-01-05', '2017-01-06'];
const ctx = { userId: crypto.randomUUID(), requestId: crypto.randomUUID() };

afterAll(async () => {
  await admin.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`delete from app.fx_quotes where rate_date in ${tx(DAYS)}`;
  });
  await admin.end();
});

describe('reference rates as app_api', () => {
  it('stores new days, keeps stored ones and refuses bad values without losing the rest', async () => {
    const db = postgresDatabase(API_URL);
    try {
      const first = await db.storeBankOfCanadaRates([
        { date: DAYS[0] ?? '', cadPerUsd: '1.3404' },
        { date: DAYS[1] ?? '', cadPerUsd: '1.3300' },
      ]);
      expect(first.map((r) => r.outcome)).toEqual(['stored', 'stored']);

      const again = await db.storeBankOfCanadaRates([
        { date: DAYS[0] ?? '', cadPerUsd: '1.3404' },
        { date: DAYS[1] ?? '', cadPerUsd: '1.2999' },
        { date: '2999-01-01', cadPerUsd: '1.3300' },
        { date: DAYS[2] ?? '', cadPerUsd: '0' },
      ]);
      expect(again.map((r) => r.outcome)).toEqual(['unchanged', 'differs', 'refused', 'refused']);

      const rows = await admin<{ rate_date: string; rate: string }[]>`
        select to_char(rate_date, 'YYYY-MM-DD') as rate_date, rate::text as rate
        from app.fx_quotes where rate_date in ${admin(DAYS)} order by rate_date`;
      expect(rows).toEqual([
        { rate_date: DAYS[0], rate: '1.3404' },
        { rate_date: DAYS[1], rate: '1.3300' },
      ]);
    } finally {
      await db.close();
    }
  });

  it('lists the rates newest first, exactly as stored, for a signed-in user', async () => {
    const db = postgresDatabase(API_URL);
    try {
      const rates = (await db.listFxQuotes(ctx)).filter((r) => DAYS.includes(r.rateDate));
      expect(rates).toEqual([
        expect.objectContaining({
          base: 'USD',
          quote: 'CAD',
          rate: '1.3300',
          rateDate: DAYS[1],
          source: 'bank_of_canada',
          series: 'FXUSDCAD',
        }),
        expect.objectContaining({ rate: '1.3404', rateDate: DAYS[0] }),
      ]);
      expect(Number.isNaN(Date.parse(rates[0]?.fetchedAt ?? ''))).toBe(false);
    } finally {
      await db.close();
    }
  });

  it('cannot write the table directly', async () => {
    const api = postgres(API_URL, { max: 1, onnotice: () => undefined });
    try {
      await expect(
        api`insert into app.fx_quotes (base_currency, quote_currency, rate, rate_date, source, source_series)
            values ('USD', 'CAD', 1.25, ${DAYS[2] ?? ''}, 'bank_of_canada', 'FXUSDCAD')`,
      ).rejects.toMatchObject({ code: '42501' });
      await expect(api`delete from app.fx_quotes`).rejects.toMatchObject({ code: '42501' });
    } finally {
      await api.end();
    }
  });
});
