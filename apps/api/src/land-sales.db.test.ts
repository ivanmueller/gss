import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-242): land sale parcels read as the real `petro_api` role against the
// real migration. The rows are written as the database's owner, as the manual load does.
// Made-up parcels, buyers and prices only, in sales of the year 1990, which no load reaches,
// in Alberta's far north-west corner.
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

const square = (west: number, south: number) => ({
  shape: [
    [
      [
        [west, south],
        [west + 0.01, south],
        [west + 0.01, south + 0.01],
        [west, south + 0.01],
        [west, south],
      ],
    ],
  ],
  bounds: `(${String(west + 0.01)},${String(south + 0.01)}),(${String(west)},${String(south)})`,
});
const VIEW = { west: -120.05, south: 59.9, east: -119.9, north: 60.05 };
// Only this test's rights, so the totals count none of a local load's parcels.
const PLAY = 'IN THE TEST ONLY FM';
const ALL = { zonePattern: PLAY, since: null };

describe('land sales as petro_api', () => {
  it('reads the parcels touching the view and sums the money in the database', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    const clean = () =>
      admin`delete from petro.land_sale_parcels where sale_date between '1990-01-01' and '1990-12-31'`;
    try {
      await clean();
      const a = square(-120, 59.95);
      const b = square(-119.98, 59.95);
      const far = square(-119.5, 59.5);
      const zone = `PETROLEUM AND NATURAL GAS ${PLAY}`;
      await admin`
        insert into petro.land_sale_parcels
          (sale_date, contract_no, contract_type, region, hectares, zone, land, status, bonus,
           dollars_per_hectare, buyers, bounds, shape)
        values
          ('1990-02-07', 'A0001', 'LEASE', 'PLAINS', 256, ${zone}, '61212624', 'ACCEPTED',
           25600.10, 100.00, 'EXAMPLE LAND LTD. 100%', ${a.bounds}::box, ${admin.json(a.shape)}),
          ('1990-05-09', 'A0002', 'LEASE', 'PLAINS', 64, ${zone}, '61212625SW', 'ACCEPTED',
           19200.20, 300.00, 'SAMPLE RESOURCES INC. 100%', ${b.bounds}::box, ${admin.json(b.shape)}),
          ('1990-05-09', 'A0003', 'LICENCE', 'NORTHERN', 128, ${zone}, '61212626', 'NO OFFERS',
           null, null, null, ${far.bounds}::box, ${admin.json(far.shape)}),
          ('1990-05-09', 'A0004', 'LEASE', 'PLAINS', 64, 'PETROLEUM AND NATURAL GAS IN THE OTHER FM',
           '61212627', 'ACCEPTED', 1, 1, null, ${a.bounds}::box, ${admin.json(a.shape)})`;

      // The newest sale first; the parcel elsewhere and the one of other rights are left out.
      const inView = await db.landSales(member(), VIEW, ALL, 10);
      expect(inView.parcels.map((p) => [p.saleDate, p.contractNo])).toEqual([
        ['1990-05-09', 'A0002'],
        ['1990-02-07', 'A0001'],
      ]);
      expect(inView.parcels[1]).toMatchObject({
        contractType: 'LEASE',
        hectares: '256.0000',
        land: '61212624',
        inexact: false,
        status: 'ACCEPTED',
        bonus: '25600.10',
        dollarsPerHectare: '100.00',
        buyers: 'EXAMPLE LAND LTD. 100%',
        shape: a.shape,
      });
      // From a date on, and one more than the limit to say there is more.
      const later = await db.landSales(member(), VIEW, { ...ALL, since: '1990-03-01' }, 10);
      expect(later.parcels.map((p) => p.contractNo)).toEqual(['A0002']);
      expect((await db.landSales(member(), VIEW, ALL, 1)).parcels).toHaveLength(2);

      const summary = await db.landSaleSummary(member(), ALL);
      expect(summary).toMatchObject({
        offered: 3,
        sold: 2,
        bonus: '44800.30',
        hectaresSold: '320.0000',
        averagePerHectare: '140.00',
        highPerHectare: '300.00',
        nextSale: null,
        quarters: [
          { quarter: '1990-Q1', bonus: '25600.10', sold: 1 },
          { quarter: '1990-Q2', bonus: '19200.20', sold: 1 },
        ],
      });
      const since = await db.landSaleSummary(member(), { ...ALL, since: '1990-03-01' });
      expect(since).toMatchObject({ offered: 2, sold: 1, bonus: '19200.20' });
      // The quarters cover every year, whatever the date asked for.
      expect(since.quarters).toHaveLength(2);

      // Without a member the rows are not read at all.
      const nobody = { ...member(), role: 'stranger' };
      expect((await db.landSales(nobody, VIEW, ALL, 10)).parcels).toEqual([]);
      expect(await db.landSaleSummary(nobody, ALL)).toMatchObject({ offered: 0, bonus: '0' });
    } finally {
      await clean();
      await admin.end();
      await db.close();
    }
  });
});
