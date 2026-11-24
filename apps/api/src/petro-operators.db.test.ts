import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-302): the operators read as the real `petro_api` role against the real
// migrations, from the wells, facilities and pipelines tables. The rows are written as the
// database's owner, as the loads do. Made-up companies and IDs no AER record has.
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

const UWIS = ['00/03-01-125-01W6/0', '00/04-01-125-01W6/0'];

describe('operators as petro_api', () => {
  it('counts each company in the wells, the facilities and the pipelines', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    const clean = async () => {
      await admin`delete from petro.st37_wells where uwi in ${admin(UWIS)}`;
      await admin`delete from petro.facilities where facility_id like 'ABZY%'`;
      await admin`delete from petro.pipelines where licence_number like 'ZY%'`;
    };
    try {
      await clean();
      await admin`
        insert into petro.st37_wells (uwi, licence_number, licensee, status_class,
          surface_longitude, surface_latitude, bottom_longitude, bottom_latitude)
        values (${UWIS[0] ?? ''}, '0998001', 'ZQXEXAMPLE ENERGY LTD.', 'producing', -119.9, 59.95, -119.9, 59.95),
               (${UWIS[1] ?? ''}, '0998002', 'ZQXEXAMPLE ENERGY LTD.', 'abandoned', -119.9, 59.95, -119.9, 59.95)`;
      await admin`
        insert into petro.facilities (facility_id, operator_code, operator, longitude, latitude)
        values ('ABZY9999901', 'Z0Y1', 'Zqxexample Energy Ltd.', -119.95, 59.95)`;
      await admin`
        insert into petro.pipelines (segment_id, licence_number, line_number, licensee_code,
          licensee, status, bounds, path, breaks)
        values ('998001', 'ZY1', '1', 'Z0Y2', 'Zqxsample Midstream Ltd.', 'Operating',
                box(point(-119.99, 59.95), point(-119.95, 59.96)),
                '{-11999000,5995000,-11995000,5996000}', '{}')`;

      const rows = (await db.operators(member())).filter((r) =>
        (r.name ?? '').toUpperCase().startsWith('ZQX'),
      );
      expect(rows.sort((a, b) => a.source.localeCompare(b.source))).toEqual([
        { source: 'facilities', code: 'Z0Y1', name: 'Zqxexample Energy Ltd.', count: 1 },
        { source: 'pipelines', code: 'Z0Y2', name: 'Zqxsample Midstream Ltd.', count: 1 },
        { source: 'wells', code: null, name: 'ZQXEXAMPLE ENERGY LTD.', count: 2 },
      ]);
    } finally {
      await clean();
      await admin.end();
      await db.close();
    }
  });
});
