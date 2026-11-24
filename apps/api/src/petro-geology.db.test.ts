import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-287 part 2): a well's geology read as the real `petro_api` role against
// the real migrations. The rows are written as the database's owner, as the loads do. Made-up
// wells far in the north-west corner (no real well is there), under licences no real well has;
// every row written here is removed after.
const PETRO_URL = process.env.PETROLEUM_TEST_DATABASE_URL;
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
if (!PETRO_URL || !ADMIN_URL) {
  throw new Error('Set PETROLEUM_TEST_DATABASE_URL and API_TEST_ADMIN_DATABASE_URL.');
}
const ADMIN = `${ADMIN_URL.slice(0, ADMIN_URL.lastIndexOf('/'))}/petroleum`;
const ONE = '00/16-36-099-27W6/0';
const LEG = '00/16-36-099-27W6/2';
const NEAR = '00/15-36-099-27W6/0';
const FAR = '00/01-01-100-20W6/0';
const NAME_IDS = [32001, 32002];
const SAMPLE_IDS = [999_001, 999_002];
const X = Math.round(-119.9 / 0.016);
const Y = Math.round(59.95 / 0.009);

const member = () => ({
  userId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  role: 'viewer',
  requestId: crypto.randomUUID(),
});

describe('geology as petro_api', () => {
  it("reads a well's legs, the picks near it, the samples and the model's cells", async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    const loads: string[] = [];
    const clean = async () => {
      await admin`delete from petro.st37_wells where uwi in (${ONE}, ${LEG})`;
      await admin`delete from petro.formation_pick_wells where uwi in (${ONE}, ${NEAR}, ${FAR})`;
      await admin`delete from petro.formation_pick_names where id = any(${`{${NAME_IDS.join(',')}}`}::smallint[])`;
      await admin`delete from petro.maturity_samples where sample_id = any(${`{${SAMPLE_IDS.join(',')}}`}::int[])`;
      await admin`delete from petro.formation_cells where cell_x = ${X} and cell_y = ${Y}`;
      if (loads.length)
        await admin`delete from petro.geology_loads where id = any(${`{${loads.join(',')}}`}::bigint[])`;
    };
    try {
      await clean();
      await admin`
        insert into petro.st37_wells (uwi, licence_number, licensee, status_class, formation,
          surface_longitude, surface_latitude, bottom_longitude, bottom_latitude, path_3d,
          kb_elevation_m, ground_elevation_m)
        values
          (${ONE}, 'ZZGEO1', 'Example Energy Ltd.', 'producing', 'duvernay', -119.9, 59.95,
           -119.9, 59.95, '[[-119.9, 59.95, 700], [-119.9, 59.95, -2230]]', 705, 700),
          (${LEG}, 'ZZGEO1', 'Example Energy Ltd.', 'licensed', 'duvernay', -119.9, 59.95,
           -119.9, 59.95, null, null, null)`;
      await admin`
        insert into petro.formation_pick_names (id, name, surface)
        values (32001, 'Duvernay Formation top', '68_D_Dv_Mu_top'),
               (32002, 'Ireton Formation top', '67_D_Ir_FS_Gr_G_top')`;
      await admin`
        insert into petro.formation_pick_wells (uwi, licence_number, longitude, latitude,
          kb_elevation_m, names, tvd_m, sources)
        values (${ONE}, 'ZZGEO1', -119.9, 59.95, 705, '{32002,32001}', '{2900.5,2920.1}', '{1,2}'),
               (${NEAR}, 'ZZGEO2', -119.91, 59.95, null, '{32001}', '{2925}', '{0}'),
               (${FAR}, 'ZZGEO3', -119.5, 59.95, null, '{32001}', '{2950}', '{1}')`;
      await admin`
        insert into petro.maturity_samples (sample_id, run, uwi, site, longitude, latitude,
          top_depth_m, unit, sample_type, tmax_c, s2, toc_pct)
        values (999001, 1, ${ONE}, 'well', -119.9, 59.95, 2925.5, 'Duvernay', 'core', 460, 3.2, 4.25),
               (999002, 1, null, 'outcrop', -119.7, 59.95, null, 'Duvernay', 'outcrop', 440, 1, 1)`;
      const tops = Array.from({ length: 90 }, (_, i) => (i === 67 ? -2200 : null));
      const bases = Array.from({ length: 90 }, (_, i) => (i === 67 ? -2257 : null));
      await admin`
        insert into petro.formation_cells (cell_x, cell_y, tops, bases)
        values (${X}, ${Y}, ${`{${tops.map((v) => v ?? 'NULL').join(',')}}`}::smallint[], ${`{${bases.map((v) => v ?? 'NULL').join(',')}}`}::smallint[])`;
      const rows = await admin<{ id: string }[]>`
        insert into petro.geology_loads (kind, source_url, source_date, rows_loaded, skipped)
        values ('picks', 'https://aercclrsuatagsgispub01.blob.core.windows.net/x.zip', '2026-10-31', 4, 0),
               ('samples', 'https://static.ags.aer.ca/x.zip', null, 2, 0)
        returning id::text as id`;
      loads.push(...rows.map((r) => r.id));

      const got = await db.geologyOfWell(member(), ONE);
      expect(got.well).toEqual({
        uwi: ONE,
        licenceNumber: 'ZZGEO1',
        formation: 'duvernay',
        surface: [-119.9, 59.95],
        bottom: [-119.9, 59.95],
        groundElevationM: 700,
      });
      expect(got.legs.map((l) => [l.uwi, l.kbElevationM, l.points?.length ?? null])).toEqual([
        [ONE, 705, 2],
        [LEG, null, null],
      ]);
      expect(
        got.picked
          .map((p) => [p.uwi, p.names, p.tvdM, p.sources])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        [NEAR, [32001], [2925], [0]],
        [ONE, [32002, 32001], [2900.5, 2920.1], [1, 2]],
      ]);
      expect(got.names.map((n) => n.id).sort()).toEqual(NAME_IDS);
      expect(got.samples.map((s) => [s.sampleId, s.tmaxC, s.s2, s.topDepthM]).sort()).toEqual([
        [999001, '460', '3.200', '2925.50'],
        [999002, '440', '1.000', null],
      ]);
      expect(got.cells).toEqual([{ x: X, y: Y, tops, bases }]);
      expect(got.loads.picks).toMatchObject({ sourceDate: '2026-10-31' });
      expect(got.loads.samples).toMatchObject({ sourceDate: null });

      expect((await db.geologyOfWell(member(), '00/01-01-001-01W4/0')).well).toBeNull();
    } finally {
      await clean();
      await admin.end();
      await db.close();
    }
  });
});
