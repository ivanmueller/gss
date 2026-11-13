import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type RequestContext } from './db';

// Integration test of Draft with Claude and Reply (F-114 step 5b): the API's database code as
// `app_api` against the real migrations. Fixtures are synthetic; emails are never deleted, so
// every organization and id is fresh.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const db = postgresDatabase(API_URL);
const id = () => crypto.randomUUID();
const as = (userId: string): RequestContext => ({ userId, requestId: id() });
const org = id();
const company = id();
const received = id();
const people = { adam: id(), vera: id() };

beforeAll(async () => {
  await admin`insert into app.organizations (id, display_name) values (${org}, ${`Synthetic Org ${org}`})`;
  for (const [name, userId] of Object.entries(people)) {
    await admin`insert into auth.users (id, email, raw_user_meta_data)
      values (${userId}, ${`${name}-${userId}@example.test`}, ${admin.json({ first_name: name })})`;
    await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at)
      values (${org}, ${userId}, ${name === 'vera' ? 'viewer' : 'org_admin'}, 'active', now())`;
  }
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by)
    values (${company}, ${org}, ${`Synthetic Buyer ${company}`}, '{buyer}', 'CA', 'manual', ${people.adam})`;
  await admin`insert into app.emails
      (id, organization_id, direction, status, counterparty_id, from_address, to_addresses, subject,
       body_text, message_id, raw_key, raw_size, envelope_to, auth_passed, reply_to)
    values (${received}, ${org}, 'incoming', 'received', ${company}, 'pat@buyer.example.test',
            '{info@gss.example.test}', 'Barley for December', 'Can you do 2 loads?',
            ${`m-${received}`}, ${`raw/${org}/${'0'.repeat(64)}.eml`}, 10, 'info@gss.example.test', true,
            'pat.reply@buyer.example.test')`;
  expect(await db.saveEmailSettings(as(people.adam), org, 'info', '{name}')).toBe('saved');
});

afterAll(async () => {
  await Promise.all([admin.end(), db.close()]);
});

describe('a reply drafted with Claude', () => {
  it('is drafted from the context and sent with both links, shown on the email', async () => {
    const started = await db.startEmailDraft(as(people.vera), org, company, received, id());
    if (started.status !== 'started') throw new Error(started.status);

    expect(await db.answeredEmailIds(as(people.vera), org, received)).toEqual({
      messageId: `m-${received}`,
      references: [],
    });
    const context = await db.emailDraftContext(as(people.vera), org, company, received);
    expect(context?.answer).toMatchObject({ id: received, subject: 'Barley for December' });
    expect(context?.name).toBe(`Synthetic Buyer ${company}`);

    await db.finishEmailDraft(as(people.vera), started.id, {
      drafted: true,
      model: 'claude-opus-5-5',
      inputTokens: 100,
      outputTokens: 10,
    });

    const reply = {
      organizationId: org,
      counterpartyId: company,
      contactId: null,
      fromLocalPart: 'info',
      domain: 'gss.example.test',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Re: Barley for December',
      body: 'Hi Pat',
      messageId: `gss-${id()}`,
      replyToEmailId: received,
      claudeDraftId: started.id,
      autoDraftId: null,
      attachments: [],
    };
    const sending = await db.startOutgoingEmail(as(people.vera), reply);
    if (sending.status !== 'started') throw new Error(sending.status);
    const email = await db.getEmail(as(people.vera), org, sending.id);
    expect(email).toMatchObject({
      inReplyToSubject: 'Barley for December',
      draftedByClaude: true,
    });
    const received_ = await db.getEmail(as(people.vera), org, received);
    expect(received_).toMatchObject({
      inReplyToSubject: null,
      draftedByClaude: false,
      replyToAddress: 'pat.reply@buyer.example.test',
    });
    expect(email?.replyToAddress).toBeNull();

    // Once the answered email is deleted, its subject no longer shows on the reply.
    expect(await db.removeEmail(as(people.adam), org, received)).toBe('done');
    expect((await db.getEmail(as(people.vera), org, sending.id))?.inReplyToSubject).toBeNull();

    // A retry of the same send (its answer lost) still finds it, the answered email deleted
    // meanwhile (Codex's final review, F-114-5b-R2-01).
    const retry = await db.startOutgoingEmail(as(people.vera), reply);
    expect(retry.status).toBe('already_started');
  });

  it('has no context for a company of another organization', async () => {
    const other = id();
    await admin`insert into app.organizations (id, display_name) values (${other}, 'Synthetic Other')`;
    expect(await db.emailDraftContext(as(people.vera), other, company, null)).toBeNull();
    expect((await db.startEmailDraft(as(people.vera), other, company, null, id())).status).toBe(
      'forbidden',
    );
  });
});
