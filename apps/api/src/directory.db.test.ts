import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connectionOptions,
  createDatabase,
  postgresDatabase,
  type Database,
  type ImportBatchInput,
  type RequestContext,
} from './db';

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
    counterparties: [
      {
        counterparty: {
          legalName: 'Synthetic Prairie Mills',
          tradingName: 'Prairie Mills',
          types: ['buyer', 'seller'],
          primaryCountry: 'CA',
          verificationStatus: 'pending',
          website: 'https://www.example.com',
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
    await expect(db.importCounterparties(as(users.victor), batch())).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('imports counterparties with contacts and facilities, audited with the request id', async () => {
    const ctx = as(users.olivia);
    const batchId = await db.importCounterparties(ctx, batch());
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
      notes: 'Synthetic record.',
      // Buys first, each in the commodity list's order, with its name.
      commodities: [
        { code: 'canola', name: 'Canola', direction: 'buys' },
        { code: 'yellow_peas', name: 'Yellow peas', direction: 'sells' },
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
    expect(await db.counterpartyKeys(as(users.bob), orgs.a)).toEqual(new Set());
  });

  it('reports existing names as keys that match the import grouping', async () => {
    expect(await db.counterpartyKeys(as(users.victor), orgs.a)).toEqual(
      new Set(['CA:synthetic prairie mills', 'US:synthetic buyer llc']),
    );
  });

  it('refuses the same content twice', async () => {
    await expect(
      db.importCounterparties(as(users.olivia), batch({ counterparties: [] })),
    ).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'import_batches_organization_id_kind_content_sha256_key',
    });
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
      await expect(own.importCounterparties(as(users.victor), batch())).rejects.toThrow();
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
