import { companyNameKey, contactKey, facilityKey } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connectionOptions,
  createDatabase,
  postgresDatabase,
  type Database,
  type ExistingCounterparty,
  type ImportBatchInput,
  type RequestContext,
} from './db';
import { importBatchFor, matchImport, planImport } from './counterparties';

// Integration test of the counterparty directory: the real driver, as `app_api`, against
// the real migrations, row level security and audit trigger. Fixtures are synthetic and
// removed afterwards.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { olivia: id(), victor: id(), bob: id() };
const orgs = { a: id(), b: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

// A valid 1x1 PNG.
const PNG = Uint8Array.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082'.match(
    /../g,
  ) ?? [],
  (pair) => parseInt(pair, 16),
);

function batch(overrides: Partial<ImportBatchInput> = {}): ImportBatchInput {
  return {
    organizationId: orgs.a,
    fileName: 'synthetic-buyers.csv',
    contentSha256: 'c'.repeat(64),
    rowCount: 3,
    skippedCount: 0,
    additions: [],
    counterparties: [
      {
        counterparty: {
          legalName: 'Synthetic Prairie Mills',
          tradingName: 'Prairie Mills',
          types: ['buyer', 'seller'],
          primaryCountry: 'CA',
          verificationStatus: 'pending',
          website: 'https://www.example.com',
          phone: '+1 306 555 0100',
          markets: ['pet', 'bird'],
          tier: 'A',
          notes: 'Synthetic record.',
        },
        contacts: [
          {
            name: 'Synthetic Merchandiser',
            role: 'Buyer',
            email: 'merch@example.test',
            phone: '+1 306 555 0100',
          },
        ],
        facilities: [
          {
            name: 'Synthetic Elevator',
            facilityType: 'elevator',
            addressLine: '1 Synthetic Road',
            city: 'Synthetic Town',
            region: 'SK',
            postalCode: 'S4P 3Y2',
            country: 'CA',
            latitude: '52.133214',
            longitude: '-106.670046',
            locationPrecision: 'approximate',
          },
          {
            name: null,
            facilityType: null,
            addressLine: null,
            city: 'Synthetic City',
            region: 'MB',
            postalCode: null,
            country: 'CA',
            latitude: null,
            longitude: null,
            locationPrecision: null,
          },
        ],
        commodities: [
          { commodity: 'yellow_peas', direction: 'sells' },
          { commodity: 'canola', direction: 'buys' },
        ],
      },
      {
        counterparty: {
          legalName: 'Synthetic Buyer LLC',
          tradingName: null,
          types: ['buyer'],
          primaryCountry: 'US',
          verificationStatus: 'unverified',
          website: null,
          phone: null,
          markets: [],
          tier: null,
          notes: null,
        },
        contacts: [],
        facilities: [],
        commodities: [],
      },
    ],
    ...overrides,
  };
}

let db: Database;

/**
 * Runs `change` in an admin transaction as olivia, starts the import, and commits the change
 * only once the import waits for a company's row lock: a change made after the import read
 * the list but before it locked the company.
 */
function whileImportWaits(
  change: (tx: postgres.TransactionSql) => Promise<void>,
  run: () => Promise<string | null>,
): Promise<string | null> {
  return admin
    .begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.olivia}, true)`;
      await change(tx);
      const running = run();
      void running.catch(() => undefined);
      for (let waited = 0; ; waited += 1) {
        // pg_stat_activity is read once per transaction unless its snapshot is cleared.
        await tx`select pg_stat_clear_snapshot()`;
        const [row] = await tx<{ count: number }[]>`
          select count(*)::int as count from pg_stat_activity
          where usename = 'app_api' and wait_event_type = 'Lock'
            and query like '%for no key update%'`;
        if (row?.count === 1) break;
        if (waited > 40) throw new Error('the import did not wait for the company');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      // In an object: postgres.js would wait for a returned promise inside the transaction.
      return { running };
    })
    .then(({ running }) => running);
}

/**
 * Imports rows as the route does, with the route's own matching (matchImport) made under the
 * import's lock.
 */
function importRows(
  ctx: RequestContext,
  rows: { line: number; values: Record<string, string> }[],
  contentSha256: string,
): Promise<string | null> {
  const plan = planImport(rows, ['buyer']);
  return db.importCounterparties(ctx, orgs.a, (companies) =>
    importBatchFor(plan, matchImport(plan, rows.length, companies), {
      organizationId: orgs.a,
      fileName: 'synthetic-buyers.csv',
      contentSha256,
      rowCount: rows.length,
    }),
  );
}

beforeAll(async () => {
  for (const [name, userId] of Object.entries(users)) {
    await admin`insert into auth.users (id, email) values (${userId}, ${`${name}-${userId}@example.test`})`;
  }
  await admin`insert into app.organizations (id, display_name) values
    (${orgs.a}, 'Synthetic Org A'), (${orgs.b}, 'Synthetic Org B')`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.olivia}, 'operations', 'active', now()),
    (${orgs.a}, ${users.victor}, 'viewer', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  const both = admin([orgs.a, orgs.b]);
  await admin`delete from app.counterparty_logos where organization_id in ${both}`;
  await admin`delete from app.counterparty_commodities where organization_id in ${both}`;
  await admin`delete from app.facilities where organization_id in ${both}`;
  await admin`delete from app.counterparty_contacts where organization_id in ${both}`;
  await admin`delete from app.counterparties where organization_id in ${both}`;
  await admin`delete from app.import_batches where organization_id in ${both}`;
  await admin`delete from app.organization_members where organization_id in ${both}`;
  // Deleting the records and memberships above writes audit events too, so the audit trail goes last.
  await admin`delete from app.audit_events where organization_id in ${both}`;
  await admin`delete from app.organizations where id in ${both}`;
  await admin`delete from auth.users where id in ${admin(Object.values(users))}`;
  await admin.end();
});

describe('the counterparty directory as app_api', () => {
  it('lets only operations and admin members edit, and only in their organization', async () => {
    expect(await db.canEditDirectory(as(users.olivia), orgs.a)).toBe(true);
    expect(await db.canEditDirectory(as(users.olivia), orgs.b)).toBe(false);
    expect(await db.canEditDirectory(as(users.victor), orgs.a)).toBe(false);
    expect(await db.canEditDirectory(as(users.bob), orgs.a)).toBe(false);
  });

  it('refuses an import by a viewer', async () => {
    await expect(
      db.importCounterparties(as(users.victor), orgs.a, () => batch()),
    ).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('imports counterparties with contacts and facilities, audited with the request id', async () => {
    const ctx = as(users.olivia);
    const batchId = await db.importCounterparties(ctx, orgs.a, () => batch());
    expect(batchId).toMatch(/^[0-9a-f-]{36}$/);

    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.audit_events
      where request_id = ${ctx.requestId} and actor_id = ${users.olivia}`;
    // 1 batch + 2 counterparties + 1 contact + 2 facilities + 2 commodities.
    expect(audit?.count).toBe(8);
  });

  it('lists the organization’s counterparties for any member', async () => {
    const list = await db.listCounterparties(as(users.victor), null);
    expect(
      list.map((c) => [c.legalName, c.types, c.contactCount, c.facilityCount, c.regions, c.source]),
    ).toEqual([
      ['Synthetic Buyer LLC', ['buyer'], 0, 0, [], 'file_import'],
      ['Synthetic Prairie Mills', ['buyer', 'seller'], 1, 2, ['MB', 'SK'], 'file_import'],
    ]);
    expect(list[0]?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    // What each buys and sells, as codes for the list's commodity filter.
    expect(list.map((c) => [c.buys, c.sells])).toEqual([
      [[], []],
      [['canola'], ['yellow_peas']],
    ]);
    expect(await db.listCounterparties(as(users.victor), orgs.b)).toEqual([]);
  });

  it('returns a counterparty with its contacts and facilities, coordinates as text', async () => {
    const [prairie] = (await db.listCounterparties(as(users.olivia), orgs.a)).filter(
      (c) => c.legalName === 'Synthetic Prairie Mills',
    );
    const detail = await db.getCounterparty(as(users.victor), prairie?.id ?? '');
    expect(detail).toMatchObject({
      legalName: 'Synthetic Prairie Mills',
      tradingName: 'Prairie Mills',
      verificationStatus: 'pending',
      website: 'https://www.example.com',
      phone: '+1 306 555 0100',
      markets: ['pet', 'bird'],
      tier: 'A',
      notes: 'Synthetic record.',
      // Buys first, each in the commodity list's order, with its name; from a spreadsheet,
      // so unverified.
      commodities: [
        { code: 'canola', name: 'Canola', direction: 'buys', verifiedAt: null },
        { code: 'yellow_peas', name: 'Yellow peas', direction: 'sells', verifiedAt: null },
      ],
      contacts: [
        {
          name: 'Synthetic Merchandiser',
          role: 'Buyer',
          email: 'merch@example.test',
          phone: '+1 306 555 0100',
        },
      ],
      facilities: [
        { city: 'Synthetic City', region: 'MB', latitude: null, locationPrecision: null },
        {
          name: 'Synthetic Elevator',
          facilityType: 'elevator',
          postalCode: 'S4P 3Y2',
          latitude: '52.133214',
          longitude: '-106.670046',
          locationPrecision: 'approximate',
        },
      ],
    });
  });

  it('hides one organization’s directory from another', async () => {
    const [any] = await db.listCounterparties(as(users.olivia), orgs.a);
    expect(await db.listCounterparties(as(users.bob), null)).toEqual([]);
    expect(await db.getCounterparty(as(users.bob), any?.id ?? '')).toBeNull();
    expect(await db.existingCounterparties(as(users.bob), orgs.a)).toEqual([]);
  });

  it('lists the companies already there, with their locations, contacts and commodities', async () => {
    const existing = await db.existingCounterparties(as(users.victor), orgs.a);
    expect(
      existing.map((company) => `${company.primaryCountry}:${company.legalName}`).sort(),
    ).toEqual(['CA:Synthetic Prairie Mills', 'US:Synthetic Buyer LLC']);
    const mills = existing.find((company) => company.legalName === 'Synthetic Prairie Mills');
    expect(mills?.archived).toBe(false);
    expect(mills?.facilities.length).toBeGreaterThan(0);
    expect(mills?.contacts.length).toBeGreaterThan(0);
    expect(mills?.commodities.length).toBeGreaterThan(0);
  });

  it('adds new locations, contacts and grains to companies already listed, not archived ones', async () => {
    const ctx = as(users.olivia);
    const [mills] = (await db.existingCounterparties(ctx, orgs.a)).filter(
      (company) => company.legalName === 'Synthetic Prairie Mills',
    );
    if (!mills) throw new Error('fixture missing');
    const template = batch().counterparties[1];
    if (!template) throw new Error('fixture missing');
    const created = await db.createCounterparty(ctx, orgs.a, {
      counterparty: { ...template.counterparty, legalName: 'Synthetic Closed Co' },
      contacts: [],
      facilities: [],
      commodities: [],
    });
    if (created.status !== 'created') throw new Error('not created');
    const closed = created;
    await db.setArchived(ctx, closed.id, true);
    const spur = {
      name: 'Synthetic Spur',
      facilityType: null,
      addressLine: null,
      city: 'Synthetic Spur',
      region: 'AB',
      postalCode: null,
      country: 'CA',
      latitude: null,
      longitude: null,
      locationPrecision: null,
    } as const;

    // As the route plans: archived companies get nothing.
    const batchId = await db.importCounterparties(ctx, orgs.a, (existing) =>
      batch({
        contentSha256: 'd'.repeat(64),
        counterparties: [],
        additions: (
          [
            {
              counterpartyId: mills.id,
              facilities: [spur],
              contacts: [{ name: 'Synthetic Second Buyer', role: null, email: null, phone: null }],
              // Canola is listed already: it stays as it was.
              commodities: [
                { commodity: 'canola', direction: 'buys' },
                { commodity: 'oats', direction: 'buys' },
              ],
            },
            { counterpartyId: closed.id, facilities: [spur], contacts: [], commodities: [] },
          ] satisfies ImportBatchInput['additions']
        ).filter((item) => existing.some((c) => c.id === item.counterpartyId && !c.archived)),
      }),
    );
    if (batchId === null) throw new Error('nothing was imported');

    const after = await db.getCounterparty(ctx, mills.id);
    expect(after?.facilities.map((facility) => facility.name)).toContain('Synthetic Spur');
    expect(after?.contacts.map((contact) => contact.name)).toContain('Synthetic Second Buyer');
    expect(after?.commodities.filter((item) => item.code === 'oats')).toEqual([
      { code: 'oats', name: 'Oats', direction: 'buys', verifiedAt: null },
    ]);
    expect(after?.legalName).toBe('Synthetic Prairie Mills');
    expect((await db.getCounterparty(ctx, closed.id))?.facilities).toEqual([]);
    // The import's coordinates step finds the location added to the company already listed.
    const looked = await db.facilitiesWithoutCoordinates(ctx, orgs.a, 10, {
      importBatchId: batchId,
    });
    expect(looked.map((facility) => facility.facilityName)).toEqual(['Synthetic Spur']);
  });

  // Codex's reviews of ivanmueller/gss#88: two imports run side by side, on separate
  // connections, must not create the same company twice nor add the same location or contact
  // twice. Each plans against the list it reads; both are held at the import lock until both
  // are waiting there, so they truly overlap.
  it('lets two imports of one organization run side by side without duplicating anything', async () => {
    const ctx = as(users.olivia);
    const siding = {
      name: 'Synthetic Siding',
      facilityType: null,
      addressLine: null,
      city: 'Synthetic Siding',
      region: 'AB',
      postalCode: null,
      country: 'CA',
      latitude: null,
      longitude: null,
      locationPrecision: null,
    } as const;
    const field = {
      ...siding,
      name: null,
      city: null,
      region: null,
      latitude: '51.000000',
      longitude: '-105.000000',
      locationPrecision: 'approximate',
    } as const;
    const template = batch().counterparties[1];
    if (!template) throw new Error('fixture missing');
    // What the route plans (matchImport): the company is new unless the list has it, and the
    // listed one gets only what it lacks.
    const plan =
      (legalName: string, letter: string) =>
      (existing: ExistingCounterparty[]): ImportBatchInput | null => {
        const mills = existing.find((c) => c.legalName === 'Synthetic Prairie Mills');
        if (!mills) throw new Error('fixture missing');
        const has = new Set(mills.facilities.map(facilityKey));
        const known = new Set(mills.contacts.map(contactKey));
        const contact = { name: 'Synthetic Third Buyer', role: null, email: null, phone: null };
        const listed = existing.some(
          (c) =>
            c.primaryCountry === 'US' && companyNameKey(c.legalName) === companyNameKey(legalName),
        );
        return batch({
          contentSha256: letter.repeat(64),
          counterparties: listed
            ? []
            : [{ ...template, counterparty: { ...template.counterparty, legalName } }],
          additions: [
            {
              counterpartyId: mills.id,
              facilities: [siding, field].filter((f) => !has.has(facilityKey(f))),
              contacts: [contact].filter((k) => !known.has(contactKey(k))),
              commodities: [],
            },
          ],
        });
      };

    const one = postgresDatabase(API_URL);
    const two = postgresDatabase(API_URL);
    try {
      await admin
        .begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(
          hashtextextended(${`app.counterparty_import:${orgs.a}`}, 0))`;
          const imports = [
            one.importCounterparties(ctx, orgs.a, plan('Synthetic Fresh Concurrent Ltd.', 'e')),
            two.importCounterparties(ctx, orgs.a, plan('SYNTHETIC FRESH CONCURRENT LIMITED', 'f')),
          ];
          // Both wait at the lock before either goes on.
          for (let waited = 0; ; waited += 1) {
            // pg_stat_activity is read once per transaction unless its snapshot is cleared.
            await tx`select pg_stat_clear_snapshot()`;
            const [row] = await tx<{ count: number }[]>`
            select count(*)::int as count from pg_stat_activity
            where usename = 'app_api' and wait_event_type = 'Lock' and wait_event = 'advisory'
              and query like '%lock_counterparty_import%'`;
            if (row?.count === 2) break;
            if (waited > 40) throw new Error('the imports did not both wait at the import lock');
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          // Released when this transaction ends; the imports then run one after the other.
          void Promise.all(imports).catch(() => undefined);
          // In an object: postgres.js would wait for a returned array inside the transaction.
          return { imports };
        })
        .then(({ imports }) => Promise.all(imports));
    } finally {
      await one.close();
      await two.close();
    }

    const fresh = (await db.listCounterparties(ctx, orgs.a)).filter(
      (c) => companyNameKey(c.legalName) === companyNameKey('Synthetic Fresh Concurrent Ltd.'),
    );
    // One company, in the spelling of whichever import went first.
    expect(fresh).toHaveLength(1);
    const [mills] = (await db.listCounterparties(ctx, orgs.a)).filter(
      (c) => c.legalName === 'Synthetic Prairie Mills',
    );
    const after = await db.getCounterparty(ctx, mills?.id ?? '');
    expect(after?.facilities.filter((f) => f.name === 'Synthetic Siding')).toHaveLength(1);
    expect(after?.facilities.filter((f) => f.latitude === '51.000000')).toHaveLength(1);
    expect(after?.contacts.filter((k) => k.name === 'Synthetic Third Buyer')).toHaveLength(1);
  });

  // Codex's third review of ivanmueller/gss#88: a company archived after the import read the
  // list but before it locked the company. The archive is held uncommitted until the import
  // waits on the company's row, then committed.
  it('plans again when a company is archived while the import waits for it', async () => {
    const ctx = as(users.olivia);
    const template = batch().counterparties[1];
    if (!template) throw new Error('fixture missing');
    const created = await db.createCounterparty(ctx, orgs.a, {
      counterparty: { ...template.counterparty, legalName: 'Synthetic Archived Meanwhile' },
      contacts: [],
      facilities: [],
      commodities: [],
    });
    if (created.status !== 'created') throw new Error('not created');
    const target = created.id;
    const depot = {
      name: 'Synthetic Depot',
      facilityType: null,
      addressLine: null,
      city: 'Synthetic Depot',
      region: 'SK',
      postalCode: null,
      country: 'CA',
      latitude: null,
      longitude: null,
      locationPrecision: null,
    } as const;
    // What the route plans: the location for the company unless it is archived, and
    // optionally a new company; nothing at all is null (NOTHING_TO_IMPORT).
    const plan =
      (letter: string, newName: string | null) =>
      (existing: ExistingCounterparty[]): ImportBatchInput | null => {
        const company = existing.find((c) => c.id === target);
        const additions =
          company && !company.archived && !company.facilities.some((f) => f.name === depot.name)
            ? [{ counterpartyId: target, facilities: [depot], contacts: [], commodities: [] }]
            : [];
        const counterparties =
          newName === null || existing.some((c) => c.legalName === newName)
            ? []
            : [{ ...template, counterparty: { ...template.counterparty, legalName: newName } }];
        if (additions.length === 0 && counterparties.length === 0) return null;
        return batch({ contentSha256: letter.repeat(64), counterparties, additions });
      };
    const archivedWhileWaiting = (run: () => Promise<string | null>) =>
      whileImportWaits(async (tx) => {
        await tx`update app.counterparties set archived_at = now() where id = ${target}`;
      }, run);
    const batchesOf = async (letter: string) =>
      (
        await admin<{ count: number }[]>`
          select count(*)::int as count from app.import_batches
          where organization_id = ${orgs.a} and content_sha256 = ${letter.repeat(64)}`
      )[0]?.count;

    // Only that company: nothing to write, and no import recorded.
    expect(
      await archivedWhileWaiting(() => db.importCounterparties(ctx, orgs.a, plan('1', null))),
    ).toBeNull();
    expect(await batchesOf('1')).toBe(0);
    expect((await db.getCounterparty(ctx, target))?.facilities).toEqual([]);

    // Restored, the same file imports its location.
    await db.setArchived(ctx, target, false);
    expect(await db.importCounterparties(ctx, orgs.a, plan('1', null))).toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.getCounterparty(ctx, target))?.facilities.map((f) => f.name)).toEqual([
      'Synthetic Depot',
    ]);

    // With a new company too: the new company only, recorded as such.
    await admin`delete from app.facilities where counterparty_id = ${target}`;
    await db.setArchived(ctx, target, false);
    const second = await archivedWhileWaiting(() =>
      db.importCounterparties(ctx, orgs.a, plan('2', 'Synthetic Newcomer Co')),
    );
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.getCounterparty(ctx, target))?.facilities).toEqual([]);
    const [recorded] = await admin<{ created_count: number; skipped_count: number }[]>`
      select created_count, skipped_count from app.import_batches where id = ${second}`;
    expect(recorded?.created_count).toBe(1);
  });

  // Codex's fourth review of ivanmueller/gss#88.
  it('imports again what a file skipped while a company was archived, once it is restored', async () => {
    const ctx = as(users.olivia);
    const template = batch().counterparties[1];
    if (!template) throw new Error('fixture missing');
    const created = await db.createCounterparty(ctx, orgs.a, {
      counterparty: {
        ...template.counterparty,
        legalName: 'Synthetic Paused Co',
        primaryCountry: 'CA',
      },
      contacts: [],
      facilities: [],
      commodities: [],
    });
    if (created.status !== 'created') throw new Error('not created');
    await db.setArchived(ctx, created.id, true);
    const rows = [
      {
        line: 2,
        values: {
          legalName: 'Synthetic Paused Co',
          country: 'CA',
          city: 'Synthetic Halt',
          region: 'SK',
        },
      },
      { line: 3, values: { legalName: 'Synthetic Newcomer Two', country: 'CA' } },
    ];
    const file = '9'.repeat(64);

    // The new company is imported; the archived one gets nothing.
    expect(await importRows(ctx, rows, file)).toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.getCounterparty(ctx, created.id))?.facilities).toEqual([]);

    // Restored, the same file adds its location, and nothing twice.
    await db.setArchived(ctx, created.id, false);
    expect(await importRows(ctx, rows, file)).toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.getCounterparty(ctx, created.id))?.facilities.map((f) => f.city)).toEqual([
      'Synthetic Halt',
    ]);
    const newcomers = (await db.listCounterparties(ctx, orgs.a)).filter(
      (c) => c.legalName === 'Synthetic Newcomer Two',
    );
    expect(newcomers).toHaveLength(1);
    // A third time there is nothing new: nothing is written or recorded.
    expect(await importRows(ctx, rows, file)).toBeNull();
    const [recorded] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.import_batches
      where organization_id = ${orgs.a} and content_sha256 = ${file}`;
    expect(recorded?.count).toBe(2);
  });

  it('plans again when a commodity is added by hand while the import waits for the company', async () => {
    const ctx = as(users.olivia);
    const template = batch().counterparties[1];
    if (!template) throw new Error('fixture missing');
    const created = await db.createCounterparty(ctx, orgs.a, {
      counterparty: {
        ...template.counterparty,
        legalName: 'Synthetic Busy Co',
        primaryCountry: 'CA',
      },
      contacts: [],
      facilities: [],
      commodities: [],
    });
    if (created.status !== 'created') throw new Error('not created');
    const file = '8'.repeat(64);

    // As changeCommodities does: the company locked, then Canola added.
    const imported = await whileImportWaits(
      async (tx) => {
        await tx`select id from app.counterparties where id = ${created.id} for no key update`;
        await tx`insert into app.counterparty_commodities
                   (organization_id, counterparty_id, commodity_code, direction, created_by)
                 values (${orgs.a}, ${created.id}, 'canola', 'buys', ${users.olivia})`;
      },
      () =>
        importRows(
          ctx,
          [
            {
              line: 2,
              values: { legalName: 'Synthetic Busy Co', country: 'CA', commodities: 'Canola' },
            },
          ],
          file,
        ),
    );

    // Canola is there already: nothing to write, and no import recorded.
    expect(imported).toBeNull();
    const [recorded] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.import_batches
      where organization_id = ${orgs.a} and content_sha256 = ${file}`;
    expect(recorded?.count).toBe(0);
    expect((await db.getCounterparty(ctx, created.id))?.commodities.map((k) => k.code)).toEqual([
      'canola',
    ]);
  });

  it('leaves no user or request id on the connection after writes and refused writes', async () => {
    const sql = postgres(API_URL, connectionOptions(API_URL));
    const own = createDatabase(sql);
    const context = async () => {
      const [row] = await sql<{ user_id: string | null; request_id: string | null }[]>`
        select current_setting('app.user_id', true) as user_id,
               current_setting('app.request_id', true) as request_id`;
      return [row?.user_id ?? '', row?.request_id ?? ''];
    };
    try {
      await own.putLogo(as(users.olivia), id(), PNG);
      expect(await context()).toEqual(['', '']);
      await expect(
        own.importCounterparties(as(users.victor), orgs.a, () => batch()),
      ).rejects.toThrow();
      expect(await context()).toEqual(['', '']);
      await own.listCounterparties(as(users.victor), null);
      expect(await context()).toEqual(['', '']);
    } finally {
      await sql.end();
    }
  });

  it('saves and serves a logo for editors only', async () => {
    const [prairie] = (await db.listCounterparties(as(users.olivia), orgs.a)).filter(
      (c) => c.legalName === 'Synthetic Prairie Mills',
    );
    const target = prairie?.id ?? '';

    expect(await db.putLogo(as(users.victor), target, PNG)).toEqual({ status: 'forbidden' });
    expect(await db.putLogo(as(users.bob), target, PNG)).toEqual({ status: 'not_found' });
    const saved = await db.putLogo(as(users.olivia), target, PNG);
    expect(saved.status).toBe('saved');
    expect(saved.status === 'saved' ? saved.sha256 : '').toMatch(/^[0-9a-f]{64}$/);

    const logo = await db.getLogo(as(users.victor), target);
    expect(new Uint8Array(logo?.data ?? [])).toEqual(PNG);
    expect(logo?.sha256).toBe(saved.status === 'saved' ? saved.sha256 : '');
    expect(await db.getLogo(as(users.bob), target)).toBeNull();

    const list = await db.listCounterparties(as(users.victor), orgs.a);
    expect(list.find((c) => c.id === target)?.logoSha256).toBe(logo?.sha256);
  });
});
