import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type RequestContext } from './db';

// Integration test of the email drafts Claude makes by itself (F-114 step 5c): the API's database
// code as `app_api` against the real migrations, the job's calls without a signed-in person.
// Fixtures are synthetic; emails and drafts are never deleted, so every organization and id is
// fresh.
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
const readingClaim = id();
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
      (id, organization_id, direction, status, counterparty_id, from_address, from_name, to_addresses,
       subject, body_text, message_id, raw_key, raw_size, envelope_to, auth_passed, gss_member)
    values (${received}, ${org}, 'incoming', 'received', ${company}, 'pat@buyer.example.test',
            'Pat Buyer', '{vera@gss.example.test}', 'Barley?', 'What barley do you have?',
            ${`m-${received}`}, ${`raw/${org}/${'0'.repeat(64)}.eml`}, 10, 'vera@gss.example.test',
            true, ${people.vera})`;
  await admin`insert into app.email_readings (organization_id, email_id, state, attempts, claimed_at, claim_token)
    values (${org}, ${received}, 'pending', 1, now(), ${readingClaim})`;
  expect(await db.saveEmailSettings(as(people.adam), org, 'info', '{name}')).toBe('saved');
});

afterAll(async () => {
  await Promise.all([admin.end(), db.close()]);
});

describe('a reply Claude drafts by itself', () => {
  it('is added by the reading, written by the job, listed, and sent once', async () => {
    const kept = await db.keepEmailReading(
      { emailId: received, token: readingClaim },
      ['Subject: Barley?', 'What barley do you have?'],
      false,
      {
        model: 'claude-test',
        reading: {
          voicemail: false,
          summary: 'Asks about barley.',
          drafts: [],
          emailAbout: 'The barley GSS has',
        },
        inputTokens: 10,
        outputTokens: 5,
      },
    );
    expect(kept).toBe(true);

    const claims = await db.claimEmailAutoDrafts(10);
    const [draftId] = await admin<{ id: string }[]>`
      select id from app.email_auto_drafts where email_id = ${received}`.then((rows) =>
      rows.map((row) => row.id),
    );
    const claim = claims.find((item) => item.draftId === draftId);
    if (claim === undefined) throw new Error('the draft was not claimed');

    const context = await db.emailAutoDraftContext(claim);
    expect(context).toMatchObject({
      source: 'email',
      about: 'The barley GSS has',
      shared: true,
      sender: { name: 'vera', title: null },
    });
    expect(context !== null && context.source !== 'reminder' ? context.answer?.id : null).toBe(
      received,
    );

    expect(
      await db.keepEmailAutoDraft(claim, {
        model: 'claude-test',
        subject: 'Re: Barley?',
        message: 'Hi Pat, we have barley at [price].',
        checkThis: [],
        placeholders: ['[price]'],
        inputTokens: 100,
        outputTokens: 20,
      }),
    ).toBe(true);

    const list = await db.listEmailAutoDrafts(as(people.vera), org, {
      counterpartyId: company,
      mine: true,
    });
    expect(list?.drafts).toHaveLength(1);
    expect(list?.drafts[0]).toMatchObject({
      id: draftId,
      source: 'email',
      emailFrom: 'Pat Buyer',
      assignedToName: 'vera',
      fromChoice: 'shared',
      to: ['pat@buyer.example.test'],
      placeholders: ['[price]'],
      answeredSince: null,
    });
    expect(list?.drafts[0]?.draftedAt).toMatch(/Z$/);
    expect(await db.countEmailAutoDrafts(as(people.vera), org)).toBe(1);
    expect(await db.countEmailAutoDrafts(as(people.adam), org)).toBe(0);
    expect(
      await db.listEmailAutoDrafts(as(id()), org, { counterpartyId: null, mine: false }),
    ).toBeNull();

    const email = {
      organizationId: org,
      counterpartyId: company,
      contactId: null,
      fromLocalPart: 'info',
      domain: 'gss.example.test',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Re: Barley?',
      body: 'Hi Pat',
      messageId: `gss-${id()}`,
      replyToEmailId: received,
      claudeDraftId: null,
      autoDraftId: draftId ?? null,
    };
    const first = await db.startOutgoingEmail(as(people.vera), email);
    if (first.status !== 'started') throw new Error(first.status);
    expect(
      (await db.startOutgoingEmail(as(people.adam), { ...email, messageId: `gss-${id()}` })).status,
    ).toBe('auto_draft_used');
    expect(await db.dismissEmailAutoDraft(as(people.adam), org, draftId ?? '')).toBe('taken');

    // Refused by the mail service: the draft is free again (D1-01).
    await db.finishOutgoingEmail(as(people.vera), first.id, { ok: false, failure: 'refused' });
    const second = await db.startOutgoingEmail(as(people.vera), {
      ...email,
      messageId: `gss-${id()}`,
    });
    expect(second.status).toBe('started');
    if (second.status !== 'started') return;
    await db.finishOutgoingEmail(as(people.vera), second.id, {
      ok: true,
      providerId: `<cf-${id()}>`,
    });
    const sent = await db.getEmail(as(people.vera), org, second.id);
    expect(sent?.draftedByClaude).toBe(true);
    expect(await db.countEmailAutoDrafts(as(people.vera), org)).toBe(0);
    expect(await db.dismissEmailAutoDraft(as(people.vera), org, draftId ?? '')).toBe('taken');
  });
});

describe('a reminder (F-114 step 5c, part 2)', () => {
  /** A company with a GSS email sent 8 days ago and a pending reminder of it. */
  async function quietEmail(subject: string) {
    const quiet = id();
    const sent = id();
    const reminder = id();
    await admin`insert into app.counterparties
        (id, organization_id, legal_name, types, primary_country, source, created_by)
      values (${quiet}, ${org}, ${`Synthetic Quiet ${quiet}`}, '{buyer}', 'CA', 'manual', ${people.adam})`;
    await admin`insert into app.emails
        (id, organization_id, direction, status, counterparty_id, sent_by, sent_by_name, from_address,
         to_addresses, subject, body_text, message_id)
      values (${sent}, ${org}, 'outgoing', 'sending', ${quiet}, ${people.adam}, 'adam',
              'info@gss.example.test', '{pat@buyer.example.test}', ${subject},
              'Could you confirm the 2 loads?', ${`gss-${sent}`})`;
    await admin`update app.emails set status = 'sent', provider_message_id = ${`<cf-${sent}@gss.example.test>`},
                       occurred_at = now() - interval '8 days'
                 where id = ${sent}`;
    await admin`insert into app.email_auto_drafts
        (id, organization_id, counterparty_id, source, email_id, about, assigned_to, from_choice)
      values (${reminder}, ${org}, ${quiet}, 'reminder', ${sent}, ${`No answer to "${subject}"`},
              ${people.adam}, 'shared')`;
    return { quiet, sent, reminder };
  }

  it('is described, kept, listed and sent as a reply in the same thread', async () => {
    const { quiet, sent, reminder } = await quietEmail('Barley for December');
    const claim = (await db.claimEmailAutoDrafts(10)).find((item) => item.draftId === reminder);
    if (claim === undefined) throw new Error('the reminder was not claimed');

    const context = await db.emailAutoDraftContext(claim);
    expect(context).toMatchObject({
      source: 'reminder',
      about: 'No answer to "Barley for December"',
      types: ['buyer'],
      sender: { name: 'adam', title: null },
      shared: true,
      reminded: {
        subject: 'Barley for December',
        body: 'Could you confirm the 2 loads?',
        to: ['pat@buyer.example.test'],
        contactName: null,
        sentByName: 'adam',
      },
    });
    expect(context?.happenedAt).toMatch(/Z$/);
    expect(context).not.toHaveProperty('quotes');

    expect(
      await db.keepEmailAutoDraft(claim, {
        model: 'claude-test',
        subject: 'Re: Barley for December',
        message: 'Hi Pat, could you confirm the 2 loads?',
        checkThis: [],
        placeholders: [],
        inputTokens: 100,
        outputTokens: 20,
      }),
    ).toBe(true);
    const list = await db.listEmailAutoDrafts(as(people.adam), org, {
      counterpartyId: quiet,
      mine: true,
    });
    expect(list?.drafts[0]).toMatchObject({
      id: reminder,
      source: 'reminder',
      emailId: sent,
      emailSubject: 'Barley for December',
      to: ['pat@buyer.example.test'],
      answeredSince: null,
    });

    const started = await db.startOutgoingEmail(as(people.adam), {
      organizationId: org,
      counterpartyId: quiet,
      contactId: null,
      fromLocalPart: 'info',
      domain: 'gss.example.test',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Re: Barley for December',
      body: 'Hi Pat',
      messageId: `gss-${id()}`,
      replyToEmailId: sent,
      claudeDraftId: null,
      autoDraftId: reminder,
    });
    if (started.status !== 'started') throw new Error(started.status);
    // The reply's headers name the id the recipient knows GSS's email by.
    expect(await db.answeredEmailIds(as(people.adam), org, sent)).toEqual({
      messageId: `<cf-${sent}@gss.example.test>`,
      references: [],
    });
    // An email still being sent has no id yet: no headers.
    expect(await db.answeredEmailIds(as(people.adam), org, started.id)).toBeNull();
    expect(await db.answeredEmailIds(as(id()), org, sent)).toBeNull();
  });

  it('is put away when Claude finds it not needed, once, under its claim', async () => {
    const { reminder } = await quietEmail('Thanks for the call');
    const claim = (await db.claimEmailAutoDrafts(10)).find((item) => item.draftId === reminder);
    if (claim === undefined) throw new Error('the reminder was not claimed');
    expect(await db.skipEmailAutoDraft({ ...claim, token: id() })).toBe(false);
    expect(await db.skipEmailAutoDraft(claim)).toBe(true);
    expect(await db.skipEmailAutoDraft(claim)).toBe(false);
    const [row] = await admin<{ state: string }[]>`
      select state from app.email_auto_drafts where id = ${reminder}`;
    expect(row?.state).toBe('skipped');
  });
});
