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
    .getByLabel('Upload logo')
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

  // The map view of the Counterparties page. CI builds without a Mapbox token, so it lists
  // the locations instead, and none of the imported ones has coordinates.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Counterparties' })
    .click();
  await page.getByRole('tab', { name: 'Map' }).click();
  await expect(page).toHaveURL(/\/counterparties\?view=map$/);
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

test('adds a seller by hand, edits it, and archives and restores it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/counterparties');
  await page.getByRole('link', { name: 'Add counterparty' }).click();
  const company = page.getByRole('region', { name: 'Company' });
  await company.getByLabel('Legal name (required)').fill('Synthetic Hand Grower');
  await company.getByRole('checkbox', { name: 'Seller' }).check();
  await company.getByLabel('Country (required)').selectOption('CA');
  await page.getByRole('region', { name: 'Contact' }).getByLabel('Name').fill('Synthetic Farmer');
  const location = page.getByRole('region', { name: 'Location' });
  await location.getByLabel('City or town').fill('Synthetic Town');
  await location.getByLabel('Province or territory').selectOption('SK');
  await page.getByRole('button', { name: 'Add counterparty' }).click();

  await expect(page.getByRole('heading', { name: 'Synthetic Hand Grower' })).toBeVisible();
  await expect(page.getByText('Entered by hand')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Contacts (1)' })).toContainText(
    'Synthetic Farmer',
  );

  // Correct the details and the location.
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page
    .getByRole('form', { name: 'Edit details' })
    .getByLabel('Trading name')
    .fill('Hand Grower');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Trading as Hand Grower')).toBeVisible();

  await page.getByRole('button', { name: 'Edit Synthetic Town' }).click();
  const edit = page.getByRole('form', { name: 'Edit Synthetic Town' });
  await edit.getByLabel('Latitude').fill('52.133214');
  await edit.getByLabel('Longitude').fill('-106.670046');
  await edit.getByLabel('Precision').selectOption('exact');
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page.getByRole('region', { name: 'Locations (1)' })).toContainText(
    '52.133214, -106.670046 · exact location · entered by hand',
  );

  // Remove the contact, after a confirmation.
  await page.getByRole('button', { name: 'Remove Synthetic Farmer' }).click();
  await page
    .getByRole('group', { name: 'Remove Synthetic Farmer' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(page.getByRole('region', { name: 'Contacts (0)' })).toBeVisible();

  // Sellers only.
  await page.getByRole('link', { name: 'All counterparties' }).click();
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Sellers' }).click();
  const table = page.getByRole('table', { name: 'Counterparties' });
  await expect(table.getByRole('link', { name: 'Synthetic Hand Grower' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Synthetic Mills' })).toHaveCount(0);

  // Archive: off the list until shown, then restored.
  await table.getByRole('link', { name: 'Synthetic Hand Grower' }).click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await page
    .getByRole('group', { name: 'Archive this counterparty' })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(page.getByText(/cannot be changed until it is restored/)).toBeVisible();
  await page.getByRole('link', { name: 'All counterparties' }).click();
  await expect(page.getByRole('link', { name: 'Synthetic Hand Grower' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show archived (1)' }).check();
  await page.getByRole('link', { name: 'Synthetic Hand Grower' }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();

  // The old map address opens the map view.
  await page.goto('/map');
  await expect(page).toHaveURL(/\/counterparties\?view=map$/);
  await expect(page.getByRole('tab', { name: 'Map', selected: true })).toBeVisible();

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
          facilityVersion: '2026-10-28T00:00:00.000000Z',
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

  // Adding to, editing, archiving and removing from another organization's directory.
  const version = '2026-10-28T00:00:00.000000Z';
  const add = await request.post('/api/v1/counterparties', {
    headers,
    data: {
      organizationId: OTHER_ORG.id,
      values: { legalName: 'Synthetic Intruder', country: 'US', types: 'buyer' },
    },
  });
  expect(add.status()).toBe(403);
  const writes = [
    request.patch(one, {
      headers,
      data: { version, values: { legalName: 'Hijacked', country: 'US', types: 'buyer' } },
    }),
    request.post(`${one}/archive`, { headers }),
    request.post(`${one}/contacts`, { headers, data: { values: { contactName: 'Intruder' } } }),
    request.post(`${one}/facilities`, { headers, data: { values: { city: 'Elsewhere' } } }),
    request.delete(`${one}/facilities/${OTHER_ORG.counterpartyId}`, { headers }),
  ];
  for (const write of await Promise.all(writes)) expect(write.status()).toBe(404);

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
  await expect(page.getByRole('alert')).toHaveText('This counterparty does not exist.');
});

// Runs after the tests above in this file, which leave the seller "Synthetic Hand Grower"
// with a location in Synthetic Town. Bids and offers are never deleted, so a second local
// run needs a fresh database (supabase.ts says so).
test('enters an offer, records new terms, and withdraws it, keeping the history', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/counterparties');
  await page.getByRole('link', { name: 'Synthetic Hand Grower' }).click();
  const section = page.getByRole('region', { name: 'Bids and offers (0)' });
  await expect(section).toContainText('No live bids or offers.');
  // A seller offers; it does not bid.
  await expect(section.getByRole('link', { name: 'New bid' })).toHaveCount(0);
  await section.getByRole('link', { name: 'New offer' }).click();

  await expect(page.getByRole('heading', { name: 'New offer' })).toBeVisible();
  await expect(page.getByLabel('Counterparty (required)')).toHaveValue(/[0-9a-f-]{36}/);
  await page.getByLabel('Location', { exact: true }).selectOption({ label: 'Synthetic Town, SK' });
  await page.getByLabel('Commodity (required)').selectOption({ label: 'Flaxseed' });
  await page.getByLabel('Price (required)').fill('820.00');
  await page.getByLabel('Currency (required)').selectOption('CAD');
  await page.getByLabel('Firm or indicative (required)').selectOption('firm');
  await page.getByLabel('Grade or quality').fill('No. 1 CW');
  await page.getByLabel('Available quantity (MT) (required)').fill('42');
  await page.getByLabel('Delivery basis (required)').selectOption('fob');
  await page.getByLabel('Valid until (required)').fill('2099-10-30T16:00');
  await page.getByLabel('Source (required)').selectOption('phone');
  await page.getByRole('button', { name: 'Save offer' }).click();

  await expect(page.getByRole('heading', { name: /Offer · Flaxseed/ })).toBeVisible();
  const current = page.getByRole('region', { name: 'Current terms' });
  await expect(current).toContainText('CAD 820.00/MT');
  await expect(current).toContainText('Revision 1');
  await expect(current).toContainText('by Synthetic Trader');

  // New terms are a new revision; the first terms stay in the history.
  await page.getByRole('button', { name: 'Record new terms' }).click();
  await page.getByLabel('Price (required)').fill('815.50');
  await page.getByRole('button', { name: 'Save new terms' }).click();
  await expect(page.getByText('New terms saved.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Current terms' })).toContainText('CAD 815.50/MT');
  const history = page.getByRole('table', { name: 'Revision history' });
  await expect(history.getByRole('row')).toHaveCount(3);
  await expect(history.getByRole('row').nth(2)).toContainText('CAD 820.00/MT');
  await expect(history.getByRole('row').nth(2)).toContainText('Superseded');

  // It reaches the workspace's order book (demo data is off in this file), at its CAD price
  // per tonne.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Workspace' })
    .click();
  const workspaceBook = page.getByRole('complementary', { name: 'Order book' });
  await expect(
    workspaceBook.getByRole('button', { name: /^Ask: Synthetic Hand Grower, CAD 815\.50\/MT/ }),
  ).toBeVisible();

  // The live list shows it until it is withdrawn; then only with the historical filter.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Bids & offers' })
    .click();
  const list = page.getByRole('table', { name: 'Bids and offers' });
  await expect(list).toContainText('CAD 815.50/MT');
  await list.getByRole('link', { name: 'Flaxseed' }).click();
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page
    .getByRole('group', { name: 'Withdraw this quote' })
    .getByRole('button', { name: 'Withdraw' })
    .click();
  await expect(page.getByText(/is never live again/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record new terms' })).toHaveCount(0);
  await page.getByRole('link', { name: 'All bids and offers' }).click();
  await expect(page.getByText('No live bids or offers here.')).toBeVisible();
  await page.getByLabel('Include withdrawn and expired').check();
  await expect(page.getByRole('table', { name: 'Bids and offers' })).toContainText('Withdrawn');

  // Withdrawn, it leaves the workspace's order book.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Workspace' })
    .click();
  await expect(page.getByRole('complementary', { name: 'Order book' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ask: Synthetic Hand Grower/ })).toHaveCount(0);

  // Another organization's counterparty cannot be quoted for, and its quotes stay hidden.
  const headers = { Authorization: `Bearer ${await accessToken(page)}` };
  const intrude = await request.post('/api/v1/quotes', {
    headers,
    data: {
      organizationId: OTHER_ORG.id,
      counterpartyId: OTHER_ORG.counterpartyId,
      side: 'bid',
      commodity: 'flaxseed',
      values: {
        firmness: 'firm',
        price: '1.00',
        currency: 'USD',
        priceUnit: 'MT',
        deliveryBasis: 'delivered',
        quantityMax: '1',
        validUntil: '2099-01-01T00:00:00Z',
        sourceType: 'phone',
      },
    },
  });
  expect(intrude.status()).toBe(403);
  const other = await request.get(`/api/v1/quotes?organization_id=${OTHER_ORG.id}&status=all`, {
    headers,
  });
  expect(await other.json()).toEqual({ quotes: [], truncated: false });

  expect(errors).toEqual([]);
});
