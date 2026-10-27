import { expect, test, type Page } from '@playwright/test';

import { showDemoData } from './synthetic';

// Demo data on, read at a fixed time: the synthetic quotes expire in November 2026.
test.beforeEach(async ({ page }) => {
  await showDemoData(page);
});

/** The "Demo" tag beside the GSS name, where it is on screen. */
const demoTag = (page: Page) => page.getByText(/^demo$/i).filter({ visible: true });

test('loads the workspace with demo data and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');

  // The heading is for screen readers only; the page itself carries no demo notes.
  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeAttached();
  await expect(demoTag(page)).toBeVisible();
  await expect(page.getByText('Synthetic demo data')).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeAttached();

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Dark mode' }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});

test('turns demo data off and on with the switch above Dark mode', async ({ page }) => {
  await page.goto('/');
  const book = page.getByRole('complementary', { name: 'Order book' });
  await expect(demoTag(page)).toBeVisible();
  await expect(book).toContainText('Flaxseed · No. 1 CW');

  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('menuitemcheckbox')).toHaveText(['Demo data', 'Dark mode']);
  const demo = page.getByRole('menuitemcheckbox', { name: 'Demo data' });
  await expect(demo).toHaveAttribute('aria-checked', 'true');
  await demo.click();
  await expect(demo).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  // Off: no tag, and the workspace says there are no asks or bids rather than showing any.
  await expect(demoTag(page)).toHaveCount(0);
  await expect(book).toContainText('No asks or bids yet.');
  await expect(page.getByRole('table')).toContainText('No facilities with asks or bids yet.');

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Demo data' }).click();
  await page.keyboard.press('Escape');
  await expect(demoTag(page)).toBeVisible();
  await expect(book).toContainText('Flaxseed · No. 1 CW');
});

test('uses the IBM Plex Sans typeface served with the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspace', level: 1 })).toBeAttached();
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px "IBM Plex Sans Variable"');
  });
  expect(loaded).toBe(true);
});

test('shows the selected buyer bid in CAD, with its USD price, rate and validity', async ({
  page,
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Demo Buyer C', exact: true }).click();

  const bid = page.getByRole('complementary').getByRole('region', { name: 'Buyer bid' });
  // The golden fixture: USD 725.00 at 1.360000 CAD per USD is CAD 986.00.
  await expect(bid).toContainText('CAD 986.00/MT');
  await expect(bid).toContainText('Quoted as USD 725.00/MT at 1.360000 CAD per USD');
  await expect(bid).toContainText('valid until 2026-11-09 23:59 UTC');
  await expect(bid).toContainText('Not executable');
});

test('keeps the order book flush with the map, and tucks it away with the arrow tab', async ({
  page,
}) => {
  await page.goto('/');
  const book = page.getByRole('complementary', { name: 'Order book' });
  await expect(book).toContainText('Flaxseed · No. 1 CW');
  // Where the book sits inside the map's frame (its wrapper's parent), in pixels.
  const edges = () =>
    book.evaluate((element) => {
      const frame = element.parentElement?.parentElement;
      if (!frame) throw new Error('order book is not inside the map frame');
      const own = element.getBoundingClientRect();
      const inner = frame.getBoundingClientRect();
      const border = parseFloat(getComputedStyle(frame).borderRightWidth);
      return {
        left: own.left,
        right: own.right,
        top: own.top,
        bottom: own.bottom,
        frameRight: inner.right - border,
        frameTop: inner.top + border,
        frameBottom: inner.bottom - border,
      };
    });

  // Flush right and full height: no map shows beside, above or below it.
  const open = await edges();
  expect(Math.abs(open.right - open.frameRight)).toBeLessThan(1);
  expect(Math.abs(open.top - open.frameTop)).toBeLessThan(1);
  expect(Math.abs(open.bottom - open.frameBottom)).toBeLessThan(1);

  const hide = page.getByRole('button', { name: 'Hide order book' });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await hide.click();
  const show = page.getByRole('button', { name: 'Show order book' });
  await expect(show).toBeVisible();
  // Slid out past the map's right edge, leaving only the tab.
  await expect.poll(async () => (await edges()).left - open.frameRight).toBeGreaterThanOrEqual(-1);
  // Out of reach of the keyboard and screen readers while tucked away.
  await expect(book).toHaveAttribute('inert', '');

  await show.click();
  await expect.poll(async () => Math.round((await edges()).left)).toBe(Math.round(open.left));
  await expect(page.getByRole('button', { name: 'Hide order book' })).toBeVisible();
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
  // Bid 712.00 minus ask 690.00, both in CAD, exactly; the caveat is the spread's tooltip.
  await expect(
    book.getByTitle('Best bid minus best ask, before freight and basis: not a margin.'),
  ).toContainText('+22.00');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(4);
});
