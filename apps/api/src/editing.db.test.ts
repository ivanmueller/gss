import { VERSION, type ContactInput, type FacilityInput } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type NewCounterparty, type RequestContext } from './db';

// Integration test of counterparty editing: the real driver, as `app_api`, against the real
// migrations, row level security and triggers. Fixtures are synthetic and removed afterwards.
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
const WORLD = { west: -180, south: -90, east: 180, north: 90 };

const contact = (name: string): ContactInput => ({
  name,
  role: null,
  email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`,
  phone: null,
});

/** A location; with coordinates, approximate unless said otherwise (as the forms parse it). */
const facility = (overrides: Partial<FacilityInput> = {}): FacilityInput => ({
  name: 'Synthetic Elevator',
  facilityType: 'elevator',
  addressLine: '1 Synthetic Road',
  city: 'Synthetic Town',
  region: 'SK',
  postalCode: 'S4P 3Y2',
  country: 'CA',
  latitude: null,
  longitude: null,
  locationPrecision: overrides.latitude ? 'approximate' : null,
  ...overrides,
});

function record(legalName: string, overrides: Partial<NewCounterparty> = {}): NewCounterparty {
  return {
    counterparty: {
      legalName,
      tradingName: null,
      types: ['seller'],
      primaryCountry: 'CA',
      verificationStatus: 'unverified',
      notes: 'Synthetic record.\nSecond line.',
    },
    contacts: [contact('Synthetic Grower')],
    facilities: [facility({ latitude: '52.133214', longitude: '-106.670046' })],
    ...overrides,
  };
}

let db: Database;

async function create(name: string, overrides: Partial<NewCounterparty> = {}): Promise<string> {
  const result = await db.createCounterparty(as(users.olivia), orgs.a, record(name, overrides));
  if (result.status !== 'created') throw new Error(`not created: ${result.status}`);
  return result.id;
}

async function detail(counterpartyId: string) {
  const found = await db.getCounterparty(as(users.olivia), counterpartyId);
  if (!found) throw new Error('counterparty not found');
  return found;
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
  await admin`delete from app.facilities where organization_id in ${both}`;
  await admin`delete from app.counterparty_contacts where organization_id in ${both}`;
  await admin`delete from app.counterparties where organization_id in ${both}`;
  await admin`delete from app.organization_members where organization_id in ${both}`;
  // Deleting the records and memberships above writes audit events too, so the audit trail goes last.
  await admin`delete from app.audit_events where organization_id in ${both}`;
  await admin`delete from app.organizations where id in ${both}`;
  await admin`delete from auth.users where id in ${admin(Object.values(users))}`;
  await admin.end();
});

describe('adding a counterparty by hand as app_api', () => {
  it('creates it with its first contact and location, entered by hand and audited', async () => {
    const ctx = as(users.olivia);
    const result = await db.createCounterparty(ctx, orgs.a, record('Synthetic Hand Grower'));
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;

    const saved = await detail(result.id);
    expect(saved).toMatchObject({
      legalName: 'Synthetic Hand Grower',
      types: ['seller'],
      source: 'manual',
      notes: 'Synthetic record.\nSecond line.',
      archivedAt: null,
      contacts: [{ name: 'Synthetic Grower' }],
      facilities: [{ city: 'Synthetic Town', latitude: '52.133214', geocodingSource: 'manual' }],
    });
    expect(saved.version).toMatch(VERSION);

    const audit = await admin<{ entity: string }[]>`
      select entity from app.audit_events
      where request_id = ${ctx.requestId} and actor_id = ${users.olivia} and action = 'insert'
      order by entity`;
    expect(audit.map((row) => row.entity)).toEqual([
      'counterparties',
      'counterparty_contacts',
      'facilities',
    ]);
  });

  it('refuses a viewer and another organization’s admin', async () => {
    expect(
      await db.createCounterparty(as(users.victor), orgs.a, record('Synthetic Viewer Try')),
    ).toEqual({ status: 'forbidden' });
    expect(
      await db.createCounterparty(as(users.bob), orgs.a, record('Synthetic Intruder')),
    ).toEqual({ status: 'forbidden' });
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.counterparties
      where legal_name in ('Synthetic Viewer Try', 'Synthetic Intruder')`;
    expect(row?.count).toBe(0);
  });

  it('refuses a name already in the list for the country, ignoring case', async () => {
    await create('Synthetic Twin');
    await expect(
      db.createCounterparty(as(users.olivia), orgs.a, record('SYNTHETIC TWIN')),
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'counterparties_name_unique' });
  });
});

describe('editing a counterparty as app_api', () => {
  it('saves new details for the version the user saw, and refuses a stale one', async () => {
    const counterpartyId = await create('Synthetic Editable');
    const before = await detail(counterpartyId);
    const changes = {
      ...record('Synthetic Edited').counterparty,
      types: ['buyer' as const, 'seller' as const],
      verificationStatus: 'verified' as const,
    };

    expect(
      await db.updateCounterparty(as(users.olivia), counterpartyId, before.version, changes),
    ).toEqual({ status: 'saved' });
    const after = await detail(counterpartyId);
    expect(after).toMatchObject({
      legalName: 'Synthetic Edited',
      types: ['buyer', 'seller'],
      verificationStatus: 'verified',
    });
    expect(after.version).not.toBe(before.version);

    // Someone else's edit came in after `before` was read.
    expect(
      await db.updateCounterparty(as(users.olivia), counterpartyId, before.version, changes),
    ).toEqual({ status: 'changed' });
  });

  it('refuses a viewer, and hides the counterparty from another organization', async () => {
    const counterpartyId = await create('Synthetic Guarded');
    const { version } = await detail(counterpartyId);
    const changes = record('Synthetic Hijacked').counterparty;
    expect(await db.updateCounterparty(as(users.victor), counterpartyId, version, changes)).toEqual(
      { status: 'forbidden' },
    );
    expect(await db.updateCounterparty(as(users.bob), counterpartyId, version, changes)).toEqual({
      status: 'not_found',
    });
    expect(await db.setArchived(as(users.bob), counterpartyId, true)).toEqual({
      status: 'not_found',
    });
    expect((await detail(counterpartyId)).legalName).toBe('Synthetic Guarded');
  });

  it('archives and restores, leaving archived ones off the map and out of geocoding', async () => {
    const counterpartyId = await create('Synthetic Archivable', {
      facilities: [
        facility({ name: 'Synthetic Located', latitude: '50.000001', longitude: '-100.000001' }),
        facility({ name: 'Synthetic Unlocated' }),
      ],
    });
    const onMap = async () =>
      (await db.facilitiesInBbox(as(users.olivia), orgs.a, WORLD, null)).facilities.map(
        (item) => item.name,
      );
    const toGeocode = async () =>
      (await db.facilitiesWithoutCoordinates(as(users.olivia), orgs.a, 1000)).map(
        (item) => item.facilityName,
      );
    expect(await onMap()).toContain('Synthetic Located');
    expect(await toGeocode()).toContain('Synthetic Unlocated');

    expect(await db.setArchived(as(users.victor), counterpartyId, true)).toEqual({
      status: 'forbidden',
    });
    expect(await db.setArchived(as(users.olivia), counterpartyId, true)).toEqual({
      status: 'saved',
    });
    const archived = await detail(counterpartyId);
    expect(archived.archivedAt).not.toBeNull();
    expect(await onMap()).not.toContain('Synthetic Located');
    expect(await toGeocode()).not.toContain('Synthetic Unlocated');

    // An archived counterparty is restored before it is changed.
    expect(
      await db.updateCounterparty(
        as(users.olivia),
        counterpartyId,
        archived.version,
        record('Synthetic Archivable').counterparty,
      ),
    ).toEqual({ status: 'archived' });
    expect(await db.addContact(as(users.olivia), counterpartyId, contact('Late Contact'))).toEqual({
      status: 'archived',
    });

    // Archiving again changes nothing and writes no audit event.
    expect(await db.setArchived(as(users.olivia), counterpartyId, true)).toEqual({
      status: 'saved',
    });
    expect(await db.setArchived(as(users.olivia), counterpartyId, false)).toEqual({
      status: 'saved',
    });
    expect((await detail(counterpartyId)).archivedAt).toBeNull();
    expect(await onMap()).toContain('Synthetic Located');
    const [audit] = await admin<{ count: number }[]>`
      select count(*)::int as count from app.audit_events
      where entity_id = ${counterpartyId} and changed_fields = array['archived_at']`;
    expect(audit?.count).toBe(2);
  });
});

describe('contacts and locations as app_api', () => {
  it('adds, corrects and removes a contact, refusing stale versions and other records', async () => {
    const counterpartyId = await create('Synthetic Contacts', { contacts: [] });
    const other = await create('Synthetic Other Contacts');
    const otherContact = (await detail(other)).contacts[0];
    if (!otherContact) throw new Error('fixture has no contact');

    expect(await db.addContact(as(users.olivia), counterpartyId, contact('Synthetic Ana'))).toEqual(
      { status: 'saved' },
    );
    const [added] = (await detail(counterpartyId)).contacts;
    if (!added) throw new Error('contact not added');
    expect(added.version).toMatch(VERSION);

    const fixed = { ...contact('Synthetic Ana'), phone: '+1 306 555 0101' };
    expect(
      await db.updateContact(as(users.olivia), counterpartyId, added.id, added.version, fixed),
    ).toEqual({ status: 'saved' });
    expect((await detail(counterpartyId)).contacts[0]?.phone).toBe('+1 306 555 0101');
    expect(
      await db.updateContact(as(users.olivia), counterpartyId, added.id, added.version, fixed),
    ).toEqual({ status: 'changed' });

    // A contact is changed only under its own counterparty.
    expect(
      await db.updateContact(
        as(users.olivia),
        counterpartyId,
        otherContact.id,
        otherContact.version,
        fixed,
      ),
    ).toEqual({ status: 'not_found' });
    expect(await db.removeContact(as(users.olivia), counterpartyId, otherContact.id)).toEqual({
      status: 'not_found',
    });
    expect(await db.removeContact(as(users.victor), counterpartyId, added.id)).toEqual({
      status: 'forbidden',
    });
    expect(await db.removeContact(as(users.bob), counterpartyId, added.id)).toEqual({
      status: 'not_found',
    });

    expect(await db.removeContact(as(users.olivia), counterpartyId, added.id)).toEqual({
      status: 'saved',
    });
    expect((await detail(counterpartyId)).contacts).toEqual([]);
    expect((await detail(other)).contacts).toHaveLength(1);
  });

  it('keeps the geocoder as the source until the coordinates themselves change', async () => {
    const counterpartyId = await create('Synthetic Locations', { facilities: [facility()] });
    const [unlocated] = (await detail(counterpartyId)).facilities;
    if (!unlocated) throw new Error('fixture has no facility');
    await admin`update app.facilities
      set latitude = 52.133214, longitude = -106.670046, location_precision = 'exact',
          geocoding_source = 'geocodio', geocoding_accuracy = 'rooftop', geocoding_confidence = 0.97
      where id = ${unlocated.id}`;

    const current = async () => {
      const [item] = (await detail(counterpartyId)).facilities;
      if (!item) throw new Error('facility missing');
      return item;
    };
    const located = await current();
    const sameSpot = facility({
      name: 'Synthetic Renamed Elevator',
      latitude: '52.133214',
      longitude: '-106.670046',
      locationPrecision: 'exact',
    });
    expect(
      await db.updateFacility(
        as(users.olivia),
        counterpartyId,
        located.id,
        located.version,
        sameSpot,
      ),
    ).toEqual({ status: 'saved' });
    const renamed = await current();
    expect(renamed).toMatchObject({
      name: 'Synthetic Renamed Elevator',
      geocodingSource: 'geocodio',
    });
    const [kept] = await admin<{ accuracy: string }[]>`
      select geocoding_accuracy as accuracy from app.facilities where id = ${located.id}`;
    expect(kept?.accuracy).toBe('rooftop');

    const moved = { ...sameSpot, latitude: '50.445211', longitude: '-104.618894' };
    expect(
      await db.updateFacility(as(users.olivia), counterpartyId, renamed.id, renamed.version, moved),
    ).toEqual({ status: 'saved' });
    const corrected = await current();
    expect(corrected).toMatchObject({ latitude: '50.445211', geocodingSource: 'manual' });
    const [cleared] = await admin<{ accuracy: string | null; confidence: string | null }[]>`
      select geocoding_accuracy as accuracy, geocoding_confidence::text as confidence
      from app.facilities where id = ${located.id}`;
    expect(cleared).toEqual({ accuracy: null, confidence: null });

    const noCoordinates = { ...moved, latitude: null, longitude: null, locationPrecision: null };
    expect(
      await db.updateFacility(
        as(users.olivia),
        counterpartyId,
        corrected.id,
        corrected.version,
        noCoordinates,
      ),
    ).toEqual({ status: 'saved' });
    expect(await current()).toMatchObject({ latitude: null, geocodingSource: null });
    expect(
      await db.updateFacility(
        as(users.olivia),
        counterpartyId,
        corrected.id,
        corrected.version,
        moved,
      ),
    ).toEqual({ status: 'changed' });
  });

  it('adds and removes a location for editors of the organization only', async () => {
    const counterpartyId = await create('Synthetic Removals', { facilities: [] });
    const extra = facility({ name: 'Synthetic Annex', latitude: '49.1', longitude: '-98.2' });
    expect(await db.addFacility(as(users.victor), counterpartyId, extra)).toEqual({
      status: 'forbidden',
    });
    expect(await db.addFacility(as(users.bob), counterpartyId, extra)).toEqual({
      status: 'not_found',
    });
    expect(await db.addFacility(as(users.olivia), counterpartyId, extra)).toEqual({
      status: 'saved',
    });
    const [added] = (await detail(counterpartyId)).facilities;
    expect(added).toMatchObject({ name: 'Synthetic Annex', geocodingSource: 'manual' });
    if (!added) return;

    expect(await db.removeFacility(as(users.bob), counterpartyId, added.id)).toEqual({
      status: 'not_found',
    });
    expect(await db.removeFacility(as(users.olivia), counterpartyId, added.id)).toEqual({
      status: 'saved',
    });
    expect(await db.removeFacility(as(users.olivia), counterpartyId, added.id)).toEqual({
      status: 'not_found',
    });
    expect((await detail(counterpartyId)).facilities).toEqual([]);
  });
});

describe('archiving while something under the counterparty is being changed', () => {
  // Waits until a query of the API's connection is waiting for a lock.
  async function untilWaitingForLock() {
    const watcher = postgres(ADMIN_URL ?? '', { max: 1, onnotice: () => undefined });
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [row] = await watcher<{ waiting: number }[]>`
          select count(*)::int as waiting from pg_stat_activity
          where usename = 'app_api' and wait_event_type = 'Lock'`;
        if ((row?.waiting ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('the change never waited for the lock');
    } finally {
      await watcher.end();
    }
  }

  it('never lets a change land on a counterparty archived in the meantime', async () => {
    const counterpartyId = await create('Synthetic Race');
    const [first] = (await detail(counterpartyId)).contacts;
    if (!first) throw new Error('fixture has no contact');

    // Another session holds the counterparty while the contact edit starts, then archives
    // it and commits. The edit must then see it archived, not save over it.
    let pending: Promise<unknown> = Promise.resolve();
    await admin.begin(async (tx) => {
      await tx`select 1 from app.counterparties where id = ${counterpartyId} for update`;
      pending = db.updateContact(as(users.olivia), counterpartyId, first.id, first.version, {
        ...contact('Synthetic Grower'),
        phone: '+1 306 555 0199',
      });
      await untilWaitingForLock();
      await tx`update app.counterparties set archived_at = now() where id = ${counterpartyId}`;
    });

    expect(await pending).toEqual({ status: 'archived' });
    const [row] = await admin<{ phone: string | null }[]>`
      select phone from app.counterparty_contacts where id = ${first.id}`;
    expect(row?.phone).toBeNull();
  });
});

describe('the map by counterparty type', () => {
  it('shows only the locations of counterparties with the chosen type', async () => {
    await create('Synthetic Map Seller', {
      facilities: [
        facility({ name: 'Synthetic Seller Bin', latitude: '51.1', longitude: '-101.1' }),
      ],
    });
    await create('Synthetic Map Buyer', {
      counterparty: { ...record('Synthetic Map Buyer').counterparty, types: ['buyer'] },
      facilities: [
        facility({ name: 'Synthetic Buyer Plant', latitude: '51.2', longitude: '-101.2' }),
        facility({ name: 'Synthetic Buyer Office' }),
      ],
    });
    const names = async (type: 'buyer' | 'seller') => {
      const result = await db.facilitiesInBbox(as(users.olivia), orgs.a, WORLD, type);
      return {
        names: result.facilities.map((item) => item.name),
        missing: result.withoutCoordinates,
      };
    };
    const sellers = await names('seller');
    const buyers = await names('buyer');
    expect(sellers.names).toContain('Synthetic Seller Bin');
    expect(sellers.names).not.toContain('Synthetic Buyer Plant');
    expect(buyers.names).toContain('Synthetic Buyer Plant');
    expect(buyers.names).not.toContain('Synthetic Seller Bin');
    // The office is the only buyer location in these fixtures without coordinates.
    expect(buyers.missing).toBe(1);
  });
});
