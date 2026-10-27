import { expect, test } from '@playwright/test';

test('loads the workspace with synthetic data and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Grain Trading Workspace' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Synthetic demo data');
  await expect(page.getByRole('status')).toHaveText('API reachable');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('shows the selected buyer bid with its validity', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Demo Buyer C', exact: true }).click();

  const bid = page.getByRole('complementary').getByRole('region', { name: 'Buyer bid' });
  await expect(bid).toContainText('USD 725.00/MT');
  await expect(bid).toContainText('valid until 2026-11-09 23:59 UTC');
  await expect(bid).toContainText('Not executable');
});

test('selects a facility from the keyboard', async ({ page }) => {
  await page.goto('/');

  const buyerD = page.getByRole('button', { name: 'Demo Buyer D', exact: true });
  await buyerD.focus();
  await page.keyboard.press('Enter');

  await expect(buyerD).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary')).toContainText('No active bid');
});
