import type { APIRequestContext } from '@playwright/test';

/** Where the setup project saves the signed-in session for the other projects. */
export const AUTH_STATE = 'playwright/.auth/user.json';

/** Synthetic account created in the local, throwaway Supabase only. */
export const E2E_USER = {
  email: 'e2e-trader@example.test',
  password: 'synthetic-e2e-password-1',
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

/** Deletes any previous copy of the synthetic user, then creates it fresh. */
export async function recreateE2eUser(request: APIRequestContext): Promise<void> {
  const url = env('E2E_SUPABASE_URL');
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
    data: { email: E2E_USER.email, password: E2E_USER.password, email_confirm: true },
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
