import { expect, test } from '@playwright/test';

// Synthetic, fictional companies only.
const CSV = [
  'Company Name,Country,Contact,E-mail,City,Prov',
  'Synthetic Mills,Canada,Ana Synthetic,ana@example.test,Alpha,SK',
  'Synthetic Mills,Canada,,,Beta,Manitoba',
  'Synthetic Buyer LLC,USA,,,Gamma,ND',
  '',
].join('\n');

// A valid 1x1 PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082',
  'hex',
);

function csvFile(name: string) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(CSV) };
}

test('imports a spreadsheet, adds a logo and skips companies already listed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/counterparties');
  await expect(page.getByText('No counterparties yet.')).toBeVisible();

  await page.getByRole('link', { name: 'Import spreadsheet' }).click();
  await page.getByLabel('Choose CSV file').setInputFiles(csvFile('synthetic-buyers.csv'));
  await expect(page.getByLabel('Legal name (required)')).toHaveValue('Company Name');
  await page.getByRole('button', { name: 'Review import' }).click();
  await expect(page.getByRole('table', { name: 'Counterparties in this import' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 new counterparties' }).click();
  await expect(
    page.getByText('Imported 2 counterparties with 1 contacts and 3 locations.'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'See the counterparties' }).click();
  const table = page.getByRole('table', { name: 'Counterparties' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table).toContainText('MB, SK · Canada');

  await table.getByRole('link', { name: 'Synthetic Mills' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Mills' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Contacts (1)' })).toContainText(
    'ana@example.test',
  );
  await expect(page.getByRole('region', { name: 'Locations (2)' })).toBeVisible();
  await page
    .getByLabel('Upload PNG logo')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('Logo saved.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Synthetic Mills logo' })).toBeVisible();

  await page.getByRole('link', { name: 'All counterparties' }).click();
  await page.getByRole('tab', { name: 'Logos' }).click();
  await expect(
    page
      .getByRole('list', { name: 'Counterparties by logo' })
      .getByRole('img', { name: 'Synthetic Mills logo' }),
  ).toBeVisible();

  // The same companies again are reported as already listed, and nothing is imported.
  await page.goto('/counterparties/import');
  await page.getByLabel('Choose CSV file').setInputFiles(csvFile('again.csv'));
  await page.getByRole('button', { name: 'Review import' }).click();
  await expect(page.getByText('Already in the list; skipped')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Import 0 new counterparties' })).toBeDisabled();

  expect(errors).toEqual([]);
});
