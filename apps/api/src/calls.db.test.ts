import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CallEvent } from './call-steps';
import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of calls placed through Telnyx: the real driver, as `app_api`, against the
// real migrations, row level security and triggers. Telnyx itself is not called; its events
// are given as the webhook would pass them. Fixtures are synthetic (555 numbers).
//
// Calls, their events and contact log entries are never deleted, so this test's records stay
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
const users = { tess: id(), olga: id(), victor: id(), bob: id() };
const orgs = { a: id(), b: id() };
const counterparties = { buyer: id(), archived: id(), other: id() };
const contacts = { pat: id(), ext: id(), none: id(), other: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });
const FROM = '+18255550199';

let db: Database;

function event(type: string, leg: 'you' | 'them', extra: Partial<CallEvent> = {}): CallEvent {
  return {
    type,
    leg,
    occurredAt: new Date().toISOString(),
    callControlId: leg === 'you' ? 'v3:synthetic-staff' : 'v3:synthetic-them',
    digits: null,
    gatherStatus: null,
    hangupCause: null,
    ...extra,
  };
}

beforeAll(async () => {
  const names = {
    tess: { first_name: 'Tess', last_name: 'Trader' },
    olga: { first_name: 'Olga' },
    victor: { first_name: 'Victor' },
    bob: { first_name: 'Bob' },
  };
  for (const [name, userId] of Object.entries(users)) {
    await admin`insert into auth.users (id, email, raw_user_meta_data)
      values (${userId}, ${`${name}-${userId}@example.test`},
              ${JSON.stringify(names[name as keyof typeof users])}::text::jsonb)`;
  }
  await admin`insert into app.organizations (id, display_name) values
    (${orgs.a}, ${`Synthetic Org A ${orgs.a}`}), (${orgs.b}, ${`Synthetic Org B ${orgs.b}`})`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.tess}, 'trader', 'active', now()),
    (${orgs.a}, ${users.olga}, 'operations', 'active', now()),
    (${orgs.a}, ${users.victor}, 'viewer', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at, phone) values
    (${counterparties.buyer}, ${orgs.a}, 'Synthetic Buyer', '{buyer}', 'CA', 'manual', ${users.tess}, null, '(403) 555-0110'),
    (${counterparties.archived}, ${orgs.a}, 'Synthetic Old Buyer', '{buyer}', 'CA', 'manual', ${users.tess}, now(), '(403) 555-0111'),
    (${counterparties.other}, ${orgs.b}, 'Synthetic Other', '{buyer}', 'US', 'manual', ${users.bob}, null, '(406) 555-0112')`;
  await admin`insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, phone, created_by) values
    (${contacts.pat}, ${orgs.a}, ${counterparties.buyer}, 'Pat Buyer', '(403) 555-0100', ${users.tess}),
    (${contacts.ext}, ${orgs.a}, ${counterparties.buyer}, 'Ext Person', '(403) 555-0101 x12', ${users.tess}),
    (${contacts.none}, ${orgs.a}, ${counterparties.buyer}, 'No Phone', null, ${users.tess}),
    (${contacts.other}, ${orgs.b}, ${counterparties.other}, 'Other Person', '(406) 555-0102', ${users.bob})`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe("a member's own cell phone", () => {
  it('is saved, changed and read by its owner only', async () => {
    expect(await db.getMemberPhone(as(users.tess), orgs.a)).toBeNull();
    expect(await db.saveMemberPhone(as(users.tess), orgs.a, '+14035550142')).toBe('saved');
    expect(await db.saveMemberPhone(as(users.tess), orgs.a, '+14035550143')).toBe('saved');
    expect(await db.getMemberPhone(as(users.tess), orgs.a)).toBe('+14035550143');
    expect(await db.getMemberPhone(as(users.olga), orgs.a)).toBeNull();
    expect(await db.saveMemberPhone(as(users.bob), orgs.a, '+14065550144')).toBe('forbidden');
  });

  it('is removed by its owner', async () => {
    expect(await db.saveMemberPhone(as(users.olga), orgs.a, '+14035550145')).toBe('saved');
    expect(await db.saveMemberPhone(as(users.olga), orgs.a, null)).toBe('saved');
    expect(await db.getMemberPhone(as(users.olga), orgs.a)).toBeNull();
  });
});

describe('placing a call', () => {
  it("needs the caller's cell, a number it can dial and a counterparty they may call", async () => {
    expect(await db.placeCall(as(users.olga), counterparties.buyer, contacts.pat, FROM)).toEqual({
      status: 'no_cell',
    });
    expect(await db.placeCall(as(users.tess), counterparties.buyer, contacts.ext, FROM)).toEqual({
      status: 'not_dialable',
    });
    expect(await db.placeCall(as(users.tess), counterparties.buyer, contacts.none, FROM)).toEqual({
      status: 'no_number',
    });
    expect(await db.placeCall(as(users.tess), counterparties.archived, null, FROM)).toEqual({
      status: 'archived',
    });
    expect(await db.placeCall(as(users.victor), counterparties.buyer, null, FROM)).toEqual({
      status: 'forbidden',
    });
    expect(await db.placeCall(as(users.tess), counterparties.other, null, FROM)).toEqual({
      status: 'not_found',
    });
    expect(await db.placeCall(as(users.tess), counterparties.buyer, contacts.other, FROM)).toEqual({
      status: 'not_found',
    });
    expect(await db.placeCall(as(users.bob), counterparties.buyer, null, FROM)).toEqual({
      status: 'not_found',
    });
  });
});

describe('a call from start to finish', () => {
  let callId = '';

  it("starts by calling the caller's cell, one call at a time", async () => {
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    expect(placed).toMatchObject({
      status: 'created',
      staffPhone: '+14035550143',
      counterpartyPhone: '+14035550100',
    });
    if (placed.status !== 'created') throw new Error('not placed');
    callId = placed.callId;
    expect(await db.placeCall(as(users.tess), counterparties.buyer, null, FROM)).toEqual({
      status: 'in_progress',
    });
    await db.recordLeg(as(users.tess), callId, 'you', 'v3:synthetic-staff');
    expect(await db.getCall(as(users.victor), callId)).toMatchObject({
      contactName: 'Pat Buyer',
      status: 'calling_you',
      outcome: null,
    });
    expect(await db.getCall(as(users.bob), callId)).toBeNull();
    expect(await db.callPlacer(callId)).toEqual({ organizationId: orgs.a, placedBy: users.tess });
  });

  it("follows Telnyx's events, each applied once", async () => {
    const answered = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-1`,
      event('call.answered', 'you'),
    );
    expect(answered).toMatchObject({
      status: 'applied',
      step: { commands: [{ kind: 'confirm', callControlId: 'v3:synthetic-staff' }] },
    });
    expect(
      await db.applyCallEvent(
        as(users.tess),
        callId,
        `evt-${callId}-1`,
        event('call.answered', 'you'),
      ),
    ).toEqual({ status: 'duplicate' });
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
    );
    expect(pressed).toMatchObject({ step: { commands: [{ kind: 'dial_them' }] } });
    expect(await db.callNumber(as(users.tess), callId)).toBe('+14035550100');
    await db.recordLeg(as(users.tess), callId, 'them', 'v3:synthetic-them');
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-3`,
      event('call.answered', 'them'),
    );
    expect(await db.getCall(as(users.tess), callId)).toMatchObject({ status: 'connected' });
  });

  it("writes a call that connected to the contact log in the caller's name", async () => {
    const ended = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-4`,
      event('call.hangup', 'them', { hangupCause: 'normal_clearing' }),
    );
    expect(ended).toMatchObject({
      step: { commands: [{ kind: 'hang_up', callControlId: 'v3:synthetic-staff' }] },
    });
    const call = await db.getCall(as(users.victor), callId);
    expect(call).toMatchObject({ status: 'ended', outcome: 'talked' });
    expect(call?.contactLogEntryId).not.toBeNull();
    const log = await db.listContactLog(as(users.victor), counterparties.buyer);
    const entry = log.find((e) => e.id === call?.contactLogEntryId);
    expect(entry?.current).toMatchObject({
      channel: 'call',
      contactName: 'Pat Buyer',
      recordedByName: 'Tess Trader',
    });
    expect(entry?.current.notes).toMatch(/^Phone call placed from the platform; talked \d+ s\.$/);
    expect(entry?.current.occurredAt).toBe(call?.connectedAt);

    // The caller's own hangup arriving afterwards changes nothing and logs nothing more.
    const late = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-5`,
      event('call.hangup', 'you', { hangupCause: 'normal_clearing' }),
    );
    expect(late).toMatchObject({ status: 'applied', step: { changes: {}, commands: [] } });
    const after = await db.listContactLog(as(users.victor), counterparties.buyer);
    expect(after.filter((e) => e.current.notes?.startsWith('Phone call placed'))).toHaveLength(1);
  });

  it('lets nobody else apply events to it', async () => {
    await expect(
      db.applyCallEvent(as(users.olga), callId, `evt-${callId}-6`, event('call.hangup', 'you')),
    ).resolves.toEqual({ status: 'not_found' });
  });
});

describe('a call that does not connect', () => {
  it('ends without a contact log entry when 1 is not pressed', async () => {
    await admin`update app.calls set status = 'ended', outcome = 'failed', ended_at = now()
                where placed_by = ${users.tess} and status <> 'ended'`;
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, null, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    await db.applyCallEvent(
      as(users.tess),
      placed.callId,
      `evt-${placed.callId}-1`,
      event('call.answered', 'you'),
    );
    const step = await db.applyCallEvent(
      as(users.tess),
      placed.callId,
      `evt-${placed.callId}-2`,
      event('call.gather.ended', 'you', { gatherStatus: 'timeout' }),
    );
    expect(step).toMatchObject({ step: { changes: { outcome: 'not_confirmed' } } });
    expect(await db.getCall(as(users.tess), placed.callId)).toMatchObject({
      status: 'ended',
      outcome: 'not_confirmed',
      contactLogEntryId: null,
    });
  });

  it('is ended as failed when Telnyx refuses a command, once', async () => {
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, null, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    await db.failCall(as(users.tess), placed.callId, 'failed');
    await db.failCall(as(users.tess), placed.callId, 'cancelled');
    expect(await db.getCall(as(users.tess), placed.callId)).toMatchObject({
      status: 'ended',
      outcome: 'failed',
    });
  });

  it('logs nothing when the caller may no longer log contacts', async () => {
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, null, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    const ctx = as(users.tess);
    await db.applyCallEvent(
      ctx,
      placed.callId,
      `evt-${placed.callId}-1`,
      event('call.answered', 'you'),
    );
    await db.applyCallEvent(
      ctx,
      placed.callId,
      `evt-${placed.callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
    );
    await db.applyCallEvent(
      ctx,
      placed.callId,
      `evt-${placed.callId}-3`,
      event('call.answered', 'them'),
    );
    await admin`update app.organization_members set role = 'viewer'
                where organization_id = ${orgs.a} and user_id = ${users.tess}`;
    try {
      await db.applyCallEvent(
        ctx,
        placed.callId,
        `evt-${placed.callId}-4`,
        event('call.hangup', 'you', { hangupCause: 'normal_clearing' }),
      );
      expect(await db.getCall(ctx, placed.callId)).toMatchObject({
        status: 'ended',
        outcome: 'talked',
        contactLogEntryId: null,
      });
    } finally {
      await admin`update app.organization_members set role = 'trader'
                  where organization_id = ${orgs.a} and user_id = ${users.tess}`;
    }
  });
});

describe('two clicks at the same moment', () => {
  it('place one call only', async () => {
    await admin`update app.calls set status = 'ended', outcome = 'failed', ended_at = now()
                where placed_by = ${users.tess} and status <> 'ended'`;
    const second = postgresDatabase(API_URL);
    try {
      const results = await Promise.all([
        db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM),
        second.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(['created', 'in_progress']);
    } finally {
      await second.close();
    }
  });
});
