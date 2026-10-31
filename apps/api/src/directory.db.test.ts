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
const users = { olivia: id(), victor: id(), bob: id(), adam: id(), ana: id() };
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
 * Runs `change` in an admin transaction as olivia, starts `run`, and commits the change only
 * once `run` waits for a row lock (by default an import waiting for a company): a change made
 * after it read but before it locked.
 */
function whileItWaits<T>(
  change: (tx: postgres.TransactionSql) => Promise<void>,
  run: () => Promise<T>,
  { waitingOn = '%for no key update%', meanwhile }: WhileWaiting = {},
): Promise<T> {
  return admin
    .begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.olivia}, true)`;
      await change(tx);
      const running = run();
      void running.catch(() => undefined);
      await waitUntilWaiting(tx, 'app_api', waitingOn, true);
      await meanwhile?.(tx);
      // In an object: postgres.js would wait for a returned promise inside the transaction.
      return { running };
    })
    .then(({ running }) => running);
}

interface WhileWaiting {
  /** The waiting statement, as a LIKE pattern. */
  waitingOn?: string;
  /** Runs once the statement waits, before the change is committed. */
  meanwhile?: (tx: postgres.TransactionSql) => Promise<void>;
}

/**
 * Waits until one of `user`'s statements matching `pattern` waits for a lock: about two
 * seconds, then throws when `required`, else returns false.
 */
async function waitUntilWaiting(
  tx: postgres.TransactionSql,
  user: string,
  pattern: string,
  required: boolean,
): Promise<boolean> {
  for (let waited = 0; ; waited += 1) {
    // pg_stat_activity is read once per transaction unless its snapshot is cleared.
    await tx`select pg_stat_clear_snapshot()`;
    const [row] = await tx<{ count: number }[]>`
      select count(*)::int as count from pg_stat_activity
      where usename = ${user} and wait_event_type = 'Lock' and query like ${pattern}`;
    if (row?.count === 1) return true;
    if (waited > 40) {
      if (required) throw new Error(`no statement like ${pattern} waited`);
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
    (${orgs.a}, ${users.adam}, 'org_admin', 'active', now()),
    (${orgs.a}, ${users.ana}, 'org_admin', 'active', now()),
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
              details: null,
              contactUpdates: [],
              facilityUpdates: [],
              counterpartyId: mills.id,
              facilities: [spur],
              contacts: [{ name: 'Synthetic Second Buyer', role: null, email: null, phone: null }],
              // Canola is listed already: it stays as it was.
              commodities: [
                { commodity: 'canola', direction: 'buys' },
                { commodity: 'oats', direction: 'buys' },
              ],
            },
            {
              details: null,
              contactUpdates: [],
              facilityUpdates: [],
              counterpartyId: closed.id,
              facilities: [spur],
              contacts: [],
              commodities: [],
            },
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
              details: null,
              contactUpdates: [],
              facilityUpdates: [],
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
            ? [
                {
                  details: null,
                  contactUpdates: [],
                  facilityUpdates: [],
                  counterpartyId: target,
                  facilities: [depot],
                  contacts: [],
                  commodities: [],
                },
              ]
            : [];
        const counterparties =
          newName === null || existing.some((c) => c.legalName === newName)
            ? []
            : [{ ...template, counterparty: { ...template.counterparty, legalName: newName } }];
        if (additions.length === 0 && counterparties.length === 0) return null;
        return batch({ contentSha256: letter.repeat(64), counterparties, additions });
      };
    const archivedWhileWaiting = (run: () => Promise<string | null>) =>
      whileItWaits(async (tx) => {
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

  // The owner's answer of 2026-10-31: a later file updates a listed company, filled cells
  // winning, while a verified commodity stays as it is.
  it('updates a listed company, its contact and its location from a file', async () => {
    const ctx = as(users.olivia);
    const created = await db.createCounterparty(ctx, orgs.a, {
      counterparty: {
        legalName: 'Synthetic Updated Co',
        tradingName: null,
        types: ['seller'],
        primaryCountry: 'CA',
        verificationStatus: 'verified',
        website: null,
        phone: '(306) 555-0100',
        markets: ['pet'],
        tier: 'B',
        notes: 'Synthetic own note.',
      },
      contacts: [{ name: 'Synthetic Ana', role: null, email: 'ana@example.test', phone: null }],
      facilities: [
        {
          name: null,
          facilityType: null,
          addressLine: null,
          city: 'Synthetic Halt',
          region: 'SK',
          postalCode: null,
          country: 'CA',
          latitude: '52.000000',
          longitude: '-106.000000',
          locationPrecision: 'approximate',
        },
      ],
      commodities: [{ commodity: 'canola', direction: 'buys' }],
    });
    if (created.status !== 'created') throw new Error('not created');
    const target = created.id;
    await db.changeCommodities(ctx, target, {
      add: [],
      remove: [],
      verify: [{ commodity: 'canola', direction: 'buys' }],
    });

    const batchId = await importRows(
      ctx,
      [
        {
          line: 2,
          values: {
            legalName: 'SYNTHETIC UPDATED CO',
            country: 'CA',
            verificationStatus: 'pending',
            companyPhone: '306 555 0199',
            tier: 'A',
            notes: 'Synthetic file note.',
            commodities: 'Canola; Oats',
            contactName: 'synthetic ana',
            contactPhone: '306-555-0111',
            contactRole: 'Buyer',
            facilityType: 'Elevator',
            addressLine: '1 Synthetic Road',
            city: 'Synthetic Halt',
            region: 'SK',
            latitude: '52.5',
            longitude: '-106.5',
            locationPrecision: 'exact',
          },
        },
      ],
      '7'.repeat(64),
    );
    expect(batchId).toMatch(/^[0-9a-f-]{36}$/);

    const after = await db.getCounterparty(ctx, target);
    expect(after).toMatchObject({
      legalName: 'Synthetic Updated Co',
      types: ['buyer', 'seller'],
      verificationStatus: 'verified',
      phone: '(306) 555-0199',
      markets: ['pet'],
      tier: 'A',
      notes: 'Synthetic own note.\n\nSynthetic file note.',
    });
    expect(after?.contacts).toEqual([
      expect.objectContaining({
        name: 'Synthetic Ana',
        email: 'ana@example.test',
        phone: '(306) 555-0111',
        role: 'Buyer',
      }),
    ]);
    expect(after?.facilities).toEqual([
      expect.objectContaining({
        facilityType: 'elevator',
        addressLine: '1 Synthetic Road',
        latitude: '52.500000',
        longitude: '-106.500000',
        locationPrecision: 'exact',
        geocodingSource: 'file_import',
      }),
    ]);
    // The verified commodity stays verified; the new one is unverified.
    expect(after?.commodities.map((k) => [k.code, k.verifiedAt === null])).toEqual([
      ['canola', false],
      ['oats', true],
    ]);
    // The update is audited.
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.audit_events
      where entity = 'counterparties' and entity_id = ${target} and action = 'update'
        and actor_id = ${users.olivia} and 'phone' = any (changed_fields)`;
    expect(audit?.count).toBe(1);
  });

  // Codex's review of ivanmueller/gss#95: an importer demoted while the import ran had its
  // updates skipped by row level security, yet the import was recorded.
  it('keeps the importer able to import until the import is done', async () => {
    const ctx = as(users.olivia);
    const template = batch().counterparties[1];
    if (!template) throw new Error('fixture missing');
    const created = await db.createCounterparty(ctx, orgs.a, {
      ...template,
      counterparty: {
        ...template.counterparty,
        legalName: 'Synthetic Held Co',
        primaryCountry: 'CA',
        phone: '(306) 555-0100',
      },
    });
    if (created.status !== 'created') throw new Error('not created');
    const other = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
    let demoted: Promise<void> = Promise.resolve();
    try {
      const imported = await whileItWaits(
        async (tx) => {
          await tx`select pg_advisory_xact_lock(
            hashtextextended(${`app.counterparty_import:${orgs.a}`}, 0))`;
        },
        () =>
          importRows(
            ctx,
            [
              {
                line: 2,
                values: {
                  legalName: 'Synthetic Held Co',
                  country: 'CA',
                  companyPhone: '306 555 0199',
                },
              },
            ],
            '6'.repeat(64),
          ),
        {
          waitingOn: '%lock_counterparty_import%',
          meanwhile: async (tx) => {
            demoted = other`
              update app.organization_members set role = 'viewer'
              where organization_id = ${orgs.a} and user_id = ${users.olivia}`.then(
              () => undefined,
            );
            // The demotion waits for the import, which holds the importer's membership.
            expect(
              await waitUntilWaiting(tx, 'postgres', '%update app.organization_members%', false),
            ).toBe(true);
          },
        },
      );
      expect(imported).toMatch(/^[0-9a-f-]{36}$/);
      await demoted;
    } finally {
      await demoted.catch(() => undefined);
      await admin`update app.organization_members set role = 'operations'
                  where organization_id = ${orgs.a} and user_id = ${users.olivia}`;
      await other.end();
    }
    expect((await db.getCounterparty(as(users.adam), created.id))?.phone).toBe('(306) 555-0199');
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
    const imported = await whileItWaits(
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

  // The owner's request of 2026-10-31.
  it('lets an admin delete an archived counterparty with what it has, and nobody else', async () => {
    const template = batch().counterparties[0];
    if (!template) throw new Error('fixture missing');
    const created = await db.createCounterparty(as(users.olivia), orgs.a, {
      ...template,
      counterparty: { ...template.counterparty, legalName: 'Synthetic Short-Lived Co' },
    });
    if (created.status !== 'created') throw new Error('not created');
    const target = created.id;
    expect((await db.putLogo(as(users.olivia), target, PNG)).status).toBe('saved');

    expect(await db.deleteCounterparty(as(users.adam), target)).toEqual({ status: 'not_archived' });
    expect((await db.setArchived(as(users.olivia), target, true)).status).toBe('saved');
    expect(await db.deleteCounterparty(as(users.olivia), target)).toEqual({ status: 'forbidden' });
    expect(await db.deleteCounterparty(as(users.victor), target)).toEqual({ status: 'forbidden' });
    expect(await db.deleteCounterparty(as(users.bob), target)).toEqual({ status: 'not_found' });

    const ctx = as(users.adam);
    expect(await db.deleteCounterparty(ctx, target)).toEqual({ status: 'deleted' });
    expect(await db.getCounterparty(ctx, target)).toBeNull();
    expect(await db.deleteCounterparty(ctx, target)).toEqual({ status: 'not_found' });
    const [left] = await admin<{ count: number }[]>`
      select (select count(*) from app.counterparty_contacts where counterparty_id = ${target})
           + (select count(*) from app.facilities where counterparty_id = ${target})
           + (select count(*) from app.counterparty_commodities where counterparty_id = ${target})
           + (select count(*) from app.counterparty_logos where counterparty_id = ${target})
           as count`;
    expect(Number(left?.count)).toBe(0);
    // The audit trail keeps who deleted it, when, and in which request.
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.audit_events
      where entity = 'counterparties' and entity_id = ${target} and action = 'delete'
        and actor_id = ${users.adam} and request_id = ${ctx.requestId}`;
    expect(audit?.count).toBe(1);
  });

  // Codex's review of ivanmueller/gss#93: an admin demoted while the delete waited for the
  // company had its contacts and locations deleted, then was refused the company itself.
  it('keeps the deleting admin an admin until the delete is done', async () => {
    const template = batch().counterparties[0];
    if (!template) throw new Error('fixture missing');
    const created = await db.createCounterparty(as(users.olivia), orgs.a, {
      ...template,
      counterparty: { ...template.counterparty, legalName: 'Synthetic Contested Co' },
      commodities: [],
    });
    if (created.status !== 'created') throw new Error('not created');
    const target = created.id;
    await db.setArchived(as(users.olivia), target, true);
    const other = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
    let demoted: Promise<void> = Promise.resolve();
    try {
      const result = await whileItWaits(
        async (tx) => {
          await tx`select id from app.counterparties where id = ${target} for update`;
        },
        () => db.deleteCounterparty(as(users.adam), target),
        {
          waitingOn: '%for update%',
          meanwhile: async (tx) => {
            demoted = other`
              update app.organization_members set role = 'operations'
              where organization_id = ${orgs.a} and user_id = ${users.adam}`.then(() => undefined);
            // The demotion waits for the delete, which holds the admin's membership.
            expect(
              await waitUntilWaiting(tx, 'postgres', '%update app.organization_members%', false),
            ).toBe(true);
          },
        },
      );
      expect(result).toEqual({ status: 'deleted' });
      await demoted;
    } finally {
      await demoted.catch(() => undefined);
      await admin`update app.organization_members set role = 'org_admin'
                  where organization_id = ${orgs.a} and user_id = ${users.adam}`;
      await other.end();
    }
    const [left] = await admin<{ count: number }[]>`
      select (select count(*) from app.counterparties where id = ${target})
           + (select count(*) from app.counterparty_contacts where counterparty_id = ${target})
           + (select count(*) from app.facilities where counterparty_id = ${target})
           as count`;
    expect(Number(left?.count)).toBe(0);
  });

  it('refuses a delete by someone demoted just before it', async () => {
    const template = batch().counterparties[0];
    if (!template) throw new Error('fixture missing');
    const created = await db.createCounterparty(as(users.olivia), orgs.a, {
      ...template,
      counterparty: { ...template.counterparty, legalName: 'Synthetic Kept Co' },
      commodities: [],
    });
    if (created.status !== 'created') throw new Error('not created');
    await db.setArchived(as(users.olivia), created.id, true);
    await admin`update app.organization_members set role = 'operations'
                where organization_id = ${orgs.a} and user_id = ${users.adam}`;
    try {
      expect(await db.deleteCounterparty(as(users.adam), created.id)).toEqual({
        status: 'forbidden',
      });
    } finally {
      await admin`update app.organization_members set role = 'org_admin'
                  where organization_id = ${orgs.a} and user_id = ${users.adam}`;
    }
    const after = await db.getCounterparty(as(users.olivia), created.id);
    expect(after?.contacts).toHaveLength(1);
    expect(after?.facilities).toHaveLength(2);
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
