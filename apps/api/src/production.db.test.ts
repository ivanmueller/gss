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

const [ONE, TWO, THREE, INJECTOR] = [
  '00/01-01-126-01W6/0',
  '00/02-01-126-01W6/2',
  '00/04-01-126-01W6/0',
  '00/05-01-126-01W6/0',
];
const UWIS = [ONE, TWO, THREE, INJECTOR];
const PLAY = 'example_play';

describe('monthly production as petro_api', () => {
  it("reads a well's months in order and the total of one play's wells by month, injection beside", async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    try {
      await admin`delete from petro.well_production where uwi in ${admin(UWIS)}`;
      await admin`delete from petro.well_injection where uwi in ${admin(UWIS)}`;
      await admin`delete from petro.st37_wells where uwi in ${admin(UWIS)}`;
      // Both wells belong to a play of their own; a third well's production to no play.
      await admin`
        insert into petro.st37_wells (uwi, licence_number, status_class, formation,
          surface_longitude, surface_latitude, bottom_longitude, bottom_latitude)
        values (${ONE}, '0999001', 'producing', ${PLAY}, -119.9, 59.95, -119.91, 59.95),
               (${TWO}, '0999002', 'producing', ${PLAY}, -119.9, 59.96, -119.91, 59.96),
               (${INJECTOR}, '0999005', 'producing', ${PLAY}, -119.9, 59.97, -119.91, 59.97)`;
      await admin`
        insert into petro.well_production (uwi, month, oil_m3, gas_e3m3, water_m3, condensate_m3, hours)
        values
          (${ONE}, '1990-02-01', 280, 110.125, null, 12.5, 600),
          (${ONE}, '1990-01-01', 310.5, 120.25, 80, null, 744),
          (${TWO}, '1990-01-01', 100.25, null, 20, null, null),
          (${THREE}, '1990-01-01', 999, 999, 999, 999, 1)`;
      // The injector took water both months and produced nothing; ONE took gas in February;
      // THREE's injection is of no play (F-300).
      await admin`
        insert into petro.well_injection (uwi, month, water_m3, gas_e3m3, hours)
        values
          (${INJECTOR}, '1990-01-01', 500.5, null, 744),
          (${INJECTOR}, '1990-03-01', 400, null, 700),
          (${ONE}, '1990-02-01', null, 2.25, 10),
          (${THREE}, '1990-01-01', 999, null, 1)`;

      const well = await db.wellProduction(member(), ONE);
      const none = { waterInjected: null, gasInjected: null };
      expect(well.months).toEqual([
        {
          month: '1990-01',
          oil: 310.5,
          gas: 120.25,
          water: 80,
          condensate: null,
          ...none,
          hours: 744,
        },
        {
          month: '1990-02',
          oil: 280,
          gas: 110.125,
          water: null,
          condensate: 12.5,
          waterInjected: null,
          gasInjected: 2.25,
          hours: 600,
        },
      ]);
      // An injector's months: injection only, with its hours.
      const empty = { oil: null, gas: null, water: null, condensate: null };
      expect((await db.wellProduction(member(), INJECTOR)).months).toEqual([
        { month: '1990-01', ...empty, waterInjected: 500.5, gasInjected: null, hours: 744 },
        { month: '1990-03', ...empty, waterInjected: 400, gasInjected: null, hours: 700 },
      ]);
      expect((await db.wellProduction(member(), '00/03-01-126-01W6/0')).months).toEqual([]);

      const formation = await db.formationProduction(member(), PLAY);
      expect(formation.months).toEqual([
        {
          month: '1990-01',
          oil: 410.75,
          gas: 120.25,
          water: 100,
          condensate: null,
          waterInjected: 500.5,
          gasInjected: null,
          wells: 2,
          injectors: 1,
        },
        {
          month: '1990-02',
          oil: 280,
          gas: 110.125,
          water: null,
          condensate: 12.5,
          waterInjected: null,
          gasInjected: 2.25,
          wells: 1,
          injectors: 1,
        },
        {
          month: '1990-03',
          ...empty,
          waterInjected: 400,
          gasInjected: null,
          wells: 0,
          injectors: 1,
        },
      ]);

      expect((await db.formationProduction(member(), 'another_play')).months).toEqual([]);

      // Without a member the rows are not read at all.
      const nobody = { ...member(), role: 'stranger' };
      expect((await db.wellProduction(nobody, ONE)).months).toEqual([]);
      expect((await db.wellProduction(nobody, INJECTOR)).months).toEqual([]);
      expect((await db.formationProduction(nobody, PLAY)).months).toEqual([]);
    } finally {
      await admin`delete from petro.well_production where uwi in ${admin(UWIS)}`;
      await admin`delete from petro.well_injection where uwi in ${admin(UWIS)}`;
      await admin`delete from petro.st37_wells where uwi in ${admin(UWIS)}`;
      await admin.end();
      await db.close();
    }
  });
});
