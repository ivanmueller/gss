import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { connectionOptions } from './db';
import {
  createPetroleumDatabase,
  PETROLEUM_SCHEMA_VERSION,
  postgresPetroleum,
} from './petroleum-db';

// Integration test (F-247-1): the oil and gas database's queries as the real `petro_api` role,
// against its real migration. CI creates that database in the local Supabase and gives
// petro_api a throwaway login (README, "The oil and gas database"). Synthetic ids only.
const PETRO_URL = process.env.PETROLEUM_TEST_DATABASE_URL;
if (!PETRO_URL) {
  throw new Error(
    'Set PETROLEUM_TEST_DATABASE_URL (petro_api login on the local petroleum database).',
  );
}

const ctx = (role: string) => ({
  userId: crypto.randomUUID(),
  organizationId: crypto.randomUUID(),
  role,
  requestId: crypto.randomUUID(),
});

describe('the oil and gas database as petro_api', () => {
  it('has the schema version this code needs once migrated', async () => {
    const db = postgresPetroleum(PETRO_URL);
    try {
      expect(await db.schemaVersion()).toBe(PETROLEUM_SCHEMA_VERSION);
    } finally {
      await db.close();
    }
  });

  it('sees the organization it is told, for that transaction only', async () => {
    const db = postgresPetroleum(PETRO_URL);
    try {
      for (const role of ['viewer', 'analyst', 'trader', 'operations', 'org_admin']) {
        const asking = ctx(role);
        expect(await db.organizationSeen(asking)).toBe(asking.organizationId);
      }
      // A second person on the same connection sees only their own organization.
      const first = ctx('viewer');
      const second = ctx('org_admin');
      expect(await db.organizationSeen(first)).toBe(first.organizationId);
      expect(await db.organizationSeen(second)).toBe(second.organizationId);
    } finally {
      await db.close();
    }
  });

  it('fails closed on a malformed id', async () => {
    const db = postgresPetroleum(PETRO_URL);
    try {
      await expect(
        db.organizationSeen({ ...ctx('viewer'), organizationId: 'org-a' }),
      ).rejects.toMatchObject({
        code: '22P02',
      });
    } finally {
      await db.close();
    }
  });

  // F-247-1-R1-02: who is asking lasts for one transaction only, so a pooled connection never
  // carries a person's identity on, after a commit or after a failure.
  it('leaves no one on the connection after a transaction, committed or failed', async () => {
    const sql = postgres(PETRO_URL, connectionOptions(PETRO_URL));
    const db = createPetroleumDatabase(sql);
    const leftOver = async () => {
      const [row] = await sql<
        { user_id: string | null; org: string | null; role: string | null }[]
      >`
        select petro.current_user_id()::text as user_id,
               petro.current_organization_id()::text as org,
               petro.current_member_role() as role`;
      return row;
    };
    try {
      const asking = ctx('org_admin');
      expect(await db.organizationSeen(asking)).toBe(asking.organizationId);
      expect(await leftOver()).toEqual({ user_id: null, org: null, role: null });

      await expect(
        db.organizationSeen({ ...ctx('trader'), organizationId: 'org-a' }),
      ).rejects.toMatchObject({ code: '22P02' });
      expect(await leftOver()).toEqual({ user_id: null, org: null, role: null });
    } finally {
      await db.close();
    }
  });

  // F-247-1-R5-02: each oil and gas query has a time limit, for its own transaction only.
  it('limits each query to 10 seconds without changing the connection', async () => {
    const sql = postgres(PETRO_URL, connectionOptions(PETRO_URL));
    const db = createPetroleumDatabase(sql);
    const timeout = async () =>
      (await sql<{ t: string }[]>`select current_setting('statement_timeout') as t`)[0]?.t;
    try {
      const before = await timeout();
      expect(before).not.toBe('10s');
      expect(await db.schemaVersion()).toBe(PETROLEUM_SCHEMA_VERSION);
      expect(await timeout()).toBe(before);
      const inside = await sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', '10s', true)`;
        return (await tx<{ t: string }[]>`select current_setting('statement_timeout') as t`)[0]?.t;
      });
      expect(inside).toBe('10s');
      await expect(
        sql.begin(async (tx) => {
          await tx`select set_config('statement_timeout', '50ms', true)`;
          await tx`select pg_sleep(1)`;
        }),
      ).rejects.toMatchObject({ code: '57014' });
    } finally {
      await db.close();
    }
  });

  // F-247-1-R10-01: a request past its deadline drops its connection at once, even mid-query.
  it('drops the connection at once when aborted, ending the query in progress', async () => {
    const sql = postgres(PETRO_URL, connectionOptions(PETRO_URL));
    const db = createPetroleumDatabase(sql);
    const slow = sql`select pg_sleep(5)`.execute();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = Date.now();
    await db.abort();
    await expect(slow).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
