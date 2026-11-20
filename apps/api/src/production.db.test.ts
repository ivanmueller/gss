import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-252 step 3): monthly production read as the real `petro_api` role against
// the real migration. The rows are written as the database's owner, as the manual load does.
// Synthetic wells and volumes only, in months no load reaches.
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

const [ONE, TWO] = ['00/01-01-125-01W6/0', '00/02-01-125-01W6/2'];
const UWIS = [ONE, TWO];

describe('monthly production as petro_api', () => {
  it("reads a well's months in order and the total of all wells by month", async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    try {
      await admin`delete from petro.well_production where uwi in ${admin(UWIS)}`;
      await admin`
        insert into petro.well_production (uwi, month, oil_m3, gas_e3m3, water_m3, condensate_m3, hours)
        values
          (${ONE}, '1990-02-01', 280, 110.125, null, 12.5, 600),
          (${ONE}, '1990-01-01', 310.5, 120.25, 80, null, 744),
          (${TWO}, '1990-01-01', 100.25, null, 20, null, null)`;

      const well = await db.wellProduction(member(), ONE);
      expect(well.months).toEqual([
        { month: '1990-01', oil: 310.5, gas: 120.25, water: 80, condensate: null, hours: 744 },
        { month: '1990-02', oil: 280, gas: 110.125, water: null, condensate: 12.5, hours: 600 },
      ]);
      expect((await db.wellProduction(member(), '00/03-01-125-01W6/0')).months).toEqual([]);

      const formation = await db.formationProduction(member());
      expect(formation.months.filter((m) => m.month.startsWith('1990-'))).toEqual([
        { month: '1990-01', oil: 410.75, gas: 120.25, water: 100, condensate: null, wells: 2 },
        { month: '1990-02', oil: 280, gas: 110.125, water: null, condensate: 12.5, wells: 1 },
      ]);

      // Without a member the rows are not read at all.
      const nobody = { ...member(), role: 'stranger' };
      expect((await db.wellProduction(nobody, ONE)).months).toEqual([]);
    } finally {
      await admin`delete from petro.well_production where uwi in ${admin(UWIS)}`;
      await admin.end();
      await db.close();
    }
  });
});
