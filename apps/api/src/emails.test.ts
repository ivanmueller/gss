import type { EmailView } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import {
  cloudflareMailer,
  emailConfig,
  sendFailure,
  type Mailer,
  type SendEmailBinding,
} from './email';
import { contentDisposition } from './emails';
import type { EmailSettingsRecord } from './emails-db';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Email sent by hand (F-114 step 3). Synthetic values only: example.test addresses and made-up ids.
const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000bb';
const COMPANY = '00000000-0000-4000-8000-00000000c1aa';
const CONTACT = '00000000-0000-4000-8000-00000000d1aa';
const EMAIL_ID = '00000000-0000-4000-8000-0000000e1aa1';
const KEY = '00000000-0000-4000-8000-00000000beef';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

const EMAIL_ENV = {
  ...ENV,
  EMAIL: { send: () => Promise.resolve({ messageId: 'unused' }) } as SendEmailBinding,
  EMAIL_DOMAIN: 'gss.example.test',
  EMAIL_ORGANIZATION_ID: ORG,
};

const SETTINGS: EmailSettingsRecord = {
  sharedLocalPart: 'info',
  signature: '{name}\n{title}\nPhone: {phone}\n{email}',
  updatedByName: 'Adam',
  updatedAt: '2026-11-10T20:00:00.000Z',
  members: [
    { userId: USER_ID, name: 'Tom Trader', localPart: 'tom', title: 'Grain trader', phone: null },
    {
      userId: '00000000-0000-4000-8000-0000000022aa',
      name: 'Adam',
      localPart: null,
      title: null,
      phone: null,
    },
  ],
};

function emailRow(overrides: Partial<EmailView> = {}): EmailView {
  return {
    id: EMAIL_ID,
    direction: 'outgoing',
    state: 'sent',
    fromAddress: 'tom@gss.example.test',
    fromName: 'Tom Trader',
    to: ['pat@buyer.example.test'],
    cc: [],
    subject: 'Feed oats',
    sentByName: 'Tom Trader',
    contactName: 'Pat Buyer',
    failure: null,
    occurredAt: '2026-11-10T21:00:00.000Z',
    unverifiedSender: false,
    automatic: false,
    parseFailed: false,
    counterpartyId: COMPANY,
    sentTo: null,
    attachmentCount: 0,
    ...overrides,
  };
}

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
let mailer: { send: ReturnType<typeof vi.fn<Mailer['send']>> };
const app = createApp(openDatabase, { mailer: (env) => (emailConfig(env) ? mailer : null) });

function send(body: Record<string, unknown> = {}, env: Record<string, unknown> = EMAIL_ENV) {
  return app.request(
    '/api/v1/emails',
    {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        counterpartyId: COMPANY,
        contactId: CONTACT,
        from: 'own',
        to: ['Pat@Buyer.example.test'],
        cc: [],
        subject: 'Feed oats',
        message: 'Hello Pat,\n\nWe have oats.',
        sendKey: KEY,
        ...body,
      }),
    },
    env,
  );
}

beforeEach(() => {
  db = fakeDatabase();
  db.memberships.mockResolvedValue([
    { organizationId: ORG, organizationName: 'Synthetic Org A', role: 'trader' },
  ]);
  db.getEmailSettings.mockResolvedValue(SETTINGS);
  db.getEmail.mockResolvedValue(emailRow());
  mailer = {
    send: vi.fn<Mailer['send']>(() => Promise.resolve({ kind: 'sent', messageId: 'cf-message-1' })),
  };
  mockAuthServer(
    new Response(JSON.stringify({ id: USER_ID, email: 'tom@example.test' }), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('emailConfig', () => {
  it('needs the binding, a domain and the organization', () => {
    expect(emailConfig(EMAIL_ENV)).toEqual({ domain: 'gss.example.test', organizationId: ORG });
    expect(emailConfig({ ...EMAIL_ENV, EMAIL: undefined })).toBeNull();
    expect(emailConfig({ ...EMAIL_ENV, EMAIL_DOMAIN: 'not a domain' })).toBeNull();
    expect(emailConfig({ ...EMAIL_ENV, EMAIL_DOMAIN: undefined })).toBeNull();
    expect(emailConfig({ ...EMAIL_ENV, EMAIL_ORGANIZATION_ID: 'org-a' })).toBeNull();
    expect(emailConfig({ ...EMAIL_ENV, EMAIL_DOMAIN: ' GSS.Example.Test ' })?.domain).toBe(
      'gss.example.test',
    );
  });
});

describe('POST /emails', () => {
  it('sends exactly the text it keeps, from the person’s own address, with the signature filled', async () => {
    const response = await send();
    expect(response.status).toBe(201);
    const text =
      'Hello Pat,\n\nWe have oats.\n\n-- \nTom Trader\nGrain trader\ntom@gss.example.test';
    expect(db.startOutgoingEmail).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      counterpartyId: COMPANY,
      contactId: CONTACT,
      fromLocalPart: 'tom',
      domain: 'gss.example.test',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Feed oats',
      body: text,
      messageId: `gss-${KEY}`,
    });
    expect(mailer.send).toHaveBeenCalledWith({
      fromAddress: 'tom@gss.example.test',
      fromName: 'Tom Trader',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Feed oats',
      text,
    });
    expect(db.finishOutgoingEmail).toHaveBeenCalledWith(expect.anything(), 'email-1', {
      ok: true,
      providerId: 'cf-message-1',
    });
    expect((await response.json<{ email: EmailView }>()).email.state).toBe('sent');
  });

  it('sends from the shared address', async () => {
    await send({ from: 'shared' });
    expect(mailer.send.mock.calls[0]?.[0].fromAddress).toBe('info@gss.example.test');
  });

  it('refuses the own address of someone who has none, before anything is kept', async () => {
    db.getEmailSettings.mockResolvedValue({
      ...SETTINGS,
      members: [{ userId: USER_ID, name: 'Tom Trader', localPart: null, title: null, phone: null }],
    });
    const response = await send();
    expect(response.status).toBe(409);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe('NO_OWN_ADDRESS');
    expect(db.startOutgoingEmail).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('answers 503 when email is not configured, and never sends', async () => {
    const response = await send({}, ENV);
    expect(response.status).toBe(503);
    expect(db.startOutgoingEmail).not.toHaveBeenCalled();
  });

  it('refuses another organization than the configured one (D1-01)', async () => {
    db.memberships.mockResolvedValue([
      { organizationId: OTHER_ORG, organizationName: 'Synthetic Org B', role: 'org_admin' },
    ]);
    const response = await send({ from: 'shared' });
    expect(response.status).toBe(403);
    expect(db.getEmailSettings).not.toHaveBeenCalled();
    expect(db.startOutgoingEmail).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('refuses a malformed request: bad address, two-line subject, unknown field', async () => {
    for (const body of [
      { to: ['Someone <a@example.test>'] },
      { subject: 'One\r\nBcc: x@example.test' },
      { bcc: ['x@example.test'] },
      { to: [] },
    ]) {
      expect((await send(body)).status).toBe(422);
    }
    expect(db.startOutgoingEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 403],
    ['no_settings', 409],
    ['from_not_allowed', 409],
    ['company_not_found', 404],
    ['archived', 409],
    ['contact_not_found', 422],
    ['bad_recipients', 422],
  ] as const)('maps the database’s %s to %i without sending', async (status, code) => {
    db.startOutgoingEmail.mockResolvedValue({ status });
    expect((await send()).status).toBe(code);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('keeps a refused email as failed and says why (D1-02: the form then makes a new key)', async () => {
    mailer.send.mockResolvedValue({
      kind: 'refused',
      code: 'E_RECIPIENT_SUPPRESSED',
      failure: 'A recipient is on the suppression list.',
    });
    db.getEmail.mockResolvedValue(
      emailRow({ state: 'failed', failure: 'E_RECIPIENT_SUPPRESSED: …' }),
    );
    const response = await send();
    expect(response.status).toBe(502);
    const body = await response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('EMAIL_REFUSED');
    expect(body.error.message).toContain('suppression list');
    expect(db.finishOutgoingEmail).toHaveBeenCalledWith(expect.anything(), 'email-1', {
      ok: false,
      failure: 'E_RECIPIENT_SUPPRESSED: A recipient is on the suppression list.',
    });
  });

  it('leaves an unconfirmed send as sending and never calls it failed', async () => {
    mailer.send.mockResolvedValue({ kind: 'unknown', code: 'E_TIMEOUT' });
    const response = await send();
    expect(response.status).toBe(504);
    expect(db.finishOutgoingEmail).not.toHaveBeenCalled();
  });

  it('never sends twice for the same key: the earlier email as it stands (D1-02)', async () => {
    for (const [state, status, code] of [
      ['sent', 200, undefined],
      ['failed', 409, 'EMAIL_REFUSED'],
      ['sending', 409, 'EMAIL_IN_PROGRESS'],
      ['unconfirmed', 409, 'EMAIL_IN_PROGRESS'],
    ] as const) {
      db.startOutgoingEmail.mockResolvedValue({
        status: 'already_started',
        email: emailRow({ state }),
      });
      const response = await send();
      expect(response.status).toBe(status);
      if (code !== undefined) {
        expect((await response.json<{ error: { code: string } }>()).error.code).toBe(code);
      }
    }
    expect(mailer.send).not.toHaveBeenCalled();
  });
});

describe('the Cloudflare mailer', () => {
  it('sends text from the address with the name, without Cc when there is none', async () => {
    const binding = {
      send: vi.fn<SendEmailBinding['send']>(() => Promise.resolve({ messageId: 'id-1' })),
    };
    const sender = cloudflareMailer({ ...EMAIL_ENV, EMAIL: binding });
    const outcome = await sender?.send({
      fromAddress: 'tom@gss.example.test',
      fromName: 'Tom Trader',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Feed oats',
      text: 'Hello',
    });
    expect(outcome).toEqual({ kind: 'sent', messageId: 'id-1' });
    expect(binding.send).toHaveBeenCalledWith({
      from: { email: 'tom@gss.example.test', name: 'Tom Trader' },
      to: ['pat@buyer.example.test'],
      subject: 'Feed oats',
      text: 'Hello',
    });
  });

  it('is absent without the configuration', () => {
    expect(cloudflareMailer({ ...ENV, EMAIL: undefined })).toBeNull();
  });

  it('reads Cloudflare’s codes: refusals are definite, the rest unknown', () => {
    const coded = (code: unknown) => Object.assign(new Error('x'), { code });
    expect(sendFailure(coded('E_RECIPIENT_SUPPRESSED')).kind).toBe('refused');
    expect(sendFailure(coded('E_DAILY_LIMIT_EXCEEDED')).kind).toBe('refused');
    expect(sendFailure(coded('E_DELIVERY_FAILED'))).toEqual({
      kind: 'unknown',
      code: 'E_DELIVERY_FAILED',
    });
    expect(sendFailure(coded('E_INTERNAL_SERVER_ERROR')).kind).toBe('unknown');
    expect(sendFailure(new Error('no code'))).toEqual({ kind: 'unknown', code: 'E_UNKNOWN' });
    expect(sendFailure(coded('bad code; with text'))).toEqual({
      kind: 'unknown',
      code: 'E_UNKNOWN',
    });
  });
});

describe('settings', () => {
  it('shows the configured domain only to the configured organization', async () => {
    const response = await app.request('/api/v1/emails/settings', { headers: AUTH }, EMAIL_ENV);
    const { settings } = await response.json<{
      settings: { configured: boolean; domain: string | null; ownLocalPart: string | null };
    }>();
    expect(settings).toMatchObject({
      configured: true,
      domain: 'gss.example.test',
      ownLocalPart: 'tom',
    });

    db.memberships.mockResolvedValue([
      { organizationId: OTHER_ORG, organizationName: 'B', role: 'org_admin' },
    ]);
    const other = await app.request('/api/v1/emails/settings', { headers: AUTH }, EMAIL_ENV);
    expect(
      (await other.json<{ settings: { configured: boolean; domain: string | null } }>()).settings,
    ).toMatchObject({
      configured: false,
      domain: null,
    });
  });

  it('refuses another organization’s admin before the database (D1-01)', async () => {
    db.memberships.mockResolvedValue([
      { organizationId: OTHER_ORG, organizationName: 'B', role: 'org_admin' },
    ]);
    const response = await app.request(
      '/api/v1/emails/settings',
      {
        method: 'PUT',
        headers: AUTH,
        body: JSON.stringify({ sharedLocalPart: 'info', signature: null }),
      },
      EMAIL_ENV,
    );
    expect(response.status).toBe(403);
    expect(db.saveEmailSettings).not.toHaveBeenCalled();
    const member = await app.request(
      `/api/v1/emails/members/${USER_ID}`,
      {
        method: 'PUT',
        headers: AUTH,
        body: JSON.stringify({ localPart: 'info', title: null, phone: null }),
      },
      EMAIL_ENV,
    );
    expect(member.status).toBe(403);
    expect(db.saveMemberEmail).not.toHaveBeenCalled();
  });

  it('maps a non-admin’s save to 403 and a taken address to 409', async () => {
    db.saveEmailSettings.mockResolvedValue('forbidden');
    const put = (body: unknown) =>
      app.request(
        '/api/v1/emails/settings',
        { method: 'PUT', headers: AUTH, body: JSON.stringify(body) },
        EMAIL_ENV,
      );
    expect((await put({ sharedLocalPart: 'info', signature: null })).status).toBe(403);
    db.saveEmailSettings.mockResolvedValue('address_taken');
    expect((await put({ sharedLocalPart: 'tom', signature: null })).status).toBe(409);
    expect((await put({ sharedLocalPart: 'Not valid!', signature: null })).status).toBe(422);
  });

  it('saves a person’s address, title and phone together', async () => {
    const response = await app.request(
      `/api/v1/emails/members/${USER_ID}`,
      {
        method: 'PUT',
        headers: AUTH,
        body: JSON.stringify({ localPart: ' Tom ', title: 'Grain trader', phone: '' }),
      },
      EMAIL_ENV,
    );
    expect(response.status).toBe(200);
    expect(db.saveMemberEmail).toHaveBeenCalledWith(expect.anything(), ORG, USER_ID, {
      localPart: 'tom',
      title: 'Grain trader',
      phone: null,
    });
  });
});

describe('GET /emails', () => {
  it('lists a company’s emails, a page before a cursor (D1-03)', async () => {
    db.listEmails.mockResolvedValue([emailRow()]);
    const first = await app.request(
      `/api/v1/emails?counterparty_id=${COMPANY}`,
      { headers: AUTH },
      EMAIL_ENV,
    );
    expect(first.status).toBe(200);
    expect(db.listEmails).toHaveBeenLastCalledWith(expect.anything(), ORG, COMPANY, null);
    await app.request(
      `/api/v1/emails?counterparty_id=${COMPANY}&before_id=${EMAIL_ID}`,
      { headers: AUTH },
      EMAIL_ENV,
    );
    expect(db.listEmails).toHaveBeenLastCalledWith(expect.anything(), ORG, COMPANY, {
      id: EMAIL_ID,
    });
  });

  it('refuses a malformed cursor and an unknown company', async () => {
    const bad = await app.request(
      `/api/v1/emails?counterparty_id=${COMPANY}&before_id=not-an-id`,
      { headers: AUTH },
      EMAIL_ENV,
    );
    expect(bad.status).toBe(422);
    db.listEmails.mockResolvedValue(null);
    const unknown = await app.request(
      `/api/v1/emails?counterparty_id=${COMPANY}`,
      { headers: AUTH },
      EMAIL_ENV,
    );
    expect(unknown.status).toBe(404);
  });

  it('reads emails without the sending configuration', async () => {
    const response = await app.request(`/api/v1/emails/${EMAIL_ID}`, { headers: AUTH }, ENV);
    expect(response.status).toBe(200);
  });
});

// Received email on no company (F-114 step 4b). Synthetic values only.
const RAW_KEY = `raw/${ORG}/${'a'.repeat(64)}.eml`;
const HTML_ATTACHMENT = '<script>alert(1)</script>';

/** A received message with one HTML attachment (a hostile file a sender might choose). */
function rawMessage(): Uint8Array {
  return new TextEncoder().encode(
    [
      'From: Sam <sam@sender.example.test>',
      'To: nobody@gss.example.test',
      'Subject: Prices',
      'Message-ID: <m1@sender.example.test>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'See attached.',
      '--b',
      'Content-Type: text/html; name="page.html"',
      'Content-Disposition: attachment; filename="page.html"',
      '',
      HTML_ATTACHMENT,
      '--b--',
      '',
    ].join('\r\n'),
  );
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bucketWith(objects: Record<string, Uint8Array>) {
  return {
    get: vi.fn((key: string) => {
      const data = objects[key];
      return Promise.resolve(
        data === undefined ? null : { arrayBuffer: () => Promise.resolve(data.slice().buffer) },
      );
    }),
    put: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };
}

describe('received email on no company', () => {
  it('lists it a page at a time, for any member, before a cursor', async () => {
    db.listUnmatchedEmails.mockResolvedValue({
      emails: [emailRow({ direction: 'incoming', state: 'received', counterpartyId: null })],
      more: true,
      total: 51,
    });
    const first = await app.request('/api/v1/emails/unmatched', { headers: AUTH }, ENV);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ more: true, total: 51 });
    expect(db.listUnmatchedEmails).toHaveBeenLastCalledWith(expect.anything(), ORG, null);
    await app.request(`/api/v1/emails/unmatched?before_id=${EMAIL_ID}`, { headers: AUTH }, ENV);
    expect(db.listUnmatchedEmails).toHaveBeenLastCalledWith(expect.anything(), ORG, {
      id: EMAIL_ID,
    });
    const bad = await app.request('/api/v1/emails/unmatched?before_id=x', { headers: AUTH }, ENV);
    expect(bad.status).toBe(422);
  });

  it('refuses someone of no organization', async () => {
    db.memberships.mockResolvedValue([]);
    const response = await app.request('/api/v1/emails/unmatched', { headers: AUTH }, ENV);
    expect(response.status).toBe(403);
    expect(db.listUnmatchedEmails).not.toHaveBeenCalled();
  });

  it('links it to a company and answers every refusal plainly', async () => {
    db.getEmail.mockResolvedValue(emailRow({ direction: 'incoming', state: 'received' }));
    const link = (body: unknown) =>
      app.request(
        `/api/v1/emails/${EMAIL_ID}/link`,
        { method: 'POST', headers: AUTH, body: JSON.stringify(body) },
        ENV,
      );
    const done = await link({ counterpartyId: COMPANY, contactId: CONTACT });
    expect(done.status).toBe(200);
    expect(db.linkEmail).toHaveBeenLastCalledWith(
      expect.anything(),
      ORG,
      EMAIL_ID,
      COMPANY,
      CONTACT,
    );

    expect((await link({ counterpartyId: COMPANY })).status).toBe(422);
    expect((await link({ counterpartyId: COMPANY, contactId: null, extra: 1 })).status).toBe(422);

    const answers: [Awaited<ReturnType<Database['linkEmail']>>, number, string][] = [
      ['not_found', 404, 'NOT_FOUND'],
      ['removed', 404, 'NOT_FOUND'],
      ['already_linked', 409, 'ALREADY_LINKED'],
      ['company_not_found', 409, 'COMPANY_UNAVAILABLE'],
    ];
    for (const [answer, status, code] of answers) {
      db.linkEmail.mockResolvedValueOnce(answer);
      const response = await link({ counterpartyId: COMPANY, contactId: null });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
  });

  it('deletes it; a retry after a lost answer is no error; mail on a company is for admins', async () => {
    const remove = () =>
      app.request(`/api/v1/emails/${EMAIL_ID}/remove`, { method: 'POST', headers: AUTH }, ENV);
    expect((await remove()).status).toBe(200);
    db.removeEmail.mockResolvedValueOnce('already_removed');
    expect((await remove()).status).toBe(200);
    db.removeEmail.mockResolvedValueOnce('forbidden');
    expect((await remove()).status).toBe(403);
    db.removeEmail.mockResolvedValueOnce('not_found');
    expect((await remove()).status).toBe(404);
    expect(db.removeEmail).toHaveBeenLastCalledWith(expect.anything(), ORG, EMAIL_ID);
  });
});

describe('a received email’s files', () => {
  it('gives an attachment from the original as a plain download, never as a page', async () => {
    db.storedEmailFile.mockResolvedValue({
      rawKey: RAW_KEY,
      rawSize: 400,
      attachment: { position: 0, fileName: 'page.html', sha256: await sha256(HTML_ATTACHMENT) },
    });
    const response = await app.request(
      `/api/v1/emails/${EMAIL_ID}/attachments/0`,
      { headers: AUTH },
      { ...ENV, EMAIL_FILES: bucketWith({ [RAW_KEY]: rawMessage() }) },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HTML_ATTACHMENT);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="page.html"; filename*=UTF-8''page.html`,
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(db.storedEmailFile).toHaveBeenLastCalledWith(expect.anything(), ORG, EMAIL_ID, 0);
  });

  it('finds an attachment by its hash when its position moved', async () => {
    db.storedEmailFile.mockResolvedValue({
      rawKey: RAW_KEY,
      rawSize: 400,
      attachment: { position: 3, fileName: null, sha256: await sha256(HTML_ATTACHMENT) },
    });
    const response = await app.request(
      `/api/v1/emails/${EMAIL_ID}/attachments/3`,
      { headers: AUTH },
      { ...ENV, EMAIL_FILES: bucketWith({ [RAW_KEY]: rawMessage() }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('filename="attachment-4"');
  });

  it('answers plainly when the file cannot be given, with no address in the log', async () => {
    const env = { ...ENV, EMAIL_FILES: bucketWith({ [RAW_KEY]: rawMessage() }) };
    const get = (path: string, withEnv: object = env) =>
      app.request(`/api/v1/emails/${EMAIL_ID}/${path}`, { headers: AUTH }, withEnv);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Not set up: no bucket.
    expect((await get('attachments/0', ENV)).status).toBe(503);
    expect((await get('original', ENV)).status).toBe(503);
    // Not listed, removed, another organization's or sent email: the database finds nothing.
    db.storedEmailFile.mockResolvedValue(null);
    expect((await get('attachments/0')).status).toBe(404);
    expect((await get('original')).status).toBe(404);
    // A malformed position, before the database.
    db.storedEmailFile.mockClear();
    for (const position of ['100', '01', '-1', 'x']) {
      expect((await get(`attachments/${position}`)).status).toBe(404);
    }
    expect(db.storedEmailFile).not.toHaveBeenCalled();
    // The hash found nowhere in the original.
    db.storedEmailFile.mockResolvedValue({
      rawKey: RAW_KEY,
      rawSize: 400,
      attachment: { position: 0, fileName: 'page.html', sha256: 'b'.repeat(64) },
    });
    expect((await get('attachments/0')).status).toBe(502);
    // The original missing from the bucket.
    db.storedEmailFile.mockResolvedValue({
      rawKey: `raw/${ORG}/${'c'.repeat(64)}.eml`,
      rawSize: 400,
      attachment: { position: 0, fileName: 'page.html', sha256: 'b'.repeat(64) },
    });
    expect((await get('attachments/0')).status).toBe(404);
    expect(errors.mock.calls.flat().join(' ')).not.toContain('@');
    errors.mockRestore();
  });

  it('gives the original of an email as a download', async () => {
    db.storedEmailFile.mockResolvedValue({ rawKey: RAW_KEY, rawSize: 400, attachment: null });
    const response = await app.request(
      `/api/v1/emails/${EMAIL_ID}/original`,
      { headers: AUTH },
      { ...ENV, EMAIL_FILES: bucketWith({ [RAW_KEY]: rawMessage() }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Disposition')).toContain(`email-${EMAIL_ID}.eml`);
    expect(await response.text()).toContain('Subject: Prices');
    expect(db.storedEmailFile).toHaveBeenLastCalledWith(expect.anything(), ORG, EMAIL_ID, null);
  });
});

describe('contentDisposition', () => {
  it('keeps the header safe whatever the name', () => {
    expect(contentDisposition('prix été.pdf')).toBe(
      `attachment; filename="prix _t_.pdf"; filename*=UTF-8''prix%20%C3%A9t%C3%A9.pdf`,
    );
    expect(contentDisposition("it's (1).pdf")).toBe(
      `attachment; filename="it's (1).pdf"; filename*=UTF-8''it%27s%20%281%29.pdf`,
    );
  });
});
