import type { CheckedReading } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';

// Integration test of Claude's readings of call transcripts: the real driver, as `app_api`,
// against the real migrations, row level security and functions. Claude itself is not called;
// a checked reading is given as the job would pass it. Fixtures are synthetic (555 numbers).
//
// Calls, recordings and drafts are never deleted, so this test's records stay in the
// throwaway test database; every id is fresh, so nothing else sees them.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { tess: id(), olga: id(), victor: id(), bob: id() };
const orgs = { a: id(), b: id() };
const buyer = id();
const pat = id();
const call = id();
const recording = id();
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

let db: Database;

const READING: CheckedReading = {
  voicemail: false,
  emailAbout: null,
  summary: 'Pat bids on canola delivered.',
  drafts: [
    {
      kind: 'quote',
      fields: {
        side: 'bid',
        commodity: 'canola',
        values: { price: '725', quotedAt: '2026-11-05T15:00:00.000Z', sourceType: 'phone' },
        checks: { price: { said: '725 a tonne', line: 1, doubt: null } },
      },
      lines: [1],
    },
    { kind: 'follow_up', fields: { values: { task: 'Call Pat', assignedTo: '' } }, lines: [1] },
    {
      kind: 'contact',
      contactId: pat,
      fields: { values: { contactRole: 'Head buyer' }, checks: {} },
      lines: [1],
    },
  ],
};

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
    (${orgs.a}, ${users.olga}, 'operations', 'active', now()),
    (${orgs.a}, ${users.victor}, 'viewer', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by) values
    (${buyer}, ${orgs.a}, 'Synthetic Prairie Mills', '{buyer}', 'CA', 'manual', ${users.tess})`;
  await admin`insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, phone, created_by)
    values (${pat}, ${orgs.a}, ${buyer}, 'Pat Buyer', '(403) 555-0100', ${users.tess})`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${users.tess}, true)`;
    await tx`insert into app.calls (id, organization_id, counterparty_id, contact_name, placed_by,
                                    placed_by_name, from_phone, counterparty_phone)
             values (${call}, ${orgs.a}, ${buyer}, 'Pat Buyer', ${users.tess}, 'x',
                     '+18255550199', '+14035550100')`;
  });
  await admin`insert into app.call_recordings (id, organization_id, call_id, telnyx_recording_id,
                                               transcript, transcript_lines, transcribed_at)
    values (${recording}, ${orgs.a}, ${call}, ${`rec-${recording}`},
            'Tess: Hi Pat.\nPat: We bid 725 a tonne.',
            ${JSON.stringify([
              { side: 'caller', start: 0, text: 'Hi Pat.' },
              { side: 'counterparty', start: 2, text: 'We bid 725 a tonne.' },
            ])}::text::jsonb, now())`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe("Claude's reading of a call", () => {
  it('claims the transcript, gives its context, and keeps the reading once', async () => {
    // Other tests' recordings may be claimed too; this one is among them.
    const claim = (await db.claimCallReadings(10)).find((c) => c.recordingId === recording);
    if (claim === undefined) throw new Error('The recording was not claimed.');
    expect(claim.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await db.callReadingContext({ recordingId: recording, token: crypto.randomUUID() }),
    ).toBeNull();
    const context = await db.callReadingContext(claim);
    expect(context).toMatchObject({
      recordingId: recording,
      counterpartyName: 'Synthetic Prairie Mills',
      counterpartyTypes: ['buyer'],
      callerId: users.tess,
      callerName: 'Tess',
      contactName: 'Pat Buyer',
      contacts: [{ id: pat, name: 'Pat Buyer', role: null, email: null, phone: '(403) 555-0100' }],
      lines: [
        { side: 'caller', start: 0, text: 'Hi Pat.' },
        { side: 'counterparty', start: 2, text: 'We bid 725 a tonne.' },
      ],
    });
    expect(context?.calledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    expect(await db.keepCallReading(claim, 'claude-opus-5-5', READING, 2400, 600)).toBe(true);
    expect(await db.keepCallReading(claim, 'claude-opus-5-5', READING, 1, 1)).toBe(false);
    expect(await db.callReadingContext(claim)).toBeNull();
  });

  it('is listed with the recording for everyone on the team, and for no other organization', async () => {
    const [listed] = await db.listRecordings(as(users.victor), buyer);
    expect(listed?.readingFailed).toBe(false);
    expect(listed?.reading).toMatchObject({
      model: 'claude-opus-5-5',
      voicemail: false,
      claudeVoicemail: false,
      voicemailCorrectedByName: null,
      summary: 'Pat bids on canola delivered.',
    });
    expect(listed?.reading?.drafts.map((draft) => [draft.kind, draft.status, draft.lines])).toEqual(
      [
        ['quote', 'open', [1]],
        ['follow_up', 'open', [1]],
        ['contact', 'open', [1]],
      ],
    );
    expect(listed?.reading?.drafts[0]?.fields).toEqual(READING.drafts[0]?.fields);
    expect(listed?.reading?.drafts[2]?.contactId).toBe(pat);
    expect(await db.listRecordings(as(users.bob), buyer)).toEqual([]);
  });

  it('lets a trader accept the bid draft with the bid they saved, once', async () => {
    const [listed] = await db.listRecordings(as(users.tess), buyer);
    const [quoteDraft, followUpDraft, contactDraft] = listed?.reading?.drafts ?? [];
    const bid = id();
    await admin.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${users.tess}, true)`;
      await tx`insert into app.quotes (id, organization_id, counterparty_id, side, commodity_code, created_by)
               values (${bid}, ${orgs.a}, ${buyer}, 'bid', 'canola', ${users.tess})`;
    });
    expect(
      await db.decideCallDraft(as(users.victor), quoteDraft?.id ?? '', 'dismissed', null),
    ).toBe('forbidden');
    expect(await db.decideCallDraft(as(users.bob), quoteDraft?.id ?? '', 'dismissed', null)).toBe(
      'not_found',
    );
    expect(await db.decideCallDraft(as(users.tess), quoteDraft?.id ?? '', 'accepted', id())).toBe(
      'result_not_found',
    );
    expect(await db.decideCallDraft(as(users.tess), quoteDraft?.id ?? '', 'accepted', bid)).toBe(
      'decided',
    );
    expect(await db.decideCallDraft(as(users.tess), quoteDraft?.id ?? '', 'dismissed', null)).toBe(
      'already_decided',
    );
    expect(
      await db.decideCallDraft(as(users.tess), followUpDraft?.id ?? '', 'dismissed', null),
    ).toBe('decided');
    expect(await db.decideCallDraft(as(users.olga), contactDraft?.id ?? '', 'accepted', pat)).toBe(
      'decided',
    );

    const [after] = await db.listRecordings(as(users.tess), buyer);
    expect(
      after?.reading?.drafts.map((draft) => [draft.status, draft.decidedByName, draft.resultId]),
    ).toEqual([
      ['accepted', 'Tess', bid],
      ['dismissed', 'Tess', null],
      ['accepted', 'Olga', pat],
    ]);
    expect(after?.reading?.drafts[0]?.decidedAt).toMatch(/Z$/);
  });

  it('lets a person correct whether it was a voicemail', async () => {
    expect(await db.correctCallVoicemail(as(users.victor), recording, true)).toBe('forbidden');
    expect(await db.correctCallVoicemail(as(users.bob), recording, true)).toBe('not_found');
    expect(await db.correctCallVoicemail(as(users.tess), recording, true)).toBe('saved');
    const [listed] = await db.listRecordings(as(users.olga), buyer);
    expect(listed?.reading).toMatchObject({
      voicemail: true,
      claudeVoicemail: false,
      voicemailCorrectedByName: 'Tess',
    });
    expect(listed?.reading?.voicemailCorrectedAt).toMatch(/Z$/);
  });
});
