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

export interface PetroleumDatabase {
  /** True once the oil and gas database's first migration has run. Reads no data. */
  ready(): Promise<boolean>;
  /** The organization the database sees for this person: the health check. */
  organizationSeen(ctx: PetroleumContext): Promise<string | null>;
  close(): Promise<void>;
}

export type PetroleumFactory = (
  url: string,
  options?: { viaHyperdrive?: boolean },
) => PetroleumDatabase;

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
    async ready() {
      const [row] = await sql<{ ready: boolean }[]>`select petro.ready() as ready`;
      return row?.ready === true;
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
