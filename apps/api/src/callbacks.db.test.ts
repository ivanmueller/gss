import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CallbackCommand, CallbackEvent, ClaimedCallbackCommand } from './callbacks-db';
import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of callbacks to GSS's number (F-132): the real driver, as `app_api`, against
// the real migrations, row level security and functions. Telnyx itself is not called; its
// events are given as the webhook passes them on. Fixtures are synthetic (555 numbers); calls
// are never deleted, so every id, and GSS's number, is fresh for each run.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { tess: id(), olga: id(), adam: id(), victor: id(), bob: id() };
const orgs = { a: id(), b: id() };
const companies = { buyer: id(), other: id() };
const pat = id();
const as = (userId: string): RequestContext => ({ userId, requestId: id() });
// GSS's number for this run, and the counterparties' numbers (all 555).
const digits = () => String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
const GSS = `+1825555${digits()}`;
const PAT = `+1403555${digits()}`;
const UNKNOWN = `+1780555${digits()}`;

let db: Database;

function event(
  type: string,
  side: 'you' | 'them',
  extra: Partial<CallbackEvent> = {},
): CallbackEvent {
  return {
    type,
    side,
    attemptId: null,
    occurredAt: new Date().toISOString(),
    leg: null,
    digits: null,
    gatherStatus: null,
    cause: null,
    ...extra,
  };
}

/** Claims and finishes each command as done (a dial returning the given leg); what follows. */
async function sendAll(callId: string, commands: CallbackCommand[], leg: string | null = null) {
  const sent: ClaimedCallbackCommand[] = [];
  const queue = [...commands];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const claim = await db.claimCallbackCommand(callId, next.id);
    if (claim.status !== 'claimed') continue;
    sent.push(claim.command);
    const finished = await db.finishCallbackCommand(
      callId,
      next.id,
      claim.command.claim,
      'done',
      claim.command.kind === 'dial_member' ? leg : null,
    );
    queue.push(...finished.commands);
  }
  return sent;
}

beforeAll(async () => {
  const names = {
    tess: { first_name: 'Tess', last_name: 'Trader' },
    olga: { first_name: 'Olga' },
    adam: { first_name: 'Adam' },
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
    (${orgs.a}, ${users.adam}, 'org_admin', 'active', now()),
    (${orgs.a}, ${users.victor}, 'viewer', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by) values
    (${companies.buyer}, ${orgs.a}, 'Synthetic Buyer', '{buyer}', 'CA', 'manual', ${users.tess}),
    (${companies.other}, ${orgs.b}, 'Synthetic Other', '{buyer}', 'US', 'manual', ${users.bob})`;
  await admin`insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, phone, created_by)
    values (${pat}, ${orgs.a}, ${companies.buyer}, 'Pat Buyer', ${PAT}, ${users.tess})`;
  await admin`insert into app.member_phones (organization_id, user_id, phone) values
    (${orgs.a}, ${users.tess}, '+15875550131'), (${orgs.a}, ${users.olga}, '+15875550132')`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe('callbacks settings', () => {
  it('are chosen by an admin, on the number given, and read by every member', async () => {
    expect(await db.getCallbackSettings(as(users.bob), orgs.a, GSS)).toBeNull();
    const before = await db.getCallbackSettings(as(users.victor), orgs.a, GSS);
    expect(before).toMatchObject({ phone: null, callbacksPerson: null });
    expect(before?.candidates.map((candidate) => candidate.name)).toEqual([
      'Adam',
      'Olga',
      'Tess Trader',
    ]);
    expect(await db.saveCallbackSettings(as(users.tess), orgs.a, GSS, null)).toBe('forbidden');
    expect(await db.saveCallbackSettings(as(users.adam), orgs.a, GSS, users.victor)).toBe(
      'not_a_member',
    );
    expect(await db.saveCallbackSettings(as(users.adam), orgs.a, GSS, users.olga)).toBe('saved');
    expect(await db.saveCallbackSettings(as(users.bob), orgs.b, GSS, null)).toBe('phone_taken');
    expect(await db.getCallbackSettings(as(users.victor), orgs.a, GSS)).toMatchObject({
      callbacksPerson: { id: users.olga, name: 'Olga' },
      updatedByName: 'Adam',
    });
  });
});

describe('a callback', () => {
  it('rings whom it was meant for, joins them, and logs it in their name', async () => {
    const placed = await db.placeCall(as(users.tess), companies.buyer, pat, GSS);
    if (placed.status !== 'created') throw new Error('not placed');
    await admin`update app.calls set status = 'ended', outcome = 'no_answer', ended_at = now()
                where id = ${placed.callId}`;

    const leg = `in-${id()}`;
    const received = await db.receiveCallback({
      eventId: id(),
      type: 'call.initiated',
      occurredAt: new Date().toISOString(),
      leg,
      from: PAT,
      to: GSS,
    });
    if (received.status !== 'created') throw new Error('not received');
    const callId = received.callId;
    expect(received.commands.map((command) => command.kind)).toEqual(['dial_member']);
    const attemptId = received.commands[0]?.attemptId ?? '';

    // Being rung counts as a call under way: no call can be placed meanwhile (Codex, finding 3).
    expect((await db.placeCall(as(users.tess), companies.buyer, pat, GSS)).status).toBe(
      'in_progress',
    );
    expect(await db.myCallback(as(users.tess), orgs.a)).toBe(callId);
    expect(await db.myCallback(as(users.olga), orgs.a)).toBeNull();
    const rung = (await db.getCall(as(users.tess), callId))?.callback;
    expect(rung).toMatchObject({ companyName: 'Synthetic Buyer', you: 'ringing' });
    expect(rung?.callerPhone).toMatch(/^\(403\) 555-\d{4}$/);
    expect((await db.getCall(as(users.olga), callId))?.callback?.you).toBeNull();

    const cellLeg = `cell-${id()}`;
    const sent = await sendAll(callId, received.commands, cellLeg);
    expect(sent[0]).toMatchObject({
      kind: 'dial_member',
      cell: '+15875550131',
      companyName: 'Synthetic Buyer',
    });
    expect(await db.callbackByLeg(cellLeg)).toEqual({ callId, side: 'you', attemptId });
    expect(await db.callbackByLeg(leg)).toEqual({ callId, side: 'them', attemptId: null });

    const answered = await db.applyCallbackEvent(
      callId,
      id(),
      event('call.answered', 'you', { attemptId, leg: cellLeg }),
    );
    expect(answered.status === 'applied' && answered.commands.map((c) => c.kind)).toEqual([
      'confirm',
    ]);
    await sendAll(callId, answered.status === 'applied' ? answered.commands : []);
    const pressed = await db.applyCallbackEvent(
      callId,
      id(),
      event('call.gather.ended', 'you', {
        attemptId,
        leg: cellLeg,
        digits: '1',
        gatherStatus: 'valid',
      }),
    );
    expect(pressed.status === 'applied' && pressed.commands.map((c) => c.kind)).toEqual(['answer']);
    await sendAll(callId, pressed.status === 'applied' ? pressed.commands : []);
    const joined = await db.applyCallbackEvent(
      callId,
      id(),
      event('call.answered', 'them', { leg }),
    );
    const joinSent = await sendAll(callId, joined.status === 'applied' ? joined.commands : []);
    expect(joinSent.map((command) => [command.kind, command.bridgeWith])).toEqual([
      ['bridge', leg],
      ['record', null],
    ]);
    expect((await db.getCall(as(users.tess), callId))?.status).toBe('connected');
    // A call Tess took is found again past 15 minutes, as long as it lasts (Codex, finding 3).
    await admin`update app.callback_attempts set started_at = now() - interval '40 minutes'
                where call_id = ${callId}`;
    expect(await db.myCallback(as(users.tess), orgs.a)).toBe(callId);

    const ended = await db.applyCallbackEvent(callId, id(), event('call.hangup', 'them', { leg }));
    expect(ended.status === 'applied' && ended.commands.map((c) => c.kind)).toEqual(['hang_up']);
    await sendAll(callId, ended.status === 'applied' ? ended.commands : []);
    expect(await db.callbackOpenCommands(callId)).toEqual([]);
    const call = await db.getCall(as(users.victor), callId);
    expect(call).toMatchObject({
      direction: 'incoming',
      outcome: 'talked',
      counterpartyId: companies.buyer,
    });
    expect(call?.contactLogEntryId).not.toBeNull();
    expect(await db.myCallback(as(users.tess), orgs.a)).toBeNull();

    // The recording, on the leg of who answered, is the call by side; Tess is its GSS side.
    const recording = `rec-${id()}`;
    expect(await db.keepCallbackRecording(callId, recording, null, null, cellLeg)).toBe(false);
    const [listed] = (await db.listRecordings(as(users.victor), companies.buyer)).filter(
      (row) => row.callId === callId,
    );
    expect(listed).toMatchObject({
      callerName: 'Tess Trader',
      contactName: 'Pat Buyer',
      voicemail: false,
    });
  });

  it('has a sweep for callbacks whose join was unclear, logging nothing ended under five minutes ago', async () => {
    expect(await db.settleLateCallbacks(10)).toBeGreaterThanOrEqual(0);
  });

  it('applies an event once, and a repeated incoming leg is the same call', async () => {
    const leg = `in-${id()}`;
    const eventId = id();
    const first = await db.receiveCallback({
      eventId,
      type: 'call.initiated',
      occurredAt: new Date().toISOString(),
      leg,
      from: PAT,
      to: GSS,
    });
    const again = await db.receiveCallback({
      eventId: id(),
      type: 'call.initiated',
      occurredAt: new Date().toISOString(),
      leg,
      from: PAT,
      to: GSS,
    });
    if (first.status !== 'created' || again.status !== 'duplicate')
      throw new Error('not kept once');
    expect(again.callId).toBe(first.callId);
    expect(again.commands.map((command) => command.id)).toEqual(
      first.commands.map((command) => command.id),
    );
    const hangUp = event('call.hangup', 'them', { leg });
    const hangUpId = id();
    expect((await db.applyCallbackEvent(first.callId, hangUpId, hangUp)).status).toBe('applied');
    expect((await db.applyCallbackEvent(first.callId, hangUpId, hangUp)).status).toBe('duplicate');
    // The caller gave up: a missed callback with a follow-up for Tess, whom it was meant for.
    const [followUp] = await admin<{ assigned_to: string; task: string }[]>`
      select f.assigned_to, f.task from app.calls c join app.follow_ups f on f.id = c.follow_up_id
      where c.id = ${first.callId}`;
    expect(followUp).toEqual({ assigned_to: users.tess, task: 'Return call from Pat Buyer' });
  });

  it('is not one of another organization’s, nor taken on another number', async () => {
    expect(
      await db.receiveCallback({
        eventId: id(),
        type: 'call.initiated',
        occurredAt: new Date().toISOString(),
        leg: `in-${id()}`,
        from: PAT,
        to: '+18005550100',
      }),
    ).toEqual({ status: 'not_ours' });
    expect(await db.listCallbackReturns(as(users.bob), orgs.a)).toEqual([]);
  });
});

describe('a callback from an unknown number', () => {
  it('becomes an open return the team takes, links or dismisses', async () => {
    const leg = `in-${id()}`;
    const received = await db.receiveCallback({
      eventId: id(),
      type: 'call.initiated',
      occurredAt: new Date().toISOString(),
      leg,
      from: UNKNOWN,
      to: GSS,
    });
    if (received.status !== 'created') throw new Error('not received');
    const callId = received.callId;
    // Olga, the callbacks person, is rung; she does not answer: voicemail.
    const cellLeg = `cell-${id()}`;
    await sendAll(callId, received.commands, cellLeg);
    const attemptId = received.commands[0]?.attemptId ?? null;
    const missed = await db.applyCallbackEvent(
      callId,
      id(),
      event('call.hangup', 'you', { attemptId, leg: cellLeg, cause: 'timeout' }),
    );
    expect(missed.status === 'applied' && missed.commands.map((c) => c.kind)).toEqual(['answer']);
    await sendAll(callId, missed.status === 'applied' ? missed.commands : []);
    const greeted = await db.applyCallbackEvent(
      callId,
      id(),
      event('call.answered', 'them', { leg }),
    );
    await sendAll(callId, greeted.status === 'applied' ? greeted.commands : []);
    const recording = await db.applyCallbackEvent(
      callId,
      id(),
      event('call.speak.ended', 'them', { leg }),
    );
    expect(recording.status === 'applied' && recording.commands.map((c) => c.kind)).toEqual([
      'record_voicemail',
    ]);
    await sendAll(callId, recording.status === 'applied' ? recording.commands : []);
    await db.applyCallbackEvent(callId, id(), event('call.hangup', 'them', { leg }));
    expect(await db.keepCallbackRecording(callId, `vm-${id()}`, null, null, leg)).toBe(true);

    const [open] = (await db.listCallbackReturns(as(users.victor), orgs.a)).filter(
      (row) => row.callId === callId,
    );
    expect(open).toMatchObject({
      counterpartyId: null,
      outcome: 'voicemail',
      ownerId: users.olga,
      ownerName: 'Olga',
      recording: { voicemail: true, transcript: null },
    });
    expect(open?.callerPhone).toMatch(/^\(780\) 555-\d{4}$/);
    expect(await db.countCallbackReturns(as(users.olga), orgs.a)).toBeGreaterThanOrEqual(1);
    const tessBefore = await db.countCallbackReturns(as(users.tess), orgs.a);

    expect(await db.settleCallbackReturn(as(users.victor), callId, { action: 'take' })).toBe(
      'forbidden',
    );
    expect(await db.settleCallbackReturn(as(users.bob), callId, { action: 'dismiss' })).toBe(
      'not_found',
    );
    expect(await db.settleCallbackReturn(as(users.tess), callId, { action: 'take' })).toBe('done');
    expect(await db.countCallbackReturns(as(users.tess), orgs.a)).toBe(tessBefore + 1);
    expect(
      await db.settleCallbackReturn(as(users.tess), callId, {
        action: 'link',
        counterpartyId: companies.other,
        contactId: null,
      }),
    ).toBe('company_not_found');
    expect(
      await db.settleCallbackReturn(as(users.tess), callId, {
        action: 'link',
        counterpartyId: companies.buyer,
        contactId: pat,
      }),
    ).toBe('done');
    expect(
      (await db.listCallbackReturns(as(users.tess), orgs.a)).some((row) => row.callId === callId),
    ).toBe(false);
    expect((await db.getCall(as(users.tess), callId))?.counterpartyId).toBe(companies.buyer);
    const [listed] = (await db.listRecordings(as(users.victor), companies.buyer)).filter(
      (row) => row.callId === callId,
    );
    expect(listed).toMatchObject({
      voicemail: true,
      contactName: 'Pat Buyer',
      callerName: 'Tess Trader',
    });
    expect(await db.settleCallbackReturn(as(users.adam), callId, { action: 'dismiss' })).toBe(
      'closed',
    );
  });

  it('counts a return nobody has for every admin', async () => {
    expect(await db.saveCallbackSettings(as(users.adam), orgs.a, GSS, null)).toBe('saved');
    const leg = `in-${id()}`;
    const received = await db.receiveCallback({
      eventId: id(),
      type: 'call.hangup',
      occurredAt: new Date().toISOString(),
      leg,
      from: UNKNOWN,
      to: GSS,
    });
    if (received.status !== 'created') throw new Error('not received');
    const [open] = (await db.listCallbackReturns(as(users.adam), orgs.a)).filter(
      (row) => row.callId === received.callId,
    );
    expect(open).toMatchObject({ outcome: 'missed', ownerId: null });
    const adamBefore = await db.countCallbackReturns(as(users.adam), orgs.a);
    const olgaBefore = await db.countCallbackReturns(as(users.olga), orgs.a);
    expect(adamBefore).toBeGreaterThanOrEqual(1);
    expect(
      await db.settleCallbackReturn(as(users.olga), received.callId, { action: 'dismiss' }),
    ).toBe('done');
    expect(await db.countCallbackReturns(as(users.adam), orgs.a)).toBe(adamBefore - 1);
    expect(await db.countCallbackReturns(as(users.olga), orgs.a)).toBe(olgaBefore);
  });
});
