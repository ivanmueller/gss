import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-243 part 4): the ST37 wells read as the real `petro_api` role against the
// real migration. The wells are written as the database's owner, as the manual load does.
// Synthetic wells only, in a far corner of Alberta no load covers.
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

const BOX = { west: -119.95, south: 59.9, east: -119.85, north: 60 };
const [ONE, TWO] = ['00/01-01-125-01W6/0', '00/02-01-125-01W6/2'];
const UWIS = [ONE, TWO];

describe('the ST37 wells as petro_api', () => {
  it('reads the wells in a box, with their paths, and says when there are more', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    try {
      await admin`delete from petro.st37_wells where uwi in ${admin(UWIS)}`;
      await admin`
        insert into petro.st37_wells (uwi, licence_number, licensee, status_class, status_fluid,
          spud_date, total_depth_m, surface_longitude, surface_latitude, bottom_longitude,
          bottom_latitude, path)
        values
          (${ONE}, '0999001', 'Example Energy Ltd.', 'producing', 'Crude oil',
           '2023-09-03', 5846, -119.9, 59.95, -119.91, 59.95,
           '[[-119.9, 59.95], [-119.91, 59.95]]'),
          (${TWO}, '0999002', 'Example Energy Ltd.', 'abandoned', null,
           null, null, -119.88, 59.96, -119.88, 59.96, null)`;

      const { wells } = await db.st37Wells(member(), BOX, 10);
      const ours = wells.filter((w) => UWIS.includes(w.uwi));
      expect(ours).toHaveLength(2);
      expect(ours.find((w) => w.statusClass === 'producing')).toMatchObject({
        licenceNumber: '0999001',
        statusFluid: 'Crude oil',
        spudDate: '2023-09-03',
        totalDepthM: 5846,
        surface: [-119.9, 59.95],
        path: [
          [-119.9, 59.95],
          [-119.91, 59.95],
        ],
      });
      expect(ours.find((w) => w.statusClass === 'abandoned')?.path).toBeNull();

      // One more than the limit comes back, so the route can say the view holds more.
      expect((await db.st37Wells(member(), BOX, 1)).wells).toHaveLength(2);
      // Outside the box, nothing of ours.
      const elsewhere = await db.st37Wells(member(), { ...BOX, west: -119.86 }, 10);
      expect(elsewhere.wells.filter((w) => UWIS.includes(w.uwi))).toHaveLength(0);
    } finally {
      await admin`delete from petro.st37_wells where uwi in ${admin(UWIS)}`;
      await admin.end();
      await db.close();
    }
  });
});
