import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';
import type { VerifyDraftResult } from './readings-db';

// Integration test of Claude's drafts listed in their sections and verified in one click (the
// owner's answers of 2026-11-06, F-115): the real driver, as `app_api`, against the real
// migrations, row level security and functions. Fixtures are synthetic (555 numbers).
//
// Calls and drafts are never deleted, so this test's records stay in the throwaway test
// database; every id is fresh, so nothing else sees them.
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
const archived = id();
const pat = id();
const call = id();
const recording = id();
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

const HOUR = 3_600_000;
const quotedAt = new Date(Date.now() - HOUR).toISOString();
const validUntil = new Date(Date.now() + 7 * 24 * HOUR).toISOString();

/** A complete bid as Claude might draft it: everything the usual form requires. */
const COMPLETE_BID = {
  side: 'bid',
  commodity: 'canola',
  values: {
    firmness: 'indicative',
    price: '725.00',
    currency: 'CAD',
    priceUnit: 'MT',
    deliveryBasis: 'delivered',
    quantityMax: '500',
    quotedAt,
    validUntil,
    sourceType: 'phone',
    sourceReference: 'Call drafted by Claude',
  },
  checks: { price: { said: 'CAD 725 a tonne', line: 1, doubt: 'a dash in the line' } },
};

const drafts = {
  bid: id(),
  raced: id(),
  noValidUntil: id(),
  noUnit: id(),
  edited: id(),
  followUp: id(),
  followUpNoTime: id(),
  newContact: id(),
  patsRole: id(),
  archivedBid: id(),
};

let db: Database;
let position = 0;

async function insertDraft(
  draftId: string,
  kind: string,
  fields: unknown,
  options: { counterpartyId?: string; contactId?: string | null } = {},
) {
  await admin`insert into app.call_drafts (id, organization_id, counterparty_id, call_id,
                                           recording_id, position, kind, fields, lines, contact_id)
    values (${draftId}, ${orgs.a}, ${options.counterpartyId ?? buyer}, ${call}, ${recording},
            ${position++}, ${kind}, ${JSON.stringify(fields)}::text::jsonb, '[1]'::jsonb,
            ${options.contactId ?? null})`;
}

const count = async (table: 'quotes' | 'follow_ups' | 'counterparty_contacts') => {
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from ${admin('app')}.${admin(table)}
    where counterparty_id = ${buyer}`;
  return row?.n ?? 0;
};

const contactVersion = async (contactId: string) => {
  const [row] = await admin<{ version: string }[]>`
    select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as version
    from app.counterparty_contacts where id = ${contactId}`;
  if (!row) throw new Error('no such contact');
  return row.version;
};

const statusOf = async (draftId: string) => {
  const [row] = await admin<
    { status: string; decided_by: string | null; result_id: string | null }[]
  >`
    select status, decided_by, result_id from app.call_drafts where id = ${draftId}`;
  return row;
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
    (${buyer}, ${orgs.a}, 'Synthetic Prairie Mills', '{buyer}', 'CA', 'manual', ${users.tess}),
    (${archived}, ${orgs.a}, 'Synthetic Closed Mills', '{buyer}', 'CA', 'manual', ${users.tess})`;
  await admin`update app.counterparties set archived_at = now() where id = ${archived}`;
  await admin`insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, email, phone, created_by)
    values (${pat}, ${orgs.a}, ${buyer}, 'Pat Buyer', 'pat@example.test', '(403) 555-0100', ${users.tess})`;
  await admin.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${users.tess}, true)`;
    await tx`insert into app.calls (id, organization_id, counterparty_id, contact_name, placed_by,
                                    placed_by_name, from_phone, counterparty_phone)
             values (${call}, ${orgs.a}, ${buyer}, 'Pat Buyer', ${users.tess}, 'x',
                     '+18255550199', '+14035550100')`;
  });
  await admin`insert into app.call_recordings (id, organization_id, call_id, telnyx_recording_id,
                                               transcript, transcribed_at)
    values (${recording}, ${orgs.a}, ${call}, ${`rec-${recording}`},
            'Tess: Hi Pat.\nPat: We bid CAD 725 a tonne.', now())`;
  await insertDraft(drafts.bid, 'quote', COMPLETE_BID);
  await insertDraft(drafts.raced, 'quote', COMPLETE_BID);
  await insertDraft(drafts.noValidUntil, 'quote', {
    ...COMPLETE_BID,
    values: { ...COMPLETE_BID.values, validUntil: undefined, deliveryBasis: undefined },
  });
  // Codex's review of 88e09df, finding 1: a price said without its unit.
  await insertDraft(drafts.noUnit, 'quote', {
    ...COMPLETE_BID,
    values: { ...COMPLETE_BID.values, priceUnit: undefined },
  });
  await insertDraft(drafts.edited, 'quote', {
    ...COMPLETE_BID,
    values: { ...COMPLETE_BID.values, validUntil: undefined },
  });
  await insertDraft(drafts.followUp, 'follow_up', {
    values: {
      task: 'Send Pat the contract',
      assignedTo: users.tess,
      dueAt: '2026-11-10T16:30:00.000Z',
    },
  });
  await insertDraft(drafts.followUpNoTime, 'follow_up', {
    values: { task: 'Call Pat back', assignedTo: users.tess },
  });
  await insertDraft(drafts.newContact, 'contact', {
    values: { contactName: 'Sam Logistics', contactPhone: '(403) 555-0177' },
    checks: {},
  });
  await insertDraft(
    drafts.patsRole,
    'contact',
    { values: { contactRole: 'Head buyer' }, checks: {} },
    { contactId: pat },
  );
  await insertDraft(drafts.archivedBid, 'quote', COMPLETE_BID, { counterpartyId: archived });
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe("Claude's open drafts", () => {
  it('are listed for everyone on the team with their call, and for no other organization', async () => {
    const listed = await db.listOpenDrafts(as(users.victor), {
      organizationId: orgs.a,
      counterpartyId: buyer,
      kind: null,
    });
    expect(listed.map((draft) => draft.id).sort()).toEqual(
      [
        drafts.bid,
        drafts.raced,
        drafts.noValidUntil,
        drafts.noUnit,
        drafts.edited,
        drafts.followUp,
        drafts.followUpNoTime,
        drafts.newContact,
        drafts.patsRole,
      ].sort(),
    );
    expect(listed.find((draft) => draft.id === drafts.patsRole)).toMatchObject({
      kind: 'contact',
      contactId: pat,
      counterpartyId: buyer,
      counterpartyName: 'Synthetic Prairie Mills',
      callId: call,
      callerId: users.tess,
      callerName: 'Tess',
      contactName: 'Pat Buyer',
      sourceLines: [{ line: 1, text: 'Pat: We bid CAD 725 a tonne.' }],
    });
    // The lines a check points to come too, from a transcript split by side.
    expect(listed.find((draft) => draft.id === drafts.raced)?.sourceLines).toEqual([
      { line: 1, text: 'Pat: We bid CAD 725 a tonne.' },
    ]);
    expect(listed[0]?.calledAt).toMatch(/Z$/);
    expect(
      await db.listOpenDrafts(as(users.tess), {
        organizationId: orgs.a,
        counterpartyId: null,
        kind: 'follow_up',
      }),
    ).toEqual([
      expect.objectContaining({ id: drafts.followUp }),
      expect.objectContaining({ id: drafts.followUpNoTime }),
    ]);
    // An archived company's drafts are not listed.
    const everyone = await db.listOpenDrafts(as(users.tess), {
      organizationId: orgs.a,
      counterpartyId: null,
      kind: null,
    });
    expect(everyone.map((draft) => draft.id)).not.toContain(drafts.archivedBid);
    expect(
      await db.listOpenDrafts(as(users.bob), {
        organizationId: orgs.a,
        counterpartyId: null,
        kind: null,
      }),
    ).toEqual([]);
  });
});

describe('Verify', () => {
  it('refuses anyone whose role cannot save the kind, and other organizations, saving nothing', async () => {
    const before = await count('quotes');
    expect(await db.verifyCallDraft(as(users.victor), drafts.bid, 'Victor', new Date())).toEqual({
      status: 'forbidden',
    });
    expect(await db.verifyCallDraft(as(users.olga), drafts.bid, 'Olga', new Date())).toEqual({
      status: 'forbidden',
    });
    expect(await db.verifyCallDraft(as(users.bob), drafts.bid, 'Bob', new Date())).toEqual({
      status: 'not_found',
    });
    expect(await db.verifyCallDraft(as(users.tess), id(), 'Tess', new Date())).toEqual({
      status: 'not_found',
    });
    expect(await count('quotes')).toBe(before);
    expect((await statusOf(drafts.bid))?.status).toBe('open');
  });

  it('saves a complete bid as it is and marks the draft as saved by the person, once', async () => {
    const before = await count('quotes');
    const result = await db.verifyCallDraft(as(users.tess), drafts.bid, 'Tess', new Date());
    expect(result).toMatchObject({ status: 'verified', kind: 'quote' });
    if (result.status !== 'verified') throw new Error('not verified');
    const quote = await db.getQuote(as(users.tess), result.resultId);
    expect(quote).toMatchObject({
      side: 'bid',
      commodity: { code: 'canola' },
      counterparty: { id: buyer },
      current: {
        firmness: 'indicative',
        price: '725.00',
        currency: 'CAD',
        priceUnit: 'MT',
        deliveryBasis: 'delivered',
        quantityMaxMt: '500.000',
        sourceType: 'phone',
        recordedByName: 'Tess',
      },
    });
    expect(await statusOf(drafts.bid)).toEqual({
      status: 'accepted',
      decided_by: users.tess,
      result_id: result.resultId,
    });
    expect(await db.verifyCallDraft(as(users.tess), drafts.bid, 'Tess', new Date())).toEqual({
      status: 'already_decided',
    });
    expect(await count('quotes')).toBe(before + 1);
  });

  it('saves nothing when the draft is dismissed while it is being verified', async () => {
    const before = await count('quotes');
    let verifying: Promise<VerifyDraftResult> | undefined;
    // Someone else holds the draft (as app.decide_call_draft does) while Tess verifies it: her
    // bid is entered, then the draft is dismissed before hers is marked, so her bid is undone.
    await admin.begin(async (tx) => {
      await tx`select id from app.call_drafts where id = ${drafts.raced} for update`;
      verifying = db.verifyCallDraft(as(users.tess), drafts.raced, 'Tess', new Date());
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await tx`update app.call_drafts
               set status = 'dismissed', decided_by = ${users.olga}, decided_by_name = 'Olga',
                   decided_at = now()
               where id = ${drafts.raced}`;
    });
    expect(await verifying).toEqual({ status: 'already_decided' });
    expect(await count('quotes')).toBe(before);
    expect(await statusOf(drafts.raced)).toMatchObject({ status: 'dismissed', result_id: null });
  });

  it('names what an incomplete draft is missing and saves nothing', async () => {
    const before = await count('quotes');
    const result = await db.verifyCallDraft(
      as(users.tess),
      drafts.noValidUntil,
      'Tess',
      new Date(),
    );
    expect(result.status).toBe('incomplete');
    if (result.status !== 'incomplete') throw new Error('not incomplete');
    expect(result.missing).toEqual(expect.arrayContaining(['valid until', 'delivery basis']));
    expect(await count('quotes')).toBe(before);
    expect((await statusOf(drafts.noValidUntil))?.status).toBe('open');
  });

  it('adds nothing that was not said: no price unit, no due time (Codex, 88e09df, finding 1)', async () => {
    const before = await count('quotes');
    const noUnit = await db.verifyCallDraft(as(users.tess), drafts.noUnit, 'Tess', new Date());
    expect(noUnit).toMatchObject({ status: 'incomplete', missing: ['price unit'] });
    const noTime = await db.verifyCallDraft(
      as(users.olga),
      drafts.followUpNoTime,
      'Olga',
      new Date(),
    );
    expect(noTime).toMatchObject({ status: 'incomplete', missing: ['due time'] });
    expect(await count('quotes')).toBe(before);
    expect((await statusOf(drafts.noUnit))?.status).toBe('open');
  });

  it('plans a follow-up at the time said, for an operations member', async () => {
    const result = await db.verifyCallDraft(as(users.olga), drafts.followUp, 'Olga', new Date());
    expect(result).toMatchObject({ status: 'verified', kind: 'follow_up' });
    if (result.status !== 'verified') throw new Error('not verified');
    const followUp = await db.getFollowUp(as(users.olga), result.resultId);
    expect(followUp).toMatchObject({
      task: 'Send Pat the contract',
      dueAt: '2026-11-10T16:30:00.000Z',
      assignedTo: { userId: users.tess, name: 'Tess' },
    });
  });

  it('saves what the person finished in the form, and marks the draft, in one step', async () => {
    const before = await count('quotes');
    const edited = {
      commodity: 'canola',
      values: { ...COMPLETE_BID.values, price: '730.00', validUntil },
    };
    // Something the form would refuse is answered by field, and nothing is saved.
    const refused = await db.verifyCallDraft(as(users.tess), drafts.edited, 'Tess', new Date(), {
      edited: { ...edited, values: { ...edited.values, price: '' } },
    });
    expect(refused).toMatchObject({
      status: 'incomplete',
      issues: [expect.objectContaining({ field: 'price' })],
    });
    expect(await count('quotes')).toBe(before);
    const result = await db.verifyCallDraft(as(users.tess), drafts.edited, 'Tess', new Date(), {
      edited,
    });
    expect(result).toMatchObject({ status: 'verified', kind: 'quote' });
    if (result.status !== 'verified') throw new Error('not verified');
    expect(await db.getQuote(as(users.tess), result.resultId)).toMatchObject({
      commodity: { code: 'canola' },
      current: { price: '730.00' },
    });
    expect(await statusOf(drafts.edited)).toMatchObject({
      status: 'accepted',
      result_id: result.resultId,
    });
    expect(await count('quotes')).toBe(before + 1);
  });

  it('lets only operations and admins save contacts: a new person, and new details of a listed one', async () => {
    expect(await db.verifyCallDraft(as(users.tess), drafts.newContact, 'Tess', new Date())).toEqual(
      {
        status: 'forbidden',
      },
    );
    const added = await db.verifyCallDraft(as(users.olga), drafts.newContact, 'Olga', new Date());
    expect(added).toMatchObject({ status: 'verified', kind: 'contact' });
    // Without the version the person saw, or with an older one, nothing is overwritten.
    const seen = await contactVersion(pat);
    expect(await db.verifyCallDraft(as(users.olga), drafts.patsRole, 'Olga', new Date())).toEqual({
      status: 'contact_changed',
    });
    expect(
      await db.verifyCallDraft(as(users.olga), drafts.patsRole, 'Olga', new Date(), {
        contactVersion: '2026-01-01T00:00:00.000000Z',
      }),
    ).toEqual({ status: 'contact_changed' });
    const updated = await db.verifyCallDraft(as(users.olga), drafts.patsRole, 'Olga', new Date(), {
      contactVersion: seen,
    });
    expect(updated).toEqual({ status: 'verified', kind: 'contact', resultId: pat });
    const contacts = await admin<
      { name: string; role: string | null; email: string | null; phone: string | null }[]
    >`
      select name, role, email, phone from app.counterparty_contacts
      where counterparty_id = ${buyer} order by name`;
    expect(contacts).toEqual([
      { name: 'Pat Buyer', role: 'Head buyer', email: 'pat@example.test', phone: '(403) 555-0100' },
      { name: 'Sam Logistics', role: null, email: null, phone: '(403) 555-0177' },
    ]);
    // Both are off the list now.
    const open = await db.listOpenDrafts(as(users.olga), {
      organizationId: orgs.a,
      counterpartyId: buyer,
      kind: 'contact',
    });
    expect(open).toEqual([]);
  });

  it("refuses an archived company's draft, saving nothing", async () => {
    expect(
      await db.verifyCallDraft(as(users.tess), drafts.archivedBid, 'Tess', new Date()),
    ).toEqual({ status: 'archived' });
    expect((await statusOf(drafts.archivedBid))?.status).toBe('open');
  });

  it('never overwrites a contact corrected after the card was loaded (Codex, 88e09df, finding 2)', async () => {
    const sam = id();
    const draftId = id();
    await admin`insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, phone, created_by)
      values (${sam}, ${orgs.a}, ${buyer}, 'Sam Driver', '(403) 555-0150', ${users.tess})`;
    await insertDraft(
      draftId,
      'contact',
      { values: { contactPhone: '(403) 555-0177' }, checks: {} },
      { contactId: sam },
    );
    const seen = await contactVersion(sam);
    // Another member corrects the phone after the card was loaded.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await admin`update app.counterparty_contacts set phone = '(403) 555-0199' where id = ${sam}`;
    expect(
      await db.verifyCallDraft(as(users.olga), draftId, 'Olga', new Date(), {
        contactVersion: seen,
      }),
    ).toEqual({ status: 'contact_changed' });
    const [row] = await admin<{ phone: string }[]>`
      select phone from app.counterparty_contacts where id = ${sam}`;
    expect(row?.phone).toBe('(403) 555-0199');
    expect((await statusOf(draftId))?.status).toBe('open');
  });
});
