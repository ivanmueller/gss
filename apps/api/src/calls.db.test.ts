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
      commands: [{ kind: 'confirm', callControlId: 'v3:synthetic-staff' }],
    });
    if (answered.status !== 'applied') throw new Error('not applied');
    const confirm = answered.commands[0]?.id ?? '';
    // Delivered again before the command went out: the command is still to send.
    expect(
      await db.applyCallEvent(
        as(users.tess),
        callId,
        `evt-${callId}-1`,
        event('call.answered', 'you'),
      ),
    ).toEqual({ status: 'duplicate', commands: answered.commands });
    expect(await db.claimCommand(as(users.tess), callId, confirm)).toMatchObject({
      status: 'claimed',
      command: { kind: 'confirm', attempt: 1 },
    });
    // Claimed by one delivery, another delivery meanwhile is told to come again.
    expect(await db.claimCommand(as(users.tess), callId, confirm)).toEqual({ status: 'busy' });
    // Telnyx could not be reached: pending again, sent with the event's next delivery.
    await db.finishCommand(as(users.tess), callId, confirm, 1, { kind: 'retry' });
    expect(
      await db.applyCallEvent(
        as(users.tess),
        callId,
        `evt-${callId}-1`,
        event('call.answered', 'you'),
      ),
    ).toEqual({ status: 'duplicate', commands: answered.commands });
    expect(await db.claimCommand(as(users.tess), callId, confirm)).toMatchObject({
      status: 'claimed',
      command: { attempt: 2 },
    });
    expect(await db.finishCommand(as(users.tess), callId, confirm, 2, { kind: 'done' })).toEqual({
      followUp: null,
    });
    expect(
      await db.applyCallEvent(
        as(users.tess),
        callId,
        `evt-${callId}-1`,
        event('call.answered', 'you'),
      ),
    ).toEqual({ status: 'duplicate', commands: [] });
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
    );
    expect(pressed).toMatchObject({
      commands: [{ kind: 'dial_them', callControlId: 'v3:synthetic-staff' }],
    });
    if (pressed.status !== 'applied') throw new Error('not applied');
    const dial = pressed.commands[0]?.id ?? '';
    expect(await db.claimCommand(as(users.tess), callId, dial)).toMatchObject({
      status: 'claimed',
      command: { kind: 'dial_them', counterpartyPhone: '+14035550100', attempt: 1 },
    });
    expect(
      await db.finishCommand(as(users.tess), callId, dial, 1, {
        kind: 'done',
        legId: 'v3:synthetic-them',
      }),
    ).toEqual({ followUp: null });
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
      commands: [{ kind: 'hang_up', callControlId: 'v3:synthetic-staff' }],
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
    expect(late).toEqual({ status: 'applied', commands: [] });
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
    expect(step).toMatchObject({ commands: [{ kind: 'hang_up' }] });
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

/** Ends tess's calls under way, so that the next test can place one. */
async function endTessCalls() {
  await admin`update app.calls
              set status = 'ended', ended_at = now(),
                  outcome = case when connected_at is null then 'failed' else 'talked' end::app.call_outcome
              where placed_by = ${users.tess} and status <> 'ended'`;
}

/** A call by tess to Pat with the given events applied in order; returns its id. */
async function callWith(events: [string, CallEvent][]): Promise<string> {
  await endTessCalls();
  const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
  if (placed.status !== 'created') throw new Error('not placed');
  for (const [suffix, e] of events) {
    await db.applyCallEvent(as(users.tess), placed.callId, `evt-${placed.callId}-${suffix}`, e);
  }
  return placed.callId;
}

describe("Codex's review of ivanmueller/gss#107", () => {
  // Times relative to one moment, so the same minute gives the same instant.
  const base = Date.now();
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();

  it('never sends a dial queued before the caller hung up (finding 2)', async () => {
    const callId = await callWith([['1', event('call.answered', 'you', { occurredAt: at(-3) })]]);
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid', occurredAt: at(-2) }),
    );
    if (pressed.status !== 'applied') throw new Error('not applied');
    const dial = pressed.commands[0]?.id ?? '';
    // The caller hangs up before the dial is sent.
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-3`,
      event('call.hangup', 'you', { hangupCause: 'normal_clearing', occurredAt: at(-1) }),
    );
    expect(await db.getCall(as(users.tess), callId)).toMatchObject({ outcome: 'cancelled' });
    expect(await db.claimCommand(as(users.tess), callId, dial)).toEqual({ status: 'skipped' });
    const [row] = await admin<{ status: string }[]>`
      select status from app.call_commands where id = ${dial}`;
    expect(row?.status).toBe('cancelled');
  });

  it('hangs up the leg of a dial that was in flight when the call ended (finding 2)', async () => {
    const callId = await callWith([['1', event('call.answered', 'you', { occurredAt: at(-3) })]]);
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid', occurredAt: at(-2) }),
    );
    if (pressed.status !== 'applied') throw new Error('not applied');
    const dial = pressed.commands[0]?.id ?? '';
    expect(await db.claimCommand(as(users.tess), callId, dial)).toMatchObject({
      status: 'claimed',
    });
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-3`,
      event('call.hangup', 'you', { hangupCause: 'normal_clearing', occurredAt: at(-1) }),
    );
    expect(
      await db.finishCommand(as(users.tess), callId, dial, 1, {
        kind: 'done',
        legId: 'v3:late-leg',
      }),
    ).toMatchObject({ followUp: { kind: 'hang_up', callControlId: 'v3:late-leg' } });
  });

  it('keeps a conversation whose answer arrives after its hangup (finding 3)', async () => {
    const callId = await callWith([
      ['1', event('call.answered', 'you', { occurredAt: at(-8) })],
      [
        '2',
        event('call.gather.ended', 'you', {
          digits: '1',
          gatherStatus: 'valid',
          occurredAt: at(-7),
        }),
      ],
      // T2, the hangup, delivered before T1, the answer.
      ['3', event('call.hangup', 'them', { hangupCause: 'normal_clearing', occurredAt: at(-1) })],
    ]);
    expect(await db.getCall(as(users.tess), callId)).toMatchObject({
      outcome: 'no_answer',
      contactLogEntryId: null,
    });
    const late = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-4`,
      event('call.answered', 'them', { occurredAt: at(-6) }),
    );
    expect(late).toMatchObject({ status: 'applied', commands: [{ kind: 'hang_up' }] });
    const call = await db.getCall(as(users.victor), callId);
    expect(call).toMatchObject({ status: 'ended', outcome: 'talked', connectedAt: at(-6) });
    expect(call?.contactLogEntryId).not.toBeNull();
    const log = await db.listContactLog(as(users.victor), counterparties.buyer);
    expect(log.find((e) => e.id === call?.contactLogEntryId)?.current.notes).toBe(
      'Phone call placed from the platform; talked 5 min 0 s.',
    );
  });

  it('blocks a new call while one is still connected, however long (finding 4)', async () => {
    await endTessCalls();
    // A connected call placed 16 minutes ago (placed as tess, by the table owner).
    await admin.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.tess}, true)`;
      const [row] = await tx<{ id: string }[]>`
        insert into app.calls (organization_id, counterparty_id, contact_id, contact_name, placed_by,
                               placed_by_name, from_phone, counterparty_phone, created_at)
        values (${orgs.a}, ${counterparties.buyer}, ${contacts.pat}, 'Pat Buyer', ${users.tess},
                'x', ${FROM}, '+14035550100', now() - interval '16 minutes')
        returning id`;
      await tx`update app.calls set status = 'connected', connected_at = now() - interval '15 minutes'
               where id = ${row?.id ?? ''}`;
    });
    expect(await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM)).toEqual({
      status: 'in_progress',
    });
    // One still ringing after 16 minutes is treated as over (its legs rang 30 and 45 s).
    await endTessCalls();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.tess}, true)`;
      await tx`
        insert into app.calls (organization_id, counterparty_id, contact_id, contact_name, placed_by,
                               placed_by_name, from_phone, counterparty_phone, created_at)
        values (${orgs.a}, ${counterparties.buyer}, ${contacts.pat}, 'Pat Buyer', ${users.tess},
                'x', ${FROM}, '+14035550100', now() - interval '16 minutes')`;
    });
    expect(
      await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM),
    ).toMatchObject({
      status: 'created',
    });
  });
});

describe("Codex's re-review of ivanmueller/gss#108", () => {
  const base = Date.now();
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();

  /** A call waiting for its dial to them, with the dial command's id. */
  async function dialing(): Promise<{ callId: string; dial: string; event: string }> {
    const callId = await callWith([['1', event('call.answered', 'you', { occurredAt: at(-3) })]]);
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid', occurredAt: at(-2) }),
    );
    if (pressed.status !== 'applied') throw new Error('not applied');
    return { callId, dial: pressed.commands[0]?.id ?? '', event: `evt-${callId}-2` };
  }

  it('lets only the latest claim finish a command; an older one changes nothing (finding 1)', async () => {
    const { callId, dial } = await dialing();
    expect(await db.claimCommand(as(users.tess), callId, dial)).toMatchObject({
      command: { attempt: 1 },
    });
    // The first claim lapses (its Worker stalled); a later delivery claims it again.
    await admin`update app.call_commands set claimed_at = now() - interval '2 minutes'
                where id = ${dial}`;
    expect(await db.claimCommand(as(users.tess), callId, dial)).toMatchObject({
      command: { attempt: 2 },
    });
    // Both dials reach Telnyx, which answers both with the same leg.
    const done = { kind: 'done', legId: 'v3:same-leg' } as const;
    expect(await db.finishCommand(as(users.tess), callId, dial, 2, done)).toEqual({
      followUp: null,
    });
    expect(await db.finishCommand(as(users.tess), callId, dial, 1, done)).toEqual({
      followUp: null,
    });
    expect(await db.finishCommand(as(users.tess), callId, dial, 1, { kind: 'failed' })).toEqual({
      followUp: null,
    });
    expect(await db.getCall(as(users.tess), callId)).toMatchObject({ status: 'calling_them' });
    const [row] = await admin<{ status: string; counterparty_call_control_id: string }[]>`
      select m.status, c.counterparty_call_control_id
      from app.call_commands m join app.calls c on c.id = m.call_id where m.id = ${dial}`;
    expect(row).toEqual({ status: 'done', counterparty_call_control_id: 'v3:same-leg' });
  });

  it('hangs up a second, different leg of the same dial', async () => {
    const { callId, dial } = await dialing();
    await db.claimCommand(as(users.tess), callId, dial);
    await db.finishCommand(as(users.tess), callId, dial, 1, { kind: 'done', legId: 'v3:first' });
    expect(
      await db.finishCommand(as(users.tess), callId, dial, 1, { kind: 'done', legId: 'v3:second' }),
    ).toMatchObject({ followUp: { kind: 'hang_up', callControlId: 'v3:second' } });
  });

  it('keeps a delivery retryable while a claim is unresolved (finding 2)', async () => {
    const { callId, dial, event: eventId } = await dialing();
    await db.claimCommand(as(users.tess), callId, dial);
    // The Worker that claimed it dies before sending; Telnyx delivers the event again.
    const again = await db.applyCallEvent(
      as(users.tess),
      callId,
      eventId,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid', occurredAt: at(-2) }),
    );
    expect(again).toMatchObject({ status: 'duplicate', commands: [{ id: dial }] });
    expect(await db.claimCommand(as(users.tess), callId, dial)).toEqual({ status: 'busy' });
    // Once the claim has lapsed, a delivery takes it over.
    await admin`update app.call_commands set claimed_at = now() - interval '2 minutes'
                where id = ${dial}`;
    expect(await db.claimCommand(as(users.tess), callId, dial)).toMatchObject({
      status: 'claimed',
      command: { attempt: 2 },
    });
  });

  it('keeps a cleanup hang-up as a command, sent again on the next delivery (finding 3)', async () => {
    const { callId, dial, event: eventId } = await dialing();
    await db.claimCommand(as(users.tess), callId, dial);
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-3`,
      event('call.hangup', 'you', { hangupCause: 'normal_clearing', occurredAt: at(-1) }),
    );
    const finished = await db.finishCommand(as(users.tess), callId, dial, 1, {
      kind: 'done',
      legId: 'v3:orphan',
    });
    const cleanup = finished.followUp;
    expect(cleanup).toMatchObject({ kind: 'hang_up', callControlId: 'v3:orphan' });
    if (cleanup === null) throw new Error('no cleanup');
    // The hang-up cannot reach Telnyx.
    await db.claimCommand(as(users.tess), callId, cleanup.id);
    await db.finishCommand(as(users.tess), callId, cleanup.id, 1, { kind: 'retry' });
    // The event's next delivery gives the hang-up back.
    const again = await db.applyCallEvent(
      as(users.tess),
      callId,
      eventId,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid', occurredAt: at(-2) }),
    );
    expect(again).toEqual({ status: 'duplicate', commands: [cleanup] });
    // Asked again for the same leg, the kept hang-up is given back, not a second one.
    expect(
      await db.finishCommand(as(users.tess), callId, dial, 1, { kind: 'done', legId: 'v3:orphan' }),
    ).toEqual({ followUp: cleanup });
  });

  it('makes no call talked without its leg to them and their answer (finding 6)', async () => {
    // Their answer arrives after a hangup, from a leg the call never knew.
    const callId = await callWith([
      ['1', event('call.answered', 'you', { occurredAt: at(-8) })],
      [
        '2',
        event('call.gather.ended', 'you', {
          digits: '1',
          gatherStatus: 'valid',
          occurredAt: at(-7),
        }),
      ],
      ['3', event('call.hangup', 'you', { hangupCause: 'normal_clearing', occurredAt: at(-1) })],
    ]);
    const late = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-4`,
      event('call.answered', 'them', { occurredAt: at(-6), callControlId: 'v3:unknown' }),
    );
    expect(late).toMatchObject({ commands: [{ kind: 'hang_up', callControlId: 'v3:unknown' }] });
    expect(await db.getCall(as(users.tess), callId)).toMatchObject({
      outcome: 'cancelled',
      contactLogEntryId: null,
    });
  });
});

describe("Codex's third review (ivanmueller/gss#109)", () => {
  const base = Date.now();
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();

  async function dialing(): Promise<{ callId: string; dial: string }> {
    const callId = await callWith([['1', event('call.answered', 'you', { occurredAt: at(-3) })]]);
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid', occurredAt: at(-2) }),
    );
    if (pressed.status !== 'applied') throw new Error('not applied');
    return { callId, dial: pressed.commands[0]?.id ?? '' };
  }

  const lapse = (id: string) =>
    admin`update app.call_commands set claimed_at = now() - interval '2 minutes' where id = ${id}`;

  it('gives back a cleanup hang-up still being sent, so it is not acknowledged unsent (finding 1)', async () => {
    const { callId, dial } = await dialing();
    await db.claimCommand(as(users.tess), callId, dial); // A
    await lapse(dial);
    await db.claimCommand(as(users.tess), callId, dial); // B
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-3`,
      event('call.hangup', 'you', { hangupCause: 'normal_clearing', occurredAt: at(-1) }),
    );
    const byB = await db.finishCommand(as(users.tess), callId, dial, 2, {
      kind: 'done',
      legId: 'v3:new-leg',
    });
    const cleanup = byB.followUp;
    if (cleanup === null) throw new Error('no cleanup');
    expect(await db.claimCommand(as(users.tess), callId, cleanup.id)).toMatchObject({
      status: 'claimed',
    });
    // A comes back with the same leg while B is still hanging it up.
    expect(
      await db.finishCommand(as(users.tess), callId, dial, 1, {
        kind: 'done',
        legId: 'v3:new-leg',
      }),
    ).toEqual({ followUp: cleanup });
    expect(await db.claimCommand(as(users.tess), callId, cleanup.id)).toEqual({ status: 'busy' });
  });

  it("lets a renewed claim's failure never undo a dial an older claim made (finding 2)", async () => {
    const { callId, dial } = await dialing();
    await db.claimCommand(as(users.tess), callId, dial);
    await lapse(dial);
    await db.claimCommand(as(users.tess), callId, dial);
    expect(
      await db.finishCommand(as(users.tess), callId, dial, 1, { kind: 'done', legId: 'v3:good' }),
    ).toEqual({ followUp: null });
    expect(await db.finishCommand(as(users.tess), callId, dial, 2, { kind: 'failed' })).toEqual({
      followUp: null,
    });
    expect(await db.getCall(as(users.tess), callId)).toMatchObject({
      status: 'calling_them',
      outcome: null,
    });
    const [row] = await admin<{ status: string; counterparty_call_control_id: string }[]>`
      select m.status, c.counterparty_call_control_id
      from app.call_commands m join app.calls c on c.id = m.call_id where m.id = ${dial}`;
    expect(row).toEqual({ status: 'done', counterparty_call_control_id: 'v3:good' });
  });

  it('keeps the leg of each event, so a late answer counts only from the known leg (finding 3)', async () => {
    const callId = await callWith([
      ['1', event('call.answered', 'you', { occurredAt: at(-8) })],
      [
        '2',
        event('call.gather.ended', 'you', {
          digits: '1',
          gatherStatus: 'valid',
          occurredAt: at(-7),
        }),
      ],
      [
        '3',
        event('call.hangup', 'them', {
          hangupCause: 'timeout',
          occurredAt: at(-1),
          callControlId: 'v3:x',
        }),
      ],
      ['4', event('call.answered', 'them', { occurredAt: at(-6), callControlId: 'v3:y' })],
    ]);
    expect(await db.getCall(as(users.tess), callId)).toMatchObject({ outcome: 'no_answer' });
    const [kept] = await admin<{ call_control_id: string }[]>`
      select call_control_id from app.call_events where telnyx_event_id = ${`evt-${callId}-4`}`;
    expect(kept?.call_control_id).toBe('v3:y');
    // Even as the caller, straight in the database, Y's answer does not make it talked.
    // Connected as app_api, as the Worker is (the test's admin may not switch roles in CI).
    const api = postgres(API_URL, { max: 1, onnotice: () => undefined });
    try {
      await expect(
        api.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${users.tess}, true)`;
          await tx`update app.calls set outcome = 'talked', connected_at = ${at(-6)}
                   where id = ${callId}`;
        }),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await api.end();
    }
  });
});

describe("Codex's fourth review", () => {
  it('keeps the delivery unacknowledged when a lapsed claim fails while a renewed one is still sending', async () => {
    await endTessCalls();
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    const callId = placed.callId;
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-1`,
      event('call.answered', 'you'),
    );
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
    );
    if (pressed.status !== 'applied') throw new Error('not applied');
    const dial = pressed.commands[0]?.id ?? '';
    await db.claimCommand(as(users.tess), callId, dial); // A
    await admin`update app.call_commands set claimed_at = now() - interval '2 minutes' where id = ${dial}`;
    await db.claimCommand(as(users.tess), callId, dial); // B, still inside its request to Telnyx
    expect(await db.finishCommand(as(users.tess), callId, dial, 1, { kind: 'failed' })).toEqual({
      followUp: null,
      unresolved: true,
    });
    expect(await db.finishCommand(as(users.tess), callId, dial, 1, { kind: 'retry' })).toEqual({
      followUp: null,
      unresolved: true,
    });
    // Once B has finished, an older claim's failure is simply ignored.
    await db.finishCommand(as(users.tess), callId, dial, 2, { kind: 'done', legId: 'v3:b-leg' });
    expect(await db.finishCommand(as(users.tess), callId, dial, 1, { kind: 'failed' })).toEqual({
      followUp: null,
    });
    expect(await db.getCall(as(users.tess), callId)).toMatchObject({ status: 'calling_them' });
  });
});

describe("Codex's fifth review", () => {
  it('keeps a dial in flight unsettled when the call ends, until its result is known (finding 2)', async () => {
    await endTessCalls();
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    const callId = placed.callId;
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-1`,
      event('call.answered', 'you'),
    );
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
    );
    if (pressed.status !== 'applied') throw new Error('not applied');
    const dial = pressed.commands[0]?.id ?? '';
    await db.claimCommand(as(users.tess), callId, dial); // A, inside its request to Telnyx
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-3`,
      event('call.hangup', 'you', { hangupCause: 'normal_clearing' }),
    );
    // The call has ended, but A's dial is still unsettled: no delivery is acknowledged.
    expect(await db.unsettledCommands(as(users.tess), callId)).toMatchObject([{ id: dial }]);
    // A gets its leg: it is to be hung up, and that hang-up is unsettled until sent.
    const finished = await db.finishCommand(as(users.tess), callId, dial, 1, {
      kind: 'done',
      legId: 'v3:late',
    });
    expect(finished.followUp).toMatchObject({ kind: 'hang_up', callControlId: 'v3:late' });
    expect(await db.unsettledCommands(as(users.tess), callId)).toEqual([finished.followUp]);
    // Telnyx cannot be reached for the hang-up: still unsettled, so the next delivery sends it.
    const cleanup = finished.followUp?.id ?? '';
    await db.claimCommand(as(users.tess), callId, cleanup);
    await db.finishCommand(as(users.tess), callId, cleanup, 1, { kind: 'retry' });
    expect(await db.unsettledCommands(as(users.tess), callId)).toEqual([finished.followUp]);
    await db.claimCommand(as(users.tess), callId, cleanup);
    await db.finishCommand(as(users.tess), callId, cleanup, 2, { kind: 'done' });
    expect(await db.unsettledCommands(as(users.tess), callId)).toEqual([]);
  });

  it('are read by the caller only', async () => {
    await endTessCalls();
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    await db.applyCallEvent(
      as(users.tess),
      placed.callId,
      `evt-${placed.callId}-1`,
      event('call.answered', 'you'),
    );
    expect(await db.unsettledCommands(as(users.tess), placed.callId)).toHaveLength(1);
    expect(await db.unsettledCommands(as(users.olga), placed.callId)).toEqual([]);
  });
});

describe("Codex's sixth review", () => {
  it('tells a call its caller can no longer reach from a settled one, and still knows its legs (finding 2)', async () => {
    await endTessCalls();
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    const callId = placed.callId;
    await db.recordLeg(as(users.tess), callId, 'you', 'v3:staff-s');
    const answered = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-1`,
      event('call.answered', 'you', { callControlId: 'v3:staff-s' }),
    );
    if (answered.status !== 'applied') throw new Error('not applied');
    await admin`update app.organization_members set status = 'suspended'
                where organization_id = ${orgs.a} and user_id = ${users.tess}`;
    try {
      expect(await db.unsettledCommands(as(users.tess), callId)).toBeNull();
      expect(
        await db.applyCallEvent(
          as(users.tess),
          callId,
          `evt-${callId}-2`,
          event('call.hangup', 'you', { callControlId: 'v3:staff-s' }),
        ),
      ).toEqual({ status: 'not_found' });
      expect(await db.callLegs(callId)).toEqual(['v3:staff-s']);
    } finally {
      await admin`update app.organization_members set status = 'active'
                  where organization_id = ${orgs.a} and user_id = ${users.tess}`;
    }
    expect(await db.unsettledCommands(as(users.tess), callId)).toHaveLength(1);
  });

  it('lists a stray leg waiting to be hung up among the call legs', async () => {
    await endTessCalls();
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    const callId = placed.callId;
    await db.applyCallEvent(as(users.tess), callId, `evt-${callId}-1`, event('call.hangup', 'you'));
    // A leg that starts after the end is to be hung up.
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.initiated', 'them', { callControlId: 'v3:stray-s' }),
    );
    expect(await db.callLegs(callId)).toContain('v3:stray-s');
    expect(await db.callLegs(crypto.randomUUID())).toEqual([]);
  });
});

describe("Codex's seventh review", () => {
  it('keeps the leg of a dial that came back after its caller was suspended', async () => {
    await endTessCalls();
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    const callId = placed.callId;
    await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-1`,
      event('call.answered', 'you'),
    );
    const pressed = await db.applyCallEvent(
      as(users.tess),
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
    );
    if (pressed.status !== 'applied') throw new Error('not applied');
    const dial = pressed.commands[0]?.id ?? '';
    await db.claimCommand(as(users.tess), callId, dial);
    await admin`update app.organization_members set status = 'suspended'
                where organization_id = ${orgs.a} and user_id = ${users.tess}`;
    try {
      expect(
        await db.finishCommand(as(users.tess), callId, dial, 1, {
          kind: 'done',
          legId: 'v3:new-s',
        }),
      ).toEqual({ followUp: null, callerGone: true });
      // Two deliveries at the same moment keep it once.
      const second = postgresDatabase(API_URL);
      try {
        await Promise.all([
          db.keepStrayLeg(dial, 'v3:new-s'),
          second.keepStrayLeg(dial, 'v3:new-s'),
        ]);
      } finally {
        await second.close();
      }
      await db.keepStrayLeg(dial, 'v3:new-s');
      expect(await db.callLegs(callId)).toContain('v3:new-s');
      const [kept] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.call_commands
        where call_id = ${callId} and kind = 'hang_up' and call_control_id = 'v3:new-s'`;
      expect(kept?.n).toBe(1);
    } finally {
      await admin`update app.organization_members set status = 'active'
                  where organization_id = ${orgs.a} and user_id = ${users.tess}`;
    }
  });
});

describe("Codex's eighth review", () => {
  it('treats a command hidden by a suspension as the caller gone, so the returned leg is kept', async () => {
    await endTessCalls();
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    // A command id the caller cannot see stands for the suspension between the two reads.
    expect(
      await db.finishCommand(as(users.tess), placed.callId, crypto.randomUUID(), 1, {
        kind: 'done',
        legId: 'v3:x',
      }),
    ).toEqual({ followUp: null, callerGone: true });
  });
});

describe("recordings and transcripts (owner's request, 2026-11-02)", () => {
  it('records a connected call, keeps its transcript for the team, and plays its audio for 24 hours', async () => {
    await endTessCalls();
    const placed = await db.placeCall(as(users.tess), counterparties.buyer, contacts.pat, FROM);
    if (placed.status !== 'created') throw new Error('not placed');
    const callId = placed.callId;
    const ctx = as(users.tess);
    await db.applyCallEvent(ctx, callId, `evt-${callId}-1`, event('call.answered', 'you'));
    await db.applyCallEvent(
      ctx,
      callId,
      `evt-${callId}-2`,
      event('call.gather.ended', 'you', { digits: '1', gatherStatus: 'valid' }),
    );
    const connected = await db.applyCallEvent(
      ctx,
      callId,
      `evt-${callId}-3`,
      event('call.answered', 'them'),
    );
    expect(connected).toMatchObject({
      commands: [{ kind: 'record', callControlId: 'v3:synthetic-staff' }],
    });
    if (connected.status !== 'applied') throw new Error('not applied');
    const record = connected.commands[0]?.id ?? '';
    expect(await db.claimCommand(ctx, callId, record)).toMatchObject({ status: 'claimed' });
    // A recording that cannot start leaves the call as it is.
    expect(await db.finishCommand(ctx, callId, record, 1, { kind: 'failed' })).toEqual({
      followUp: null,
    });
    expect(await db.getCall(ctx, callId)).toMatchObject({ status: 'connected' });

    const recording = `rec-${callId}`;
    await db.keepCallRecording(
      callId,
      recording,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    await db.keepCallTranscript(callId, recording, 'We can do November at the posted price.');
    const [listed] = await db
      .listRecordings(as(users.victor), counterparties.buyer)
      .then((rows) => rows.filter((row) => row.callId === callId));
    expect(listed).toMatchObject({ transcript: 'We can do November at the posted price.' });
    expect(listed?.audioUntil).not.toBeNull();
    expect(await db.playableRecording(as(users.victor), listed?.id ?? '')).toBe(recording);
    expect(await db.listRecordings(as(users.bob), counterparties.buyer)).toEqual([]);

    // 24 hours later its audio is due, then gone; the transcript stays.
    await admin`update app.call_recordings set recording_ended_at = now() - interval '25 hours'
                where telnyx_recording_id = ${recording}`;
    expect(await db.recordingsToDelete(500)).toContain(recording);
    expect(await db.playableRecording(as(users.victor), listed?.id ?? '')).toBeNull();
    await db.markRecordingDeleted(recording);
    expect(await db.recordingsToDelete(500)).not.toContain(recording);
    const [after] = await db
      .listRecordings(as(users.victor), counterparties.buyer)
      .then((rows) => rows.filter((row) => row.callId === callId));
    expect(after).toMatchObject({
      audioUntil: null,
      transcript: 'We can do November at the posted price.',
    });
  });
});
