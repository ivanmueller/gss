import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const MEMBER = '00000000-0000-4000-8000-00000000a0a2';
const VERSION = '2026-10-28T14:05:09.123456Z';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

function request(method: string, path: string, body?: unknown) {
  return app.request(
    `/api/v1/members${path}`,
    { method, headers: AUTH, ...(body !== undefined && { body: JSON.stringify(body) }) },
    ENV,
  );
}

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  openDatabase.mockClear();
});

describe('/api/v1/members', () => {
  it.each([
    ['GET', `?organization_id=${ORG}`],
    ['POST', ''],
    ['PATCH', `/${MEMBER}`],
  ])('%s requires sign-in', async (method, path) => {
    const res = await app.request(`/api/v1/members${path}`, { method }, ENV);
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('lists the team for an admin and refuses everyone else', async () => {
    const res = await request('GET', `?organization_id=${ORG}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ members: [] });
    expect(db.listMembers).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }), ORG);

    db.listMembers.mockResolvedValueOnce(null);
    expect((await request('GET', `?organization_id=${ORG}`)).status).toBe(403);
    expect((await request('GET', '?organization_id=org-a')).status).toBe(422);
  });

  it.each([
    [{ status: 'added', id: MEMBER }, 201, null],
    [{ status: 'forbidden' }, 403, 'FORBIDDEN'],
    [{ status: 'no_account' }, 404, 'NO_ACCOUNT'],
    [{ status: 'already_member' }, 409, 'ALREADY_MEMBER'],
  ] as const)('adds a person: %o answers %i', async (result, status, code) => {
    db.addMember.mockResolvedValueOnce(result);
    const res = await request('POST', '', {
      organizationId: ORG,
      email: ' Ana@Example.test ',
      role: 'trader',
    });
    expect(res.status).toBe(status);
    if (code) expect(await res.json()).toMatchObject({ error: { code } });
    expect(db.addMember).toHaveBeenCalledWith(expect.anything(), ORG, 'Ana@Example.test', 'trader');
  });

  it('refuses a malformed addition without opening the database', async () => {
    const res = await request('POST', '', { organizationId: ORG, email: 'nope', role: 'trader' });
    expect(res.status).toBe(422);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('changes a role and names for the version on screen', async () => {
    const res = await request('PATCH', `/${MEMBER}`, {
      organizationId: ORG,
      version: VERSION,
      role: 'operations',
      firstName: ' Ana ',
      lastName: '',
    });
    expect(res.status).toBe(200);
    expect(db.updateMember).toHaveBeenCalledWith(expect.anything(), ORG, MEMBER, VERSION, {
      role: 'operations',
      firstName: 'Ana',
      lastName: null,
    });
  });

  it.each([
    [{ status: 'not_found' }, 404, 'NOT_FOUND'],
    [{ status: 'forbidden' }, 403, 'FORBIDDEN'],
    [{ status: 'changed' }, 409, 'RECORD_CHANGED'],
    [{ status: 'self' }, 409, 'OWN_MEMBERSHIP'],
  ] as const)('answers %o with %i %s', async (result, status, code) => {
    db.updateMember.mockResolvedValueOnce(result);
    const res = await request('PATCH', `/${MEMBER}`, {
      organizationId: ORG,
      version: VERSION,
      status: 'suspended',
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error: { code } });
  });

  it('says when the last active admin would be lost', async () => {
    db.updateMember.mockRejectedValueOnce(
      Object.assign(new Error('an organization keeps at least one active admin'), {
        code: 'GS001',
      }),
    );
    const res = await request('PATCH', `/${MEMBER}`, {
      organizationId: ORG,
      version: VERSION,
      role: 'viewer',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'LAST_ADMIN' } });
  });

  it('refuses an empty change and "invited"', async () => {
    for (const body of [
      { organizationId: ORG, version: VERSION },
      { organizationId: ORG, version: VERSION, status: 'invited' },
    ]) {
      expect((await request('PATCH', `/${MEMBER}`, body)).status).toBe(422);
    }
    expect(openDatabase).not.toHaveBeenCalled();
  });
});
