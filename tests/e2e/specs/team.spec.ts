import { expect, test, type Page } from '@playwright/test';

import { E2E_USER, OTHER_ORG } from './supabase';

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

test('the Team page lists the admin and explains adding someone without a login', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Team' }).click();
  const table = page.getByRole('table', { name: 'Team members' });
  const me = table.getByRole('row').filter({ hasText: E2E_USER.email });
  await expect(me).toContainText('You');
  await expect(me).toContainText('Admin');

  const add = page.getByRole('region', { name: 'Add a person' });
  await add.getByLabel('Email of their login').fill('nobody-synthetic@example.test');
  await add.getByRole('button', { name: 'Add to team' }).click();
  await expect(add.getByRole('alert')).toContainText('Authentication → Users → Add user');

  await me.getByRole('button', { name: `Edit ${E2E_USER.email}` }).click();
  const form = page.getByRole('form', { name: `Edit ${E2E_USER.email}` });
  await expect(form.getByLabel('Role')).toBeDisabled();
  await form.getByLabel('First name').fill('Synthetic');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(me).toContainText('Synthetic');
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
