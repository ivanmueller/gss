import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase, type Database, type RequestContext } from './db';
import type { VerifiedRoute } from './readings-db';

// Integration test of Claude's freight rate drafts verified (F-235 part 2): the real driver, as
// `app_api`, against the real migrations, row level security and functions. A verified draft
// becomes a freight rate quoted by the draft's company (any company), with its first terms, and
// the draft names it, in one transaction. Fixtures are synthetic.
//
// Calls and drafts are never deleted: every id is fresh, so nothing else sees them.
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
const call = id();
const recording = id();
const as = (userId: string): RequestContext => ({ userId, requestId: id() });

const quotedAt = new Date(Date.now() - 3_600_000).toISOString();

/** A rate as Claude might draft it from "Synthetic Town A MB to Synthetic Town B IN 335/CMT". */
const FIELDS = {
  mode: 'truck',
  origin: { text: 'Synthetic Town A MB', region: 'CA-MB' },
  destination: { text: 'Synthetic Town B IN', region: 'US-IN' },
  values: {
    firmness: 'indicative',
    rate: '335',
    currency: 'CAD',
    rateUnit: 'MT',
    quotedAt,
    sourceType: 'email',
    sourceReference: 'Email drafted by Claude',
  },
  checks: { rate: { said: '335/CMT', line: 0, doubt: null } },
};

/** The ends as the route resolves them: the origin placed for sure, the destination not. */
const ROUTE: VerifiedRoute = {
  origin: {
    kind: 'area',
    text: 'Synthetic Town A MB',
    region: 'CA-MB',
    point: { latitude: '49.354000', longitude: '-97.365000', precision: 'approximate' },
  },
  destination: { kind: 'area', text: 'Synthetic Town B IN', region: 'US-IN', point: null },
};

const drafts = { rate: id(), raced: id(), same: id(), archived: id() };

let db: Database;
let position = 0;

async function insertDraft(draftId: string, counterpartyId = buyer) {
  await admin`insert into app.call_drafts (id, organization_id, counterparty_id, call_id,
                                           recording_id, position, kind, fields, lines)
    values (${draftId}, ${orgs.a}, ${counterpartyId}, ${call}, ${recording}, ${position++},
            'freight', ${JSON.stringify(FIELDS)}::text::jsonb, '[0]'::jsonb)`;
}

const rates = async () => {
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from app.freight_quotes where carrier_id = ${buyer}`;
  return row?.n ?? 0;
};

const statusOf = async (draftId: string) => {
  const [row] = await admin<
    { status: string; decided_by: string | null; result_id: string | null }[]
  >`select status, decided_by, result_id from app.call_drafts where id = ${draftId}`;
  return row;
};

beforeAll(async () => {
  for (const [name, userId] of Object.entries(users)) {
    await admin`insert into auth.users (id, email, raw_user_meta_data)
      values (${userId}, ${`${name}-${userId}@example.test`},
              ${JSON.stringify({ first_name: name })}::text::jsonb)`;
  }
  await admin`insert into app.organizations (id, display_name) values
    (${orgs.a}, ${`Synthetic Org A ${orgs.a}`}), (${orgs.b}, ${`Synthetic Org B ${orgs.b}`})`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.tess}, 'trader', 'active', now()),
    (${orgs.a}, ${users.olga}, 'operations', 'active', now()),
    (${orgs.a}, ${users.victor}, 'viewer', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now())`;
  // A buyer, not a carrier: any company may quote a rate (F-235).
  await admin`insert into app.counterparties
      (id, organization_id, legal_name, types, primary_country, source, created_by) values
    (${buyer}, ${orgs.a}, 'Synthetic Prairie Mills', '{buyer}', 'CA', 'manual', ${users.tess}),
    (${archived}, ${orgs.a}, 'Synthetic Closed Mills', '{buyer}', 'CA', 'manual', ${users.tess})`;
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
            'Pat: Synthetic Town A MB to Synthetic Town B IN 335/CMT.', now())`;
  await insertDraft(drafts.rate);
  await insertDraft(drafts.raced);
  await insertDraft(drafts.same);
  await insertDraft(drafts.archived, archived);
  await admin`update app.counterparties set archived_at = now() where id = ${archived}`;
  db = postgresDatabase(API_URL);
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe('a freight draft about to be verified', () => {
  it('says whether the person may save it, and is hidden from other organizations', async () => {
    expect(await db.draftToVerify(as(users.tess), drafts.rate)).toMatchObject({
      kind: 'freight',
      organizationId: orgs.a,
      open: true,
      allowed: true,
      fields: { origin: FIELDS.origin },
    });
    expect(await db.draftToVerify(as(users.olga), drafts.rate)).toMatchObject({ allowed: true });
    expect(await db.draftToVerify(as(users.victor), drafts.rate)).toMatchObject({
      allowed: false,
    });
    expect(await db.draftToVerify(as(users.bob), drafts.rate)).toBeNull();
    expect(await db.draftToVerify(as(users.tess), id())).toBeNull();
  });
});

describe('Verify a freight draft', () => {
  it('refuses a viewer and another organization, saving nothing', async () => {
    const before = await rates();
    expect(
      await db.verifyCallDraft(as(users.victor), drafts.rate, 'Victor', new Date(), {}, ROUTE),
    ).toEqual({ status: 'forbidden' });
    expect(
      await db.verifyCallDraft(as(users.bob), drafts.rate, 'Bob', new Date(), {}, ROUTE),
    ).toEqual({ status: 'not_found' });
    expect(await rates()).toBe(before);
  });

  it("saves the rate as the draft's company's, with its route and first terms, once", async () => {
    const before = await rates();
    const result = await db.verifyCallDraft(
      as(users.olga),
      drafts.rate,
      'Olga',
      new Date(),
      {},
      ROUTE,
    );
    expect(result).toMatchObject({ status: 'verified', kind: 'freight' });
    if (result.status !== 'verified') throw new Error('not verified');
    const [rate] = await admin<Record<string, unknown>[]>`
      select q.carrier_id, q.mode::text, q.created_by, q.origin_area_text, q.origin_area_region::text,
             q.origin_area_latitude::text, q.destination_area_text, q.destination_area_latitude,
             r.rate::text, r.currency::text, r.rate_unit::text, r.valid_until, r.source_type::text,
             r.recorded_by_name
      from app.freight_quotes q join app.freight_quote_revisions r on r.freight_quote_id = q.id
      where q.id = ${result.resultId}`;
    expect(rate).toEqual({
      carrier_id: buyer,
      mode: 'truck',
      created_by: users.olga,
      origin_area_text: 'Synthetic Town A MB',
      origin_area_region: 'CA-MB',
      origin_area_latitude: '49.354000',
      destination_area_text: 'Synthetic Town B IN',
      destination_area_latitude: null,
      rate: '335.0000',
      currency: 'CAD',
      rate_unit: 'MT',
      valid_until: null,
      source_type: 'email',
      recorded_by_name: 'Olga',
    });
    expect(await statusOf(drafts.rate)).toEqual({
      status: 'accepted',
      decided_by: users.olga,
      result_id: result.resultId,
    });
    expect(
      await db.verifyCallDraft(as(users.tess), drafts.rate, 'Tess', new Date(), {}, ROUTE),
    ).toEqual({ status: 'already_decided' });
    expect(await rates()).toBe(before + 1);
  });

  it('saves nothing when the draft is dismissed while it is being verified', async () => {
    const before = await rates();
    let verifying: ReturnType<Database['verifyCallDraft']> | undefined;
    await admin.begin(async (tx) => {
      await tx`select id from app.call_drafts where id = ${drafts.raced} for update`;
      verifying = db.verifyCallDraft(as(users.tess), drafts.raced, 'Tess', new Date(), {}, ROUTE);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await tx`update app.call_drafts
               set status = 'dismissed', decided_by = ${users.olga}, decided_by_name = 'Olga',
                   decided_at = now()
               where id = ${drafts.raced}`;
    });
    expect(await verifying).toEqual({ status: 'already_decided' });
    expect(await rates()).toBe(before);
  });

  it('names the same place at both ends as the database compares them, saving nothing', async () => {
    const before = await rates();
    const same: VerifiedRoute = {
      origin: ROUTE.origin,
      destination: { kind: 'area', text: 'SYNTHETIC TOWN A MB', region: 'CA-MB', point: null },
    };
    expect(
      await db.verifyCallDraft(as(users.tess), drafts.same, 'Tess', new Date(), {}, same),
    ).toMatchObject({ status: 'incomplete', missing: ['a different place at each end'] });
    expect(await rates()).toBe(before);
    expect((await statusOf(drafts.same))?.status).toBe('open');
  });

  it("refuses an archived company's draft, saving nothing", async () => {
    expect(
      await db.verifyCallDraft(as(users.tess), drafts.archived, 'Tess', new Date(), {}, ROUTE),
    ).toEqual({ status: 'archived' });
    expect((await statusOf(drafts.archived))?.status).toBe('open');
  });
});
