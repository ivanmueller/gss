import type { ContactLogEntry, FollowUp } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Synthetic values only.
let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const COUNTERPARTY = '00000000-0000-4000-8000-00000000c1aa';
const ENTRY = '00000000-0000-4000-8000-00000000e101';
const FOLLOW_UP = '00000000-0000-4000-8000-00000000f101';
const PERSON = '00000000-0000-4000-8000-0000000022aa';
const VERSION = '2026-10-29T14:05:09.123456Z';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

const ENTRY_DETAIL: ContactLogEntry = {
  id: ENTRY,
  counterpartyId: COUNTERPARTY,
  createdAt: '2026-10-29T14:00:00.000Z',
  current: {
    id: '00000000-0000-4000-8000-0000000001e1',
    revisionNumber: 1,
    occurredAt: '2026-10-29T13:30:00.000Z',
    channel: 'call',
    contactName: 'Pat Buyer',
    notes: null,
    recordedByName: 'Tess Trader',
    recordedAt: '2026-10-29T14:00:00.000Z',
  },
  revisions: [],
};

const FOLLOW_UP_DETAIL: FollowUp = {
  id: FOLLOW_UP,
  counterparty: {
    id: COUNTERPARTY,
    legalName: 'Synthetic Buyer',
    tradingName: null,
    archived: false,
  },
  contactLogEntryId: null,
  task: 'Send the bid sheet',
  dueAt: '2026-10-30T14:00:00.000Z',
  assignedTo: { userId: PERSON, name: 'Adam Admin' },
  createdByName: 'Tess Trader',
  createdAt: '2026-10-29T14:00:00.000Z',
  doneAt: null,
  doneByName: null,
  version: VERSION,
};

const LOG = { channel: 'call', contactName: 'Pat Buyer', occurredAt: '2026-10-29T13:30:00Z' };
const PLAN = { task: 'Send the bid sheet', dueAt: '2026-10-30T14:00:00Z', assignedTo: PERSON };

function request(method: string, path: string, body?: unknown) {
  return app.request(
    `/api/v1${path}`,
    { method, headers: AUTH, ...(body !== undefined && { body: JSON.stringify(body) }) },
    ENV,
  );
}

beforeEach(() => {
  mockAuthServer(
    Response.json({
      id: USER_ID,
      email: 'tess@example.test',
      user_metadata: { first_name: 'Tess', last_name: 'Trader' },
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  db = fakeDatabase();
  openDatabase.mockClear();
});

describe('/api/v1/contact-log', () => {
  it.each([
    ['GET', `/contact-log?counterparty_id=${COUNTERPARTY}`],
    ['GET', `/contact-log/${ENTRY}`],
    ['POST', '/contact-log'],
    ['POST', `/contact-log/${ENTRY}/revisions`],
  ])('%s %s requires sign-in', async (method, path) => {
    const res = await app.request(`/api/v1${path}`, { method }, ENV);
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('lists a counterparty’s log, and needs the counterparty', async () => {
    db.listContactLog.mockResolvedValueOnce([ENTRY_DETAIL]);
    const res = await request('GET', `/contact-log?counterparty_id=${COUNTERPARTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [ENTRY_DETAIL], truncated: false });
    expect(db.listContactLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      COUNTERPARTY,
    );
    expect((await request('GET', '/contact-log')).status).toBe(422);
    expect((await request('GET', '/contact-log?counterparty_id=x')).status).toBe(422);
  });

  it('answers one entry, or 404', async () => {
    db.getContactLogEntry.mockResolvedValueOnce(ENTRY_DETAIL);
    expect(await (await request('GET', `/contact-log/${ENTRY}`)).json()).toEqual(ENTRY_DETAIL);
    expect((await request('GET', `/contact-log/${ENTRY}`)).status).toBe(404);
    expect((await request('GET', '/contact-log/nope')).status).toBe(404);
  });

  it('logs a contact with the checked values and the recorder’s name from their login', async () => {
    db.getContactLogEntry.mockResolvedValueOnce(ENTRY_DETAIL);
    const res = await request('POST', '/contact-log', {
      counterpartyId: COUNTERPARTY,
      values: { ...LOG, contactName: '  Pat  Buyer ' },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ entry: ENTRY_DETAIL, followUpId: null });
    expect(db.createContactLog).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }), {
      counterpartyId: COUNTERPARTY,
      log: {
        occurredAt: '2026-10-29T13:30:00.000Z',
        channel: 'call',
        contactName: 'Pat Buyer',
        notes: null,
      },
      followUp: null,
      recordedByName: 'Tess Trader',
    });
  });

  it('logs a contact with its follow-up', async () => {
    db.createContactLog.mockResolvedValueOnce({
      status: 'created',
      id: ENTRY,
      followUpId: FOLLOW_UP,
    });
    db.getContactLogEntry.mockResolvedValueOnce(ENTRY_DETAIL);
    const res = await request('POST', '/contact-log', {
      counterpartyId: COUNTERPARTY,
      values: LOG,
      followUp: PLAN,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ entry: ENTRY_DETAIL, followUpId: FOLLOW_UP });
    expect(db.createContactLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        followUp: {
          task: 'Send the bid sheet',
          dueAt: '2026-10-30T14:00:00.000Z',
          assignedTo: PERSON,
        },
      }),
    );
  });

  it('reports the fields of both forms that need fixing, before touching the database', async () => {
    const res = await request('POST', '/contact-log', {
      counterpartyId: COUNTERPARTY,
      values: { channel: 'fax' },
      followUp: { dueAt: 'tomorrow', assignedTo: PERSON },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      issues: [
        { field: 'channel', message: 'is not one of the choices' },
        { field: 'contactName', message: 'is required' },
        { field: 'task', message: 'is required' },
        { field: 'dueAt', message: 'must be a date and time' },
      ],
    });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('refuses a malformed request', async () => {
    const res = await request('POST', '/contact-log', { counterpartyId: 'x', values: {} });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ fields: ['counterpartyId'] });
  });

  it.each([
    ['not_found', 404, 'NOT_FOUND'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['archived', 409, 'ARCHIVED'],
    ['not_a_member', 422, 'NOT_A_MEMBER'],
  ] as const)('answers %s with %i %s', async (status, code, error) => {
    db.createContactLog.mockResolvedValueOnce({ status });
    const res = await request('POST', '/contact-log', {
      counterpartyId: COUNTERPARTY,
      values: LOG,
      followUp: PLAN,
    });
    expect(res.status).toBe(code);
    expect(await res.json()).toMatchObject({ error: { code: error } });
  });

  it('records a correction of the version the person saw', async () => {
    db.getContactLogEntry.mockResolvedValueOnce(ENTRY_DETAIL);
    const res = await request('POST', `/contact-log/${ENTRY}/revisions`, {
      basedOnRevision: 1,
      values: { ...LOG, notes: 'Corrected.' },
    });
    expect(res.status).toBe(201);
    expect(db.correctContactLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ENTRY,
      1,
      expect.objectContaining({ notes: 'Corrected.' }),
      'Tess Trader',
    );
  });

  it('refuses a correction of a version someone has corrected since', async () => {
    db.correctContactLog.mockResolvedValueOnce({ status: 'changed', currentRevision: 3 });
    const res = await request('POST', `/contact-log/${ENTRY}/revisions`, {
      basedOnRevision: 2,
      values: LOG,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'ENTRY_CHANGED' },
      currentRevision: 3,
    });
  });

  it('needs the version a correction is based on', async () => {
    const res = await request('POST', `/contact-log/${ENTRY}/revisions`, { values: LOG });
    expect(res.status).toBe(422);
    expect(db.correctContactLog).not.toHaveBeenCalled();
  });
});

describe('/api/v1/follow-ups', () => {
  it.each([
    ['GET', '/follow-ups'],
    ['GET', `/follow-ups/count?organization_id=${ORG}`],
    ['GET', `/follow-ups/team?organization_id=${ORG}`],
    ['GET', `/follow-ups/${FOLLOW_UP}`],
    ['POST', '/follow-ups'],
    ['PATCH', `/follow-ups/${FOLLOW_UP}`],
    ['POST', `/follow-ups/${FOLLOW_UP}/done`],
  ])('%s %s requires sign-in', async (method, path) => {
    const res = await app.request(`/api/v1${path}`, { method }, ENV);
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('lists open follow-ups by default, with the filters given', async () => {
    db.listFollowUps.mockResolvedValueOnce([FOLLOW_UP_DETAIL]);
    const res = await request('GET', `/follow-ups?organization_id=${ORG}&assigned_to=me`);
    expect(await res.json()).toEqual({ followUps: [FOLLOW_UP_DETAIL], truncated: false });
    expect(db.listFollowUps).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }), {
      organizationId: ORG,
      counterpartyId: null,
      assignedTo: 'me',
      status: 'open',
    });
    await request(
      'GET',
      `/follow-ups?counterparty_id=${COUNTERPARTY}&assigned_to=${PERSON}&status=all`,
    );
    expect(db.listFollowUps).toHaveBeenLastCalledWith(expect.anything(), {
      organizationId: null,
      counterpartyId: COUNTERPARTY,
      assignedTo: PERSON,
      status: 'all',
    });
  });

  it.each(['?organization_id=x', '?counterparty_id=y', '?assigned_to=you', '?status=late'])(
    'refuses the filter %s',
    async (query) => {
      expect((await request('GET', `/follow-ups${query}`)).status).toBe(422);
      expect(db.listFollowUps).not.toHaveBeenCalled();
    },
  );

  it('says when the list is cut', async () => {
    db.listFollowUps.mockResolvedValueOnce(Array.from({ length: 1001 }, () => FOLLOW_UP_DETAIL));
    const body: { followUps: unknown[]; truncated: boolean } = await (
      await request('GET', '/follow-ups')
    ).json();
    expect(body.followUps).toHaveLength(1000);
    expect(body.truncated).toBe(true);
  });

  it('counts the person’s follow-ups overdue and due today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T16:00:00.000Z'));
    db.countFollowUps.mockResolvedValueOnce({ overdue: 2, dueToday: 1 });
    const res = await request('GET', `/follow-ups/count?organization_id=${ORG}`);
    expect(await res.json()).toEqual({ overdue: 2, dueToday: 1 });
    expect(db.countFollowUps).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
      // 10 am in Alberta on 30 October 2026: today ends at the next midnight there.
      '2026-10-31T06:00:00.000Z',
    );
    expect((await request('GET', '/follow-ups/count')).status).toBe(422);
  });

  it('lists the team who can be made responsible', async () => {
    db.teamNames.mockResolvedValueOnce([{ userId: PERSON, name: 'Adam Admin' }]);
    const res = await request('GET', `/follow-ups/team?organization_id=${ORG}`);
    expect(await res.json()).toEqual({ members: [{ userId: PERSON, name: 'Adam Admin' }] });
    expect((await request('GET', '/follow-ups/team?organization_id=x')).status).toBe(422);
  });

  it('plans a follow-up with the creator’s name from their login', async () => {
    db.getFollowUp.mockResolvedValueOnce(FOLLOW_UP_DETAIL);
    const res = await request('POST', '/follow-ups', {
      counterpartyId: COUNTERPARTY,
      values: PLAN,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(FOLLOW_UP_DETAIL);
    expect(db.createFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      COUNTERPARTY,
      { task: 'Send the bid sheet', dueAt: '2026-10-30T14:00:00.000Z', assignedTo: PERSON },
      'Tess Trader',
    );
  });

  it.each([
    ['not_found', 404],
    ['forbidden', 403],
    ['archived', 409],
    ['not_a_member', 422],
  ] as const)('answers a new follow-up that is %s with %i', async (status, code) => {
    db.createFollowUp.mockResolvedValueOnce({ status });
    const res = await request('POST', '/follow-ups', {
      counterpartyId: COUNTERPARTY,
      values: PLAN,
    });
    expect(res.status).toBe(code);
  });

  it('changes a follow-up of the version the person saw', async () => {
    db.getFollowUp.mockResolvedValueOnce(FOLLOW_UP_DETAIL);
    const res = await request('PATCH', `/follow-ups/${FOLLOW_UP}`, {
      version: VERSION,
      values: PLAN,
    });
    expect(res.status).toBe(200);
    expect(db.updateFollowUp).toHaveBeenCalledWith(
      expect.anything(),
      FOLLOW_UP,
      VERSION,
      expect.objectContaining({ task: 'Send the bid sheet' }),
    );
  });

  it.each([
    ['changed', 409, 'RECORD_CHANGED'],
    ['done', 409, 'DONE'],
    ['archived', 409, 'ARCHIVED'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['not_a_member', 422, 'NOT_A_MEMBER'],
    ['not_found', 404, 'NOT_FOUND'],
  ] as const)('answers a change that is %s with %i %s', async (status, code, error) => {
    db.updateFollowUp.mockResolvedValueOnce({ status });
    const res = await request('PATCH', `/follow-ups/${FOLLOW_UP}`, {
      version: VERSION,
      values: PLAN,
    });
    expect(res.status).toBe(code);
    expect(await res.json()).toMatchObject({ error: { code: error } });
  });

  it('needs the version a change is based on', async () => {
    const res = await request('PATCH', `/follow-ups/${FOLLOW_UP}`, { values: PLAN });
    expect(res.status).toBe(422);
    expect(db.updateFollowUp).not.toHaveBeenCalled();
  });

  it('marks a follow-up done in the person’s own name', async () => {
    db.getFollowUp.mockResolvedValueOnce({
      ...FOLLOW_UP_DETAIL,
      doneAt: VERSION,
      doneByName: 'Tess Trader',
    });
    const res = await request('POST', `/follow-ups/${FOLLOW_UP}/done`);
    expect(res.status).toBe(200);
    expect(db.finishFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      FOLLOW_UP,
      'Tess Trader',
    );
    db.finishFollowUp.mockResolvedValueOnce({ status: 'forbidden' });
    const refused = await request('POST', `/follow-ups/${FOLLOW_UP}/done`);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: { message: expect.stringContaining('the person responsible') as unknown },
    });
  });

  it('maps the database’s refusal of a responsible person who is not on the team', async () => {
    db.updateFollowUp.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'GS004' }));
    const res = await request('PATCH', `/follow-ups/${FOLLOW_UP}`, {
      version: VERSION,
      values: PLAN,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_A_MEMBER' } });
  });
});
