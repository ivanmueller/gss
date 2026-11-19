import { AER_READER_VERSION } from '@grain/domain';
import { describe, expect, it } from 'vitest';

import { bodySha256 } from './aer-lists';
import type { AerLicenceRow, AerReading, AerRigRow } from './aer-lists-db';
import { postgresPetroleum, type PetroleumDatabase } from './petroleum-db';

// Integration test (F-243 part 1): the AER queries as the real `petro_api` role against the real
// migration (README, "The oil and gas database"). The lists are public data shared by every run,
// so each test uses its own random contents, list dates, licence numbers and places. Synthetic.
const PETRO_URL = process.env.PETROLEUM_TEST_DATABASE_URL;
if (!PETRO_URL) {
  throw new Error(
    'Set PETROLEUM_TEST_DATABASE_URL (petro_api login on the local petroleum database).',
  );
}
const URL = PETRO_URL;

const ST1_URL = 'https://static.aer.ca/prd/data/well-lic/WELLSTUE.TXT';
const ST49_URL = 'https://static.aer.ca/prd/data/wells/SPUDTue.txt';

const member = () => ({
  userId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  role: 'viewer',
  requestId: crypto.randomUUID(),
});

const random = (from: number, to: number) => from + Math.floor(Math.random() * (to - from + 1));
const unique = () => `synthetic list ${crypto.randomUUID()}`;
/** A list date of its own, far from any other run's (2080 to 2099). */
const ownDate = () =>
  new Date(Date.UTC(2080, 0, 1) + random(0, 7000) * 86_400_000).toISOString().slice(0, 10);
const ownLicence = () => String(random(1_000_000, 9_999_999));
const ownPlace = () => ({
  lsd: random(1, 16),
  section: random(1, 36),
  township: random(1, 126),
  range: random(1, 34),
  meridian: random(4, 6),
});
const placeText = (p: ReturnType<typeof ownPlace>) =>
  `${String(p.lsd).padStart(2, '0')}-${String(p.section).padStart(2, '0')}-${String(p.township).padStart(3, '0')}-${String(p.range).padStart(2, '0')}W${String(p.meridian)}`;

const ownWell = () => `${String(random(10, 99))}/${placeText(ownPlace())}/0`;

function licence(n: string, place: ReturnType<typeof ownPlace>, lineNo = 18): AerLicenceRow {
  return {
    lineNo,
    licenceNumber: n,
    wellName: 'EXAMPLE HZ TESTVILLE',
    mineralRights: 'ALBERTA CROWN',
    groundElevation: '700.1M',
    uwi: '100/01-02-003-04W5/00',
    surfaceOffsets: 'S 120.5M W 80.0M',
    fieldCentre: 'RED DEER',
    projectedDepth: '2500.0M',
    classification: 'DEV (NC)',
    field: 'TESTFIELD',
    terminatingZone: 'CARDIUM FM',
    drillingOperation: 'HORIZONTAL',
    wellPurpose: 'NEW',
    wellType: 'PRODUCTION',
    substance: 'CRUDE OIL',
    licensee: 'EXAMPLE ENERGY LTD.',
    surfaceLocation: placeText(place),
    location: place,
  };
}

/** A rig activity of its own well (an activity is one well, time and type). */
function rig(n: string, seconds: number, wellId: string): AerRigRow {
  return {
    lineNo: 8 + seconds,
    wellId,
    wellName: 'EXAMPLE',
    licenceNumber: n,
    contractorBaId: 'A1XX',
    contractorName: 'Example Drilling Inc.',
    rigNumber: '11',
    activityLocal: `15 Nov 2026 08:30:${String(seconds).padStart(2, '0')} PM`,
    activityWallTime: `2026-11-15T20:30:${String(seconds).padStart(2, '0')}`,
    activityAt: `2026-11-16T02:30:${String(seconds).padStart(2, '0')}.000Z`,
    fieldCentre: 'Medicine Hat',
    licenseeBaId: 'A7XX',
    licenseeName: 'Example Energy Ltd.',
    newProjectedDepth: '',
    activityType: 'Drill to LD',
    bottomHole: { lsd: 2, section: 27, township: 17, range: 13, meridian: 4 },
  };
}

async function capture(db: PetroleumDatabase, report: 'st1' | 'st49', url: string, body: string) {
  return db.aerCapture(report, url, body, await bodySha256(body), new Date());
}

async function storedRead(
  db: PetroleumDatabase,
  report: 'st1' | 'st49',
  url: string,
  reading: AerReading,
) {
  const { fileId } = await capture(db, report, url, unique());
  expect(await db.aerStoreReading(fileId, AER_READER_VERSION, reading)).toBe('stored');
  return fileId;
}

async function using<T>(fn: (db: PetroleumDatabase) => Promise<T>): Promise<T> {
  const db = postgresPetroleum(URL);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

describe('the AER lists as petro_api', () => {
  it('records A, B, then A again as three editions, and an unchanged address as none', () =>
    using(async (db) => {
      const a = unique();
      const b = unique();
      const first = await capture(db, 'st1', ST1_URL, a);
      expect(first).toMatchObject({ newFile: true, newEdition: true });
      expect(await capture(db, 'st1', ST1_URL, b)).toMatchObject({
        newFile: true,
        newEdition: true,
      });
      const again = await capture(db, 'st1', ST1_URL, a);
      expect(again).toEqual({ fileId: first.fileId, newFile: false, newEdition: true });
      expect(await capture(db, 'st1', ST1_URL, a)).toMatchObject({
        newFile: false,
        newEdition: false,
      });
    }));

  it('records one edition when two runs see the same change at once (F-243-1-D2-05)', async () => {
    const one = postgresPetroleum(URL);
    const two = postgresPetroleum(URL);
    try {
      const body = unique();
      const results = await Promise.all([
        capture(one, 'st49', ST49_URL, body),
        capture(two, 'st49', ST49_URL, body),
      ]);
      expect(results.filter((r) => r.newEdition)).toHaveLength(1);
      expect(results.filter((r) => r.newFile)).toHaveLength(1);
    } finally {
      await one.close();
      await two.close();
    }
  });

  it('never lets a slower, older fetch become the latest edition (F-243-1-R4-02)', () =>
    using(async (db) => {
      const a = unique();
      const b = unique();
      const fetchedA = new Date(Date.now() - 60_000);
      // B was fetched after A but reaches the database first.
      expect(await db.aerCapture('st1', ST1_URL, b, await bodySha256(b), new Date())).toMatchObject(
        {
          newEdition: true,
        },
      );
      expect(await db.aerCapture('st1', ST1_URL, a, await bodySha256(a), fetchedA)).toMatchObject({
        newFile: true,
        newEdition: false,
      });
    }));

  it('keeps the file when the database refuses a reading, which is then recorded unreadable', () =>
    using(async (db) => {
      const { fileId } = await capture(db, 'st1', ST1_URL, unique());
      const bad = licence(ownLicence(), ownPlace());
      bad.licenceNumber = '12345';
      await expect(
        db.aerStoreReading(fileId, AER_READER_VERSION, {
          status: 'read',
          listDate: ownDate(),
          skipped: 0,
          licences: [bad],
          rigs: [],
        }),
      ).rejects.toMatchObject({ code: '23514' });
      // Rolled back: the file is still waiting for this reader version.
      expect((await db.aerFilesToRead(AER_READER_VERSION, [fileId], 1)).map((f) => f.id)).toEqual([
        fileId,
      ]);
      expect(await db.aerStoreReading(fileId, AER_READER_VERSION, { status: 'unreadable' })).toBe(
        'stored',
      );
      expect(await db.aerStoreReading(fileId, AER_READER_VERSION, { status: 'unreadable' })).toBe(
        'exists',
      );
      expect(
        (await db.aerFilesToRead(AER_READER_VERSION, [fileId], 50)).map((f) => f.id),
      ).not.toContain(fileId);
    }));

  it('lists the named files first for a new reader version', () =>
    using(async (db) => {
      const { fileId } = await capture(db, 'st1', ST1_URL, unique());
      const files = await db.aerFilesToRead(AER_READER_VERSION + 500, [fileId], 2);
      expect(files[0]).toMatchObject({ id: fileId, report: 'st1' });
      expect(files).toHaveLength(2);
    }));

  it('serves a licence from its latest list date, and places its rig at the same location (F-243-1-D2-06)', () =>
    using(async (db) => {
      const n = ownLicence();
      const before = ownPlace();
      const after = ownPlace();
      const earlier = ownDate();
      const later = new Date(Date.parse(earlier) + 86_400_000).toISOString().slice(0, 10);
      await storedRead(db, 'st1', ST1_URL, {
        status: 'read',
        listDate: earlier,
        skipped: 0,
        licences: [licence(n, before)],
        rigs: [],
      });
      await storedRead(db, 'st1', ST1_URL, {
        status: 'read',
        listDate: later,
        skipped: 0,
        licences: [licence(n, after)],
        rigs: [],
      });
      await storedRead(db, 'st49', ST49_URL, {
        status: 'read',
        listDate: later,
        skipped: 0,
        licences: [],
        rigs: [rig(n, 15, ownWell()), rig(n, 59, ownWell())],
      });

      // The corrected location is to be located; once found, both routes place there.
      const pending = await db.aerSubdivisionsToLocate(100_000, 1);
      expect(pending).toContainEqual(after);
      await db.aerStorePoints([{ ...after, point: { longitude: -113.5, latitude: 53.5 } }], 1);
      expect(await db.aerSubdivisionsToLocate(100_000, 1)).not.toContainEqual(after);

      const who = member();
      const licences = await db.aerLicences(who, earlier);
      const mine = licences.rows.filter((row) => row.licenceNumber === n);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        listDate: later,
        surfaceLocation: placeText(after),
        longitude: -113.5,
        latitude: 53.5,
      });
      const rigs = (await db.aerRigs(who, earlier)).rows.filter((row) => row.licenceNumber === n);
      // Two activities in the same minute stay two, each with its list date and the licence's
      // served location.
      expect(rigs.map((row) => row.activityAt).sort()).toEqual([
        '2026-11-16T02:30:15.000Z',
        '2026-11-16T02:30:59.000Z',
      ]);
      for (const row of rigs) {
        expect(row).toMatchObject({
          listDate: later,
          surfaceLocation: placeText(after),
          longitude: -113.5,
          latitude: 53.5,
        });
      }
      expect(licences.dates.latestListDate).not.toBeNull();

      // A new placement version places the subdivision again, and both routes move with it
      // (F-243-1-R3-02).
      expect(await db.aerSubdivisionsToLocate(100_000, 2)).toContainEqual(after);
      await db.aerStorePoints([{ ...after, point: { longitude: -113.4, latitude: 53.6 } }], 2);
      expect(
        (await db.aerLicences(who, earlier)).rows.find((row) => row.licenceNumber === n),
      ).toMatchObject({ longitude: -113.4, latitude: 53.6 });
      for (const row of (await db.aerRigs(who, earlier)).rows.filter(
        (r) => r.licenceNumber === n,
      )) {
        expect(row).toMatchObject({ longitude: -113.4, latitude: 53.6 });
      }
      // A newer placement that finds nothing retires the older point (F-243-1-R4-03).
      await db.aerStorePoints([{ ...after, point: null }], 3);
      expect(
        (await db.aerLicences(who, earlier)).rows.find((row) => row.licenceNumber === n),
      ).toMatchObject({ longitude: null, latitude: null });
    }));

  it('leaves a rig unplaced when its licence is not in the stored ST1 lists', () =>
    using(async (db) => {
      const n = ownLicence();
      const listDate = ownDate();
      await storedRead(db, 'st49', ST49_URL, {
        status: 'read',
        listDate,
        skipped: 0,
        licences: [],
        rigs: [rig(n, 1, ownWell())],
      });
      const rows = (await db.aerRigs(member(), listDate)).rows.filter(
        (row) => row.licenceNumber === n,
      );
      expect(rows).toEqual([
        expect.objectContaining({ surfaceLocation: null, longitude: null, latitude: null }),
      ]);
    }));

  it('keeps a point not found until a week has passed', () =>
    using(async (db) => {
      const n = ownLicence();
      const place = ownPlace();
      await storedRead(db, 'st1', ST1_URL, {
        status: 'read',
        listDate: ownDate(),
        skipped: 0,
        licences: [licence(n, place)],
        rigs: [],
      });
      await db.aerStorePoints([{ ...place, point: null }], 1);
      expect(await db.aerSubdivisionsToLocate(100_000, 1)).not.toContainEqual(place);
      // Asked again within the week: the stored answer stays.
      await db.aerStorePoints([{ ...place, point: { longitude: -113, latitude: 53 } }], 1);
      const row = (await db.aerLicences(member(), '2080-01-01')).rows.find(
        (r) => r.licenceNumber === n,
      );
      expect(row).toMatchObject({ longitude: null, latitude: null });
    }));

  it('shows nothing to a person the Worker did not name', () =>
    using(async (db) => {
      const nobody = { ...member(), role: 'not-a-role' };
      expect((await db.aerLicences(nobody, '2000-01-01')).rows).toEqual([]);
    }));
});
