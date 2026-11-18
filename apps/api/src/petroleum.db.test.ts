import { describe, expect, it } from 'vitest';

import { postgresPetroleum } from './petroleum-db';

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
  it('is ready once migrated', async () => {
    const db = postgresPetroleum(PETRO_URL);
    try {
      expect(await db.ready()).toBe(true);
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
});
