import type { QuoteTerms } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of bids and offers: the real driver, as `app_api`, against the real
// migrations, row level security and triggers. Fixtures are synthetic, and so are prices.
//
// Quote revisions can never be deleted, not even by the table owner, so this test's quotes,
// and the organizations and counterparties they belong to, stay in the throwaway test
// database; every id is fresh, so nothing else sees them.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { tess: id(), victor: id(), olivia: id(), bob: id() };
const orgs = { a: id(), b: id() };
const counterparties = { buyer: id(), seller: id(), archived: id(), other: id() };
const facilities = { buyer: id(), seller: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

function terms(extra: Partial<QuoteTerms> = {}): QuoteTerms {
  return {
    firmness: 'firm',
    price: '725.00',
    currency: 'USD',
    priceUnit: 'MT',
    grade: 'No. 1 CW',
    deliveryBasis: 'delivered',
    basisLocation: 'Synthetic Town, MN',
    quantityMinMt: '21',
    quantityMaxMt: '84.5',
    deliveryStart: '2026-11-01',
    deliveryEnd: '2026-11-30',
    quotedAt: hoursFromNow(-1),
    validUntil: hoursFromNow(48),
    sourceType: 'phone',
    sourceReference: 'Synthetic call',
    notes: 'Synthetic note',
    ...extra,
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
    (${orgs.a}, ${users.tess}, 'trader', 'active', now()),
    (${orgs.a}, ${users.victor}, 'viewer', 'active', now()),
    (${orgs.a}, ${users.olivia}, 'operations', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
    (${counterparties.buyer}, ${orgs.a}, 'Synthetic Buyer', '{buyer}', 'US', 'manual', ${users.olivia}, null),
    (${counterparties.seller}, ${orgs.a}, 'Synthetic Seller', '{seller}', 'CA', 'manual', ${users.olivia}, null),
    (${counterparties.archived}, ${orgs.a}, 'Synthetic Archived', '{buyer}', 'CA', 'manual', ${users.olivia}, now()),
    (${counterparties.other}, ${orgs.b}, 'Synthetic Other', '{buyer}', 'US', 'manual', ${users.bob}, null)`;
  await admin`insert into app.facilities (id, organization_id, counterparty_id, name, city, region, country, created_by) values
    (${facilities.buyer}, ${orgs.a}, ${counterparties.buyer}, 'Synthetic Mill', 'Synthetic Town', 'MN', 'US', ${users.olivia}),
    (${facilities.seller}, ${orgs.a}, ${counterparties.seller}, null, 'Synthetic City', 'SK', 'CA', ${users.olivia})`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

const bid = (extra: Partial<Parameters<Database['createQuote']>[1]> = {}) => ({
  organizationId: orgs.a,
  counterpartyId: counterparties.buyer,
  facilityId: facilities.buyer,
  side: 'bid' as const,
  commodity: 'flaxseed',
  terms: terms(),
  recordedByName: 'Tess Trader',
  ...extra,
});

describe('bids and offers as app_api', () => {
  let quoteId = '';

  it('enters a bid and reads it back with its terms as entered', async () => {
    const created = await db.createQuote(as(users.tess), bid());
    expect(created.status).toBe('created');
    if (created.status !== 'created') return;
    quoteId = created.id;
    const quote = await db.getQuote(as(users.victor), quoteId);
    expect(quote).toMatchObject({
      side: 'bid',
      status: 'firm',
      commodity: { code: 'flaxseed', name: 'Flaxseed' },
      counterparty: { id: counterparties.buyer, legalName: 'Synthetic Buyer', archived: false },
      // Without coordinates the workspace lists it but puts no pin on the map.
      facility: {
        id: facilities.buyer,
        name: 'Synthetic Mill',
        region: 'MN',
        country: 'US',
        latitude: null,
        longitude: null,
        locationPrecision: null,
      },
      withdrawnAt: null,
      current: {
        revisionNumber: 1,
        price: '725.00',
        currency: 'USD',
        quantityMinMt: '21.000',
        quantityMaxMt: '84.500',
        deliveryStart: '2026-11-01',
        deliveryEnd: '2026-11-30',
        recordedByName: 'Tess Trader',
      },
    });
    expect(quote?.revisions).toHaveLength(1);
  });

  it('refuses other roles, other organizations and the wrong counterparty', async () => {
    expect((await db.createQuote(as(users.victor), bid())).status).toBe('forbidden');
    expect((await db.createQuote(as(users.olivia), bid())).status).toBe('forbidden');
    expect((await db.createQuote(as(users.bob), bid())).status).toBe('forbidden');
    expect(
      (await db.createQuote(as(users.bob), bid({ organizationId: orgs.b, facilityId: null })))
        .status,
    ).toBe('counterparty_not_found');
    expect(
      (
        await db.createQuote(
          as(users.tess),
          bid({ counterpartyId: counterparties.archived, facilityId: null }),
        )
      ).status,
    ).toBe('archived');
    expect(
      await db.createQuote(
        as(users.tess),
        bid({ counterpartyId: counterparties.seller, facilityId: null }),
      ),
    ).toEqual({ status: 'wrong_type', types: ['seller'] });
    expect(
      (await db.createQuote(as(users.tess), bid({ facilityId: facilities.seller }))).status,
    ).toBe('facility_not_found');
    expect((await db.createQuote(as(users.tess), bid({ commodity: 'gold' }))).status).toBe(
      'commodity_not_found',
    );
  });

  it('appends new terms and keeps the earlier ones, refusing terms based on an old revision', async () => {
    expect(
      await db.reviseQuote(
        as(users.tess),
        quoteId,
        1,
        terms({ price: '730.50', firmness: 'indicative' }),
        'Tess Trader',
      ),
    ).toEqual({ status: 'saved' });
    expect(await db.reviseQuote(as(users.tess), quoteId, 1, terms(), 'Tess Trader')).toEqual({
      status: 'changed',
      currentRevision: 2,
    });
    expect((await db.reviseQuote(as(users.victor), quoteId, 2, terms(), 'Victor')).status).toBe(
      'forbidden',
    );
    expect((await db.reviseQuote(as(users.bob), quoteId, 2, terms(), 'Bob')).status).toBe(
      'not_found',
    );
    const quote = await db.getQuote(as(users.tess), quoteId);
    expect(quote?.status).toBe('indicative');
    expect(quote?.revisions.map((r) => [r.revisionNumber, r.price, r.firmness])).toEqual([
      [2, '730.50', 'indicative'],
      [1, '725.00', 'firm'],
    ]);
  });

  it('lists live quotes by default and finds them by counterparty, side and commodity', async () => {
    const offer = await db.createQuote(as(users.tess), {
      ...bid({
        counterpartyId: counterparties.seller,
        facilityId: null,
        side: 'offer',
        commodity: 'canola',
      }),
      terms: terms({ currency: 'CAD', price: '820.00' }),
    });
    expect(offer.status).toBe('created');
    const filter = {
      organizationId: orgs.a,
      counterpartyId: null,
      side: null,
      commodity: null,
      liveOnly: true,
    };
    const all = await db.listQuotes(as(users.victor), filter);
    expect(all.map((q) => [q.side, q.commodity.code, q.current.price]).sort()).toEqual([
      ['bid', 'flaxseed', '730.50'],
      ['offer', 'canola', '820.00'],
    ]);
    expect(
      (await db.listQuotes(as(users.victor), { ...filter, side: 'offer' })).map((q) => q.side),
    ).toEqual(['offer']);
    expect(
      (
        await db.listQuotes(as(users.victor), { ...filter, counterpartyId: counterparties.buyer })
      ).map((q) => q.id),
    ).toEqual([quoteId]);
    expect(
      (await db.listQuotes(as(users.victor), { ...filter, commodity: 'canola' })).map(
        (q) => q.side,
      ),
    ).toEqual(['offer']);
    expect(await db.listQuotes(as(users.bob), filter)).toEqual([]);
    expect(await db.getQuote(as(users.bob), quoteId)).toBeNull();
  });

  it('withdraws a quote for good: it leaves the live list and gets no new terms', async () => {
    expect((await db.withdrawQuote(as(users.victor), quoteId, 'Victor')).status).toBe('forbidden');
    expect(await db.withdrawQuote(as(users.tess), quoteId, 'Tess Trader')).toEqual({
      status: 'saved',
    });
    // Withdrawing again changes nothing.
    expect(await db.withdrawQuote(as(users.tess), quoteId, 'Someone')).toEqual({ status: 'saved' });
    const quote = await db.getQuote(as(users.tess), quoteId);
    expect(quote).toMatchObject({ status: 'withdrawn', withdrawnByName: 'Tess Trader' });
    expect(await db.reviseQuote(as(users.tess), quoteId, 2, terms(), 'Tess Trader')).toEqual({
      status: 'withdrawn',
    });
    const filter = {
      organizationId: orgs.a,
      counterpartyId: counterparties.buyer,
      side: null,
      commodity: null,
    };
    expect(await db.listQuotes(as(users.tess), { ...filter, liveOnly: true })).toEqual([]);
    expect(
      (await db.listQuotes(as(users.tess), { ...filter, liveOnly: false })).map((q) => q.status),
    ).toEqual(['withdrawn']);
  });

  it('shows an expired quote as expired, outside the live list', async () => {
    // Revisions cannot be backdated, so the table owner records one quoted in the past,
    // to stand in for time passing.
    const created = { id: id() };
    await admin.begin(async (tx) => {
      // The revision trigger checks the recorder may enter quotes.
      await tx`select set_config('app.user_id', ${users.tess}, true)`;
      await tx`insert into app.quotes
          (id, organization_id, counterparty_id, side, commodity_code, created_by)
        values (${created.id}, ${orgs.a}, ${counterparties.buyer}, 'bid', 'flaxseed', ${users.tess})`;
      await tx`insert into app.quote_revisions
          (organization_id, quote_id, revision_number, firmness, price, currency, price_unit,
           delivery_basis, quantity_max_mt, quoted_at, valid_from, valid_until, source_type,
           recorded_by, recorded_by_name)
        values (${orgs.a}, ${created.id}, 1, 'firm', 700.00, 'CAD', 'MT', 'delivered', 50,
                  now() - interval '3 days', now() - interval '3 days', now() - interval '1 day',
                  'phone', ${users.tess}, 'Tess Trader')`;
    });
    expect((await db.getQuote(as(users.tess), created.id))?.status).toBe('expired');
    const live = await db.listQuotes(as(users.tess), {
      organizationId: orgs.a,
      counterpartyId: counterparties.buyer,
      side: null,
      commodity: null,
      liveOnly: true,
    });
    expect(live.map((q) => q.id)).not.toContain(created.id);
    // An expired quote can still get new terms that make it valid again.
    expect(await db.reviseQuote(as(users.tess), created.id, 1, terms(), 'Tess Trader')).toEqual({
      status: 'saved',
    });
    expect((await db.getQuote(as(users.tess), created.id))?.status).toBe('firm');
  });

  // Codex's review of ivanmueller/gss#46: new terms based on revision 1 were saved over
  // revision 2 when it was recorded while they waited for the quote's lock.
  it('refuses new terms based on a revision replaced while they waited for the lock', async () => {
    const created = await db.createQuote(as(users.tess), bid());
    if (created.status !== 'created') throw new Error('not created');
    let release: () => void = () => undefined;
    let ready: (pid: number) => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<number>((resolve) => {
      ready = resolve;
    });
    // Another session (its own connection) locks the quote and records revision 2, without
    // committing yet.
    const session = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
    const other = session.begin(async (tx) => {
      const [me] = await tx<{ pid: number }[]>`
        select pg_backend_pid() as pid, set_config('app.user_id', ${users.tess}, true)`;
      await tx`select 1 from app.quotes where id = ${created.id} for no key update`;
      await tx`insert into app.quote_revisions
          (organization_id, quote_id, revision_number, firmness, price, currency, price_unit,
           delivery_basis, quantity_max_mt, quoted_at, valid_from, valid_until, source_type,
           recorded_by, recorded_by_name)
        values (${orgs.a}, ${created.id}, 1, 'firm', 740.00, 'USD', 'MT', 'delivered', 50,
                now(), now(), now() + interval '2 days', 'phone', ${users.tess}, 'Tess Trader')`;
      ready(me?.pid ?? 0);
      await held;
    });
    const holder = await locked;
    const revising = db.reviseQuote(as(users.tess), created.id, 1, terms(), 'Tess Trader');
    // Wait until an app_api session (the revision; no other app_api session touches this
    // quote) is blocked by exactly the session holding the lock, then let that one commit.
    // Process ids, user names and pg_blocking_pids need no extra privileges, unlike other
    // sessions' wait events.
    for (let tries = 0; ; tries += 1) {
      const [waiting] = await admin<{ count: number }[]>`
        select count(*)::int as count from pg_stat_activity
        where usename = 'app_api' and ${holder}::int = any (pg_blocking_pids(pid))`;
      if ((waiting?.count ?? 0) > 0) break;
      if (tries > 200) throw new Error('the revision never waited for the lock');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    await other;
    await session.end();
    expect(await revising).toEqual({ status: 'changed', currentRevision: 2 });
    const quote = await db.getQuote(as(users.tess), created.id);
    expect(quote?.revisions.map((r) => [r.revisionNumber, r.price])).toEqual([
      [2, '740.00'],
      [1, '725.00'],
    ]);
  });

  it('gives a located quote its coordinates as text, for the workspace map', async () => {
    await admin`update app.facilities set latitude = 52.133214, longitude = -106.670046,
                  location_precision = 'exact', geocoding_source = 'manual'
                where id = ${facilities.seller}`;
    const created = await db.createQuote(as(users.tess), {
      ...bid({
        counterpartyId: counterparties.seller,
        facilityId: facilities.seller,
        side: 'offer',
      }),
      terms: terms({ currency: 'CAD', price: '810.00' }),
    });
    if (created.status !== 'created') throw new Error('not created');
    expect((await db.getQuote(as(users.victor), created.id))?.facility).toMatchObject({
      latitude: '52.133214',
      longitude: '-106.670046',
      locationPrecision: 'exact',
    });
  });

  it('keeps a location with quotes from being removed', async () => {
    await expect(
      db.removeFacility(as(users.olivia), counterparties.buyer, facilities.buyer),
    ).rejects.toMatchObject({ code: '23503', constraint_name: 'quotes_facility_fkey' });
  });

  it('lists the commodities for a signed-in member', async () => {
    const commodities = await db.listCommodities(as(users.victor));
    expect(commodities[0]).toEqual({ code: 'canola', name: 'Canola' });
    expect(commodities).toHaveLength(20);
  });
});
