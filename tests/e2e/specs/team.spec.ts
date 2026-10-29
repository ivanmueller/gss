import { expect, test, type Page } from '@playwright/test';
import { generate } from 'otplib';

import { choose } from './choose';
import { E2E_USER, NEW_LOGIN_PREFIX, OTHER_ORG } from './supabase';

async function accessToken(page: Page): Promise<string> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const session = JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string };
        if (session.access_token) return session.access_token;
      }
    }
    throw new Error('no Supabase session in local storage');
  });
}

test('the Team page lists the admin and needs a first name for a new login', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Team' }).click();
  const table = page.getByRole('table', { name: 'Team members' });
  const me = table.getByRole('row').filter({ hasText: E2E_USER.email });
  await expect(me).toContainText('You');
  await expect(me).toContainText('Admin');

  const add = page.getByRole('region', { name: 'Add a person' });
  await add.getByLabel('Email').fill(`${NEW_LOGIN_PREFIX}nameless@example.test`);
  await add.getByRole('button', { name: 'Add to team' }).click();
  await expect(add.getByRole('alert')).toContainText('Give their first name');

  await me.getByRole('button', { name: `Edit ${E2E_USER.email}` }).click();
  const form = page.getByRole('form', { name: `Edit ${E2E_USER.email}` });
  await expect(form.getByLabel('Role')).toBeDisabled();
  await form.getByLabel('First name').fill('Synthetic');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(me).toContainText('Synthetic');
});

test('an admin makes a login; the new person sets up their authenticator and own password', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = `${NEW_LOGIN_PREFIX}${String(Date.now())}@example.test`;
  await page.goto('/team');
  const add = page.getByRole('region', { name: 'Add a person' });
  await add.getByLabel('First name').fill('Newbie');
  await add.getByLabel('Last name').fill('Synthetic');
  await add.getByLabel('Email').fill(email);
  await choose(add.getByLabel('Role'), 'Viewer');
  await add.getByRole('button', { name: 'Add to team' }).click();
  const shown = add.getByRole('status');
  await expect(shown).toContainText(`Newbie can now sign in as ${email}`);
  const temporary = (await shown.locator('code').textContent())?.trim() ?? '';
  expect(temporary).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  await expect(
    page.getByRole('table', { name: 'Team members' }).getByRole('row').filter({ hasText: email }),
  ).toContainText('Newbie Synthetic');

  // The new person, in a browser of their own.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const them = await context.newPage();
  await them.goto('/');
  await them.getByLabel('Email').fill(email);
  await them.getByLabel('Password').fill(temporary);
  await them.getByRole('button', { name: 'Sign in' }).click();
  await expect(them.getByRole('heading', { name: 'Set up your authenticator app' })).toBeVisible({
    timeout: 15_000,
  });
  const secret = (await them.getByTestId('totp-secret').textContent())?.trim() ?? '';
  await them.getByLabel(/6-digit code/).fill(await generate({ secret }));
  await them.getByRole('button', { name: 'Confirm and continue' }).click();

  await expect(them.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await them.getByLabel('New password').fill('a long synthetic phrase');
  await them.getByLabel('The same again').fill('a long synthetic phrase');
  await them.getByRole('button', { name: 'Save password' }).click();

  // Setting the password signs them out everywhere; they sign in again with it.
  await expect(them.getByText('Your new password is saved. Sign in with it.')).toBeVisible();
  await them.getByLabel('Email').fill(email);
  await them.getByLabel('Password').fill('a long synthetic phrase');
  await them.getByRole('button', { name: 'Sign in' }).click();
  await expect(them.getByLabel(/6-digit code/)).toBeVisible({ timeout: 15_000 });
  // A fresh 30-second window, so the code differs from the one used to enrol.
  await them.waitForTimeout(30_000 - (Date.now() % 30_000) + 1_000);
  await them.getByLabel(/6-digit code/).fill(await generate({ secret }));
  await them.getByRole('button', { name: 'Verify' }).click();

  // Names were given on the Team page, so the app opens without asking for them.
  await expect(them.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await them.getByRole('button', { name: 'Account' }).click();
  await expect(them.getByRole('menu')).toContainText('Signed in as Newbie S.');
  await context.close();
});

test("another organization's team stays closed", async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${await accessToken(page)}` };
  const list = await request.get(`/api/v1/members?organization_id=${OTHER_ORG.id}`, { headers });
  expect(list.status()).toBe(403);
  const add = await request.post('/api/v1/members', {
    headers,
    data: { organizationId: OTHER_ORG.id, email: E2E_USER.email, role: 'org_admin' },
  });
  expect(add.status()).toBe(403);
  const change = await request.patch(`/api/v1/members/${OTHER_ORG.counterpartyId}`, {
    headers,
    data: { organizationId: OTHER_ORG.id, version: '2026-10-28T00:00:00.000000Z', role: 'viewer' },
  });
  expect(change.status()).toBe(403);
});
