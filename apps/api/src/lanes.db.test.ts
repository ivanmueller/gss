import { LANE_REGIONS, type FreightTerms, type LaneChange } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of a carrier's lanes and equipment (owner's request, 2026-11-01): the real
// driver, as `app_api`, against the real migrations, row level security and triggers.
// Fixtures are synthetic. Freight revisions can never be deleted, so this test's records stay
// in the throwaway test database; every id is fresh, so nothing else sees them.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { tess: id(), victor: id(), olivia: id(), ada: id(), bob: id() };
const orgs = { a: id(), b: id() };
const counterparties = { carrier: id(), buyer: id(), seller: id(), other: id(), spare: id() };
const facilities = { buyer: id(), seller: id(), sellerAb: id(), unknown: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

const terms: FreightTerms = {
  firmness: 'firm',
  rate: '105.00',
  currency: 'CAD',
  rateUnit: 'MT',
  payload: null,
  payloadUnit: null,
  inclusions: null,
  quotedAt: hoursFromNow(-1),
  validUntil: hoursFromNow(48),
  sourceType: 'email',
  sourceReference: null,
  notes: null,
};

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
    (${orgs.a}, ${users.ada}, 'org_admin', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by) values
    (${counterparties.carrier}, ${orgs.a}, 'Synthetic Prairie Hauling', '{carrier}', 'CA', 'manual', ${users.olivia}),
    (${counterparties.buyer}, ${orgs.a}, 'Synthetic Buyer', '{buyer}', 'US', 'manual', ${users.olivia}),
    (${counterparties.seller}, ${orgs.a}, 'Synthetic Seller', '{seller}', 'CA', 'manual', ${users.olivia}),
    (${counterparties.spare}, ${orgs.a}, 'Synthetic Spare Hauling', '{carrier}', 'CA', 'manual', ${users.olivia}),
    (${counterparties.other}, ${orgs.b}, 'Synthetic Other Hauling', '{carrier}', 'US', 'manual', ${users.bob})`;
  await admin`insert into app.facilities (id, organization_id, counterparty_id, name, city, region, country, created_by) values
    (${facilities.buyer}, ${orgs.a}, ${counterparties.buyer}, 'Synthetic Mill', 'Synthetic Town', 'MN', 'US', ${users.olivia}),
    (${facilities.seller}, ${orgs.a}, ${counterparties.seller}, null, 'Synthetic City', 'SK', 'CA', ${users.olivia}),
    (${facilities.sellerAb}, ${orgs.a}, ${counterparties.seller}, null, 'Synthetic Hamlet', 'AB', 'CA', ${users.olivia}),
    (${facilities.unknown}, ${orgs.a}, ${counterparties.seller}, null, 'Synthetic Nowhere', 'ZZ', 'CA', ${users.olivia})`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

async function lanesOf(counterpartyId: string, userId = users.victor) {
  const detail = await db.getCounterparty(as(userId), counterpartyId);
  return detail && { lanes: detail.lanes, quotedLanes: detail.quotedLanes };
}

describe("a carrier's lanes as app_api", () => {
  it('a trader adds lanes; everyone on the team reads them', async () => {
    const result = await db.changeLanes(as(users.tess), counterparties.carrier, {
      add: [
        { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
        { origin: 'CA-AB', destination: 'US-ND', transport: 'rail_and_truck' },
      ],
      remove: [],
    });
    expect(result).toEqual({ status: 'saved' });
    expect(await lanesOf(counterparties.carrier)).toEqual({
      lanes: [
        { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
        { origin: 'CA-AB', destination: 'US-ND', transport: 'rail_and_truck' },
      ],
      quotedLanes: [],
    });
    const listed = (await db.listCounterparties(as(users.victor), orgs.a)).find(
      (row) => row.id === counterparties.carrier,
    );
    expect(listed?.lanes).toHaveLength(2);
  });

  it("adding a listed lane changes its transport; removing one that isn't changes nothing", async () => {
    await db.changeLanes(as(users.olivia), counterparties.carrier, {
      add: [{ origin: 'CA-AB', destination: 'US-MT', transport: 'rail' }],
      remove: [{ origin: 'CA-MB', destination: 'US-MN' }],
    });
    await db.changeLanes(as(users.ada), counterparties.carrier, {
      add: [{ origin: 'CA-AB', destination: 'US-MT', transport: 'rail' }],
      remove: [{ origin: 'CA-AB', destination: 'US-ND' }],
    });
    expect((await lanesOf(counterparties.carrier))?.lanes).toEqual([
      { origin: 'CA-AB', destination: 'US-MT', transport: 'rail' },
    ]);
    // One insert each, one change of transport, one removal: no change written for nothing.
    const [audit] = await admin<{ inserts: number; updates: number; deletes: number }[]>`
      select count(*) filter (where action = 'insert')::int as inserts,
             count(*) filter (where action = 'update')::int as updates,
             count(*) filter (where action = 'delete')::int as deletes
      from app.audit_events where entity = 'carrier_lanes' and organization_id = ${orgs.a}`;
    expect(audit).toEqual({ inserts: 2, updates: 1, deletes: 1 });
  });

  it('a viewer, another organization and a non-carrier are refused', async () => {
    const add: LaneChange = {
      add: [{ origin: 'CA-SK', destination: 'US-ND', transport: 'truck' }],
      remove: [],
    };
    expect(await db.changeLanes(as(users.victor), counterparties.carrier, add)).toEqual({
      status: 'forbidden',
    });
    expect(await db.changeLanes(as(users.bob), counterparties.carrier, add)).toEqual({
      status: 'not_found',
    });
    expect(await lanesOf(counterparties.carrier, users.bob)).toBeNull();
    expect(await db.changeLanes(as(users.tess), counterparties.buyer, add)).toEqual({
      status: 'not_carrier',
    });
    expect(await db.changeLanes(as(users.tess), counterparties.other, add)).toEqual({
      status: 'not_found',
    });
    expect((await lanesOf(counterparties.carrier))?.lanes).toHaveLength(1);
  });

  it('an archived carrier keeps its lanes as they are', async () => {
    await admin`update app.counterparties set archived_at = now() where id = ${counterparties.spare}`;
    const add: LaneChange = {
      add: [{ origin: 'CA-SK', destination: 'US-ND', transport: 'truck' }],
      remove: [],
    };
    expect(await db.changeLanes(as(users.tess), counterparties.spare, add)).toEqual({
      status: 'archived',
    });
    await admin`update app.counterparties set archived_at = null where id = ${counterparties.spare}`;
  });

  it('the database and the shared rules agree on every place', async () => {
    const add = LANE_REGIONS.map((destination) => ({
      origin: 'CA-MB',
      destination,
      transport: 'truck' as const,
    }));
    expect(await db.changeLanes(as(users.tess), counterparties.spare, { add, remove: [] })).toEqual(
      { status: 'saved' },
    );
    expect((await lanesOf(counterparties.spare))?.lanes).toHaveLength(LANE_REGIONS.length);
    await db.changeLanes(as(users.tess), counterparties.spare, { add: [], remove: add });
    expect((await lanesOf(counterparties.spare))?.lanes).toEqual([]);
  });

  it('shows the places its freight rates run between, rail and truck together', async () => {
    const rate = (origin: string, mode: 'truck' | 'rail') =>
      db.createFreight(as(users.tess), {
        organizationId: orgs.a,
        carrierId: counterparties.carrier,
        originFacilityId: origin,
        destinationFacilityId: facilities.buyer,
        mode,
        terms,
        recordedByName: 'Tess Trader',
      });
    await rate(facilities.seller, 'truck');
    await rate(facilities.seller, 'rail');
    await rate(facilities.sellerAb, 'truck');
    // A province the lanes do not know is left out.
    await rate(facilities.unknown, 'truck');
    expect((await lanesOf(counterparties.carrier))?.quotedLanes).toEqual([
      { origin: 'CA-AB', destination: 'US-MN', transport: 'truck' },
      { origin: 'CA-SK', destination: 'US-MN', transport: 'rail_and_truck' },
    ]);
  });

  it('saves equipment with the other details, and keeps it when left out', async () => {
    const detail = await db.getCounterparty(as(users.olivia), counterparties.carrier);
    if (!detail) throw new Error('missing');
    const input = {
      legalName: detail.legalName,
      tradingName: null,
      types: ['carrier' as const],
      primaryCountry: 'CA' as const,
      verificationStatus: 'unverified' as const,
      website: null,
      phone: null,
      markets: [],
      tier: null,
      notes: null,
    };
    expect(
      await db.updateCounterparty(as(users.olivia), counterparties.carrier, detail.version, input, [
        'super_b',
        'van',
      ]),
    ).toEqual({ status: 'saved' });
    const saved = await db.getCounterparty(as(users.olivia), counterparties.carrier);
    expect(saved?.equipment).toEqual(['super_b', 'van']);
    if (!saved) throw new Error('missing');
    await db.updateCounterparty(as(users.olivia), counterparties.carrier, saved.version, {
      ...input,
      notes: 'Synthetic note',
    });
    expect((await db.getCounterparty(as(users.olivia), counterparties.carrier))?.equipment).toEqual(
      ['super_b', 'van'],
    );
    // A trader is not a directory editor.
    expect(
      await db.updateCounterparty(as(users.tess), counterparties.carrier, saved.version, input, []),
    ).toEqual({ status: 'forbidden' });
  });

  it('an admin deleting an archived carrier without history deletes its lanes', async () => {
    await db.changeLanes(as(users.tess), counterparties.spare, {
      add: [{ origin: 'CA-MB', destination: 'US-ND', transport: 'truck' }],
      remove: [],
    });
    await admin`update app.counterparties set archived_at = now() where id = ${counterparties.spare}`;
    expect(await db.deleteCounterparty(as(users.ada), counterparties.spare)).toEqual({
      status: 'deleted',
    });
    const [left] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.carrier_lanes where carrier_id = ${counterparties.spare}`;
    expect(left?.count).toBe(0);
  });
});

/** Waits until `count` app_api sessions are blocked, directly or not, by session `pid`. */
async function waitForBlocked(pid: number, count = 1) {
  for (let tries = 0; ; tries += 1) {
    const [waiting] = await admin<{ count: number }[]>`
      select count(*)::int as count from pg_stat_activity
      where ${pid}::int = any (pg_blocking_pids(pid))`;
    if ((waiting?.count ?? 0) >= count) return;
    if (tries > 200) throw new Error('nothing waited for the lock');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Runs `work` in a transaction of its own and holds it open until the returned release. */
function holdOpen(work: (tx: postgres.TransactionSql) => Promise<unknown>) {
  const connection = postgres(ADMIN_URL ?? '', { max: 1, onnotice: () => undefined });
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started: (pid: number) => void = () => undefined;
  const pid = new Promise<number>((resolve) => {
    started = resolve;
  });
  const done = connection
    .begin(async (tx) => {
      const [me] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      await work(tx);
      started(me?.pid ?? 0);
      await held;
    })
    .finally(() => connection.end());
  return { pid, release, done };
}

describe('a carrier added by hand (owner’s request, 2026-11-01)', () => {
  it('saves its equipment and first lanes, truck or rail only when stated', async () => {
    const created = await db.createCounterparty(as(users.olivia), orgs.a, {
      counterparty: {
        legalName: 'Synthetic New Hauling',
        tradingName: null,
        types: ['carrier'],
        primaryCountry: 'CA',
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
      equipment: ['super_b', 'van'],
      lanes: [
        { origin: 'CA-AB', destination: 'US-MT', transport: null },
        { origin: 'CA-AB', destination: 'US-ND', transport: 'truck' },
      ],
    });
    if (created.status !== 'created') throw new Error('not created');
    const detail = await db.getCounterparty(as(users.victor), created.id);
    expect(detail?.equipment).toEqual(['super_b', 'van']);
    expect(detail?.lanes).toEqual([
      { origin: 'CA-AB', destination: 'US-MT', transport: null },
      { origin: 'CA-AB', destination: 'US-ND', transport: 'truck' },
    ]);
    // Stated later, and back to not stated.
    await db.changeLanes(as(users.tess), created.id, {
      add: [{ origin: 'CA-AB', destination: 'US-MT', transport: 'rail' }],
      remove: [],
    });
    await db.changeLanes(as(users.tess), created.id, {
      add: [{ origin: 'CA-AB', destination: 'US-ND', transport: null }],
      remove: [],
    });
    expect((await db.getCounterparty(as(users.victor), created.id))?.lanes).toEqual([
      { origin: 'CA-AB', destination: 'US-MT', transport: 'rail' },
      { origin: 'CA-AB', destination: 'US-ND', transport: null },
    ]);
  });
});

// Codex's review of ba68201: two changes at the same moment.
describe('lanes and concurrent changes', () => {
  it('a removal waiting for an archiving under way is refused once it is archived', async () => {
    await db.changeLanes(as(users.tess), counterparties.carrier, {
      add: [{ origin: 'CA-MB', destination: 'US-MN', transport: 'truck' }],
      remove: [],
    });
    const archiving = holdOpen(
      (tx) => tx`update app.counterparties set archived_at = now()
                 where id = ${counterparties.carrier}`,
    );
    const pid = await archiving.pid;
    const removal = db.changeLanes(as(users.ada), counterparties.carrier, {
      add: [],
      remove: [{ origin: 'CA-MB', destination: 'US-MN' }],
    });
    await waitForBlocked(pid);
    archiving.release();
    await archiving.done;
    const result = await removal;
    const [kept] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.carrier_lanes
      where carrier_id = ${counterparties.carrier} and origin = 'CA-MB'`;
    await admin`update app.counterparties set archived_at = null where id = ${counterparties.carrier}`;
    expect([result, kept?.count]).toEqual([{ status: 'archived' }, 1]);
  });

  it(
    'a trader demoted while a removal runs: the removal finishes first, all of it',
    { timeout: 20000 },
    async () => {
      await db.changeLanes(as(users.tess), counterparties.carrier, {
        add: [
          { origin: 'CA-SK', destination: 'US-MT', transport: 'truck' },
          { origin: 'CA-SK', destination: 'US-SD', transport: 'truck' },
        ],
        remove: [],
      });
      // The first lane is held, so the removal stops at its first delete.
      const holder = holdOpen(
        (tx) => tx`select 1 from app.carrier_lanes
                 where carrier_id = ${counterparties.carrier} and origin = 'CA-SK'
                   and destination = 'US-MT'
                 for update`,
      );
      const pid = await holder.pid;
      const removal = db.changeLanes(as(users.tess), counterparties.carrier, {
        add: [],
        remove: [
          { origin: 'CA-SK', destination: 'US-MT' },
          { origin: 'CA-SK', destination: 'US-SD' },
        ],
      });
      await waitForBlocked(pid);
      // Meanwhile an admin makes the trader a viewer.
      // On a connection of its own, sent now (postgres.js waits for an await otherwise).
      const demoter = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
      const demotion = demoter`update app.organization_members set role = 'viewer'
      where organization_id = ${orgs.a} and user_id = ${users.tess}`.execute();
      // Let the demotion reach the database (it waits for the removal, or commits).
      await new Promise((resolve) => setTimeout(resolve, 300));
      holder.release();
      await holder.done;
      const result = await removal;
      await demotion;
      await demoter.end();
      const [left] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.carrier_lanes
      where carrier_id = ${counterparties.carrier} and origin = 'CA-SK'`;
      await admin`update app.organization_members set role = 'trader'
      where organization_id = ${orgs.a} and user_id = ${users.tess}`;
      // Never half of it: the removal held the trader's membership, so all of it happened first.
      expect([result, left?.count]).toEqual([{ status: 'saved' }, 0]);
    },
  );
});
