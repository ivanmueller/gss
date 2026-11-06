import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of Claude's summaries of companies: the real driver, as `app_api`, against
// the real migrations, row level security and functions. Claude itself is not called; a checked
// summary is given as the job would pass it. Fixtures are synthetic; contact history is never
// deleted, so they stay in the throwaway test database, every id fresh.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { tess: id(), victor: id(), bob: id() };
const orgs = { a: id(), b: id() };
const buyer = id();
const entry = id();
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

let db: Database;

beforeAll(async () => {
  for (const [name, userId] of Object.entries(users)) {
    await admin`insert into auth.users (id, email, raw_user_meta_data)
      values (${userId}, ${`${name}-${userId}@example.test`},
              ${JSON.stringify({ first_name: `${name.charAt(0).toUpperCase()}${name.slice(1)}` })}::text::jsonb)`;
  }
  await admin`insert into app.organizations (id, display_name) values
    (${orgs.a}, ${`Synthetic Org A ${orgs.a}`}), (${orgs.b}, ${`Synthetic Org B ${orgs.b}`})`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.tess}, 'trader', 'active', now()),
    (${orgs.a}, ${users.victor}, 'viewer', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by) values
    (${buyer}, ${orgs.a}, 'Synthetic Prairie Mills', '{buyer}', 'CA', 'manual', ${users.tess})`;
  await admin`insert into app.counterparty_contacts (organization_id, counterparty_id, name, role, phone, created_by)
    values (${orgs.a}, ${buyer}, 'Pat Buyer', 'Merchandiser', '(403) 555-0100', ${users.tess})`;
  // A call logged 10 minutes ago: the company's summary is due.
  await admin.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${users.tess}, true)`;
    await tx`insert into app.contact_log_entries (id, organization_id, counterparty_id, created_by, created_at)
             values (${entry}, ${orgs.a}, ${buyer}, ${users.tess}, now() - interval '10 minutes')`;
    await tx`insert into app.contact_log_revisions (organization_id, entry_id, occurred_at, channel,
                                                    contact_name, notes, recorded_by, recorded_by_name, created_at)
             values (${orgs.a}, ${entry}, now() - interval '10 minutes', 'call', 'Pat Buyer',
                     'Wants November delivery.', ${users.tess}, 'Tess', now() - interval '10 minutes')`;
  });
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe("Claude's summary of a company", () => {
  it('claims a company with something new, gives its records, and keeps the summary once', async () => {
    // Other tests' companies may be claimed too; this one is among them.
    const claim = (await db.claimCounterpartySummaries(10)).find((c) => c.counterpartyId === buyer);
    if (claim === undefined) throw new Error('The company was not claimed.');
    expect(
      await db.counterpartySummaryContext({ counterpartyId: buyer, token: crypto.randomUUID() }),
    ).toBeNull();
    const context = await db.counterpartySummaryContext(claim);
    expect(context).toMatchObject({
      counterpartyId: buyer,
      name: 'Synthetic Prairie Mills',
      types: ['buyer'],
      contacts: [{ name: 'Pat Buyer', role: 'Merchandiser', main: false }],
      history: [{ channel: 'call', contactName: 'Pat Buyer', notes: 'Wants November delivery.' }],
      quotes: [],
      followUps: [],
      draftsWaiting: 0,
    });
    // The contact's phone is never sent (checked by the number itself: a timestamp's digits can
    // hold 555, as on main run #354).
    expect(JSON.stringify(context)).not.toContain('555-0100');
    expect(context?.contacts[0]).not.toHaveProperty('phone');
    expect(context?.contacts[0]).not.toHaveProperty('email');
    expect(Number.isNaN(Date.parse(context?.history[0]?.occurredAt ?? ''))).toBe(false);

    expect(
      await db.keepCounterpartySummary(claim, 'claude-opus-5-5', 'Pat wants November.', 900, 80),
    ).toBe(true);
    expect(await db.keepCounterpartySummary(claim, 'claude-opus-5-5', 'Again.', 1, 1)).toBe(false);
  });

  it('shows the summary to the team, and to nobody in another organization', async () => {
    const view = await db.counterpartySummary(as(users.victor), buyer);
    expect(view).toMatchObject({
      summary: 'Pat wants November.',
      model: 'claude-opus-5-5',
      requested: false,
      writing: false,
      failed: false,
    });
    expect(view?.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(await db.counterpartySummary(as(users.bob), buyer)).toBeNull();
  });

  it('takes a request from a trader, not a viewer, and not right after a summary', async () => {
    expect(await db.requestCounterpartySummary(as(users.victor), buyer)).toBe('forbidden');
    expect(await db.requestCounterpartySummary(as(users.bob), buyer)).toBe('not_found');
    expect(await db.requestCounterpartySummary(as(users.tess), buyer)).toBe('too_soon');
    await admin`update app.counterparty_summaries set written_at = now() - interval '11 minutes'
                 where counterparty_id = ${buyer}`;
    expect(await db.requestCounterpartySummary(as(users.tess), buyer)).toBe('requested');
    expect(await db.counterpartySummary(as(users.tess), buyer)).toMatchObject({ requested: true });
  });
});
