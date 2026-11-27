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

// Switch-over step d: the oil and gas routes are gone from this Worker. Nothing under /petroleum
// answers any more, not even the old public readiness route: the sign-in wall takes them all.
test('the oil and gas routes are gone from the Worker', async ({ request }) => {
  for (const path of ['/api/v1/petroleum/ready', '/api/v1/petroleum/layers']) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
  }
});
