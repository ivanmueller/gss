import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectionOptions, createDatabase, postgresDatabase } from './db';

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
const orgs = { a: id(), b: id(), inactive: id() };

beforeAll(async () => {
  for (const [name, userId] of Object.entries(users)) {
    await admin`insert into auth.users (id, email) values (${userId}, ${`${name}-${userId}@example.test`})`;
  }
  await admin`insert into app.organizations (id, display_name, active) values
    (${orgs.a}, 'Synthetic Org A', true), (${orgs.b}, 'Synthetic Org B', true),
    (${orgs.inactive}, 'Synthetic Inactive Org', false)`;
  await admin`insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
    (${orgs.a}, ${users.alice}, 'trader', 'active', now()),
    (${orgs.b}, ${users.bob}, 'org_admin', 'active', now()),
    (${orgs.a}, ${users.carol}, 'viewer', 'suspended', now()),
    (${orgs.inactive}, ${users.alice}, 'org_admin', 'active', now())`;
});

afterAll(async () => {
  await admin`delete from app.organization_members where organization_id in ${admin(Object.values(orgs))}`;
  await admin`delete from app.organizations where id in ${admin(Object.values(orgs))}`;
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

  it('clears the user from the connection after each call, whether it succeeds or fails', async () => {
    // One connection (max 1), so these raw queries run where the calls just ran.
    const sql = postgres(API_URL, connectionOptions(API_URL));
    const db = createDatabase(sql);
    const context = async () => {
      const [row] = await sql<{ user_id: string | null }[]>`
        select current_setting('app.user_id', true) as user_id`;
      return row?.user_id ?? '';
    };
    try {
      expect(await db.memberships(users.alice)).toHaveLength(1);
      expect(await context()).toBe('');
      await expect(db.memberships('not-a-uuid')).rejects.toThrow();
      expect(await context()).toBe('');
      expect(await db.memberships(users.bob)).toHaveLength(1);
      expect(await context()).toBe('');
    } finally {
      await sql.end();
    }
  });

  it('is limited by row level security, not only by the query filters', async () => {
    // Unfiltered reads as app_api with alice set: only rows of alice's active organization.
    const sql = postgres(API_URL, connectionOptions(API_URL));
    try {
      const rows = await sql.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${users.alice}, true)`;
        const members = await tx<{ organization_id: string; user_id: string }[]>`
          select organization_id, user_id from app.organization_members
          where organization_id in ${tx(Object.values(orgs))}`;
        const organizations = await tx<{ id: string }[]>`
          select id from app.organizations where id in ${tx(Object.values(orgs))}`;
        return { members: [...members], organizations: [...organizations] };
      });
      expect(new Set(rows.members.map((m) => m.organization_id))).toEqual(new Set([orgs.a]));
      expect(rows.members.map((m) => m.user_id).sort()).toEqual([users.alice, users.carol].sort());
      expect(rows.organizations).toEqual([{ id: orgs.a }]);
    } finally {
      await sql.end();
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
