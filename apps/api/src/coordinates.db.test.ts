import { VERSION, type SignedMatch } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of saving geocoded coordinates: the real driver, as `app_api`, against
// the real migrations, row level security and audit trigger. Fixtures are synthetic and
// removed afterwards. Signatures are checked by the route, not the database, so any value
// stands in for one here.
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
const counterparties = { a: id(), b: id() };
const facilities = { street: id(), town: id(), located: id(), other: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

/** The facility's version now, as the lookup would have signed it. */
async function versionOf(facilityId: string): Promise<string> {
  const [row] = await admin<{ version: string }[]>`
    select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as version
    from app.facilities where id = ${facilityId}`;
  if (!row) throw new Error('no such facility');
  return row.version;
}

async function match(facilityId: string, facilityVersion?: string): Promise<SignedMatch> {
  return {
    facilityId,
    latitude: '52.133214',
    longitude: '-106.670046',
    precision: 'exact',
    accuracyType: 'rooftop',
    confidence: '0.97',
    facilityVersion: facilityVersion ?? (await versionOf(facilityId)),
    expiresAt: '2026-10-27T19:00:00.000Z',
    signature: '0'.repeat(64),
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
  await admin`insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
    (${counterparties.a}, ${orgs.a}, 'Synthetic Prairie Mills', 'CA', 'manual', ${users.olivia}),
    (${counterparties.b}, ${orgs.b}, 'Synthetic B Buyer', 'CA', 'manual', ${users.bob})`;
  await admin`insert into app.facilities
    (id, organization_id, counterparty_id, name, address_line, city, region, postal_code, country,
     latitude, longitude, location_precision, created_by) values
    (${facilities.street}, ${orgs.a}, ${counterparties.a}, 'Synthetic Elevator', '1 Synthetic Road',
     'Synthetic Town', 'SK', 'S4P 3Y2', 'CA', null, null, null, ${users.olivia}),
    (${facilities.town}, ${orgs.a}, ${counterparties.a}, 'Synthetic Terminal', null,
     'Synthetic City', 'MB', null, 'CA', null, null, null, ${users.olivia}),
    (${facilities.located}, ${orgs.a}, ${counterparties.a}, 'Synthetic Warehouse', null,
     'Synthetic Village', 'AB', null, 'CA', 53.5, -113.5, 'approximate', ${users.olivia}),
    (${facilities.other}, ${orgs.b}, ${counterparties.b}, 'Synthetic B Elevator', null,
     'Synthetic Hamlet', 'MB', null, 'CA', null, null, null, ${users.bob})`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  const both = admin([orgs.a, orgs.b]);
  await admin`delete from app.facilities where organization_id in ${both}`;
  await admin`delete from app.counterparties where organization_id in ${both}`;
  // Deleting the records above writes audit events too, so the audit trail goes last.
  await admin`delete from app.audit_events where organization_id in ${both}`;
  await admin`delete from app.organization_members where organization_id in ${both}`;
  await admin`delete from app.organizations where id in ${both}`;
  await admin`delete from auth.users where id in ${admin(Object.values(users))}`;
  await admin.end();
});

async function location(facilityId: string) {
  const [row] = await admin<
    {
      latitude: string | null;
      precision: string | null;
      source: string | null;
      accuracy: string | null;
      confidence: string | null;
    }[]
  >`
    select latitude::text as latitude, location_precision::text as precision,
           geocoding_source as source, geocoding_accuracy as accuracy,
           geocoding_confidence::text as confidence
    from app.facilities where id = ${facilityId}`;
  return row;
}

describe('geocoding as app_api', () => {
  it('lists the organization’s facilities without coordinates, with their addresses', async () => {
    expect(await db.facilitiesWithoutCoordinates(as(users.victor), orgs.a, 10)).toEqual([
      {
        facilityId: facilities.street,
        counterpartyId: counterparties.a,
        legalName: 'Synthetic Prairie Mills',
        facilityName: 'Synthetic Elevator',
        addressLine: '1 Synthetic Road',
        city: 'Synthetic Town',
        region: 'SK',
        postalCode: 'S4P 3Y2',
        country: 'CA',
        version: expect.stringMatching(VERSION) as unknown,
      },
      expect.objectContaining({ facilityId: facilities.town, city: 'Synthetic City' }),
    ]);
    expect(await db.facilitiesWithoutCoordinates(as(users.victor), orgs.a, 0)).toHaveLength(1);
    expect(await db.facilitiesWithoutCoordinates(as(users.bob), orgs.a, 10)).toEqual([]);
  });

  it('saves nothing for a viewer', async () => {
    expect(
      await db.saveCoordinates(as(users.victor), orgs.a, [await match(facilities.street)]),
    ).toEqual([]);
    expect((await location(facilities.street))?.latitude).toBeNull();
  });

  it('saves for an editor only facilities of the organization that have no coordinates', async () => {
    const ctx = as(users.olivia);
    const saved = await db.saveCoordinates(ctx, orgs.a, [
      await match(facilities.street),
      await match(facilities.located),
      await match(facilities.other),
    ]);

    expect(saved).toEqual([facilities.street]);
    expect(await location(facilities.street)).toEqual({
      latitude: '52.133214',
      precision: 'exact',
      source: 'geocodio',
      accuracy: 'rooftop',
      confidence: '0.97',
    });
    expect(await location(facilities.located)).toMatchObject({
      latitude: '53.500000',
      precision: 'approximate',
      source: null,
    });
    expect((await location(facilities.other))?.latitude).toBeNull();

    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.audit_events
      where request_id = ${ctx.requestId} and actor_id = ${users.olivia}
        and entity_id = ${facilities.street} and action = 'update'`;
    expect(audit?.count).toBe(1);
  });

  it('does not save another organization’s facility even when asked under its id', async () => {
    expect(
      await db.saveCoordinates(as(users.olivia), orgs.b, [await match(facilities.other)]),
    ).toEqual([]);
    expect((await location(facilities.other))?.latitude).toBeNull();
  });

  it('shows the saved point on the map', async () => {
    const view = { west: -110, south: 49, east: -95, north: 60 };
    const result = await db.facilitiesInBbox(as(users.victor), orgs.a, view, null);
    expect(result.facilities.map((f) => [f.name, f.locationPrecision])).toEqual([
      ['Synthetic Elevator', 'exact'],
    ]);
    expect(result.withoutCoordinates).toBe(1);
  });

  it('does not save a match for an address that was corrected after the lookup', async () => {
    const lookedUp = await versionOf(facilities.town);
    await admin`update app.facilities set address_line = '999 Different Synthetic Road'
                where id = ${facilities.town}`;
    expect(
      await db.saveCoordinates(as(users.olivia), orgs.a, [await match(facilities.town, lookedUp)]),
    ).toEqual([]);
    expect((await location(facilities.town))?.latitude).toBeNull();

    // Looked up again, the corrected address is saved.
    expect(
      await db.saveCoordinates(as(users.olivia), orgs.a, [await match(facilities.town)]),
    ).toEqual([facilities.town]);
  });

  it('does not save for a facility whose counterparty is archived', async () => {
    const late = id();
    await admin`insert into app.facilities
      (id, organization_id, counterparty_id, city, region, country, created_by)
      values (${late}, ${orgs.a}, ${counterparties.a}, 'Synthetic Late Town', 'SK', 'CA', ${users.olivia})`;
    await admin`update app.counterparties set archived_at = now() where id = ${counterparties.a}`;
    try {
      expect(await db.saveCoordinates(as(users.olivia), orgs.a, [await match(late)])).toEqual([]);
      expect((await location(late))?.latitude).toBeNull();
    } finally {
      await admin`update app.counterparties set archived_at = null where id = ${counterparties.a}`;
    }
  });
});
