import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectionOptions, createDatabase } from './db';
import { readInbound, sha256Hex } from './inbound-email';

// Integration test of received emails (F-114 step 2) where two connections matter: the real
// driver, as `app_api` with nobody signed in (the Worker's email handler), against the real
// migrations. Fixtures are synthetic; emails are never deleted, so every id is fresh.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const archiver = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const worker = postgres(API_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const user = id();
const org = id();
const company = id();
const sender = `farmer-${company}@synthetic.example`;
// Two admins of the organization: one is demoted while saving.
const admins = { kept: id(), demoted: id() };

beforeAll(async () => {
  await admin`insert into auth.users (id, email) values (${user}, ${`ada-${user}@example.test`})`;
  await admin`insert into app.organizations (id, display_name) values (${org}, ${`Synthetic Org ${org}`})`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
    values (${org}, ${user}, 'org_admin', 'active', now())`;
  for (const adminId of Object.values(admins)) {
    await admin`insert into auth.users (id, email) values (${adminId}, ${`admin-${adminId}@example.test`})`;
    await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
      values (${org}, ${adminId}, 'org_admin', 'active', now())`;
  }
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by)
    values (${company}, ${org}, ${`Synthetic Farm ${company}`}, '{seller}', 'CA', 'manual', ${user})`;
  await admin`insert into app.counterparty_contacts (organization_id, counterparty_id, name, email, created_by)
    values (${org}, ${company}, 'Synthetic Farmer', ${sender}, ${user})`;
});

afterAll(async () => {
  await Promise.all([admin.end(), archiver.end(), worker.end()]);
});

describe('receiving an email while its company is being archived', () => {
  // Codex's review of F-114-2, finding R1-03: the match is seen again under the company's lock.
  it('leaves the email to link by hand once the archive commits', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const archiving = archiver.begin(async (tx) => {
      await tx`update app.counterparties set archived_at = now() where id = ${company}`;
      locked();
      await held;
    });
    await isLocked;

    const receiving = worker<{ result: { status: string; counterparty_id: string | null } }[]>`
      select app.receive_email(${org}, 'info@gss.example', ${sender}, 'Synthetic Farmer',
        ${['info@gss.example']}::text[], ${[]}::text[], null, 'Synthetic subject',
        'Synthetic body.', false, ${`<${id()}@synthetic.example>`}, null, ${[]}::text[], true,
        false, false, ${`raw/${org}/${'a'.repeat(64)}.eml`}, 10, '[]'::jsonb, now()
      ) as result`.execute();
    // Postgres.js sends a query only when asked (Codex's round 2): it is sent now, and seen
    // waiting on the archive's lock before the archive commits.
    let waiting = false;
    for (let tries = 0; tries < 100 && !waiting; tries += 1) {
      const [row] = await admin<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock' and query like '%app.receive_email%'
          and pid <> pg_backend_pid()`;
      waiting = (row?.n ?? 0) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting).toBe(true);
    release();
    await archiving;

    const [row] = await receiving;
    expect(row?.result.status).toBe('received');
    expect(row?.result.counterparty_id).toBeNull();
  });
});

describe('saving an email address while being demoted', () => {
  // Codex's final review of F-114-2, finding R4-01: the admin check is made after the
  // organization's lock, so a demotion committed during the wait is seen.
  it('refuses the save once the demotion commits, and changes nothing', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const demoting = archiver.begin(async (tx) => {
      await tx`update app.organization_members set role = 'viewer'
        where organization_id = ${org} and user_id = ${admins.demoted}`;
      locked();
      await held;
    });
    await isLocked;

    const saving = worker
      .begin(async (tx) => {
        await tx`select set_config('app.user_id', ${admins.demoted}, true)`;
        return tx<{ result: string }[]>`
          select app.save_member_email_address(${org}, ${admins.kept}, 'kept') as result`;
      })
      .then((rows) => rows[0]?.result);
    let waiting = false;
    for (let tries = 0; tries < 100 && !waiting; tries += 1) {
      const [row] = await admin<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock' and query like '%app.save_member_email_address%'
          and pid <> pg_backend_pid()`;
      waiting = (row?.n ?? 0) > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting).toBe(true);
    release();
    await demoting;

    expect(await saving).toBe('forbidden');
    const [count] = await admin<{ n: number }[]>`
      select count(*)::int as n from app.member_email_addresses
      where organization_id = ${org} and user_id = ${admins.kept}`;
    expect(count?.n).toBe(0);
  });
});

describe('the Worker keeping a received message (F-114 step 4a)', () => {
  const CRLF = String.fromCharCode(13, 10);

  it('admits, keeps with its attachments, then calls a second delivery a duplicate', async () => {
    // The Worker's own connection settings (no fetch_types; Codex's review, finding R1-01).
    const production = postgres(API_URL, connectionOptions(API_URL));
    const db = createDatabase(production);
    const raw = new TextEncoder().encode(
      [
        'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass',
        `From: Synthetic Farmer <${sender}>`,
        'To: info@gss.example',
        `Message-ID: <${id()}@synthetic.example>`,
        'Subject: Synthetic offer',
        'Content-Type: multipart/mixed; boundary="b"',
        '',
        '--b',
        'Content-Type: text/plain',
        '',
        'Synthetic body.',
        '--b',
        'Content-Type: application/pdf; name="synthetic.pdf"',
        'Content-Disposition: attachment; filename="synthetic.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        'JVBERi0xLjQK',
        '--b--',
      ].join(CRLF),
    );
    const sha = await sha256Hex(raw);
    const email = await readInbound(raw, sha, { from: sender, to: 'info@gss.example' });
    expect(await db.admitEmail(org, email.fromAddress, email.messageId)).toBe('admit');
    const receivedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const received = {
      organizationId: org,
      email,
      rawKey: `raw/${org}/${sha}.eml`,
      rawSize: raw.byteLength,
      receivedAt,
    };
    const kept = await db.receiveEmail(received);
    expect(kept).toMatchObject({ status: 'received', duplicate: false });
    const [row] = await admin<
      { auth_passed: boolean; files: number; raw_key: string; to: string[]; occurred_at: Date }[]
    >`
      select e.auth_passed, e.raw_key, e.to_addresses::text[] as to, e.occurred_at,
             (select count(*)::int from app.email_attachments a where a.email_id = e.id) as files
        from app.emails e where e.organization_id = ${org} and e.message_id = ${email.messageId}`;
    expect(row).toEqual({
      auth_passed: true,
      raw_key: `raw/${org}/${sha}.eml`,
      files: 1,
      to: ['info@gss.example'],
      occurred_at: receivedAt,
    });
    expect(await db.admitEmail(org, email.fromAddress, email.messageId)).toBe('duplicate');
    expect(await db.receiveEmail(received)).toMatchObject({ status: 'received', duplicate: true });
    await production.end();
  });

  it('keeps an attachment whose name has an emoji at the length limit (R3-02)', async () => {
    const production = postgres(API_URL, connectionOptions(API_URL));
    const db = createDatabase(production);
    const name = `${'a'.repeat(254)}${String.fromCodePoint(0x1f33e)}.pdf`;
    const raw = new TextEncoder().encode(
      [
        `From: Synthetic Farmer <${sender}>`,
        'To: info@gss.example',
        `Message-ID: <${id()}@synthetic.example>`,
        'Content-Type: multipart/mixed; boundary="b"',
        '',
        '--b',
        'Content-Type: text/html',
        '',
        '<table><tr><td>250</td><td>100</td></tr></table>',
        '--b',
        'Content-Type: application/pdf',
        `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Transfer-Encoding: base64',
        '',
        'JVBERi0xLjQK',
        '--b--',
      ].join(CRLF),
    );
    const sha = await sha256Hex(raw);
    const email = await readInbound(raw, sha, { from: sender, to: 'info@gss.example' });
    const kept = await db.receiveEmail({
      organizationId: org,
      email,
      rawKey: `raw/${org}/${sha}.eml`,
      rawSize: raw.byteLength,
      receivedAt: new Date(),
    });
    expect(kept).toMatchObject({ status: 'received', duplicate: false });
    const [row] = await admin<{ file_name: string; body_text: string }[]>`
      select a.file_name, e.body_text
        from app.email_attachments a join app.emails e on e.id = a.email_id
       where e.organization_id = ${org} and e.message_id = ${email.messageId}`;
    expect(row).toEqual({ file_name: 'a'.repeat(254), body_text: '250	100' });
    await production.end();
  });
});
