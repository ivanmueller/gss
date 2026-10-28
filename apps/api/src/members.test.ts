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
    [{ status: 'no_account' }, 503, 'LOGINS_NOT_CONFIGURED'],
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

  it('refuses a non-admin before looking anything up', async () => {
    db.isOrgAdmin.mockResolvedValueOnce(false);
    const res = await request('POST', '', {
      organizationId: ORG,
      email: 'ana@example.test',
      role: 'trader',
    });
    expect(res.status).toBe(403);
    expect(db.addMember).not.toHaveBeenCalled();
  });

  it('gives an existing login the names typed in', async () => {
    const res = await request('POST', '', {
      organizationId: ORG,
      email: 'ana@example.test',
      role: 'trader',
      firstName: 'Ana',
      lastName: 'Synthetic',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: '00000000-0000-4000-8000-00000000ae01' });
    expect(db.setMemberNames).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      '00000000-0000-4000-8000-00000000ae01',
      'Ana',
      'Synthetic',
    );
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

describe('making a login from the Team page', () => {
  const KEY = 'sb_secret_synthetic';
  const WITH_KEY = { ...ENV, SUPABASE_SECRET_KEY: KEY };
  let adminCalls: { url: string; init: RequestInit }[] = [];
  let adminAnswer: () => Response;

  beforeEach(() => {
    adminCalls = [];
    adminAnswer = () => Response.json({ id: 'new-login' }, { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        if (url.endsWith('/auth/v1/user')) {
          return Promise.resolve(Response.json({ id: USER_ID, email: 'adam@example.test' }));
        }
        adminCalls.push({ url, init });
        return Promise.resolve(adminAnswer());
      }),
    );
  });

  function add(body: Record<string, unknown>) {
    return app.request(
      '/api/v1/members',
      {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ organizationId: ORG, role: 'trader', ...body }),
      },
      WITH_KEY,
    );
  }

  it('makes a confirmed login with the names and a temporary password, then adds it', async () => {
    db.addMember
      .mockResolvedValueOnce({ status: 'no_account' })
      .mockResolvedValueOnce({ status: 'added', id: MEMBER });
    const res = await add({ email: 'ana@example.test', firstName: 'Ana', lastName: 'Synthetic' });
    expect(res.status).toBe(201);
    const { id, temporaryPassword } = await res.json<{ id: string; temporaryPassword: string }>();
    expect(id).toBe(MEMBER);
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);

    expect(adminCalls).toHaveLength(1);
    expect(adminCalls[0]?.url).toBe('https://example-project.supabase.co/auth/v1/admin/users');
    expect(new Headers(adminCalls[0]?.init.headers).get('apikey')).toBe(KEY);
    expect(JSON.parse(adminCalls[0]?.init.body as string)).toEqual({
      email: 'ana@example.test',
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { first_name: 'Ana', last_name: 'Synthetic' },
      app_metadata: { must_change_password: true },
    });
    expect(db.setMemberNames).not.toHaveBeenCalled();
  });

  it('needs a first name for a new login', async () => {
    db.addMember.mockResolvedValueOnce({ status: 'no_account' });
    const res = await add({ email: 'ana@example.test' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'NAME_REQUIRED' } });
    expect(adminCalls).toHaveLength(0);
  });

  it('says when Supabase refuses, without the key or details in the answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.addMember.mockResolvedValueOnce({ status: 'no_account' });
    adminAnswer = () => Response.json({ msg: 'invalid key' }, { status: 401 });
    const res = await add({ email: 'ana@example.test', firstName: 'Ana' });
    vi.restoreAllMocks();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain('LOGIN_SERVICE_FAILED');
    expect(text).not.toContain(KEY);
  });
});

describe('POST /api/v1/me/password', () => {
  const KEY = 'sb_secret_synthetic';
  let calls: { url: string; init: RequestInit }[] = [];

  function stubAuth(appMetadata: Record<string, unknown>) {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        if (url.endsWith('/auth/v1/user')) {
          return Promise.resolve(
            Response.json({ id: USER_ID, email: 'ana@example.test', app_metadata: appMetadata }),
          );
        }
        calls.push({ url, init });
        return Promise.resolve(Response.json({ id: USER_ID }));
      }),
    );
  }

  function choose(
    password: string,
    env: Record<string, unknown> = { ...ENV, SUPABASE_SECRET_KEY: KEY },
  ) {
    return app.request(
      '/api/v1/me/password',
      { method: 'POST', headers: AUTH, body: JSON.stringify({ password }) },
      env,
    );
  }

  it('replaces the temporary password and clears the mark, for the signed-in user only', async () => {
    stubAuth({ must_change_password: true });
    const res = await choose('a long synthetic passphrase');
    expect(res.status).toBe(200);
    expect(calls[0]?.url).toBe(
      `https://example-project.supabase.co/auth/v1/admin/users/${USER_ID}`,
    );
    expect(calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      password: 'a long synthetic passphrase',
      app_metadata: { must_change_password: false },
    });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('is only for a login made with a temporary password', async () => {
    stubAuth({});
    const res = await choose('a long synthetic passphrase');
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it('refuses a short password and a missing key', async () => {
    stubAuth({ must_change_password: true });
    expect((await choose('short')).status).toBe(422);
    expect((await choose('a long synthetic passphrase', ENV)).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});
