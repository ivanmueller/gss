import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

// Integration test (F-261 part 2): the ground's layers read as the real `petro_api` role
// against the real migration. The cells are written as the database's owner, as the manual
// load does. Made-up cells only, far outside Alberta's lattice, where no load reaches.
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

const Y = 990_000;
/** The 90 zones of a cell: the Duvernay (zone 68) and the Precambrian, or the second alone. */
const zones = (duvernay: boolean, value: 'top' | 'base') =>
  Array.from({ length: 90 }, (_, i) =>
    i === 67 && duvernay
      ? value === 'top'
        ? -2252
        : -2310
      : i === 89
        ? value === 'top'
          ? -2722
          : -6000
        : null,
  );

describe('the formation layers as petro_api', () => {
  it('reads the cells of a range with each zone, and nothing as a stranger', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    try {
      await admin`delete from petro.formation_cells where cell_y between ${Y} and ${Y + 5}`;
      await admin`
        insert into petro.formation_cells (cell_x, cell_y, tops, bases)
        values (500, ${Y}, ${zones(true, 'top')}::smallint[], ${zones(true, 'base')}::smallint[]),
               (501, ${Y}, ${zones(false, 'top')}::smallint[], ${zones(false, 'base')}::smallint[]),
               (501, ${Y + 1}, ${zones(true, 'top')}::smallint[], ${zones(true, 'base')}::smallint[]),
               (509, ${Y}, ${zones(true, 'top')}::smallint[], ${zones(true, 'base')}::smallint[])`;

      const range = { x0: 499, x1: 502, y0: Y - 1, y1: Y + 1 };
      const { cells, load } = await db.formationCells(member(), range);
      // The south row first, then west to east; not the cell beyond the range.
      expect(cells.map((c) => [c.x, c.y])).toEqual([
        [500, Y],
        [501, Y],
        [501, Y + 1],
      ]);
      expect(cells[0]?.tops).toHaveLength(90);
      expect([cells[0]?.tops[67], cells[0]?.bases[67]]).toEqual([-2252, -2310]);
      expect([cells[0]?.tops[89], cells[0]?.bases[89]]).toEqual([-2722, -6000]);
      // A zone absent under a cell is null there.
      expect(cells[1]?.tops[67]).toBeNull();
      expect(cells[0]?.tops[0]).toBeNull();
      expect(load === null || typeof load.model === 'string').toBe(true);

      expect((await db.formationCells({ ...member(), role: 'stranger' }, range)).cells).toEqual([]);
    } finally {
      await admin`delete from petro.formation_cells where cell_y between ${Y} and ${Y + 5}`;
      await admin.end();
      await db.close();
    }
  });

  it('names the latest load', async () => {
    const admin = postgres(ADMIN, { max: 1 });
    const db = postgresPetroleum(PETRO_URL);
    const URL_ = 'https://example.test/formation-db-test.zip';
    try {
      await admin`delete from petro.formation_loads where source_url = ${URL_}`;
      await admin`
        insert into petro.formation_loads (source_url, source_date, model, lon_step, lat_step, cells)
        values (${URL_}, '2026-11-02', 'Geological Framework of Alberta, Version 4', 0.016, 0.009, 4)`;
      const { load } = await db.formationCells(member(), { x0: 0, x1: 0, y0: 0, y1: 0 });
      expect(load).toMatchObject({
        sourceDate: '2026-11-02',
        model: 'Geological Framework of Alberta, Version 4',
        lonStep: 0.016,
        latStep: 0.009,
      });
      expect(load?.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await admin`delete from petro.formation_loads where source_url = ${URL_}`;
      await admin.end();
      await db.close();
    }
  });
});
