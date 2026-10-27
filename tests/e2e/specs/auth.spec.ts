import { expect, test } from '@playwright/test';

import { passwordOnlyToken } from './supabase';

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sees the sign-in form, not the workspace', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});

test('the API refuses a session that skipped two-factor authentication', async ({ request }) => {
  const token = await passwordOnlyToken(request);

  const res = await request.get('/api/v1/me', { headers: { Authorization: `Bearer ${token}` } });

  expect(res.status()).toBe(403);
  expect(await res.json()).toMatchObject({ error: { code: 'MFA_REQUIRED' } });
});

test('the API refuses requests without a token', async ({ request }) => {
  const res = await request.get('/api/v1/me');

  expect(res.status()).toBe(401);
});
