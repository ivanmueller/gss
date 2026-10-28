import { describe, expect, it, vi } from 'vitest';

import { createLogin, LoginServiceError, setOwnPassword, temporaryPassword } from './logins';

const ENV = { SUPABASE_URL: 'https://example-project.supabase.co/' };
const LOGIN = { email: 'ana@example.test', password: 'x', firstName: 'Ana', lastName: null };

describe('temporaryPassword', () => {
  it('is four groups of easy-to-read symbols, different every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => temporaryPassword()));
    expect(seen.size).toBe(50);
    for (const password of seen)
      expect(password).toMatch(/^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){3}$/);
  });
});

describe('createLogin', () => {
  it('sends a new secret key in apikey only, and a legacy JWT key as a bearer token too', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ id: 'u1' })));
    await createLogin(ENV, 'sb_secret_x', LOGIN, fetchMock);
    await createLogin(ENV, 'eyJlegacy', LOGIN, fetchMock);
    const headers = fetchMock.mock.calls.map(
      (call) => new Headers((call as unknown as [string, RequestInit])[1].headers),
    );
    expect(headers[0]?.get('Authorization')).toBeNull();
    expect(headers[1]?.get('Authorization')).toBe('Bearer eyJlegacy');
    expect(
      JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string),
    ).toMatchObject({ user_metadata: { first_name: 'Ana' } });
  });

  it('reports an email that already has a login, and fails on anything else', async () => {
    const exists = () =>
      Promise.resolve(Response.json({ error_code: 'email_exists' }, { status: 422 }));
    expect(await createLogin(ENV, 'k', LOGIN, exists)).toEqual({ status: 'exists' });
    const down = () => Promise.resolve(new Response('', { status: 500 }));
    await expect(createLogin(ENV, 'k', LOGIN, down)).rejects.toBeInstanceOf(LoginServiceError);
    const unreachable = () => Promise.reject(new Error('network'));
    await expect(createLogin(ENV, 'k', LOGIN, unreachable)).rejects.toMatchObject({ status: 0 });
  });
});

describe('setOwnPassword', () => {
  it('saves, or says the password was too weak', async () => {
    expect(
      await setOwnPassword(ENV, 'k', 'u1', 'p', () => Promise.resolve(Response.json({}))),
    ).toBe('saved');
    expect(
      await setOwnPassword(ENV, 'k', 'u1', 'p', () =>
        Promise.resolve(Response.json({ error_code: 'weak_password' }, { status: 422 })),
      ),
    ).toBe('weak');
  });
});
