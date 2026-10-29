import {
  albertaDay,
  endOfAlbertaDay,
  type ContactLogInput,
  type FollowUpInput,
} from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of the CRM: the real driver, as `app_api`, against the real migrations,
// row level security and triggers. Fixtures are synthetic.
//
// The contact log and follow-ups can never be deleted, not even by the table owner, so this
// test's records, and the organizations and counterparties they belong to, stay in the
// throwaway test database; every id is fresh, so nothing else sees them.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { tess: id(), victor: id(), val: id(), sue: id(), bob: id() };
const orgs = { a: id(), b: id() };
const counterparties = { buyer: id(), archived: id(), other: id() };
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function log(extra: Partial<ContactLogInput> = {}): ContactLogInput {
  return {
    occurredAt: minutesFromNow(-60),
    channel: 'call',
    contactName: 'Pat Buyer',
    notes: 'Asked about November delivery.',
    ...extra,
  };
}

function plan(extra: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    task: 'Send the November bid sheet',
    dueAt: minutesFromNow(60 * 24 * 3),
    assignedTo: users.victor,
    ...extra,
  };
}

let db: Database;

beforeAll(async () => {
  const names: Record<keyof typeof users, object> = {
    tess: { first_name: 'Tess', last_name: 'Trader' },
    victor: { first_name: 'Victor' },
    val: {},
    sue: { first_name: 'Sue' },
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
    (${orgs.a}, ${users.victor}, 'viewer', 'active', now()),
    (${orgs.a}, ${users.val}, 'viewer', 'active', now()),
    (${orgs.a}, ${users.sue}, 'operations', 'suspended', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
    (${counterparties.buyer}, ${orgs.a}, 'Synthetic Buyer', '{buyer}', 'US', 'manual', ${users.tess}, null),
    (${counterparties.archived}, ${orgs.a}, 'Synthetic Old Buyer', '{buyer}', 'US', 'manual', ${users.tess}, now()),
    (${counterparties.other}, ${orgs.b}, 'Synthetic Other', '{buyer}', 'US', 'manual', ${users.bob}, null)`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe('the contact log as app_api', () => {
  let entryId = '';
  let followUpId = '';

  it('logs a contact with a follow-up, the responsible person’s name from their login', async () => {
    const created = await db.createContactLog(as(users.tess), {
      counterpartyId: counterparties.buyer,
      log: log(),
      followUp: plan(),
      recordedByName: 'Tess Trader',
    });
    expect(created).toMatchObject({ status: 'created' });
    if (created.status !== 'created' || created.followUpId === null) throw new Error('not created');
    entryId = created.id;
    followUpId = created.followUpId;
    const entries = await db.listContactLog(as(users.victor), counterparties.buyer);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: entryId,
      counterpartyId: counterparties.buyer,
      current: {
        revisionNumber: 1,
        channel: 'call',
        contactName: 'Pat Buyer',
        recordedByName: 'Tess Trader',
      },
    });
    expect(await db.getFollowUp(as(users.victor), followUpId)).toMatchObject({
      contactLogEntryId: entryId,
      task: 'Send the November bid sheet',
      assignedTo: { userId: users.victor, name: 'Victor' },
      createdByName: 'Tess Trader',
      doneAt: null,
      counterparty: { id: counterparties.buyer, legalName: 'Synthetic Buyer', archived: false },
    });
  });

  it('keeps every version of a corrected entry and refuses a correction of an old one', async () => {
    expect(
      await db.correctContactLog(
        as(users.tess),
        entryId,
        1,
        log({ contactName: 'Pat Q. Buyer' }),
        'Tess Trader',
      ),
    ).toEqual({ status: 'saved' });
    expect(
      await db.correctContactLog(as(users.tess), entryId, 1, log({ notes: null }), 'Tess Trader'),
    ).toEqual({ status: 'changed', currentRevision: 2 });
    const entry = await db.getContactLogEntry(as(users.victor), entryId);
    expect(
      entry?.revisions.map((revision) => [revision.revisionNumber, revision.contactName]),
    ).toEqual([
      [2, 'Pat Q. Buyer'],
      [1, 'Pat Buyer'],
    ]);
    expect(entry?.current.revisionNumber).toBe(2);
  });

  it('lists entries latest contact first', async () => {
    await db.createContactLog(as(users.tess), {
      counterpartyId: counterparties.buyer,
      log: log({ occurredAt: minutesFromNow(-60 * 24), channel: 'visit' }),
      followUp: null,
      recordedByName: 'Tess Trader',
    });
    const entries = await db.listContactLog(as(users.tess), counterparties.buyer);
    expect(entries.map((entry) => entry.current.channel)).toEqual(['call', 'visit']);
  });

  it('refuses viewers, archived counterparties and people not on the team', async () => {
    const input = (counterpartyId: string, followUp: FollowUpInput | null = null) => ({
      counterpartyId,
      log: log(),
      followUp,
      recordedByName: 'Someone',
    });
    expect(await db.createContactLog(as(users.victor), input(counterparties.buyer))).toEqual({
      status: 'forbidden',
    });
    expect(await db.createContactLog(as(users.tess), input(counterparties.archived))).toEqual({
      status: 'archived',
    });
    expect(
      await db.createContactLog(
        as(users.tess),
        input(counterparties.buyer, plan({ assignedTo: users.sue })),
      ),
    ).toEqual({ status: 'not_a_member' });
    expect(
      await db.createContactLog(
        as(users.tess),
        input(counterparties.buyer, plan({ assignedTo: users.bob })),
      ),
    ).toEqual({ status: 'not_a_member' });
    expect(await db.correctContactLog(as(users.victor), entryId, 2, log(), 'Victor')).toEqual({
      status: 'forbidden',
    });
  });

  it('shows another organization nothing and lets it log nothing here', async () => {
    expect(await db.listContactLog(as(users.bob), counterparties.buyer)).toEqual([]);
    expect(await db.getContactLogEntry(as(users.bob), entryId)).toBeNull();
    expect(
      await db.createContactLog(as(users.bob), {
        counterpartyId: counterparties.buyer,
        log: log(),
        followUp: null,
        recordedByName: 'Bob',
      }),
    ).toEqual({ status: 'not_found' });
    expect(await db.correctContactLog(as(users.bob), entryId, 2, log(), 'Bob')).toEqual({
      status: 'not_found',
    });
    expect(await db.getFollowUp(as(users.bob), followUpId)).toBeNull();
    expect(
      await db.listFollowUps(as(users.bob), {
        organizationId: orgs.a,
        counterpartyId: null,
        assignedTo: null,
        status: 'all',
      }),
    ).toEqual([]);
    expect(
      await db.updateFollowUp(as(users.bob), followUpId, '2026-10-29T00:00:00.000000Z', plan()),
    ).toEqual({
      status: 'not_found',
    });
    expect(await db.finishFollowUp(as(users.bob), followUpId, 'Bob')).toEqual({
      status: 'not_found',
    });
  });
});

describe('follow-ups as app_api', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const [name, dueAt] of [
      ['overdue', minutesFromNow(-90)],
      ['soon', minutesFromNow(2)],
      ['later', minutesFromNow(60 * 24 * 5)],
    ] as const) {
      const created = await db.createFollowUp(
        as(users.tess),
        counterparties.buyer,
        plan({ task: `Synthetic ${name}`, dueAt, assignedTo: users.val }),
        'Tess Trader',
      );
      if (created.status !== 'created') throw new Error(created.status);
      ids[name] = created.id;
    }
  });

  it('lists open follow-ups soonest due first, for one person or everyone', async () => {
    const mine = await db.listFollowUps(as(users.val), {
      organizationId: orgs.a,
      counterpartyId: null,
      assignedTo: 'me',
      status: 'open',
    });
    expect(mine.map((item) => item.task)).toEqual([
      'Synthetic overdue',
      'Synthetic soon',
      'Synthetic later',
    ]);
    const everyone = await db.listFollowUps(as(users.val), {
      organizationId: orgs.a,
      counterpartyId: counterparties.buyer,
      assignedTo: null,
      status: 'open',
    });
    expect(everyone).toHaveLength(4);
  });

  it('counts the person’s follow-ups overdue and due later today in Alberta time', async () => {
    const soon = minutesFromNow(2);
    const today = albertaDay(soon) === albertaDay(new Date()) ? 1 : 0;
    expect(await db.countFollowUps(as(users.val), orgs.a, endOfAlbertaDay(new Date()))).toEqual({
      overdue: 1,
      dueToday: today,
    });
    expect(await db.countFollowUps(as(users.bob), orgs.a, endOfAlbertaDay(new Date()))).toEqual({
      overdue: 0,
      dueToday: 0,
    });
  });

  it('lists the active team by name for any member, and nothing for another organization', async () => {
    const team = await db.teamNames(as(users.val), orgs.a);
    expect(team.map((member) => member.name)).toEqual([
      'Tess Trader',
      `val-${users.val}@example.test`,
      'Victor',
    ]);
    expect(await db.teamNames(as(users.bob), orgs.a)).toEqual([]);
  });

  it('changes a follow-up of the version that was open, and refuses a stale one', async () => {
    const before = await db.getFollowUp(as(users.tess), ids.later ?? '');
    if (!before) throw new Error('missing');
    expect(
      await db.updateFollowUp(
        as(users.tess),
        before.id,
        before.version,
        plan({ task: 'Call again', assignedTo: users.tess }),
      ),
    ).toEqual({ status: 'saved' });
    expect(await db.getFollowUp(as(users.tess), before.id)).toMatchObject({
      task: 'Call again',
      assignedTo: { userId: users.tess, name: 'Tess Trader' },
    });
    expect(await db.updateFollowUp(as(users.tess), before.id, before.version, plan())).toEqual({
      status: 'changed',
    });
    const now = await db.getFollowUp(as(users.tess), before.id);
    expect(
      await db.updateFollowUp(
        as(users.tess),
        before.id,
        now?.version ?? '',
        plan({ assignedTo: users.sue }),
      ),
    ).toEqual({ status: 'not_a_member' });
    expect(await db.updateFollowUp(as(users.val), before.id, now?.version ?? '', plan())).toEqual({
      status: 'forbidden',
    });
  });

  it('lets the person responsible mark it done, once, and then it stays done', async () => {
    const overdue = ids.overdue ?? '';
    expect(await db.finishFollowUp(as(users.victor), overdue, 'Victor')).toEqual({
      status: 'forbidden',
    });
    expect(await db.finishFollowUp(as(users.val), overdue, 'Val')).toEqual({ status: 'saved' });
    const done = await db.getFollowUp(as(users.tess), overdue);
    expect(done).toMatchObject({ doneByName: 'Val' });
    expect(done?.doneAt).not.toBeNull();
    expect(await db.finishFollowUp(as(users.tess), overdue, 'Tess Trader')).toEqual({
      status: 'saved',
    });
    expect((await db.getFollowUp(as(users.tess), overdue))?.doneByName).toBe('Val');
    expect(await db.updateFollowUp(as(users.tess), overdue, done?.version ?? '', plan())).toEqual({
      status: 'done',
    });
    const doneList = await db.listFollowUps(as(users.val), {
      organizationId: orgs.a,
      counterpartyId: null,
      assignedTo: 'me',
      status: 'done',
    });
    expect(doneList.map((item) => item.id)).toEqual([overdue]);
    expect(
      (await db.countFollowUps(as(users.val), orgs.a, endOfAlbertaDay(new Date()))).overdue,
    ).toBe(0);
  });
});
