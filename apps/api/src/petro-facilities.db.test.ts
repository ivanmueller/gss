import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-278): facilities read as the real `petro_api` role against the real
// migration. The rows are written as the database's owner, as the manual load does. Made-up
// facilities only, with IDs no AER facility has (ABZZ…).
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

describe('facilities as petro_api', () => {
  it('reads every facility and the latest load', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    let load: string | undefined;
    const clean = async () => {
      await admin`delete from petro.facilities where facility_id like 'ABZZ%'`;
      if (load) await admin`delete from petro.facility_loads where id = ${load}`;
    };
    try {
      await clean();
      await admin`
        insert into petro.facilities
          (facility_id, name, operator_code, operator, sub_code, sub_type, licence_number,
           licence_type, licensee_code, licensee, status, location_source, longitude, latitude)
        values
          ('ABZZ9999901', 'EXAMPLE BATTERY', 'A0X1', 'Example Energy Ltd.', 311,
           'Crude Oil Single-Well Battery', '6422', 'F', 'A0X1', 'Example Energy Ltd.', 'Active',
           'Facility Licence', -119.95, 59.95),
          ('ABZZ9999902', null, null, null, null, null, null, null, null, null, null, null,
           -119.94, 59.94)`;
      const [row] = await admin<{ id: string }[]>`
        insert into petro.facility_loads (source_url, file_date, west, south, east, north, facilities)
        values ('https://static.aer.ca/prd/data/codes/ST102-SHP.zip', '2026-11-02',
                -120, 59.9, -119.9, 60, 2)
        returning id::text as id`;
      load = row?.id;

      const { load: latest, rows } = await db.facilities(member());
      expect(latest).toMatchObject({
        fileDate: '2026-11-02',
        area: { west: -120, south: 59.9, east: -119.9, north: 60 },
        facilities: 2,
      });
      const ours = rows.filter((r) => r.facility_id.startsWith('ABZZ'));
      expect(ours).toEqual([
        {
          facility_id: 'ABZZ9999901',
          name: 'EXAMPLE BATTERY',
          operator_code: 'A0X1',
          operator: 'Example Energy Ltd.',
          sub_code: 311,
          sub_type: 'Crude Oil Single-Well Battery',
          licence_number: '6422',
          licence_type: 'F',
          licensee_code: 'A0X1',
          licensee: 'Example Energy Ltd.',
          status: 'Active',
          location_source: 'Facility Licence',
          longitude: '-119.950000',
          latitude: '59.950000',
        },
        expect.objectContaining({ facility_id: 'ABZZ9999902', name: null, sub_code: null }),
      ]);
    } finally {
      await clean();
      await admin.end();
      await db.close();
    }
  });
});
