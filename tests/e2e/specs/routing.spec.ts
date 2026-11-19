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

// F-247 part 1b: the Worker reaches the oil and gas database through its PETROLEUM binding (the
// local "petroleum" database, as petro_api), on the public readiness route and signed in.
// Always run in CI, which creates that database; on a developer's machine only with
// E2E_PETROLEUM=1, once the local "petroleum" database exists (README, "The oil and gas
// database"), so the usual local run does not need a second database (F-247-1b-R1-01).
test('the oil and gas database answers through the Worker', async ({ page, request }) => {
  test.skip(
    !process.env.CI && process.env.E2E_PETROLEUM !== '1',
    'needs the local petroleum database: set E2E_PETROLEUM=1 once it exists',
  );
  const ready = await request.get('/api/v1/petroleum/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ok', service: 'petroleum' });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  const token = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const session = JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string };
        if (session.access_token) return session.access_token;
      }
    }
    throw new Error('no Supabase session in local storage');
  });
  const health = await request.get('/api/v1/petroleum/health', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });
});
