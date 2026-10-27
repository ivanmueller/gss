import { expect, test } from '@playwright/test';

test('uses a facility list and tabs, with no sideways scrolling', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('tablist', { name: 'Workspace view' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(4);
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);

  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(page.getByText('Map placeholder')).toBeVisible();
  await expect(page.getByRole('complementary')).toContainText('Demo Seller A');
});
