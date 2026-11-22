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
          bottom_latitude, path, licence_date, planned_operation, planned_formation,
          planned_depth_m, planned_bottom_longitude, planned_bottom_latitude)
        values
          (${ONE}, '0999001', 'Example Energy Ltd.', 'producing', 'Crude oil',
           '2023-09-03', 5846, -119.9, 59.95, -119.91, 59.95,
           '[[-119.9, 59.95], [-119.91, 59.95]]', null, null, null, null, null, null),
          (${TWO}, '0999002', 'Example Energy Ltd.', 'abandoned', null,
           null, null, -119.88, 59.96, -119.88, 59.96, null, '2026-11-19', 'Horizontal',
           'Duvernay Fm', 5300, -119.93, 59.97)`;

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
      expect(ours.find((w) => w.statusClass === 'producing')?.plannedBottom).toBeNull();
      expect(ours.find((w) => w.statusClass === 'abandoned')?.path).toBeNull();
      // What the licence planned, and the planned bottom hole (F-243 part 4b).
      expect(ours.find((w) => w.statusClass === 'abandoned')).toMatchObject({
        licenceDate: '2026-11-19',
        plannedOperation: 'Horizontal',
        plannedFormation: 'Duvernay Fm',
        plannedDepthM: 5300,
        plannedBottom: [-119.93, 59.97],
      });

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

  it('reads a well with its depths, its other legs and the wells nearby, the nearest first (F-261)', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    // One well of two legs (one not drilled yet), a well 1 km away, one 2 km away with no
    // depths, and one far beyond the 3 km asked for.
    const [LEG, NEAR, FLAT, FAR] = [
      '02/01-01-125-01W6/0',
      '00/03-01-125-01W6/0',
      '00/04-01-125-01W6/0',
      '00/05-01-125-01W6/0',
    ];
    const ALL = [...UWIS, LEG, NEAR, FLAT, FAR];
    const deep = (lon: number, lat: number) =>
      admin.json([
        [lon, lat, 700.5],
        [lon, lat, -1500],
        [lon - 0.02, lat, -1550.2],
      ]);
    try {
      await admin`delete from petro.st37_wells where uwi in ${admin(ALL)}`;
      await admin`
        insert into petro.st37_wells (uwi, licence_number, licensee, status_class,
          surface_longitude, surface_latitude, bottom_longitude, bottom_latitude, path_3d,
          path_surveyed, kb_elevation_m, ground_elevation_m)
        values
          (${ONE}, '0999001', 'Example Energy Ltd.', 'producing', -119.9, 59.95, -119.92, 59.95,
           ${deep(-119.9, 59.95)}, true, 700.5, 695),
          (${LEG}, '0999001', 'Example Energy Ltd.', 'licensed', -119.9, 59.95, -119.9, 59.95,
           null, null, null, null),
          (${NEAR}, '0999003', 'Example Resources Inc', 'suspended', -119.9, 59.959, -119.92,
           59.959, ${deep(-119.9, 59.959)}, false, 701, null),
          (${TWO}, '0999002', null, 'abandoned', -119.9, 59.955, -119.92, 59.955,
           ${deep(-119.9, 59.955)}, true, null, null),
          (${FLAT}, '0999004', null, 'producing', -119.9, 59.968, -119.9, 59.968, null, null,
           null, null),
          (${FAR}, '0999005', null, 'producing', -119.9, 59.99, -119.92, 59.99,
           ${deep(-119.9, 59.99)}, true, null, null)`;

      const { legs, loadedAt } = await db.st37Well3d(member(), ONE, 3, 10);
      // The leg asked for, its well's other leg, then the others by distance; not the well
      // without depths, nor the one beyond 3 km.
      expect(legs.map((leg) => [leg.uwi, leg.own])).toEqual([
        [ONE, true],
        [LEG, true],
        [TWO, false],
        [NEAR, false],
      ]);
      expect(legs[0]).toMatchObject({
        licenceNumber: '0999001',
        licensee: 'Example Energy Ltd.',
        statusClass: 'producing',
        surveyed: true,
        surface: [-119.9, 59.95],
        kbElevationM: 700.5,
        groundElevationM: 695,
      });
      expect(legs[0]?.points?.[2]).toEqual([-119.92, 59.95, -1550.2]);
      expect(legs[1]?.points).toBeNull();
      expect(legs[3]).toMatchObject({ surveyed: false, kbElevationM: 701 });
      expect(loadedAt === null || typeof loadedAt === 'string').toBe(true);

      // One more than the limit comes back, so the route can say there are more.
      expect((await db.st37Well3d(member(), ONE, 3, 1)).legs).toHaveLength(4);
      expect((await db.st37Well3d(member(), ONE, 3, 0)).legs).toHaveLength(3);
      // A well that is not loaded, and a caller who is no member: nothing.
      expect((await db.st37Well3d(member(), '00/16-36-126-01W6/0', 3, 10)).legs).toEqual([]);
      expect((await db.st37Well3d({ ...member(), role: 'stranger' }, ONE, 3, 10)).legs).toEqual([]);
    } finally {
      await admin`delete from petro.st37_wells where uwi in ${admin(ALL)}`;
      await admin.end();
      await db.close();
    }
  });

  it("reads each play's latest load, a well's field and pool by name, and a play's drilled wells", async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    const PLAY = 'example_play';
    try {
      await admin`delete from petro.st37_wells where uwi in ${admin(UWIS)}`;
      await admin`delete from petro.st37_loads where formation = ${PLAY}`;
      await admin`delete from petro.fields where field_code = 990002`;
      await admin`insert into petro.fields (field_code, name) values (990002, 'EXAMPLE SOUTH')`;
      await admin`
        insert into petro.pools (field_code, pool_code, name) values (990002, 728001, 'EXAMPLE A')`;
      // Two loads of the play: the later one is the one named.
      await admin`
        insert into petro.st37_loads (source_url, west, south, east, north, wells, formation)
        values ('https://static.aer.ca/x', -119.99, 59.9, -119.8, 60, 1, ${PLAY}),
               ('https://static.aer.ca/x', -119.95, 59.9, -119.85, 60, 2, ${PLAY})`;
      await admin`
        insert into petro.st37_wells (uwi, licence_number, status_class, pool_code, field_code,
          formation, surface_longitude, surface_latitude, bottom_longitude, bottom_latitude)
        values (${ONE}, '0999001', 'producing', 728001, 990002, ${PLAY}, -119.9, 59.95, -119.91, 59.95),
               (${TWO}, '0999002', 'licensed', 728099, 990002, ${PLAY}, -119.88, 59.96, -119.88, 59.96)`;

      const { loads, wells } = await db.st37Wells(member(), BOX, 10);
      const ours = loads.filter((load) => load.formation === PLAY);
      expect(ours).toHaveLength(1);
      expect(ours[0]).toMatchObject({
        area: { west: -119.95, south: 59.9, east: -119.85, north: 60 },
        totals: { producing: 1, licensed: 1 },
      });
      expect(wells.find((w) => w.uwi === ONE)).toMatchObject({
        formation: PLAY,
        fieldCode: 990002,
        fieldName: 'EXAMPLE SOUTH',
        poolCode: 728001,
        poolName: 'EXAMPLE A',
      });
      // A pool the list does not name: its field is still named, the pool by its code only.
      expect(wells.find((w) => w.uwi === TWO)).toMatchObject({
        fieldName: 'EXAMPLE SOUTH',
        poolCode: 728099,
        poolName: null,
      });

      // The drilled wells of the play: not the licensed one, and none of another play.
      expect(await db.st37Drilled(member(), PLAY)).toEqual([
        { surface: [-119.9, 59.95], bottom: [-119.91, 59.95] },
      ]);
      expect(await db.st37Drilled(member(), 'another_play')).toEqual([]);
      expect(await db.st37Drilled({ ...member(), role: 'stranger' }, PLAY)).toEqual([]);

      // A play whose wells are gone is no longer listed.
      await admin`delete from petro.st37_wells where uwi in ${admin(UWIS)}`;
      const after = await db.st37Wells(member(), BOX, 10);
      expect(after.loads.some((load) => load.formation === PLAY)).toBe(false);
    } finally {
      await admin`delete from petro.st37_wells where uwi in ${admin(UWIS)}`;
      await admin`delete from petro.st37_loads where formation = ${PLAY}`;
      await admin`delete from petro.fields where field_code = 990002`;
      await admin.end();
      await db.close();
    }
  });
});
