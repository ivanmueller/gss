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

describe('received email on no company (F-114 step 4b)', () => {
  // As the Worker's API runs it: the real driver without fetch_types, as app_api, as a viewer
  // (everyone on the team links and deletes it, the owner's answer 10).
  const viewer = id();
  const analyst = id();
  const outsider = id();
  const outsiderOrg = id();
  // Its own company: the one above is archived by the first test.
  const company = id();
  const ctx = (userId: string) => ({ userId, requestId: id() });

  beforeAll(async () => {
    await admin`insert into app.counterparties
        (id, organization_id, legal_name, types, primary_country, source, created_by)
      values (${company}, ${org}, ${`Synthetic Buyer ${company}`}, '{buyer}', 'US', 'manual', ${user})`;
    await admin`insert into auth.users (id, email) values (${viewer}, ${`viewer-${viewer}@example.test`})`;
    await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
      values (${org}, ${viewer}, 'viewer', 'active', now())`;
    await admin`insert into auth.users (id, email) values (${analyst}, ${`analyst-${analyst}@example.test`})`;
    await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
      values (${org}, ${analyst}, 'analyst', 'active', now())`;
    await admin`insert into auth.users (id, email) values (${outsider}, ${`out-${outsider}@example.test`})`;
    await admin`insert into app.organizations (id, display_name) values (${outsiderOrg}, ${`Other Org ${outsiderOrg}`})`;
    await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
      values (${outsiderOrg}, ${outsider}, 'org_admin', 'active', now())`;
  });

  /** Mail to an address of nobody (on no company), kept at the given time, with one attachment. */
  async function unmatched(at: Date): Promise<string> {
    const [row] = await worker<{ result: { id: string; counterparty_id: string | null } }[]>`
      select app.receive_email(${org}, 'nobody@gss.example', 'stranger@synthetic.example', null,
        ${['nobody@gss.example']}::text[], ${[]}::text[], null, 'Synthetic offer',
        'Synthetic body.', false, ${`<${id()}@synthetic.example>`}, null, ${[]}::text[], false,
        false, false, ${`raw/${org}/${'d'.repeat(64)}.eml`}, 400,
        ${worker.json([
          {
            position: 0,
            file_name: 'offer.pdf',
            content_type: 'application/pdf',
            size_bytes: 12,
            sha256: 'e'.repeat(64),
            disposition: 'attachment',
            content_id: null,
          },
        ])}::jsonb, ${at.toISOString()}::timestamptz) as result`;
    expect(row?.result.counterparty_id).toBeNull();
    return row?.result.id ?? '';
  }

  it('lists it newest first, a page at a time, past a cursor email linked meanwhile', async () => {
    const production = postgres(API_URL, connectionOptions(API_URL));
    const db = createDatabase(production);
    try {
      // Three at the same moment (ties ordered by id) and one later.
      const same = new Date(Date.now() - 60_000);
      const tied = [await unmatched(same), await unmatched(same), await unmatched(same)].sort();
      const latest = await unmatched(new Date(Date.now() - 1_000));

      const first = await db.listUnmatchedEmails(ctx(viewer), org, null);
      const ids = first.emails.map((e) => e.id);
      const expected = [latest, ...[...tied].reverse()];
      expect(ids.filter((value) => expected.includes(value))).toEqual(expected);
      const mine = first.emails.find((e) => e.id === latest);
      expect(mine).toMatchObject({
        counterpartyId: null,
        sentTo: 'nobody@gss.example',
        attachmentCount: 1,
        unverifiedSender: true,
      });
      expect(first.total).toBeGreaterThanOrEqual(4);

      // The cursor email is linked before the next page is asked for: the page still starts
      // after it (D3 plan: the cursor is read whatever became of it).
      const cursor = tied[2] ?? '';
      expect(await db.linkEmail(ctx(viewer), org, cursor, company, null)).toBe('done');
      const next = await db.listUnmatchedEmails(ctx(viewer), org, { id: cursor });
      expect(next.emails.map((e) => e.id).slice(0, 2)).toEqual([tied[1], tied[0]]);

      // An unknown cursor, or another organization's email, gives an empty page.
      expect(await db.listUnmatchedEmails(ctx(viewer), org, { id: id() })).toMatchObject({
        emails: [],
        more: false,
      });
      // Another organization's member sees none of it.
      const outside = await db.listUnmatchedEmails(ctx(outsider), outsiderOrg, null);
      expect(outside.emails.some((e) => tied.includes(e.id))).toBe(false);
    } finally {
      await production.end();
    }
  });

  it('is linked by a viewer once, refused for an archived company or another organization', async () => {
    const production = postgres(API_URL, connectionOptions(API_URL));
    const db = createDatabase(production);
    try {
      const email = await unmatched(new Date());
      // Another organization's member: not found, nothing changed.
      expect(await db.linkEmail(ctx(outsider), outsiderOrg, email, company, null)).toBe(
        'not_found',
      );
      expect(await db.linkEmail(ctx(outsider), org, email, company, null)).toBe('not_found');
      // A contact of another company.
      expect(await db.linkEmail(ctx(viewer), org, email, company, id())).toBe('company_not_found');
      expect(await db.linkEmail(ctx(viewer), org, email, company, null)).toBe('done');
      expect(await db.linkEmail(ctx(viewer), org, email, company, null)).toBe('already_linked');
      const linked = await db.getEmail(ctx(viewer), org, email);
      expect(linked?.counterpartyId).toBe(company);

      // A viewer cannot delete mail on a company (admins only).
      expect(await db.removeEmail(ctx(viewer), org, email)).toBe('forbidden');

      // An archived company is refused.
      const archived = id();
      await admin`insert into app.counterparties
          (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at)
        values (${archived}, ${org}, ${`Archived Farm ${archived}`}, '{seller}', 'CA', 'manual',
                ${user}, now())`;
      const other = await unmatched(new Date());
      expect(await db.linkEmail(ctx(viewer), org, other, archived, null)).toBe('company_not_found');
    } finally {
      await production.end();
    }
  });

  it('is deleted by an analyst, then gone from the list, the email, its files and linking', async () => {
    const production = postgres(API_URL, connectionOptions(API_URL));
    const db = createDatabase(production);
    try {
      const email = await unmatched(new Date());
      const viewed = await db.getEmail(ctx(viewer), org, email);
      expect(viewed?.attachments).toEqual([
        {
          position: 0,
          fileName: 'offer.pdf',
          contentType: 'application/pdf',
          sizeBytes: 12,
          disposition: 'attachment',
        },
      ]);
      expect(await db.storedEmailFile(ctx(viewer), org, email, 0)).toEqual({
        rawKey: `raw/${org}/${'d'.repeat(64)}.eml`,
        rawSize: 400,
        attachment: { position: 0, fileName: 'offer.pdf', sha256: 'e'.repeat(64) },
      });
      expect(await db.storedEmailFile(ctx(viewer), org, email, 1)).toBeNull();
      expect(await db.storedEmailFile(ctx(outsider), outsiderOrg, email, null)).toBeNull();

      expect(await db.removeEmail(ctx(outsider), outsiderOrg, email)).toBe('not_found');
      expect(await db.removeEmail(ctx(analyst), org, email)).toBe('done');
      expect(await db.removeEmail(ctx(analyst), org, email)).toBe('already_removed');

      const listed = await db.listUnmatchedEmails(ctx(viewer), org, null);
      expect(listed.emails.some((e) => e.id === email)).toBe(false);
      expect(await db.getEmail(ctx(viewer), org, email)).toBeNull();
      expect(await db.storedEmailFile(ctx(viewer), org, email, 0)).toBeNull();
      expect(await db.storedEmailFile(ctx(viewer), org, email, null)).toBeNull();
      expect(await db.linkEmail(ctx(viewer), org, email, company, null)).toBe('removed');
      // The row itself is kept.
      const [kept] = await admin<{ n: number }[]>`
        select count(*)::int as n from app.emails where id = ${email}`;
      expect(kept?.n).toBe(1);
    } finally {
      await production.end();
    }
  });
});
