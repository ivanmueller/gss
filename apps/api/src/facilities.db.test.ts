import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of the map search: the real driver, as `app_api`, against the real
// migrations and row level security. Fixtures are synthetic and removed afterwards.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { olivia: id(), sam: id(), bob: id() };
const orgs = { a: id(), b: id() };
const counterparties = { mills: id(), buyer: id(), other: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

const PRAIRIES = { west: -110, south: 49, east: -95, north: 60 };
const WORLD = { west: -180, south: -90, east: 180, north: 90 };

let db: Database;

beforeAll(async () => {
  for (const [name, userId] of Object.entries(users)) {
    await admin`insert into auth.users (id, email) values (${userId}, ${`${name}-${userId}@example.test`})`;
  }
  await admin`insert into app.organizations (id, display_name) values
    (${orgs.a}, 'Synthetic Org A'), (${orgs.b}, 'Synthetic Org B')`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.olivia}, 'viewer', 'active', now()),
    (${orgs.a}, ${users.sam}, 'operations', 'suspended', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
    (id, organization_id, legal_name, trading_name, types, primary_country, source, created_by) values
    (${counterparties.mills}, ${orgs.a}, 'Synthetic Prairie Mills', 'Prairie Mills', '{buyer,seller}', 'CA', 'manual', ${users.olivia}),
    (${counterparties.buyer}, ${orgs.a}, 'Synthetic Buyer LLC', null, '{buyer}', 'US', 'manual', ${users.olivia}),
    (${counterparties.other}, ${orgs.b}, 'Synthetic B Buyer', null, '{buyer}', 'CA', 'manual', ${users.bob})`;
  await admin`insert into app.facilities
    (organization_id, counterparty_id, name, facility_type, city, region, country,
     latitude, longitude, location_precision, created_by) values
    (${orgs.a}, ${counterparties.mills}, 'Synthetic Elevator', 'elevator', 'Synthetic Town', 'SK', 'CA',
     52.133214, -106.670046, 'exact', ${users.olivia}),
    (${orgs.a}, ${counterparties.mills}, 'Synthetic Border Terminal', 'terminal', null, 'MB', 'CA',
     49.000000, -97.000000, 'approximate', ${users.olivia}),
    (${orgs.a}, ${counterparties.mills}, 'Synthetic Office', 'office', 'Synthetic City', 'MN', 'US',
     44.977753, -93.265011, 'exact', ${users.olivia}),
    (${orgs.a}, ${counterparties.mills}, null, null, 'Synthetic Village', 'AB', 'CA',
     null, null, null, ${users.olivia}),
    (${orgs.a}, ${counterparties.buyer}, 'Synthetic Mill', 'processor', null, 'SK', 'CA',
     50.500000, -104.600000, 'exact', ${users.olivia}),
    (${orgs.b}, ${counterparties.other}, 'Synthetic B Elevator', 'elevator', null, 'MB', 'CA',
     50.000000, -100.000000, 'exact', ${users.bob}),
    (${orgs.b}, ${counterparties.other}, null, null, 'Synthetic B Village', 'MB', 'CA',
     null, null, null, ${users.bob})`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  const both = admin([orgs.a, orgs.b]);
  await admin`delete from app.facilities where organization_id in ${both}`;
  await admin`delete from app.counterparties where organization_id in ${both}`;
  await admin`delete from app.organization_members where organization_id in ${both}`;
  // Deleting the records and memberships above writes audit events too, so the audit trail goes last.
  await admin`delete from app.audit_events where organization_id in ${both}`;
  await admin`delete from app.organizations where id in ${both}`;
  await admin`delete from auth.users where id in ${admin(Object.values(users))}`;
  await admin.end();
});

const names = (result: Awaited<ReturnType<Database['facilitiesInBbox']>>) =>
  result.facilities.map((f) => f.name);

describe('the map search as app_api', () => {
  it('returns the organization’s located facilities in the box, by counterparty and name', async () => {
    const result = await db.facilitiesInBbox(as(users.olivia), null, PRAIRIES, null);
    // Every field of the first facility but its generated id; the key fields of the others.
    expect(result.facilities).toMatchObject([
      {
        counterpartyId: counterparties.buyer,
        legalName: 'Synthetic Buyer LLC',
        tradingName: null,
        counterpartyTypes: ['buyer'],
        name: 'Synthetic Mill',
        facilityType: 'processor',
        city: null,
        region: 'SK',
        country: 'CA',
        latitude: '50.500000',
        longitude: '-104.600000',
        locationPrecision: 'exact',
      },
      { name: 'Synthetic Border Terminal', locationPrecision: 'approximate' },
      {
        name: 'Synthetic Elevator',
        legalName: 'Synthetic Prairie Mills',
        tradingName: 'Prairie Mills',
        counterpartyTypes: ['buyer', 'seller'],
        latitude: '52.133214',
        longitude: '-106.670046',
      },
    ]);
    for (const facility of result.facilities) expect(facility.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.withoutCoordinates).toBe(1);
  });

  it('includes points on the edge of the box and nothing beyond it', async () => {
    const justNorth = { ...PRAIRIES, south: 49.000001 };
    expect(names(await db.facilitiesInBbox(as(users.olivia), null, justNorth, null))).not.toContain(
      'Synthetic Border Terminal',
    );
    // A box whose south-west corner is the terminal.
    const corner = { west: -97, south: 49, east: -96.999999, north: 49.000001 };
    expect(names(await db.facilitiesInBbox(as(users.olivia), null, corner, null))).toEqual([
      'Synthetic Border Terminal',
    ]);
    expect(names(await db.facilitiesInBbox(as(users.olivia), null, WORLD, null))).toHaveLength(4);
  });

  it('hides one organization’s facilities from another', async () => {
    const bob = await db.facilitiesInBbox(as(users.bob), null, WORLD, null);
    expect(names(bob)).toEqual(['Synthetic B Elevator']);
    expect(bob.withoutCoordinates).toBe(1);

    expect(await db.facilitiesInBbox(as(users.bob), orgs.a, WORLD, null)).toEqual({
      facilities: [],
      withoutCoordinates: 0,
    });
    expect(await db.facilitiesInBbox(as(users.olivia), orgs.b, WORLD, null)).toEqual({
      facilities: [],
      withoutCoordinates: 0,
    });
  });

  it('shows nothing to a suspended member', async () => {
    expect(await db.facilitiesInBbox(as(users.sam), null, WORLD, null)).toEqual({
      facilities: [],
      withoutCoordinates: 0,
    });
  });
});
