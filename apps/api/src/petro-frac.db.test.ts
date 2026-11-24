import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-288): the frac data read as the real `petro_api` role against the real
// migration. The rows are written as the database's owner, as the load does. Made-up wells only,
// under a licence no real well has: every row written here is removed after.
const PETRO_URL = process.env.PETROLEUM_TEST_DATABASE_URL;
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
if (!PETRO_URL || !ADMIN_URL) {
  throw new Error('Set PETROLEUM_TEST_DATABASE_URL and API_TEST_ADMIN_DATABASE_URL.');
}
const ADMIN = `${ADMIN_URL.slice(0, ADMIN_URL.lastIndexOf('/'))}/petroleum`;
const LICENCE = 'ZZTEST1';

const member = () => ({
  userId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  role: 'viewer',
  requestId: crypto.randomUUID(),
});

describe('frac data as petro_api', () => {
  it("reads one licence's well events, as written, and the latest load", async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    let load: string | undefined;
    const clean = async () => {
      await admin`delete from petro.frac_wells where licence_number = ${LICENCE}`;
      if (load) await admin`delete from petro.frac_loads where id = ${load}`;
    };
    try {
      await clean();
      await admin`
        insert into petro.frac_wells (uwi, licence_number, first_frac_date, last_frac_date, fracs,
          stages, water_m3, proppant_t, upgrade_hint_t, refrac_proppant_t, max_tvd_m, suspect)
        values
          ('00/16-36-099-27W6/2', ${LICENCE}, '2013-01-02', '2014-02-03', 2, 20, 1000.5, 2000.25,
           100, 50, 2500.5, false),
          ('00/16-36-099-27W6/0', ${LICENCE}, '2013-01-02', '2013-01-02', 1, null, 0, 0, 0, 0,
           null, false)`;
      const [row] = await admin<{ id: string }[]>`
        insert into petro.frac_loads (source_url, source_date, wells, skipped)
        values ('https://static.aer.ca/prd/x.csv', '2013-02-01', 2, 0)
        returning id::text as id`;
      load = row?.id;

      const { load: latest, rows } = await db.fracOfLicence(member(), LICENCE);
      expect(latest).toMatchObject({ sourceDate: '2013-02-01', wells: 2 });
      expect(rows).toEqual([
        {
          uwi: '00/16-36-099-27W6/0',
          first_frac_date: '2013-01-02',
          last_frac_date: '2013-01-02',
          fracs: 1,
          stages: null,
          water_m3: '0.000',
          proppant_t: '0.000',
          upgrade_hint_t: '0.000',
          refrac_proppant_t: '0.000',
          max_tvd_m: null,
          suspect: false,
        },
        {
          uwi: '00/16-36-099-27W6/2',
          first_frac_date: '2013-01-02',
          last_frac_date: '2014-02-03',
          fracs: 2,
          stages: 20,
          water_m3: '1000.500',
          proppant_t: '2000.250',
          upgrade_hint_t: '100.000',
          refrac_proppant_t: '50.000',
          max_tvd_m: '2500.50',
          suspect: false,
        },
      ]);
    } finally {
      await clean();
      await admin.end();
      await db.close();
    }
  });
});
