import { type LandShape, packLandShape } from '@grain/domain';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-241): land read as the real `petro_api` role against the real migration.
// The rows are written as the database's owner, as the manual load does. Made-up land only, in
// Alberta's far north-west corner, where no test of the wells and no local load reaches.
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

/** A small square whose south-west corner is given, as a shape and as its box. */
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
/** A shape as it comes back from whole numbers (F-310): five decimals, every ring closed. */
const rounded = (shape: LandShape): LandShape =>
  shape.map((polygon) =>
    polygon.map((ring) =>
      ring.map(([x, y]): [number, number] => [
        Math.round(x * 1e5) / 1e5,
        Math.round(y * 1e5) / 1e5,
      ]),
    ),
  );
/** The path and counts the loads write (F-310). */
const packed = (shape: LandShape) => {
  const p = packLandShape(shape);
  if (!p) throw new Error('not a shape');
  return p;
};
const VIEW = { west: -120.05, south: 59.9, east: -119.9, north: 60.05 };
const ALL = { agreements: 10, offsets: 10, freehold: 10 };

describe('land held today as petro_api', () => {
  it('reads the shapes touching the view, each kind up to its limit and one more', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    const clean = async () => {
      await admin`delete from petro.land_agreements where agreement_type = 'ZZ9'`;
      await admin`delete from petro.land_offsets where offset_number like 'ZZTEST%'`;
      await admin`delete from petro.land_freehold where land_key between -9003 and -9001`;
    };
    try {
      await clean();
      const inView = square(-120, 59.95);
      const next = square(-119.98, 59.95);
      const elsewhere = square(-119.5, 59.5);
      const twoParts: LandShape = [...inView.shape, ...square(-119.99, 59.96).shape];
      await admin`
        insert into petro.land_agreements
          (rights, agreement_type, agreement_number, tract, agreement_group, status, holder,
           parties, zone, area_ha, term_date, expiry_text, bounds, shape)
        values
          ('png', 'ZZ9', '1', '00', 'LEASE', 'ACTIVE', 'EXAMPLE ENERGY LTD.',
           'EXAMPLE ENERGY LTD. 100%', 'PNG TO BASE EXAMPLE', 256.5, '2020-02-17', 'INDEFINITE',
           ${inView.bounds}::box, ${admin.json(inView.shape)}),
          ('oil_sands', 'ZZ9', '2', null, null, null, null, null, null, null, null, null,
           ${next.bounds}::box, ${admin.json(next.shape)}),
          ('png', 'ZZ9', '3', null, null, null, null, null, null, null, null, null,
           ${elsewhere.bounds}::box, ${admin.json(elsewhere.shape)})`;
      await admin`
        insert into petro.land_offsets (offset_type, offset_number, holder, expiry_date, bounds, path, rings)
        values ('AAY', 'ZZTEST1', 'EXAMPLE ENERGY LTD.', '2027-05-08', ${inView.bounds}::box,
                ${packed(twoParts).path}, ${packed(twoParts).rings})`;
      // Land loaded since F-310 is kept as whole numbers; land loaded before, as JSON.
      await admin`
        insert into petro.land_freehold (land_key, substances, bounds, path, rings)
        values (-9001, 'ALL MINERALS', ${inView.bounds}::box, ${packed(inView.shape).path}, '{}'),
               (-9002, 'ALL MINERALS', ${next.bounds}::box, ${packed(next.shape).path}, '{}'),
               (-9003, 'ALL MINERALS', ${elsewhere.bounds}::box, ${packed(elsewhere.shape).path}, '{}')`;

      const all = await db.land(member(), VIEW, ALL);
      expect(all.agreements.map((a) => [a.rights, a.agreementNumber])).toEqual([
        ['png', '1'],
        ['oil_sands', '2'],
      ]);
      expect(all.agreements[0]).toMatchObject({
        agreementType: 'ZZ9',
        tract: '00',
        group: 'LEASE',
        status: 'ACTIVE',
        holder: 'EXAMPLE ENERGY LTD.',
        areaHa: 256.5,
        termDate: '2020-02-17',
        continuationDate: null,
        expiryText: 'INDEFINITE',
        shape: inView.shape,
      });
      expect(all.offsets).toMatchObject([
        { offsetNumber: 'ZZTEST1', expiryDate: '2027-05-08', shape: rounded(twoParts) },
      ]);
      expect(all.freehold.map((f) => f.shape)).toEqual([
        rounded(inView.shape),
        rounded(next.shape),
      ]);

      // Only the agreements with one of the zones given, when a play's rights are asked for.
      expect((await db.land(member(), VIEW, ALL, [])).agreements).toEqual([]);
      const zones = await db.landZones(member());
      const hash = zones.find((z) => z.zone === 'PNG TO BASE EXAMPLE')?.hash ?? '';
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
      const named = await db.land(member(), VIEW, ALL, [hash, 'another']);
      expect(named.agreements.map((a) => a.agreementNumber)).toEqual(['1']);
      expect(named.freehold).toHaveLength(2);

      // Every zone written, each once, and a stamp of the loads; nothing without a member.
      expect(await db.landZoneStamp(member())).toMatch(/^\d+:\d+$/);
      expect(await db.landZones({ ...member(), role: 'stranger' })).toEqual([]);

      // A kind not asked for is not read; a limit gives one more row, to say there is more.
      const some = await db.land(member(), VIEW, { agreements: 0, offsets: 0, freehold: 1 });
      expect(some.agreements).toEqual([]);
      expect(some.offsets).toEqual([]);
      expect(some.freehold).toHaveLength(2);

      // Without a member the rows are not read at all.
      const nobody = await db.land({ ...member(), role: 'stranger' }, VIEW, ALL);
      expect([nobody.agreements, nobody.offsets, nobody.freehold, nobody.loads]).toEqual([
        [],
        [],
        [],
        [],
      ]);
    } finally {
      await clean();
      await admin.end();
      await db.close();
    }
  });
});
