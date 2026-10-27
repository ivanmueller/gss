import postgres from 'postgres';

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: string;
}

/** What the API reads from Postgres. Every call runs as the given, already verified user. */
export interface Database {
  memberships: (userId: string) => Promise<Membership[]>;
  close: () => Promise<void>;
}

function isLocalHost(url: string): boolean {
  const { hostname } = new URL(url);
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

/**
 * Connects as `app_api` (docs/DECISIONS.md, database access model). Each query runs in a
 * transaction that first sets `app.user_id`, so row level security decides what is visible.
 * Uses the Supabase transaction pooler, hence no prepared statements; TLS is required for
 * anything that is not a local database.
 */
export function postgresDatabase(url: string): Database {
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    fetch_types: false,
    ssl: isLocalHost(url) ? false : 'require',
  });

  return {
    async memberships(userId) {
      const rows = await sql.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${userId}, true)`;
        return tx<{ organization_id: string; display_name: string; role: string }[]>`
          select o.id as organization_id, o.display_name, m.role::text as role
          from app.organization_members m
          join app.organizations o on o.id = m.organization_id
          where m.user_id = app.current_user_id() and m.status = 'active'
          order by o.display_name
        `;
      });
      return rows.map((row) => ({
        organizationId: row.organization_id,
        organizationName: row.display_name,
        role: row.role,
      }));
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
