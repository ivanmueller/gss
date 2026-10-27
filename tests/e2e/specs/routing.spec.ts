import { expect, test } from '@playwright/test';

test('the API answers under /api/v1', async ({ request }) => {
  const health = await request.get('/api/v1/health');

  expect(health.status()).toBe(200);
  expect(health.headers()['cache-control']).toBe('no-store');
  expect(await health.json()).toEqual({ status: 'ok', service: 'api' });
});

test('unknown API paths reach the API, which requires sign-in, not the web app', async ({
  page,
}) => {
  const response = await page.goto('/api/v1/does-not-exist');

  expect(response?.status()).toBe(401);
  expect(response?.headers()['content-type']).toMatch(/^application\/json/);
});

test('other unknown paths load the web app', async ({ page }) => {
  const response = await page.goto('/some/deep/link');

  expect(response?.status()).toBe(200);
  await expect(page.getByText('This page does not exist.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'GSS' })).toBeVisible();
});
