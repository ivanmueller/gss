import { expect, test as setup } from '@playwright/test';
import { generate } from 'otplib';

import { AUTH_STATE, E2E_ORG_NAME, E2E_USER, recreateE2eUser } from './supabase';

setup('signs in with password and sets up the authenticator', async ({ page, request }) => {
  await recreateE2eUser(request);

  await page.goto('/');
  await page.getByLabel('Email').fill(E2E_USER.email);
  await page.getByLabel('Password').fill(E2E_USER.password);
  const signIn = page.waitForResponse((res) => res.url().includes('/auth/v1/token'));
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The page shows one generic error by design, so report Supabase's own answer.
  const signInResponse = await signIn;
  if (!signInResponse.ok()) {
    throw new Error(
      `Password sign-in returned ${String(signInResponse.status())}: ${await signInResponse.text()}`,
    );
  }
  await expect(page.getByRole('heading', { name: 'Set up your authenticator app' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  expect(secret).not.toBe('');

  await page.getByLabel(/6-digit code/).fill(await generate({ secret }));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();

  // The name in the profile menu comes from the API's /me, which answers only after reading
  // Postgres as app_api: the Supabase session at aal2 reached the Worker and the database.
  // Isolation is tested in supabase/tests, the API database tests and counterparties.spec.ts.
  // The menu shows the first name and last initial, never the email or the organization.
  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Account' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('Synthetic T.')).toBeVisible();
  await expect(menu).toContainText('Signed in as Synthetic T.');
  await expect(page.getByText(E2E_USER.email)).toHaveCount(0);
  await expect(page.getByText(E2E_ORG_NAME)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await page.context().storageState({ path: AUTH_STATE });
});
