import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-249): pipelines read as the real `petro_api` role against the real
// migration. The rows are written as the database's owner, as the manual load does. Made-up
// segments only, with licence numbers no AER pipeline has (ZZ…), in Alberta's far north-west
// corner, where no load reaches.
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

const CORNER = { west: -120, south: 59.9, east: -119.9, north: 60 };

describe('pipelines as petro_api', () => {
  it('reads the lines touching a square, the large ones alone when asked, and a segment', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    let load: string | undefined;
    const clean = async () => {
      await admin`delete from petro.pipelines where licence_number like 'ZZ%'`;
      if (load) await admin`delete from petro.pipeline_loads where id = ${load}`;
    };
    try {
      await clean();
      await admin`
        insert into petro.pipelines
          (segment_id, licence_number, line_number, licensee_code, licensee, status, substances,
           from_facility, from_location, length_km, diameter_mm, max_pressure, licence_approved,
           bounds, path, breaks)
        values
          ('999001', 'ZZ1', '1', 'A0X1', 'Example Pipelines Ltd.', 'Operating',
           '{Natural Gas,Fuel Gas}', 'Regulator Station', '16-33-044-24W4', 10.27, 508, 3100,
           '2002-09-20', box(point(-119.99, 59.95), point(-119.95, 59.96)),
           '{-11999000,5995000,-11995000,5996000}', '{}'),
          ('999002', 'ZZ2', null, null, null, 'Abandoned', '{Salt Water}', null, null, null,
           88.9, null, null, box(point(-119.98, 59.93), point(-119.97, 59.94)),
           '{-11998000,5993000,-11997500,5993500,-11997500,5993500,-11997000,5994000}', '{2}'),
          ('999003', 'ZZ3', '1', null, null, 'Operating', '{}', null, null, null, null, null,
           null, box(point(-119.5, 59.5), point(-119.4, 59.6)),
           '{-11950000,5950000,-11940000,5960000}', '{}')`;
      const [row] = await admin<{ id: string }[]>`
        insert into petro.pipeline_loads (source_url, file_date, west, south, east, north, segments)
        values ('https://static.aer.ca/prd/data/pipeline/Pipelines_SHP.zip', '2026-11-22',
                -120, 59.4, -119.3, 60, 3)
        returning id::text as id`;
      load = row?.id;

      const all = await db.pipelineSquare(member(), CORNER, 0, 100);
      expect(all.load).toMatchObject({
        fileDate: '2026-11-22',
        area: { west: -120, south: 59.4, east: -119.3, north: 60 },
        segments: 3,
      });
      const ours = all.rows.filter((r) => r.licence_number.startsWith('ZZ'));
      // The largest first; the segment outside the square is not sent.
      expect(ours).toEqual([
        {
          id: expect.any(String) as string,
          licence_number: 'ZZ1',
          line_number: '1',
          licensee_code: 'A0X1',
          licensee: 'Example Pipelines Ltd.',
          status: 'Operating',
          substance: 'Natural Gas',
          diameter_mm: 508,
          path: [-11999000, 5995000, -11995000, 5996000],
          breaks: [],
        },
        expect.objectContaining({ licence_number: 'ZZ2', substance: 'Salt Water', breaks: [2] }),
      ]);

      const large = await db.pipelineSquare(member(), CORNER, 219.1, 100);
      expect(
        large.rows.filter((r) => r.licence_number.startsWith('ZZ')).map((r) => r.licence_number),
      ).toEqual(['ZZ1']);

      const one = await db.pipelineSquare(member(), CORNER, 0, 1);
      expect(one.rows).toHaveLength(1);

      const segment = await db.pipelineSegment(member(), ours[0]?.id ?? '0');
      expect(segment).toMatchObject({
        segment_id: '999001',
        licence_number: 'ZZ1',
        substances: ['Natural Gas', 'Fuel Gas'],
        from_facility: 'Regulator Station',
        from_location: '16-33-044-24W4',
        length_km: '10.270',
        diameter_mm: '508.00',
        max_pressure: '3100.00',
        licence_approved: '2002-09-20',
        west: -119.99,
        south: 59.95,
        east: -119.95,
        north: 59.96,
      });
      expect(await db.pipelineSegment(member(), '999999999999')).toBeNull();
    } finally {
      await clean();
      await admin.end();
      await db.close();
    }
  });
});
