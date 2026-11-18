import postgres from 'postgres';

import { connectionOptions } from './db';

/**
 * The oil and gas database (petroleum-staging, F-247; docs/DECISIONS.md 2026-11-18). It has no
 * users: the Worker checks the person's membership in grain's database first, then queries this
 * one as `petro_api`, telling it who is asking for one transaction only.
 */

/** Who is asking, from the verified session and the membership just loaded from grain's database. */
export interface PetroleumContext {
  userId: string;
  organizationId: string;
  role: string;
  requestId: string;
}

/**
 * The oil and gas database's schema version this code needs (petro.schema_version()). Raised with
 * each migration the Worker's code depends on; until the database has it, the oil and gas routes
 * answer "not ready" (F-247-1-R3-01), so a deploy whose migration failed never runs new code
 * against an old schema.
 */
export const PETROLEUM_SCHEMA_VERSION = 1;

export interface PetroleumDatabase {
  /** The database's schema version (petro.schema_version()). Reads no data. */
  schemaVersion(): Promise<number>;
  /** The organization the database sees for this person: the health check. */
  organizationSeen(ctx: PetroleumContext): Promise<string | null>;
  close(): Promise<void>;
}

export type PetroleumFactory = (
  url: string,
  options?: { viaHyperdrive?: boolean },
) => PetroleumDatabase;

/**
 * The longest any oil and gas query may run, so a stalled database answers "unavailable" within
 * a request instead of holding it (F-247-1-R5-02). Set for each transaction only.
 */
const STATEMENT_TIMEOUT = '10s';

/**
 * Runs `fn` in a transaction that first sets the person, organization, role and request for that
 * transaction only (set_config(..., true)), so a pooled connection never carries them on.
 */
async function asMember<T>(
  sql: postgres.Sql,
  ctx: PetroleumContext,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
    await tx`select set_config('petro.user_id', ${ctx.userId}, true),
                    set_config('petro.organization_id', ${ctx.organizationId}, true),
                    set_config('petro.member_role', ${ctx.role}, true),
                    set_config('petro.request_id', ${ctx.requestId}, true)`;
    return fn(tx);
  })) as T;
}

/** The oil and gas database over an existing connection; tests use it directly. */
export function createPetroleumDatabase(sql: postgres.Sql): PetroleumDatabase {
  return {
    async schemaVersion() {
      const [row] = await sql.begin(async (tx) => {
        await tx`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`;
        return tx<{ version: number }[]>`select petro.schema_version() as version`;
      });
      return row?.version ?? 0;
    },
    organizationSeen(ctx) {
      return asMember(sql, ctx, async (tx) => {
        const [row] = await tx<{ organization_id: string | null }[]>`
          select petro.current_organization_id()::text as organization_id`;
        return row?.organization_id ?? null;
      });
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

/** Connects as `petro_api`, with the same driver settings as grain's database. */
export function postgresPetroleum(
  url: string,
  options: { viaHyperdrive?: boolean } = {},
): PetroleumDatabase {
  return createPetroleumDatabase(postgres(url, connectionOptions(url, options.viaHyperdrive)));
}
