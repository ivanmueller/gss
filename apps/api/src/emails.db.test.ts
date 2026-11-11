import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

beforeAll(async () => {
  await admin`insert into auth.users (id, email) values (${user}, ${`ada-${user}@example.test`})`;
  await admin`insert into app.organizations (id, display_name) values (${org}, ${`Synthetic Org ${org}`})`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
    values (${org}, ${user}, 'org_admin', 'active', now())`;
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
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => {};
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
        'Synthetic body.', false, ${`<${id()}@synthetic.example>`}, null, ${[]}::text[], true
      ) as result`;
    // The receiving waits on the archive's lock; then the archive commits.
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await archiving;

    const [row] = await receiving;
    expect(row?.result.status).toBe('received');
    expect(row?.result.counterparty_id).toBeNull();
  });
});
