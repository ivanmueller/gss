// Creating logins and setting passwords through Supabase Auth's admin API, so admins add
// people from the Team page (owner's request, 2026-10-28; docs/DECISIONS.md).
//
// This needs the project's secret key (Worker secret SUPABASE_SECRET_KEY), which may manage
// every login. It is used here only, for these two calls, and never for data: records are
// still read and written as app_api under row level security.

export interface LoginBindings {
  SUPABASE_URL: string;
  /** Supabase secret key (sb_secret_…, or the legacy service_role key). Worker secret. */
  SUPABASE_SECRET_KEY?: string;
}

/** Supabase Auth failed or refused for a reason the user cannot fix. Never logs details. */
export class LoginServiceError extends Error {
  constructor(readonly status: number) {
    super(`Supabase Auth admin call failed (${String(status)})`);
    this.name = 'LoginServiceError';
  }
}

function adminHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  // The legacy service_role key is a JWT and also goes as a bearer token; the newer
  // sb_secret_ keys go in apikey only.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/** The secret key when configured, or null. */
export function secretKey(env: LoginBindings): string | null {
  const key = env.SUPABASE_SECRET_KEY?.trim() ?? '';
  return key === '' ? null : key;
}

// Easy to read aloud and type: lower case without i, l, o, and digits without 0 and 1.
// 31 symbols × 16 ≈ 79 bits.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A temporary password such as "k7pq-mz3d-a9tw-x2fh", for the admin to pass on in person. */
export function temporaryPassword(): string {
  const symbols: string[] = [];
  while (symbols.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      // Bytes from 248 up are skipped, so every symbol is equally likely.
      if (byte < 248 && symbols.length < 16) symbols.push(ALPHABET.charAt(byte % 31));
    }
  }
  return [0, 4, 8, 12].map((start) => symbols.slice(start, start + 4).join('')).join('-');
}

export type CreateLoginResult = { status: 'created'; id: string } | { status: 'exists' };

/**
 * Creates a confirmed login with a temporary password and the person's names. The login
 * is marked so its first sign-in asks for a password of the person's own choosing.
 */
export async function createLogin(
  env: LoginBindings,
  key: string,
  login: { email: string; password: string; firstName: string; lastName: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<CreateLoginResult> {
  const url = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/admin/users`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: adminHeaders(key),
      body: JSON.stringify({
        email: login.email,
        password: login.password,
        email_confirm: true,
        user_metadata: {
          first_name: login.firstName,
          ...(login.lastName !== null && { last_name: login.lastName }),
        },
        app_metadata: { must_change_password: true },
      }),
    });
  } catch {
    throw new LoginServiceError(0);
  }
  if (response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const id =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>).id : null;
    if (typeof id !== 'string') throw new LoginServiceError(response.status);
    return { status: 'created', id };
  }
  if (response.status === 422) {
    const body: unknown = await response.json().catch(() => null);
    const code =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).error_code
        : null;
    if (code === 'email_exists' || code === 'user_already_exists') return { status: 'exists' };
  }
  throw new LoginServiceError(response.status);
}

/** Sets a login's password and clears the "choose your own password" mark, in one call. */
export async function setOwnPassword(
  env: LoginBindings,
  key: string,
  userId: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<'saved' | 'weak'> {
  const url = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'PUT',
      headers: adminHeaders(key),
      body: JSON.stringify({ password, app_metadata: { must_change_password: false } }),
    });
  } catch {
    throw new LoginServiceError(0);
  }
  if (response.ok) return 'saved';
  if (response.status === 422) return 'weak';
  throw new LoginServiceError(response.status);
}
