import { expect, test } from '@playwright/test';

test('loads the workspace with synthetic data and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Synthetic demo data');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(10);
  await expect(page.getByRole('complementary', { name: 'Order book' })).toContainText(
    'Flaxseed · No. 1 CW',
  );
  expect(errors).toEqual([]);
});

test('keeps the menu on the left and only a status dot and profile icon on top', async ({
  page,
}) => {
  await page.goto('/');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const navBox = await nav.boundingBox();
  expect(navBox?.x).toBeLessThan(40);
  await expect(page.getByRole('link', { name: 'GSS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();

  // The connection dot speaks to screen readers only while all is well.
  const status = page.getByRole('banner').getByRole('status');
  await expect(status).toHaveText('Connected to the server');
  await expect(status.getByText('Server unreachable')).toHaveCount(0);
  await expect(page.getByText('API reachable')).toHaveCount(0);
  await expect(page.getByText(/Signed in/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
});

test('switches to the night theme with one switch and keeps it after a reload', async ({
  page,
}) => {
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).not.toHaveClass(/\bdark\b/);
  const lightBackground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );

  await page.getByRole('button', { name: 'Account' }).click();
  const toggle = page.getByRole('menuitemcheckbox', { name: 'Dark mode' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);

  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Dark mode' }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});

test('uses the IBM Plex Sans typeface served with the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeVisible();
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px "IBM Plex Sans Variable"');
  });
  expect(loaded).toBe(true);
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

test('narrows the workspace to the chosen commodities', async ({ page }) => {
  await page.goto('/');
  const book = page.getByRole('complementary', { name: 'Order book' });

  await page.getByRole('button', { name: 'Commodities: All' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'All commodities' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Canola' }).click();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: 'Commodities: Canola' })).toBeVisible();
  await expect(book).toContainText('Canola · No. 1 Canada');
  await expect(book).not.toContainText('Flaxseed');
  // Bid 712.00 minus offer 690.00, both in CAD, exactly.
  await expect(book.getByRole('group', { name: 'Spreads' })).toContainText('CAD +22.00/MT');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(4);
});
