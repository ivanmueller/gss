import { createHash } from 'node:crypto';

import type { CheckedReading } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of Claude's readings of received email (F-114 step 5a): the real driver, as
// `app_api`, against the real migrations, row level security and functions. Claude itself is not
// called; a checked reading is given as the job would pass it. Fixtures are synthetic.
//
// Emails, readings and drafts are never deleted, so this test's records stay in the throwaway
// test database; every id is fresh, so nothing else sees them.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { tess: id(), ann: id(), bob: id() };
const orgs = { a: id(), b: id() };
const buyer = id();
const pat = id();
const as = (userId: string): RequestContext => ({ userId, requestId: id() });
const LINES = ['Subject: Re: Canola', 'Please send the contract by Friday.'];
const DUE = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

let db: Database;

/** Mail from Pat, received by the Worker: its id. */
async function receive(message: string): Promise<string> {
  const key = `raw/${orgs.a}/${createHash('sha256').update(message).digest('hex')}.eml`;
  const [row] = await admin<{ result: { id: string } }[]>`
    select app.receive_email(${orgs.a}, 'info@gss.example', ${`pat-${pat}@buyer.example`}, 'Pat',
                             ${['info@gss.example']}::text[], ${[]}::text[], null, 'Re: Canola',
                             ${'Please send the contract by Friday.'}, false, ${message}, null,
                             ${[]}::text[], true, false, false, ${key}, 100, '[]'::jsonb, now())
           as result`;
  if (row === undefined) throw new Error('Not received.');
  return row.result.id;
}

function reading(tess: string): CheckedReading {
  return {
    voicemail: false,
    emailAbout: null,
    summary: 'Pat asks for the contract.',
    drafts: [
      {
        kind: 'follow_up',
        fields: { values: { task: 'Send Pat the contract', assignedTo: tess, dueAt: DUE } },
        lines: [1],
      },
    ],
  };
}

/** Claims, then keeps a reading of, one email; the claim among any others'. */
async function readEmail(emailId: string) {
  const claim = (await db.claimEmailReadings(10)).find((c) => c.emailId === emailId);
  if (claim === undefined) throw new Error('The email was not claimed.');
  return claim;
}

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
    (${orgs.a}, ${users.ann}, 'org_admin', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by) values
    (${buyer}, ${orgs.a}, 'Synthetic Prairie Mills', '{buyer}', 'CA', 'manual', ${users.tess})`;
  await admin`insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, email, created_by)
    values (${pat}, ${orgs.a}, ${buyer}, 'Pat Buyer', ${`pat-${pat}@buyer.example`}, ${users.tess})`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe("Claude's reading of a received email", () => {
  it('claims the email, gives its context, keeps the reading once, and lists its draft', async () => {
    const emailId = await receive(`m-${id()}@buyer.example`);
    const claim = await readEmail(emailId);
    const context = await db.emailReadingContext(claim);
    expect(context).toMatchObject({
      emailId,
      counterpartyId: buyer,
      counterpartyTypes: ['buyer'],
      fromName: 'Pat',
      contactId: pat,
      subject: 'Re: Canola',
      body: 'Please send the contract by Friday.',
      assigneeId: null,
    });
    expect(
      await db.keepEmailReading(claim, LINES, false, {
        model: 'claude-opus-5-5',
        reading: reading(users.tess),
        inputTokens: 900,
        outputTokens: 200,
      }),
    ).toBe(true);
    expect(await db.keepEmailReading(claim, LINES, false, null)).toBe(false);

    const drafts = await db.listOpenDrafts(as(users.tess), {
      organizationId: orgs.a,
      counterpartyId: buyer,
      kind: null,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: 'follow_up',
      source: 'email',
      callId: null,
      emailId,
      emailSubject: 'Re: Canola',
      callerId: null,
      callerName: 'Pat',
      contactName: 'Pat Buyer',
      sourceLines: [{ line: 1, text: 'Please send the contract by Friday.' }],
    });
    expect(
      await db.listOpenDrafts(as(users.bob), {
        organizationId: orgs.a,
        counterpartyId: null,
        kind: null,
      }),
    ).toEqual([]);

    const verified = await db.verifyCallDraft(
      as(users.tess),
      drafts[0]?.id ?? '',
      'Tess',
      new Date(),
    );
    expect(verified).toMatchObject({ status: 'verified', kind: 'follow_up' });
  });

  it('hides and refuses the drafts of an email removed since', async () => {
    const emailId = await receive(`m-${id()}@buyer.example`);
    const claim = await readEmail(emailId);
    expect(
      await db.keepEmailReading(claim, LINES, false, {
        model: 'claude-opus-5-5',
        reading: reading(users.tess),
        inputTokens: 900,
        outputTokens: 200,
      }),
    ).toBe(true);
    const [draft] = await db.listOpenDrafts(as(users.tess), {
      organizationId: orgs.a,
      counterpartyId: buyer,
      kind: null,
    });
    if (draft === undefined) throw new Error('No draft listed.');
    await admin.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.ann}, true)`;
      await tx`select app.remove_email(${emailId})`;
    });
    expect(
      await db.listOpenDrafts(as(users.tess), {
        organizationId: orgs.a,
        counterpartyId: buyer,
        kind: null,
      }),
    ).toEqual([]);
    expect(await db.verifyCallDraft(as(users.tess), draft.id, 'Tess', new Date())).toEqual({
      status: 'not_found',
    });
  });
});
