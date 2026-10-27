import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { postgresDatabase } from './db';

// Integration test: the real driver, as the real `app_api` role, against the real
// migrations and row level security. Fixtures are synthetic and removed afterwards.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
const API_URL = process.env.API_TEST_DATABASE_URL;
if (!ADMIN_URL || !API_URL) {
  throw new Error(
    'Set API_TEST_ADMIN_DATABASE_URL (table owner) and API_TEST_DATABASE_URL (app_api login).',
  );
}

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
const id = () => crypto.randomUUID();
const users = { alice: id(), bob: id(), carol: id(), nobody: id() };
const orgs = { a: id(), b: id() };

beforeAll(async () => {
  for (const [name, userId] of Object.entries(users)) {
    await admin`insert into auth.users (id, email) values (${userId}, ${`${name}-${userId}@example.test`})`;
  }
  await admin`insert into app.organizations (id, display_name) values
    (${orgs.a}, 'Synthetic Org A'), (${orgs.b}, 'Synthetic Org B')`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.alice}, 'trader', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now()),
    (${orgs.a}, ${users.carol}, 'viewer', 'suspended', now())`;
});

afterAll(async () => {
  await admin`delete from app.organization_members where organization_id in (${orgs.a}, ${orgs.b})`;
  await admin`delete from app.organizations where id in (${orgs.a}, ${orgs.b})`;
  await admin`delete from auth.users where id in ${admin(Object.values(users))}`;
  await admin.end();
});

describe('postgresDatabase as app_api', () => {
  it("returns only the user's own active memberships", async () => {
    const db = postgresDatabase(API_URL);
    try {
      expect(await db.memberships(users.alice)).toEqual([
        { organizationId: orgs.a, organizationName: 'Synthetic Org A', role: 'trader' },
      ]);
      expect(await db.memberships(users.bob)).toEqual([
        { organizationId: orgs.b, organizationName: 'Synthetic Org B', role: 'org_admin' },
      ]);
    } finally {
      await db.close();
    }
  });

  it('returns nothing for a suspended member or a user without memberships', async () => {
    const db = postgresDatabase(API_URL);
    try {
      expect(await db.memberships(users.carol)).toEqual([]);
      expect(await db.memberships(users.nobody)).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('does not carry one user into the next query on the same connection', async () => {
    const db = postgresDatabase(API_URL);
    try {
      expect(await db.memberships(users.alice)).toHaveLength(1);
      expect(await db.memberships(users.carol)).toEqual([]);
      expect(await db.memberships(users.bob)).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  it('rejects a malformed user id instead of returning rows', async () => {
    const db = postgresDatabase(API_URL);
    try {
      await expect(db.memberships('not-a-uuid')).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it('sees no organizations as app_api without a user set', async () => {
    const raw = postgres(API_URL, { max: 1, prepare: false });
    try {
      const [row] = await raw<
        { count: number }[]
      >`select count(*)::int as count from app.organizations`;
      expect(row?.count).toBe(0);
    } finally {
      await raw.end();
    }
  });
});
