import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { emailConfig, type Mailer, type SendEmailBinding } from './email';
import type { EmailSettingsRecord } from './emails-db';
import { forwardingCodeHash, forwardingCodeText, newForwardingCode } from './forwarding';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Forwarding addresses (F-233). Synthetic values only: example addresses and made-up ids.
const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';
const ADDRESS_ID = '00000000-0000-4000-8000-0000000f0a11';
const SEND_ID = '00000000-0000-4000-8000-0000000f05e1';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

const EMAIL_ENV = {
  ...ENV,
  EMAIL: { send: () => Promise.resolve({ messageId: 'unused' }) } as SendEmailBinding,
  EMAIL_DOMAIN: 'gss.example.test',
  EMAIL_ORGANIZATION_ID: ORG,
};

const SETTINGS: EmailSettingsRecord = {
  sharedLocalPart: 'info',
  signature: null,
  updatedByName: 'Adam',
  updatedAt: '2026-11-10T20:00:00.000Z',
  members: [{ userId: USER_ID, name: 'Tom Trader', localPart: 'tom', title: null, phone: null }],
};

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
let mailer: { send: ReturnType<typeof vi.fn<Mailer['send']>> };
const app = createApp(openDatabase, { mailer: (env) => (emailConfig(env) ? mailer : null) });

function call(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  env: Record<string, unknown> = EMAIL_ENV,
) {
  return app.request(
    `/api/v1/me/forwarding-addresses${path}`,
    { method, headers: AUTH, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    env,
  );
}

beforeEach(() => {
  db = fakeDatabase();
  db.memberships.mockResolvedValue([
    { organizationId: ORG, organizationName: 'Synthetic Org A', role: 'viewer' },
  ]);
  db.getEmailSettings.mockResolvedValue(SETTINGS);
  mailer = {
    send: vi.fn<Mailer['send']>(() => Promise.resolve({ kind: 'sent', messageId: 'cf-1' })),
  };
  mockAuthServer(
    new Response(JSON.stringify({ id: USER_ID, email: 'tom@example.test' }), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the code', () => {
  it('is 6 digits, and hashed with the address row', async () => {
    for (let i = 0; i < 50; i += 1) expect(newForwardingCode()).toMatch(/^[0-9]{6}$/);
    const hash = await forwardingCodeHash('012345', ADDRESS_ID);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await forwardingCodeHash('012345', ADDRESS_ID.toUpperCase())).toBe(hash);
    expect(await forwardingCodeHash('012346', ADDRESS_ID)).not.toBe(hash);
  });

  it('is emailed with who asked and what to ignore', () => {
    const text = forwardingCodeText('012345', 'Tom Trader');
    expect(text).toContain('012345');
    expect(text).toContain('Tom Trader asked');
    expect(text).toContain('ignore this email');
  });
});

describe('POST /me/forwarding-addresses', () => {
  it('adds the address for any role, reserves, sends and records the code', async () => {
    const res = await call('', 'POST', { address: ' Tom.Home@Mail.Example ' });
    expect(res.status).toBe(201);
    expect(db.addForwardingAddress).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      'tom.home@mail.example',
      'gss.example.test',
    );
    expect(db.reserveForwardingCode).toHaveBeenCalledWith(expect.anything(), ORG, ADDRESS_ID);
    const sent = mailer.send.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      fromAddress: 'info@gss.example.test',
      to: ['tom.personal@mail.example'],
      subject: 'Your GSS forwarding code',
    });
    const code = /code is ([0-9]{6})/.exec(sent?.text ?? '')?.[1] ?? '';
    expect(db.finishForwardingCode).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      SEND_ID,
      await forwardingCodeHash(code, ADDRESS_ID),
    );
    expect(db.failForwardingCode).not.toHaveBeenCalled();
  });

  it('sends nothing for an address already confirmed', async () => {
    db.addForwardingAddress.mockResolvedValue({
      status: 'exists',
      id: ADDRESS_ID,
      confirmed: true,
    });
    const res = await call('', 'POST', { address: 'tom.home@mail.example' });
    expect(res.status).toBe(201);
    expect(db.reserveForwardingCode).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('never sends without a reservation (D1-03)', async () => {
    db.reserveForwardingCode.mockResolvedValue({ status: 'too_soon' });
    const res = await call('', 'POST', { address: 'tom.home@mail.example' });
    expect(res.status).toBe(429);
    expect(mailer.send).not.toHaveBeenCalled();
    db.reserveForwardingCode.mockResolvedValue({ status: 'too_many' });
    expect((await call('', 'POST', { address: 'tom.home@mail.example' })).status).toBe(429);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('marks a refused send failed and keeps no code', async () => {
    mailer.send.mockResolvedValue({
      kind: 'refused',
      code: 'E_RECIPIENT_SUPPRESSED',
      failure: 'A recipient is suppressed.',
    });
    const res = await call('', 'POST', { address: 'tom.home@mail.example' });
    expect(res.status).toBe(502);
    expect(db.failForwardingCode).toHaveBeenCalledWith(expect.anything(), ORG, SEND_ID);
    expect(db.finishForwardingCode).not.toHaveBeenCalled();
  });

  it('refuses a malformed address, its own domain, a taken address and a sixth', async () => {
    expect((await call('', 'POST', { address: 'two@a.example, b@c.example' })).status).toBe(422);
    db.addForwardingAddress.mockResolvedValue({ status: 'on_own_domain' });
    expect((await call('', 'POST', { address: 'x@gss.example.test' })).status).toBe(422);
    db.addForwardingAddress.mockResolvedValue({ status: 'taken' });
    expect((await call('', 'POST', { address: 'x@mail.example' })).status).toBe(409);
    db.addForwardingAddress.mockResolvedValue({ status: 'too_many' });
    expect((await call('', 'POST', { address: 'x@mail.example' })).status).toBe(409);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('needs email set up for the organization', async () => {
    expect((await call('', 'POST', { address: 'x@mail.example' }, ENV)).status).toBe(503);
    expect(
      (
        await call(
          '',
          'POST',
          { address: 'x@mail.example' },
          { ...EMAIL_ENV, EMAIL_ORGANIZATION_ID: OTHER_ORG },
        )
      ).status,
    ).toBe(503);
    expect(db.addForwardingAddress).not.toHaveBeenCalled();
  });
});

describe('the other routes', () => {
  it('lists the caller’s addresses and whether forwarding is available', async () => {
    const res = await call('', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      addresses: [],
      available: true,
      sharedAddress: 'info@gss.example.test',
      ownAddress: 'tom@gss.example.test',
    });
    expect(await (await call('', 'GET', undefined, ENV)).json()).toMatchObject({
      available: false,
      sharedAddress: null,
    });
    // The shared address as an admin set it, not always info@ (R1-01).
    const [me] = SETTINGS.members;
    if (me === undefined) throw new Error('No member.');
    db.getEmailSettings.mockResolvedValue({
      ...SETTINGS,
      sharedLocalPart: 'trading',
      members: [{ ...me, localPart: null }],
    });
    expect(await (await call('', 'GET')).json()).toMatchObject({
      sharedAddress: 'trading@gss.example.test',
      ownAddress: null,
    });
  });

  it('sends a new code', async () => {
    expect((await call(`/${ADDRESS_ID}/code`, 'POST')).status).toBe(200);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    db.reserveForwardingCode.mockResolvedValue({ status: 'already_confirmed' });
    expect((await call(`/${ADDRESS_ID}/code`, 'POST')).status).toBe(409);
    expect((await call('/not-a-uuid/code', 'POST')).status).toBe(404);
  });

  it('confirms with the code’s hash, never the code', async () => {
    const res = await call(`/${ADDRESS_ID}/confirm`, 'POST', { code: '012 345' });
    expect(res.status).toBe(200);
    expect(db.confirmForwardingAddress).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      ADDRESS_ID,
      await forwardingCodeHash('012345', ADDRESS_ID),
    );
    db.confirmForwardingAddress.mockResolvedValue('wrong');
    expect((await call(`/${ADDRESS_ID}/confirm`, 'POST', { code: '000000' })).status).toBe(422);
    db.confirmForwardingAddress.mockResolvedValue('expired');
    expect((await call(`/${ADDRESS_ID}/confirm`, 'POST', { code: '000000' })).status).toBe(410);
    expect((await call(`/${ADDRESS_ID}/confirm`, 'POST', { code: '12345' })).status).toBe(422);
  });

  it('removes', async () => {
    expect((await call(`/${ADDRESS_ID}`, 'DELETE')).status).toBe(200);
    db.removeForwardingAddress.mockResolvedValue('not_found');
    expect((await call(`/${ADDRESS_ID}`, 'DELETE')).status).toBe(404);
  });
});
