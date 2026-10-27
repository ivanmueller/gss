import type { Context, MiddlewareHandler } from 'hono';

export interface AuthBindings {
  /** Supabase project URL, e.g. https://<ref>.supabase.co. Not secret. */
  SUPABASE_URL: string;
  /** Supabase publishable (anon) key, sent as `apikey`. Not secret. */
  SUPABASE_PUBLISHABLE_KEY: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
  /** From the user's Supabase metadata (`first_name`, `last_name`); for display only. */
  firstName: string | null;
  lastName: string | null;
}

export interface AuthEnv {
  Bindings: AuthBindings;
  Variables: { user: AuthUser };
}

type AuthErrorCode = 'UNAUTHENTICATED' | 'MFA_REQUIRED' | 'AUTH_UNAVAILABLE' | 'MISCONFIGURED';

function fail(c: Context, status: 401 | 403 | 500 | 503, code: AuthErrorCode, message: string) {
  c.header('Cache-Control', 'no-store');
  return c.json({ error: { code, message } }, status);
}

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const field: unknown = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : null;
}

/** A trimmed name part from the user's metadata, or null when missing or unusable. */
function namePart(body: unknown, key: string): string | null {
  const metadata =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).user_metadata
      : undefined;
  const value = stringField(metadata, key)?.trim() ?? '';
  return value.length > 0 && value.length <= 100 ? value : null;
}

/** Claims from a JWT payload. Only trusted after Supabase Auth has accepted the token. */
function readClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof claims === 'object' && claims !== null
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Requires a signed-in user who has completed MFA (assurance level aal2).
 *
 * The token is checked by Supabase Auth itself (`GET /auth/v1/user`), which verifies
 * the signature and that the session has not been signed out. Only then are the
 * token's `sub` and `aal` claims read (docs/DECISIONS.md, 2026-10-27).
 */
export const requireUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const supabaseUrl = c.env.SUPABASE_URL.replace(/\/+$/, '');
  const publishableKey = c.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return fail(c, 500, 'MISCONFIGURED', 'Authentication is not configured.');
  }

  const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
  if (!token) return fail(c, 401, 'UNAUTHENTICATED', 'Sign in required.');

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
    });
  } catch {
    return fail(c, 503, 'AUTH_UNAVAILABLE', 'Sign-in service unavailable.');
  }
  if (response.status >= 400 && response.status < 500) {
    return fail(c, 401, 'UNAUTHENTICATED', 'Sign in required.');
  }
  if (!response.ok) return fail(c, 503, 'AUTH_UNAVAILABLE', 'Sign-in service unavailable.');

  const body: unknown = await response.json();
  const id = stringField(body, 'id');
  const email = stringField(body, 'email');
  const claims = readClaims(token);
  if (!id || claims?.sub !== id) {
    return fail(c, 401, 'UNAUTHENTICATED', 'Sign in required.');
  }
  if (claims.aal !== 'aal2') {
    return fail(c, 403, 'MFA_REQUIRED', 'Complete two-factor authentication first.');
  }

  c.set('user', {
    id,
    email,
    firstName: namePart(body, 'first_name'),
    lastName: namePart(body, 'last_name'),
  });
  return next();
};
