import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-285): the royalty prices read as the real `petro_api` role against the real
// migration. The rows are written as the database's owner, as the load does. Made-up prices only,
// in a month long before any the province publishes for (1994 on): every row written here is
// removed after.
const PETRO_URL = process.env.PETROLEUM_TEST_DATABASE_URL;
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
if (!PETRO_URL || !ADMIN_URL) {
  throw new Error('Set PETROLEUM_TEST_DATABASE_URL and API_TEST_ADMIN_DATABASE_URL.');
}
const ADMIN = `${ADMIN_URL.slice(0, ADMIN_URL.lastIndexOf('/'))}/petroleum`;

const member = () => ({
  userId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  role: 'viewer',
  requestId: crypto.randomUUID(),
});

describe('prices as petro_api', () => {
  it('reads every price, as written, and the latest load', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    let load: string | undefined;
    const clean = async () => {
      await admin`delete from petro.reference_prices where series = 'test_series'`;
      if (load) await admin`delete from petro.price_loads where id = ${load}`;
    };
    try {
      await clean();
      await admin`
        insert into petro.reference_prices (series, month, price, unit, source_url) values
          ('test_series', '1994-02-01', 0.5, '$/m3', 'https://www.alberta.ca/example'),
          ('test_series', '1994-01-01', 123.45, '$/m3', 'https://open.alberta.ca/example.pdf')`;
      const [row] = await admin<{ id: string }[]>`
        insert into petro.price_loads (prices, first_month, last_month, unread)
        values (2, '1994-01-01', '1994-02-01', '{https://open.alberta.ca/x.pdf}')
        returning id::text as id`;
      load = row?.id;

      const { load: latest, rows } = await db.prices(member());
      expect(latest).toMatchObject({
        prices: 2,
        firstMonth: '1994-01',
        lastMonth: '1994-02',
        unread: 1,
      });
      expect(rows.filter((r) => r.series === 'test_series')).toEqual([
        {
          series: 'test_series',
          month: '1994-01',
          price: '123.4500',
          unit: '$/m3',
          source_url: 'https://open.alberta.ca/example.pdf',
        },
        {
          series: 'test_series',
          month: '1994-02',
          price: '0.5000',
          unit: '$/m3',
          source_url: 'https://www.alberta.ca/example',
        },
      ]);
    } finally {
      await clean();
      await admin.end();
      await db.close();
    }
  });
});
