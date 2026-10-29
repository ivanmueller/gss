import type { FreightTerms } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of carrier freight rates: the real driver, as `app_api`, against the real
// migrations, row level security and triggers. Fixtures and rates are synthetic.
//
// Freight revisions can never be deleted, not even by the table owner, so this test's rates,
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
const counterparties = {
  carrier: id(),
  archivedCarrier: id(),
  buyer: id(),
  seller: id(),
  other: id(),
};
const facilities = { buyer: id(), seller: id(), other: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

function terms(extra: Partial<FreightTerms> = {}): FreightTerms {
  return {
    firmness: 'firm',
    rate: '105.00',
    currency: 'CAD',
    rateUnit: 'MT',
    payload: null,
    payloadUnit: null,
    inclusions: 'Fuel surcharge included',
    quotedAt: hoursFromNow(-1),
    validUntil: hoursFromNow(48),
    sourceType: 'email',
    sourceReference: 'Synthetic dispatch email',
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
    (${counterparties.carrier}, ${orgs.a}, 'Synthetic Carrier', '{carrier}', 'CA', 'manual', ${users.olivia}, null),
    (${counterparties.archivedCarrier}, ${orgs.a}, 'Synthetic Old Carrier', '{carrier}', 'CA', 'manual', ${users.olivia}, now()),
    (${counterparties.buyer}, ${orgs.a}, 'Synthetic Buyer', '{buyer}', 'US', 'manual', ${users.olivia}, null),
    (${counterparties.seller}, ${orgs.a}, 'Synthetic Seller', '{seller}', 'CA', 'manual', ${users.olivia}, null),
    (${counterparties.other}, ${orgs.b}, 'Synthetic Other', '{buyer}', 'US', 'manual', ${users.bob}, null)`;
  await admin`insert into app.facilities (id, organization_id, counterparty_id, name, city, region, country, created_by) values
    (${facilities.buyer}, ${orgs.a}, ${counterparties.buyer}, 'Synthetic Mill', 'Synthetic Town', 'MN', 'US', ${users.olivia}),
    (${facilities.seller}, ${orgs.a}, ${counterparties.seller}, null, 'Synthetic City', 'SK', 'CA', ${users.olivia}),
    (${facilities.other}, ${orgs.b}, ${counterparties.other}, null, 'Synthetic Village', 'ND', 'US', ${users.bob})`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

const route = (extra: Partial<Parameters<Database['createFreight']>[1]> = {}) => ({
  organizationId: orgs.a,
  carrierId: counterparties.carrier,
  originFacilityId: facilities.seller,
  destinationFacilityId: facilities.buyer,
  mode: 'truck' as const,
  terms: terms(),
  recordedByName: 'Olivia Operations',
  ...extra,
});

const everything = {
  organizationId: null,
  carrierId: null,
  facilityId: null,
  counterpartyId: null,
  mode: null,
  liveOnly: false,
};

describe('carrier freight rates as app_api', () => {
  let freightId = '';

  it('enters a rate and reads it back with its route and terms as entered', async () => {
    const created = await db.createFreight(as(users.olivia), route());
    expect(created.status).toBe('created');
    if (created.status !== 'created') return;
    freightId = created.id;
    const freight = await db.getFreight(as(users.victor), freightId);
    expect(freight).toMatchObject({
      mode: 'truck',
      status: 'firm',
      carrier: { id: counterparties.carrier, legalName: 'Synthetic Carrier', archived: false },
      origin: {
        id: facilities.seller,
        name: null,
        city: 'Synthetic City',
        region: 'SK',
        country: 'CA',
        counterparty: { id: counterparties.seller, legalName: 'Synthetic Seller', archived: false },
      },
      destination: {
        id: facilities.buyer,
        name: 'Synthetic Mill',
        counterparty: { id: counterparties.buyer, legalName: 'Synthetic Buyer' },
      },
      withdrawnAt: null,
      current: {
        revisionNumber: 1,
        rate: '105.00',
        currency: 'CAD',
        rateUnit: 'MT',
        payload: null,
        payloadUnit: null,
        inclusions: 'Fuel surcharge included',
        recordedByName: 'Olivia Operations',
      },
    });
    expect(freight?.revisions).toHaveLength(1);
  });

  it('keeps a rate per load with its payload as quoted', async () => {
    const created = await db.createFreight(
      as(users.tess),
      route({
        mode: 'rail',
        terms: terms({
          rate: '4200',
          currency: 'USD',
          rateUnit: 'LOAD',
          payload: '90.5',
          payloadUnit: 'MT',
        }),
      }),
    );
    if (created.status !== 'created') throw new Error('not created');
    expect((await db.getFreight(as(users.tess), created.id))?.current).toMatchObject({
      rate: '4200',
      rateUnit: 'LOAD',
      payload: '90.500',
      payloadUnit: 'MT',
    });
  });

  it('refuses other roles, other organizations, non-carriers and bad routes', async () => {
    expect((await db.createFreight(as(users.victor), route())).status).toBe('forbidden');
    expect((await db.createFreight(as(users.bob), route())).status).toBe('forbidden');
    expect((await db.createFreight(as(users.bob), route({ organizationId: orgs.b }))).status).toBe(
      'carrier_not_found',
    );
    expect(
      (
        await db.createFreight(
          as(users.olivia),
          route({ carrierId: counterparties.archivedCarrier }),
        )
      ).status,
    ).toBe('archived');
    expect(
      (await db.createFreight(as(users.olivia), route({ carrierId: counterparties.seller })))
        .status,
    ).toBe('not_a_carrier');
    expect(
      (
        await db.createFreight(
          as(users.olivia),
          route({ destinationFacilityId: facilities.seller }),
        )
      ).status,
    ).toBe('same_location');
    expect(
      (await db.createFreight(as(users.olivia), route({ originFacilityId: facilities.other })))
        .status,
    ).toBe('origin_not_found');
    expect(
      (await db.createFreight(as(users.olivia), route({ destinationFacilityId: facilities.other })))
        .status,
    ).toBe('destination_not_found');
  });

  it('appends new terms and keeps the earlier ones, refusing terms based on an old revision', async () => {
    expect(
      await db.reviseFreight(
        as(users.tess),
        freightId,
        1,
        terms({ rate: '98.50', firmness: 'indicative' }),
        'Tess Trader',
      ),
    ).toEqual({ status: 'saved' });
    expect(await db.reviseFreight(as(users.olivia), freightId, 1, terms(), 'Olivia')).toEqual({
      status: 'changed',
      currentRevision: 2,
    });
    expect((await db.reviseFreight(as(users.victor), freightId, 2, terms(), 'Victor')).status).toBe(
      'forbidden',
    );
    expect((await db.reviseFreight(as(users.bob), freightId, 2, terms(), 'Bob')).status).toBe(
      'not_found',
    );
    const freight = await db.getFreight(as(users.tess), freightId);
    expect(freight?.status).toBe('indicative');
    expect(freight?.revisions.map((r) => [r.revisionNumber, r.rate, r.recordedByName])).toEqual([
      [2, '98.50', 'Tess Trader'],
      [1, '105.00', 'Olivia Operations'],
    ]);
  });

  it('finds rates by carrier, location, counterparty of either end and mode', async () => {
    const filter = { ...everything, organizationId: orgs.a, liveOnly: true };
    const all = await db.listFreight(as(users.victor), filter);
    expect(all.map((f) => [f.mode, f.current.rate]).sort()).toEqual([
      ['rail', '4200'],
      ['truck', '98.50'],
    ]);
    expect(
      (await db.listFreight(as(users.victor), { ...filter, mode: 'rail' })).map((f) => f.mode),
    ).toEqual(['rail']);
    expect(
      await db.listFreight(as(users.victor), { ...filter, carrierId: counterparties.seller }),
    ).toEqual([]);
    expect(
      await db.listFreight(as(users.victor), { ...filter, carrierId: counterparties.carrier }),
    ).toHaveLength(2);
    expect(
      await db.listFreight(as(users.victor), { ...filter, facilityId: facilities.buyer }),
    ).toHaveLength(2);
    expect(
      await db.listFreight(as(users.victor), { ...filter, counterpartyId: counterparties.seller }),
    ).toHaveLength(2);
    expect(
      await db.listFreight(as(users.victor), { ...filter, counterpartyId: counterparties.carrier }),
    ).toEqual([]);
    expect(await db.listFreight(as(users.bob), everything)).toEqual([]);
    expect(await db.getFreight(as(users.bob), freightId)).toBeNull();
  });

  it('withdraws a rate for good: it leaves the live list and gets no new terms', async () => {
    expect((await db.withdrawFreight(as(users.victor), freightId, 'Victor')).status).toBe(
      'forbidden',
    );
    expect(await db.withdrawFreight(as(users.olivia), freightId, 'Olivia Operations')).toEqual({
      status: 'saved',
    });
    // Withdrawing again changes nothing.
    expect(await db.withdrawFreight(as(users.tess), freightId, 'Someone')).toEqual({
      status: 'saved',
    });
    const freight = await db.getFreight(as(users.tess), freightId);
    expect(freight).toMatchObject({ status: 'withdrawn', withdrawnByName: 'Olivia Operations' });
    expect(await db.reviseFreight(as(users.tess), freightId, 2, terms(), 'Tess Trader')).toEqual({
      status: 'withdrawn',
    });
    const live = await db.listFreight(as(users.tess), {
      ...everything,
      organizationId: orgs.a,
      liveOnly: true,
    });
    expect(live.map((f) => f.id)).not.toContain(freightId);
    const all = await db.listFreight(as(users.tess), { ...everything, organizationId: orgs.a });
    expect(all.find((f) => f.id === freightId)?.status).toBe('withdrawn');
  });

  it('refuses new terms once the carrier is archived', async () => {
    const created = await db.createFreight(as(users.olivia), route());
    if (created.status !== 'created') throw new Error('not created');
    await admin`update app.counterparties set archived_at = now() where id = ${counterparties.carrier}`;
    try {
      expect(await db.reviseFreight(as(users.olivia), created.id, 1, terms(), 'Olivia')).toEqual({
        status: 'archived',
      });
      expect((await db.getFreight(as(users.olivia), created.id))?.carrier.archived).toBe(true);
    } finally {
      await admin`update app.counterparties set archived_at = null where id = ${counterparties.carrier}`;
    }
  });

  it('keeps a location with freight from being removed', async () => {
    await expect(
      db.removeFacility(as(users.olivia), counterparties.buyer, facilities.buyer),
    ).rejects.toMatchObject({ code: '23503', constraint_name: 'freight_quotes_destination_fkey' });
    await expect(
      db.removeFacility(as(users.olivia), counterparties.seller, facilities.seller),
    ).rejects.toMatchObject({ code: '23503', constraint_name: 'freight_quotes_origin_fkey' });
  });
});
