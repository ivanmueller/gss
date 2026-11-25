import { createHash } from 'node:crypto';

import { type LandShape, packLandShape } from '@grain/domain';
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

const square = (west: number, south: number): { shape: LandShape; bounds: string } => ({
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
/** The path the loads write (F-310): every shape is kept as whole numbers since schema 24. */
const path = (shape: LandShape) => packLandShape(shape)?.path ?? [];
/** A shape as it comes back from whole numbers: five decimals, its ring closed. */
const rounded = (shape: LandShape): LandShape =>
  shape.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]): [number, number] => [
        Math.round(x * 1e5) / 1e5,
        Math.round(y * 1e5) / 1e5,
      ]),
    ),
  );
const VIEW = { west: -120.05, south: 59.9, east: -119.9, north: 60.05 };
// Only this test's rights, so the totals count none of a local load's parcels.
const PLAY = 'IN THE TEST ONLY FM';
const ZONE = `PETROLEUM AND NATURAL GAS ${PLAY}`;
// The zone's md5, as the database works it out.
const HASH = createHash('md5').update(ZONE).digest('hex');
const ALL = { zones: [HASH], since: null };
const TRACTS = [
  `${ZONE}; TO THE TOP OF THE EXAMPLE FM`,
  'NATURAL GAS IN THE SAMPLE GRP; PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE SAMPLE GRP; TO BASEMENT',
];

describe('land sales as petro_api', () => {
  it('reads the parcels touching the view and sums the money in the database', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    const clean = async () => {
      await admin`delete from petro.land_sale_parcels where sale_date between '1990-01-01' and '1990-12-31'`;
      await admin`delete from petro.land_agreements where agreement_type = 'ZZ8'`;
    };
    try {
      await clean();
      const a = square(-120, 59.95);
      const b = square(-119.98, 59.95);
      const far = square(-119.5, 59.5);
      const zone = ZONE;
      await admin`
        insert into petro.land_sale_parcels
          (sale_date, contract_no, contract_type, region, hectares, zone, land, status, bonus,
           dollars_per_hectare, buyers, restrictions, reversion_zones, tract_rights, bounds, path)
        values
          ('1990-02-07', 'A0001', 'LEASE', 'PLAINS', 256, ${zone}, '61212624', 'ACCEPTED',
           25600.10, 100.00, 'EXAMPLE LAND LTD. 100%', 'SHA010301 SHA010401', 'D00004',
           ${admin.json(TRACTS)}, ${a.bounds}::box, ${path(a.shape)}),
          ('1990-05-09', 'A0002', 'LEASE', 'PLAINS', 64, ${zone}, '61212625SW', 'ACCEPTED',
           19200.20, 300.00, 'SAMPLE RESOURCES INC. 100%', null, null, null, ${b.bounds}::box,
           ${path(b.shape)}),
          ('1990-05-09', 'A0003', 'LICENCE', 'NORTHERN', 128, ${zone}, '61212626', 'NO OFFERS',
           null, null, null, null, null, null, ${far.bounds}::box, ${path(far.shape)}),
          ('1990-05-09', 'A0004', 'LEASE', 'PLAINS', 64, 'PETROLEUM AND NATURAL GAS IN THE OTHER FM',
           '61212627', 'ACCEPTED', 1, 1, null, null, null, null, ${a.bounds}::box,
           ${path(a.shape)})`;
      // Land held today (F-276): the lease issued from A0001 of the February sale, in two
      // tracts, its term starting the day after the sale. Beside it, agreements that are not
      // it: a licence with the same number's end, a lease from the month's other sale, a lease
      // numbered after A0002 whose term starts weeks later, and one numbered after A0003, which
      // drew no offers. In Alberta's far north-east corner, away from the land of other tests:
      // where an agreement lies plays no part.
      const away = square(-110.5, 59.5);
      const held = (number: string, tract: string, group: string, term: string, holder: string) =>
        admin`
          insert into petro.land_agreements
            (rights, agreement_type, agreement_number, tract, agreement_group, holder, term_date,
             bounds, path)
          values ('png', 'ZZ8', ${number}, ${tract}, ${group}, ${holder}, ${term}::date,
                  ${away.bounds}::box, ${path(away.shape)})`;
      await held('0190020001', '01', 'LEASE', '1990-02-08', 'SAMPLE HOLDINGS LTD.');
      await held('0190020001', '02', 'LEASE', '1990-02-08', 'SAMPLE HOLDINGS LTD.');
      await held('5490020001', '00', 'LICENSE', '1990-02-08', 'OTHER KIND LTD.');
      await held('0290020001', '00', 'LEASE', '1990-02-22', 'OTHER SALE LTD.');
      await held('0190050002', '00', 'LEASE', '1990-06-20', 'TOO LATE LTD.');
      await held('0190050003', '00', 'LEASE', '1990-05-10', 'NO OFFERS LTD.');

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
        restrictions: 'SHA010301 SHA010401',
        reversionZones: 'D00004',
        shape: rounded(a.shape),
      });
      // A parcel with no codes has none (F-265). Kept as whole numbers (F-310), its shape comes
      // back to five decimals, its ring closed.
      expect(inView.parcels[0]).toMatchObject({ restrictions: null, reversionZones: null });
      expect(inView.parcels[0]?.shape).toEqual(rounded(b.shape));
      // Its rights tract by tract, and the agreement issued from it with its holder (F-276):
      // found by the database, once, whatever land the page has loaded.
      expect(inView.parcels[1]).toMatchObject({
        tractRights: TRACTS,
        heldAgreement: '0190020001',
        heldBy: 'SAMPLE HOLDINGS LTD.',
      });
      // No agreement whose term starts with the sale: none, and no rights by tract yet.
      expect(inView.parcels[0]).toMatchObject({
        tractRights: null,
        heldAgreement: null,
        heldBy: null,
      });
      // A parcel that drew no offers has no agreement, whatever is numbered like it.
      const wide = await db.landSales(
        member(),
        { ...VIEW, west: -120.05, south: 59.4, east: -119.4 },
        ALL,
        10,
      );
      expect(wide.parcels.map((p) => [p.contractNo, p.heldAgreement])).toEqual([
        ['A0002', null],
        ['A0003', null],
        ['A0001', '0190020001'],
      ]);
      // From a date on, and one more than the limit to say there is more.
      const later = await db.landSales(member(), VIEW, { ...ALL, since: '1990-03-01' }, 10);
      expect(later.parcels.map((p) => p.contractNo)).toEqual(['A0002']);
      // Before a date: the page reads every year a few years at a time (F-263).
      const earlier = await db.landSales(member(), VIEW, { ...ALL, until: '1990-03-01' }, 10);
      expect(earlier.parcels.length).toBeGreaterThan(0);
      expect(earlier.parcels.map((p) => p.contractNo)).not.toContain('A0002');
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
      // One sale's totals, from its day to the day after; and every sale, the newest first,
      // whatever the dates (F-267).
      const one = await db.landSaleSummary(member(), {
        ...ALL,
        since: '1990-02-07',
        until: '1990-02-08',
      });
      expect(one).toMatchObject({ offered: 1, sold: 1, bonus: '25600.10' });
      expect(one.sales).toEqual([
        { date: '1990-05-09', parcels: 2, sold: 1, held: true },
        { date: '1990-02-07', parcels: 1, sold: 1, held: true },
      ]);

      // Inside a play's outline (F-264): the parcels whose middle lies within an outer ring
      // and within no hole, for the parcels and for every total.
      const outline = [
        { hole: false, ring: '((-120.01,59.94),(-119.96,59.94),(-119.96,59.97),(-120.01,59.97))' },
        // Around the second parcel.
        {
          hole: true,
          ring: '((-119.985,59.945),(-119.965,59.945),(-119.965,59.965),(-119.985,59.965))',
        },
      ];
      const hugged = await db.landSales(member(), VIEW, { ...ALL, outline }, 10);
      expect(hugged.parcels.map((p) => p.contractNo)).toEqual(['A0001']);
      expect(await db.landSaleSummary(member(), { ...ALL, outline })).toMatchObject({
        offered: 1,
        sold: 1,
        bonus: '25600.10',
        quarters: [{ quarter: '1990-Q1', bonus: '25600.10', sold: 1 }],
      });
      // An outline elsewhere keeps none; no outline keeps them all, as above.
      const elsewhere = [
        { hole: false, ring: '((-111,50),(-110.9,50),(-110.9,50.1),(-111,50.1))' },
      ];
      expect(
        (await db.landSales(member(), VIEW, { ...ALL, outline: elsewhere }, 10)).parcels,
      ).toEqual([]);
      expect(
        (await db.landSales(member(), VIEW, { ...ALL, outline: null }, 10)).parcels,
      ).toHaveLength(2);

      // Every parcel as a dot, wherever it lies (F-312): the middle of its box, no outline,
      // and nothing of what is read close in; the rights and dates as for the view.
      const dots = await db.landSaleDots(member(), ALL, 10);
      expect(dots.parcels.map((p) => p.contractNo)).toEqual(['A0002', 'A0003', 'A0001']);
      const dotOfA = dots.parcels.find((p) => p.contractNo === 'A0001');
      expect(dotOfA).toMatchObject({
        saleDate: '1990-02-07',
        status: 'ACCEPTED',
        dollarsPerHectare: '100.00',
        buyers: 'EXAMPLE LAND LTD. 100%',
        shape: [],
        centre: [-119.995, 59.955],
      });
      expect(dotOfA).not.toHaveProperty('tractRights');
      expect(dotOfA).not.toHaveProperty('heldAgreement');
      expect(
        (await db.landSaleDots(member(), { ...ALL, since: '1990-03-01' }, 10)).parcels.map(
          (p) => p.contractNo,
        ),
      ).toEqual(['A0002', 'A0003']);
      expect((await db.landSaleDots(member(), ALL, 1)).parcels).toHaveLength(2);
      expect((await db.landSaleDots({ ...member(), role: 'stranger' }, ALL, 10)).parcels).toEqual(
        [],
      );

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
