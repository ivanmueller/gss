import type { WellPage, WellRow } from '@grain/domain';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { postgresPetroleum, type PetroleumDatabase } from './petroleum-db';

// Integration test (F-243 part 3): the wells queries as the real `petro_api` role against the real
// migration. Loads are global, so each test finishes any running load first (as the owner of the
// test database). Synthetic wells only.
const PETRO_URL = process.env.PETROLEUM_TEST_DATABASE_URL;
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
if (!PETRO_URL || !ADMIN_URL) {
  throw new Error('Set PETROLEUM_TEST_DATABASE_URL and API_TEST_ADMIN_DATABASE_URL.');
}
const URL = PETRO_URL;
const ADMIN = `${ADMIN_URL.slice(0, ADMIN_URL.lastIndexOf('/'))}/petroleum`;

const random = (from: number, to: number) => from + Math.floor(Math.random() * (to - from + 1));
const ownUwi = () => `05${String(random(10_000_000_000, 99_999_999_999))}`;

function row(uwi: string, objectId: number, extra: Partial<WellRow> = {}): WellRow {
  return {
    uwi,
    objectId,
    wellName: 'EXAMPLE',
    operatorCode: 'A62D',
    operatorName: 'Example Energy Ltd.',
    wellType: 'Oil',
    statusCode: '0111000000',
    status: 'Oil',
    finalDrillDate: '1999-01-01',
    longitude: -113.6,
    latitude: 53.4,
    invalid: [],
    ...extra,
  };
}

function page(rows: WellRow[], more: boolean, unidentified = 0): WellPage {
  return {
    rows,
    unidentified,
    lastObjectId: Math.max(0, ...rows.map((r) => r.objectId)) || null,
    more,
  };
}

/** A fresh running load: any load still running is closed first, as the database's owner. */
async function freshLoad(db: PetroleumDatabase) {
  const admin = postgres(ADMIN, { max: 1 });
  try {
    await admin`update petro.well_loads set status = 'failed', finished_at = now()
                where status = 'running'`;
  } finally {
    await admin.end();
  }
  const load = await db.startWellLoad();
  if (!load) throw new Error('no load started');
  return load;
}

async function using<T>(fn: (db: PetroleumDatabase) => Promise<T>): Promise<T> {
  const db = postgresPetroleum(URL);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

const member = () => ({
  userId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  role: 'viewer',
  requestId: crypto.randomUUID(),
});

describe('the wells as petro_api', () => {
  it("stores wells, keeps a known well's good values over a bad field (F-243-3-D1-01)", () =>
    using(async (db) => {
      const uwi = ownUwi();
      const first = await freshLoad(db);
      expect(await db.saveWellPage(first.id, 0, page([row(uwi, 10)], true), true)).toBe('saved');
      // Seen again with a bad date and a bad location: the good ones are kept.
      expect(
        await db.saveWellPage(
          first.id,
          10,
          page(
            [
              row(uwi, 20, {
                finalDrillDate: null,
                longitude: null,
                latitude: null,
                wellName: 'RENAMED',
                invalid: ['finalDrillDate', 'location'],
              }),
            ],
            false,
          ),
          true,
        ),
      ).toBe('saved');
      expect(await db.latestWellLoad()).toMatchObject({
        id: first.id,
        status: 'done',
        lastObjectId: 20,
      });
      const admin = postgres(ADMIN, { max: 1 });
      try {
        const [well] = await admin<
          { well_name: string; final_drill_date: string; longitude: string }[]
        >`
          select well_name, final_drill_date::text, longitude::text from petro.wells where uwi = ${uwi}`;
        expect(well).toEqual({
          well_name: 'RENAMED',
          final_drill_date: '1999-01-01',
          longitude: '-113.600000',
        });
      } finally {
        await admin.end();
      }
    }));

  it('writes nothing when the cursor moved, so two runs never both write a page (F-243-3-D1-03)', () =>
    using(async (db) => {
      const load = await freshLoad(db);
      const other = postgresPetroleum(URL);
      try {
        const results = await Promise.all([
          db.saveWellPage(load.id, 0, page([row(ownUwi(), 5)], true), true),
          other.saveWellPage(load.id, 0, page([row(ownUwi(), 6)], true), true),
        ]);
        expect(results.sort()).toEqual(['moved', 'saved']);
        expect(await db.saveWellPage(load.id, 0, page([row(ownUwi(), 7)], true), true)).toBe(
          'moved',
        );
      } finally {
        await other.close();
      }
      expect(await db.stopWellLoad(load.id, 'stopped_size')).toBe('saved');
      expect(await db.saveWellPage(load.id, 6, page([row(ownUwi(), 8)], true), true)).toBe('moved');
      expect(await db.stopWellLoad(load.id, 'stopped_size')).toBe('moved');
    }));

  it('finishes unclean when a row could not be identified, retiring nothing', () =>
    using(async (db) => {
      const kept = ownUwi();
      const a = await freshLoad(db);
      await db.saveWellPage(a.id, 0, page([row(kept, 1)], false), true);
      const b = await freshLoad(db);
      expect(await db.saveWellPage(b.id, 0, page([], false, 3), true)).toBe('saved');
      expect(await db.latestWellLoad()).toMatchObject({
        status: 'done_unclean',
        rowsUnidentified: 3,
      });
      const status = await db.wellsStatus(member());
      expect(status.current).toBeGreaterThan(0);
      expect(status.load).toMatchObject({ status: 'done_unclean' });
    }));

  it('finishes unclean when the job could not show the load complete (F-243-3-R1-01)', () =>
    using(async (db) => {
      const load = await freshLoad(db);
      expect(await db.saveWellPage(load.id, 0, page([], false), false)).toBe('saved');
      expect(await db.latestWellLoad()).toMatchObject({ id: load.id, status: 'done_unclean' });
    }));

  it('allows one running load at a time', () =>
    using(async (db) => {
      await freshLoad(db);
      expect(await db.startWellLoad()).toBeNull();
    }));

  it('measures its own size', () =>
    using(async (db) => {
      expect(await db.databaseSize()).toBeGreaterThan(1_000_000);
    }));
});
