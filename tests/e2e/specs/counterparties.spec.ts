import { expect, test, type Page } from '@playwright/test';

import { OTHER_ORG } from './supabase';

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

  // The map page. CI builds without a Mapbox token, so it lists the locations instead, and
  // none of the imported ones has coordinates.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Map' }).click();
  await expect(page.getByText(/The map is not set up yet/)).toBeVisible();
  await expect(
    page.getByText(
      '0 locations have coordinates. 3 locations have no coordinates yet, so they are not on the map.',
    ),
  ).toBeVisible();

  // Finding coordinates. CI has no Geocodio key, so the lookup says what is missing.
  await page.getByRole('link', { name: 'Find coordinates from addresses' }).click();
  await expect(page.getByRole('heading', { name: 'Find coordinates' })).toBeVisible();
  await page.getByRole('button', { name: 'Look up addresses' }).click();
  await expect(page.getByRole('alert')).toContainText('Finding coordinates is not set up');

  expect(errors).toEqual([]);
});

/** The signed-in user's access token, from the Supabase session in local storage. */
async function accessToken(page: Page): Promise<string> {
  await page.goto('/');
  // The profile button appears once the app has the signed-in session.
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

test("another organization's counterparties stay hidden, even by id", async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${await accessToken(page)}` };

  const all = await request.get('/api/v1/counterparties', { headers });
  expect(all.status()).toBe(200);
  expect(JSON.stringify(await all.json())).not.toContain(OTHER_ORG.counterpartyName);

  const byOrg = await request.get(`/api/v1/counterparties?organization_id=${OTHER_ORG.id}`, {
    headers,
  });
  expect(await byOrg.json()).toEqual({ counterparties: [], truncated: false });

  const world = '-180,-90,180,90';
  const map = await request.get(`/api/v1/facilities?bbox=${world}`, { headers });
  expect(map.status()).toBe(200);
  expect(JSON.stringify(await map.json())).not.toContain(OTHER_ORG.facilityName);
  const otherMap = await request.get(
    `/api/v1/facilities?bbox=${world}&organization_id=${OTHER_ORG.id}`,
    { headers },
  );
  expect(await otherMap.json()).toEqual({
    facilities: [],
    truncated: false,
    withoutCoordinates: 0,
  });

  const lookUp = await request.post('/api/v1/facilities/geocode', {
    headers,
    data: { organizationId: OTHER_ORG.id },
  });
  expect(lookUp.status()).toBe(403);
  const save = await request.post('/api/v1/facilities/coordinates', {
    headers,
    data: {
      organizationId: OTHER_ORG.id,
      matches: [
        {
          facilityId: OTHER_ORG.counterpartyId,
          latitude: '46.877186',
          longitude: '-96.789803',
          precision: 'exact',
          accuracyType: 'rooftop',
          confidence: '1.00',
          expiresAt: '2099-01-01T00:00:00.000Z',
          signature: '0'.repeat(64),
        },
      ],
    },
  });
  expect(save.status()).toBe(403);

  const one = `/api/v1/counterparties/${OTHER_ORG.counterpartyId}`;
  expect((await request.get(one, { headers })).status()).toBe(404);
  expect((await request.get(`${one}/logo`, { headers })).status()).toBe(404);
  const upload = await request.put(`${one}/logo`, {
    headers: { ...headers, 'Content-Type': 'image/png' },
    data: PNG,
  });
  expect(upload.status()).toBe(404);

  const intoOther = await request.post('/api/v1/counterparties/import', {
    headers,
    data: {
      organizationId: OTHER_ORG.id,
      fileName: 'cross-org.csv',
      commit: true,
      rows: [{ line: 2, values: { legalName: 'Synthetic Intruder', country: 'US' } }],
    },
  });
  expect(intoOther.status()).toBe(403);

  await page.goto(`/counterparties/${OTHER_ORG.counterpartyId}`);
  await expect(page.getByRole('alert')).toHaveText(
    'This counterparty does not exist or is not in your organization.',
  );
});
