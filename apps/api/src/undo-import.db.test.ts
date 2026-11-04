import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { importBatchFor, matchImport, planImport } from './counterparties';
import { postgresDatabase, type Database, type RequestContext } from './db';

// Undoing an import (the owner's request and answers of 2026-11-04), as app_api against the
// real migrations and row level security. Every company here is synthetic.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { adam: id(), olivia: id(), bob: id() };
const orgs = { a: id(), b: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });
let db: Database;

/** Imports synthetic rows as `userId`, rows without a type being `side`; the batch id. */
async function importRows(
  userId: string,
  side: 'buyer' | 'seller',
  rows: { line: number; values: Record<string, string> }[],
  contentSha256: string,
): Promise<string> {
  const plan = planImport(rows, [side]);
  const batchId = await db.importCounterparties(as(userId), orgs.a, (companies) =>
    importBatchFor(plan, matchImport(plan, rows.length, companies), {
      organizationId: orgs.a,
      fileName: `synthetic-${side}s.csv`,
      contentSha256,
      rowCount: rows.length,
    }),
  );
  if (batchId === null) throw new Error('nothing was imported');
  return batchId;
}

beforeAll(async () => {
  for (const [name, userId] of Object.entries(users)) {
    await admin`insert into auth.users (id, email) values (${userId}, ${`${name}-${userId}@example.test`})`;
  }
  await admin`insert into app.organizations (id, display_name) values
    (${orgs.a}, 'Synthetic Org A'), (${orgs.b}, 'Synthetic Org B')`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.adam}, 'org_admin', 'active', now()),
    (${orgs.a}, ${users.olivia}, 'operations', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  db = postgresDatabase(API_URL);
});

// The contact log can never be deleted, not even by the table owner, so this test's records
// stay in the throwaway test database, as in crm.db.test.ts; every id is fresh.
afterAll(async () => {
  await db.close();
  await admin.end();
});

describe('undoing an import as app_api', () => {
  it('removes the companies it created and what it added to a listed buyer, nothing else', async () => {
    // A buyer already listed, from an earlier buyers' file.
    await importRows(
      users.olivia,
      'buyer',
      [
        {
          line: 2,
          values: {
            legalName: 'Synthetic Feeds',
            country: 'CA',
            markets: 'Pet',
            tier: 'B',
            commodities: 'Oats',
            city: 'Synthetic Town',
            region: 'AB',
          },
        },
      ],
      '1'.repeat(64),
    );
    const [buyer] = await admin<{ id: string }[]>`
      select id from app.counterparties where organization_id = ${orgs.a} and legal_name = 'Synthetic Feeds'`;
    if (!buyer) throw new Error('no buyer');

    // The sellers' file: two new sellers, and the buyer made a seller too, with a new
    // location, a grain it sells, seller details and another tier.
    const sellers = await importRows(
      users.olivia,
      'seller',
      [
        {
          line: 2,
          values: {
            legalName: 'Synthetic Grower One',
            country: 'CA',
            city: 'Olds',
            region: 'AB',
            grainTypes: 'Feed',
          },
        },
        {
          line: 3,
          values: {
            legalName: 'Synthetic Grower One',
            country: 'CA',
            city: 'Didsbury',
            region: 'AB',
          },
        },
        {
          line: 4,
          values: {
            legalName: 'Synthetic Grower Two',
            country: 'CA',
            city: 'Carstairs',
            region: 'AB',
          },
        },
        {
          line: 5,
          values: {
            legalName: 'Synthetic Feeds',
            country: 'CA',
            tier: 'A',
            grainTypes: 'Organic',
            sellerKind: 'Processor',
            commodities: 'Canola',
            city: 'Synthetic Spur',
            region: 'AB',
          },
        },
      ],
      '2'.repeat(64),
    );
    const before = await db.getCounterparty(as(users.adam), buyer.id);
    expect(before).toMatchObject({
      types: ['buyer', 'seller'],
      tier: 'A',
      grainTypes: ['organic'],
    });

    // Only an admin of its organization may look or undo.
    expect(await db.undoImport(as(users.olivia), sellers, false)).toEqual({ status: 'forbidden' });
    expect(await db.undoImport(as(users.bob), sellers, false)).toEqual({ status: 'not_found' });
    expect(await db.listImports(as(users.olivia), orgs.a)).toBeNull();
    expect(
      (await db.listImports(as(users.adam), orgs.a))?.map((row) => [row.fileName, row.companies]),
    ).toEqual([
      ['synthetic-sellers.csv', 2],
      ['synthetic-buyers.csv', 1],
    ]);

    const preview = await db.undoImport(as(users.adam), sellers, false);
    expect(preview).toMatchObject({
      status: 'ok',
      committed: false,
      plan: {
        companies: 2,
        locations: 3,
        kept: [],
        listed: [
          {
            id: buyer.id,
            name: 'Synthetic Feeds',
            locations: 1,
            grains: 1,
            removedTypes: ['seller'],
            sellerDetails: true,
            check: ['Tier'],
          },
        ],
      },
    });
    // A preview writes nothing; an undo with another count than previewed neither.
    expect(await db.undoImport(as(users.adam), sellers, true, 5)).toMatchObject({
      status: 'changed',
    });
    expect((await db.listCounterparties(as(users.adam), orgs.a)).length).toBe(3);

    expect(await db.undoImport(as(users.adam), sellers, true, 2)).toMatchObject({
      status: 'ok',
      committed: true,
    });
    const left = await db.listCounterparties(as(users.adam), orgs.a);
    expect(left.map((row) => row.legalName)).toEqual(['Synthetic Feeds']);
    const after = await db.getCounterparty(as(users.adam), buyer.id);
    // Its buyer side as it was; what the sellers' file added, gone; the tier listed to check.
    expect(after).toMatchObject({
      types: ['buyer'],
      markets: ['pet'],
      tier: 'A',
      grainTypes: [],
      sellerKind: null,
    });
    expect(after?.facilities.map((f) => f.city)).toEqual(['Synthetic Town']);
    expect(after?.commodities.map((k) => [k.code, k.direction])).toEqual([['oats', 'buys']]);
    // Once only.
    expect(await db.undoImport(as(users.adam), sellers, true, 2)).toEqual({ status: 'undone' });
    expect((await db.listImports(as(users.adam), orgs.a))?.[0]?.undoneAt).toEqual(
      expect.any(String),
    );
  });

  it('keeps a company it created that has a history or was made a buyer since', async () => {
    const batch = await importRows(
      users.olivia,
      'seller',
      [
        {
          line: 2,
          values: { legalName: 'Synthetic Called Farm', country: 'CA', city: 'Olds', region: 'AB' },
        },
        {
          line: 3,
          values: {
            legalName: 'Synthetic Retyped Farm',
            country: 'CA',
            city: 'Olds',
            region: 'AB',
          },
        },
        {
          line: 4,
          values: { legalName: 'Synthetic Plain Farm', country: 'CA', city: 'Olds', region: 'AB' },
        },
      ],
      '3'.repeat(64),
    );
    const named = async (name: string) => {
      const [row] = await admin<{ id: string }[]>`
        select id from app.counterparties where organization_id = ${orgs.a} and legal_name = ${name}`;
      if (!row) throw new Error(`no ${name}`);
      return row.id;
    };
    const called = await named('Synthetic Called Farm');
    const retyped = await named('Synthetic Retyped Farm');
    // A contact logged with one, and the other made a buyer too, under Edit details.
    expect(
      await db.createContactLog(as(users.olivia), {
        counterpartyId: called,
        log: {
          occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
          channel: 'call',
          contactName: 'Synthetic Farmer',
          notes: 'Synthetic note.',
        },
        followUp: null,
        recordedByName: 'Synthetic Operations',
      }),
    ).toMatchObject({ status: 'created' });
    const detail = await db.getCounterparty(as(users.adam), retyped);
    if (!detail) throw new Error('no detail');
    expect(
      await db.updateCounterparty(as(users.adam), retyped, detail.version, {
        ...detail,
        types: ['buyer', 'seller'],
        primaryCountry: 'CA',
        verificationStatus: 'unverified',
        markets: [],
        tier: null,
        grainTypes: [],
        sellerKind: null,
        sellerKindUnused: undefined,
      } as never),
    ).toEqual({ status: 'saved' });

    const preview = await db.undoImport(as(users.adam), batch, false);
    expect(preview).toMatchObject({
      status: 'ok',
      plan: {
        companies: 1,
        kept: expect.arrayContaining([
          { id: called, name: 'Synthetic Called Farm', reason: 'history' },
          { id: retyped, name: 'Synthetic Retyped Farm', reason: 'retyped' },
        ]) as unknown,
      },
    });
    expect(await db.undoImport(as(users.adam), batch, true, 1)).toMatchObject({ status: 'ok' });
    const names = (await db.listCounterparties(as(users.adam), orgs.a)).map((r) => r.legalName);
    expect(names).toEqual(
      expect.arrayContaining(['Synthetic Called Farm', 'Synthetic Retyped Farm']),
    );
    expect(names).not.toContain('Synthetic Plain Farm');
  });

  // Codex's review of a62e00a, finding 2: the types taken off are those the import recorded
  // adding, not guessed from the companies it created.
  it('takes off only the type the import added, whatever types its own companies have', async () => {
    await importRows(
      users.olivia,
      'buyer',
      [
        {
          line: 2,
          values: {
            legalName: 'Synthetic Hauling Mill',
            country: 'CA',
            types: 'buyer, carrier',
            city: 'Olds',
            region: 'AB',
          },
        },
      ],
      '4'.repeat(64),
    );
    const sellers = await importRows(
      users.olivia,
      'seller',
      [
        {
          line: 2,
          values: {
            legalName: 'Synthetic Hauling Mill',
            country: 'CA',
            city: 'Olds',
            region: 'AB',
          },
        },
        {
          line: 3,
          values: {
            legalName: 'Synthetic Both Ways',
            country: 'CA',
            types: 'buyer, seller',
            city: 'Olds',
            region: 'AB',
          },
        },
      ],
      '5'.repeat(64),
    );
    const [mill] = await admin<{ id: string }[]>`
      select id from app.counterparties where organization_id = ${orgs.a} and legal_name = 'Synthetic Hauling Mill'`;
    if (!mill) throw new Error('no mill');
    expect((await db.getCounterparty(as(users.adam), mill.id))?.types).toEqual([
      'buyer',
      'seller',
      'carrier',
    ]);
    expect(await db.undoImport(as(users.adam), sellers, true, 1)).toMatchObject({
      status: 'ok',
      plan: { listed: [{ id: mill.id, removedTypes: ['seller'] }] },
    });
    expect((await db.getCounterparty(as(users.adam), mill.id))?.types).toEqual([
      'buyer',
      'carrier',
    ]);
  });

  it('takes off a type the import added when it created no company', async () => {
    await importRows(
      users.olivia,
      'buyer',
      [
        {
          line: 2,
          values: { legalName: 'Synthetic Lone Buyer', country: 'CA', city: 'Olds', region: 'AB' },
        },
      ],
      '6'.repeat(64),
    );
    const sellers = await importRows(
      users.olivia,
      'seller',
      [
        {
          line: 2,
          values: {
            legalName: 'Synthetic Lone Buyer',
            country: 'CA',
            commodities: 'Oats',
            city: 'Olds',
            region: 'AB',
          },
        },
      ],
      '7'.repeat(64),
    );
    const [lone] = await admin<{ id: string }[]>`
      select id from app.counterparties where organization_id = ${orgs.a} and legal_name = 'Synthetic Lone Buyer'`;
    if (!lone) throw new Error('no buyer');
    expect(await db.undoImport(as(users.adam), sellers, true, 0)).toMatchObject({ status: 'ok' });
    const after = await db.getCounterparty(as(users.adam), lone.id);
    expect(after?.types).toEqual(['buyer']);
    // The grain it added (oats it sells) is gone too.
    expect(after?.commodities).toEqual([]);
  });

  it('leaves to check by hand what an import made before the record did not keep', async () => {
    await importRows(
      users.olivia,
      'buyer',
      [
        {
          line: 2,
          values: { legalName: 'Synthetic Older Buyer', country: 'CA', city: 'Olds', region: 'AB' },
        },
      ],
      '8'.repeat(64),
    );
    const sellers = await importRows(
      users.olivia,
      'seller',
      [
        {
          line: 2,
          values: {
            legalName: 'Synthetic Older Buyer',
            country: 'CA',
            city: 'Didsbury',
            region: 'AB',
          },
        },
      ],
      '9'.repeat(64),
    );
    // As an import made before this record existed.
    await admin`update app.import_batches set records_additions = false where id = ${sellers}`;
    await admin`delete from app.import_additions where import_batch_id = ${sellers}`;
    await admin`update app.counterparty_commodities set import_batch_id = null where import_batch_id = ${sellers}`;
    const [older] = await admin<{ id: string }[]>`
      select id from app.counterparties where organization_id = ${orgs.a} and legal_name = 'Synthetic Older Buyer'`;
    if (!older) throw new Error('no buyer');
    const preview = await db.undoImport(as(users.adam), sellers, false);
    expect(preview).toMatchObject({
      status: 'ok',
      plan: {
        listed: [
          {
            id: older.id,
            locations: 1,
            removedTypes: [],
            check: [expect.stringContaining('check its type, seller details, grains') as unknown],
          },
        ],
      },
    });
    expect(await db.undoImport(as(users.adam), sellers, true, 0)).toMatchObject({ status: 'ok' });
    const after = await db.getCounterparty(as(users.adam), older.id);
    // Only what is recorded is taken off: the location it added. The type stays to check.
    expect(after?.facilities.map((f) => f.city)).toEqual(['Olds']);
    expect(after?.types).toEqual(['buyer', 'seller']);
  });
});
