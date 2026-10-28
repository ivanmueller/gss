import type { APIRequestContext } from '@playwright/test';
import postgres from 'postgres';

/** Where the setup project saves the signed-in session for the other projects. */
export const AUTH_STATE = 'playwright/.auth/user.json';

/** Synthetic account created in the local, throwaway Supabase only. */
export const E2E_USER = {
  email: 'e2e-trader@example.test',
  password: 'synthetic-e2e-password-1',
  firstName: 'Synthetic',
  lastName: 'Trader',
};
export const E2E_ORG_NAME = 'Synthetic E2E Org';
/** An organization the e2e user does not belong to, with one counterparty. */
export const OTHER_ORG = {
  id: '00000000-0000-4000-8000-0000000e2e0b',
  name: 'Synthetic Other E2E Org',
  counterpartyId: '00000000-0000-4000-8000-0000000e2ec0',
  counterpartyName: 'Synthetic Other Org Buyer',
  facilityName: 'Synthetic Other Org Elevator',
};

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; start a local Supabase first (README).`);
  return value;
}

function adminHeaders() {
  const key = env('E2E_SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * Deletes any previous copy of the synthetic user, then creates it fresh as the active
 * admin of a synthetic organization.
 */
export async function recreateE2eUser(request: APIRequestContext): Promise<void> {
  const url = env('E2E_SUPABASE_URL');
  const sql = postgres(env('E2E_DATABASE_URL'), { max: 1, onnotice: () => undefined });
  try {
    // App tables reference auth.users and the organization, so remove the previous
    // run's rows first. Deletes are audited, so the audit trail goes after the records.
    for (const table of [
      'counterparty_logos',
      'facilities',
      'counterparty_contacts',
      'counterparties',
      'import_batches',
      'organization_members',
      'audit_events',
    ]) {
      await sql`delete from ${sql(`app.${table}`)} where organization_id in
        (select id from app.organizations where display_name in (${E2E_ORG_NAME}, ${OTHER_ORG.name}))`;
    }
    await sql`delete from app.organization_members
      where user_id in (select id from auth.users where email = ${E2E_USER.email})`;
    await sql`delete from app.organizations where display_name in (${E2E_ORG_NAME}, ${OTHER_ORG.name})`;
    await recreateAuthUser(request, url);
    await sql`with org as (
        insert into app.organizations (display_name) values (${E2E_ORG_NAME}) returning id
      )
      insert into app.organization_members (organization_id, user_id, role, status, joined_at)
      select org.id, u.id, 'org_admin', 'active', now()
      from org, auth.users u where u.email = ${E2E_USER.email}`;
    // Another tenant's record, created outside the API, that the e2e user must never see.
    await sql`insert into app.organizations (id, display_name) values (${OTHER_ORG.id}, ${OTHER_ORG.name})`;
    await sql`insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by)
      select ${OTHER_ORG.counterpartyId}, ${OTHER_ORG.id}, ${OTHER_ORG.counterpartyName}, 'US', 'manual', u.id
      from auth.users u where u.email = ${E2E_USER.email}`;
    // With coordinates, so a map query could show it if isolation failed.
    await sql`insert into app.facilities (organization_id, counterparty_id, name, country,
        latitude, longitude, location_precision, created_by)
      select ${OTHER_ORG.id}, ${OTHER_ORG.counterpartyId}, ${OTHER_ORG.facilityName}, 'US',
        46.877186, -96.789803, 'exact', u.id
      from auth.users u where u.email = ${E2E_USER.email}`;
  } finally {
    await sql.end();
  }
}

async function recreateAuthUser(request: APIRequestContext, url: string): Promise<void> {
  const list = await request.get(`${url}/auth/v1/admin/users?per_page=1000`, {
    headers: adminHeaders(),
  });
  if (!list.ok()) throw new Error(`Listing users failed: ${String(list.status())}`);
  const body = (await list.json()) as { users?: { id: string; email?: string }[] };
  for (const user of body.users ?? []) {
    if (user.email === E2E_USER.email) {
      await request.delete(`${url}/auth/v1/admin/users/${user.id}`, { headers: adminHeaders() });
    }
  }
  const created = await request.post(`${url}/auth/v1/admin/users`, {
    headers: adminHeaders(),
    data: {
      email: E2E_USER.email,
      password: E2E_USER.password,
      email_confirm: true,
      user_metadata: { first_name: E2E_USER.firstName, last_name: E2E_USER.lastName },
    },
  });
  if (!created.ok()) throw new Error(`Creating the e2e user failed: ${String(created.status())}`);
}

/** A password-only (aal1) access token, as a client that skipped MFA would hold. */
export async function passwordOnlyToken(request: APIRequestContext): Promise<string> {
  const url = env('E2E_SUPABASE_URL');
  const res = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: env('E2E_SUPABASE_PUBLISHABLE_KEY') },
    data: { email: E2E_USER.email, password: E2E_USER.password },
  });
  if (!res.ok()) throw new Error(`Password sign-in failed: ${String(res.status())}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}
