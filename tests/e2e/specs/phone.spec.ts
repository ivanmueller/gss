import { expect, test } from '@playwright/test';

test('uses tabs for the map, order book and facilities, with no sideways scrolling', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('tablist', { name: 'Workspace view' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  // CI builds without a Mapbox token, so the map tab explains itself.
  await expect(page.getByText('Map not available')).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);

  await page.getByRole('tab', { name: 'Order book' }).click();
  await expect(page.getByRole('complementary', { name: 'Order book' })).toContainText(
    'Demo Seller A',
  );
  await page.getByRole('tab', { name: 'Facilities' }).click();
  await expect(page.getByRole('region', { name: 'Facilities' }).getByRole('listitem')).toHaveCount(
    9,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
});

test('counterparties fit the phone screen', async ({ page }) => {
  await page.goto('/counterparties');
  await expect(page.getByRole('heading', { name: 'Counterparties' })).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
});

test('opens the menu from the top bar and closes it after choosing a page', async ({ page }) => {
  await page.goto('/');
  // The left menu is folded away on a phone; the top bar keeps the dot and profile icon.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Connected to the server');
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();

  await page.getByRole('button', { name: 'Open menu' }).click();
  const panel = page.getByRole('dialog', { name: 'Menu' });
  await expect(panel.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await panel.getByRole('link', { name: 'Counterparties' }).click();

  await expect(page).toHaveURL(/\/counterparties$/);
  await expect(panel).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Counterparties' })).toBeVisible();
});
