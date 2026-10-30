import { expect, test, type Page } from '@playwright/test';

import { choose } from './choose';
import { OTHER_ORG } from './supabase';

// Synthetic, fictional companies only.
const CSV = [
  'Company Name,Country,Contact,E-mail,City,Prov,Commodities',
  'Synthetic Mills,Canada,Ana Synthetic,ana@example.test,Alpha,SK,Canola',
  'Synthetic Mills,Canada,,,Beta,Manitoba,',
  'Synthetic Buyer LLC,USA,,,Gamma,ND,',
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

  // Imported in the + button's window (owner's request, 2026-10-30).
  await page.getByRole('button', { name: 'Add counterparties' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add counterparties' });
  await dialog.getByRole('tab', { name: 'Import spreadsheet' }).click();
  await dialog.getByLabel('Choose CSV file').setInputFiles(csvFile('synthetic-buyers.csv'));
  await expect(dialog.getByLabel('Legal name (required)')).toContainText('Company Name');
  await dialog.getByRole('button', { name: 'Review import' }).click();
  await expect(dialog.getByRole('table', { name: 'Counterparties in this import' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2 new counterparties' }).click();
  await expect(
    dialog.getByText('Imported 2 counterparties with 1 contacts and 3 locations.'),
  ).toBeVisible();
  // Coordinates are looked up next; CI has no Geocodio key, so the step says what is
  // missing and lets the import finish.
  await expect(dialog.getByRole('alert')).toContainText('Finding coordinates is not set up');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  // The page opens on the logos (owner's request, 2026-10-29); the table is one click away.
  await expect(page.getByRole('tab', { name: 'Logos', selected: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Table' }).click();
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

  // Canola came from the spreadsheet: unverified until someone verifies it.
  await page.getByRole('button', { name: 'Canola, unverified: verify' }).click();
  const verify = page.getByRole('dialog', { name: 'Verify Canola?' });
  await verify.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Canola verified.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'What they buy' })).toContainText('Canola, verified');
  await expect(page.getByRole('button', { name: /Canola/ })).toHaveCount(0);

  // Finding coordinates from the counterparty's page; again not set up in CI.
  await page
    .getByRole('region', { name: 'Locations (2)' })
    .getByRole('button', { name: 'Find coordinates' })
    .click();
  const find = page.getByRole('dialog', { name: 'Find coordinates' });
  await expect(find.getByRole('alert')).toContainText('Finding coordinates is not set up');
  await find.getByRole('button', { name: 'Done' }).click();
  await expect(find).toHaveCount(0);

  await page.getByRole('link', { name: 'All counterparties' }).click();
  await page.getByRole('tab', { name: 'Logos' }).click();
  await expect(
    page
      .getByRole('list', { name: 'Counterparties by logo' })
      .getByRole('img', { name: 'Synthetic Mills logo' }),
  ).toBeVisible();

  // The same companies again are reported as already listed, and nothing is imported. The
  // old import page's address opens the window on its tab.
  await page.goto('/counterparties/import');
  await expect(page).toHaveURL(/\/counterparties\?add=import$/);
  await dialog.getByLabel('Choose CSV file').setInputFiles(csvFile('again.csv'));
  await dialog.getByRole('button', { name: 'Review import' }).click();
  await expect(dialog.getByText('Already in the list; skipped')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: 'Import 0 new counterparties' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

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
      '0 locations have coordinates. 3 locations have no coordinates yet, so they are not on the map: use Find coordinates on the counterparty’s page.',
    ),
  ).toBeVisible();

  expect(errors).toEqual([]);
});

test('adds a seller by hand, edits it, and archives and restores it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/counterparties');
  await page.getByRole('button', { name: 'Add counterparties' }).click();
  // The window opens on Add one.
  const dialog = page.getByRole('dialog', { name: 'Add counterparties' });
  const company = dialog.getByRole('region', { name: 'Company' });
  await company.getByLabel('Legal name (required)').fill('Synthetic Hand Grower');
  await company.getByRole('checkbox', { name: 'Seller' }).check();
  await choose(company.getByLabel('Country (required)'), 'Canada');
  await company.getByLabel('Company phone').fill('306 555 0100 ext. 7');
  await dialog.getByRole('region', { name: 'Contact' }).getByLabel('Name').fill('Synthetic Farmer');
  const location = dialog.getByRole('region', { name: 'Location', exact: true });
  await location.getByLabel('City or town').fill('Synthetic Town');
  await choose(location.getByLabel('Province or territory'), 'Saskatchewan');
  await choose(location.getByLabel('Served by'), 'Rail and truck');
  await dialog.getByRole('button', { name: 'Add counterparty' }).click();
  // Its location has no coordinates, so they are looked up; not set up in CI.
  await expect(dialog.getByRole('alert')).toContainText('Finding coordinates is not set up');
  await dialog.getByRole('button', { name: 'Open Synthetic Hand Grower' }).click();

  await expect(page.getByRole('heading', { name: 'Synthetic Hand Grower' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Company phone 306 555 0100 x7' })).toHaveAttribute(
    'href',
    'tel:3065550100;ext=7',
  );
  await expect(page.getByRole('region', { name: 'Locations (1)' })).toContainText(
    'Served by rail and truck',
  );
  await expect(page.getByText('Entered by hand')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Contacts (1)' })).toContainText(
    'Synthetic Farmer',
  );

  // A seller's page: Edit details and Archive are under More actions.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit details' }).click();
  const details = page.getByRole('form', { name: 'Edit details' });
  await details.getByLabel('Trading name').fill('Hand Grower');
  await details.getByLabel('Website').fill('Example.com/');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByText('Trading as Hand Grower')).toBeVisible();
  // Saved as https://example.com and opened in a new tab; there is no preview.
  const website = page.getByRole('link', { name: 'example.com (opens in a new tab)' });
  await expect(website).toHaveAttribute('href', 'https://example.com');
  await expect(website).toHaveAttribute('target', '_blank');
  await expect(website).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit Synthetic Town' }).click();
  const edit = page.getByRole('form', { name: 'Edit Synthetic Town' });
  await edit.getByLabel('Latitude').fill('52.133214');
  await edit.getByLabel('Longitude').fill('-106.670046');
  await choose(edit.getByLabel('Precision'), 'Exact');
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(page.getByRole('region', { name: 'Locations (1)' })).toContainText(
    '52.133214, -106.670046 · exact location',
  );

  // What the seller sells: ticked from the list of commodities, then shown on its page.
  await page.getByRole('button', { name: 'Edit what they sell' }).click();
  const sells = page.getByRole('form', { name: 'Edit what they sell' });
  await sells.getByRole('checkbox', { name: 'Yellow peas' }).check();
  await sells.getByRole('checkbox', { name: 'Oats' }).check();
  await sells.getByRole('button', { name: 'Save commodities' }).click();
  // Ticked by hand, so verified at once.
  await expect(page.getByRole('list', { name: 'What they sell' })).toHaveText(
    /Yellow peas, verified\s*Oats, verified/,
  );

  // The main contact, shown at the top with a link to call.
  await page.getByRole('button', { name: 'Make Synthetic Farmer the main contact' }).click();
  await expect(page.getByRole('group', { name: 'Main contact' })).toContainText('Synthetic Farmer');

  // Remove the contact, after a confirmation; no main contact is left.
  await page.getByRole('button', { name: 'Remove Synthetic Farmer' }).click();
  await page
    .getByRole('group', { name: 'Remove Synthetic Farmer' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(page.getByRole('region', { name: 'Contacts (0)' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Main contact' })).toContainText('None yet');

  // Sellers only.
  await page.getByRole('link', { name: 'All counterparties' }).click();
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Sellers' }).click();
  await page.getByRole('tab', { name: 'Table' }).click();
  const table = page.getByRole('table', { name: 'Counterparties' });
  await expect(table.getByRole('link', { name: 'Synthetic Hand Grower' })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Synthetic Mills' })).toHaveCount(0);
  // Sellers of oats, then of a commodity it does not sell.
  await choose(page.getByRole('combobox', { name: 'Commodity' }), 'Oats');
  await expect(table.getByRole('link', { name: 'Synthetic Hand Grower' })).toBeVisible();
  await choose(page.getByRole('combobox', { name: 'Commodity' }), 'Rye');
  await expect(table.getByRole('link', { name: 'Synthetic Hand Grower' })).toHaveCount(0);
  await choose(page.getByRole('combobox', { name: 'Commodity' }), 'All commodities');

  // Archive: off the list until shown, then restored.
  await table.getByRole('link', { name: 'Synthetic Hand Grower' }).click();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
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
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();

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
    request.put(`${one}/main-contact`, { headers, data: { contactId: null } }),
    request.patch(`${one}/commodities`, {
      headers,
      data: { add: [{ commodity: 'canola', direction: 'buys' }], remove: [] },
    }),
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
  await expect(page.getByLabel('Counterparty (required)')).toContainText('Synthetic Hand Grower');
  await choose(page.getByLabel('Location', { exact: true }), 'Synthetic Town, SK');
  await choose(page.getByLabel('Commodity (required)'), 'Flaxseed');
  await page.getByLabel('Price (required)').fill('820.00');
  await choose(page.getByLabel('Currency (required)'), 'CAD');
  await choose(page.getByLabel('Firm or indicative (required)'), 'Firm');
  await page.getByLabel('Grade or quality').fill('No. 1 CW');
  await page.getByLabel('Available quantity (MT) (required)').fill('42');
  await choose(page.getByLabel('Delivery basis (required)'), 'FOB');
  await page.getByLabel('Valid until (required)').fill('2099-10-30T16:00');
  await choose(page.getByLabel('Source (required)'), 'Phone call');
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

// Runs after the tests above in this file, which leave the seller "Synthetic Hand Grower"
// with a location in Synthetic Town, SK, and "Synthetic Mills" with one in Beta, MB.
// Freight rates are never deleted either, so a second local run needs a fresh database.
test('adds a carrier, enters its rate per load on a route, records new terms and withdraws it', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  // A carrier is a counterparty like any other, marked as a carrier; no location needed.
  await page.goto('/counterparties');
  await page.getByRole('button', { name: 'Add counterparties' }).click();
  const company = page.getByRole('dialog').getByRole('region', { name: 'Company' });
  await company.getByLabel('Legal name (required)').fill('Synthetic Hauling');
  await company.getByRole('checkbox', { name: 'Carrier' }).check();
  await choose(company.getByLabel('Country (required)'), 'Canada');
  await page.getByRole('button', { name: 'Add counterparty' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Hauling' })).toBeVisible();

  // The Carriers filter shows it alone.
  await page.getByRole('link', { name: 'All counterparties' }).click();
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Carriers' }).click();
  await expect(page).toHaveURL(/\/counterparties\?type=carrier$/);
  await page.getByRole('tab', { name: 'Table' }).click();
  const table = page.getByRole('table', { name: 'Counterparties' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await table.getByRole('link', { name: 'Synthetic Hauling' }).click();

  const section = page.getByRole('region', { name: 'Freight rates (0)' });
  await expect(section).toContainText('No live freight rates.');
  await section.getByRole('link', { name: 'New freight rate' }).click();

  await expect(page.getByRole('heading', { name: 'New freight rate' })).toBeVisible();
  await expect(page.getByLabel('Carrier (required)')).toContainText('Synthetic Hauling');
  await page
    .getByRole('group', { name: 'Truck or rail' })
    .getByRole('button', { name: 'Rail' })
    .click();
  await choose(page.getByLabel('From: company (required)'), 'Synthetic Hand Grower');
  await choose(page.getByLabel('From: location (required)'), 'Synthetic Town, SK');
  // The company pickers can be searched (owner's request, 2026-10-29).
  await page.getByLabel('To: company (required)').click();
  await page.getByRole('combobox', { name: 'Search the list' }).fill('mills');
  await page.getByRole('option', { name: 'Synthetic Mills', exact: true }).click();
  await choose(page.getByLabel('To: location (required)'), 'Beta, MB');
  await page.getByLabel('Rate (required)').fill('4200.00');
  await choose(page.getByLabel('Currency (required)'), 'USD');
  await choose(
    page.getByLabel('Unit (required)', { exact: true }),
    'per load (truckload or railcar)',
  );
  await page.getByLabel('Payload of one load (required)').fill('90.5');
  await choose(page.getByLabel('Payload unit (required)'), 'metric tonnes');
  await choose(page.getByLabel('Firm or indicative (required)'), 'Firm');
  await page.getByLabel('What the rate includes').fill('Fuel surcharge included');
  await page.getByLabel('Valid until (required)').fill('2099-11-05T16:00');
  await choose(page.getByLabel('Source (required)'), 'Email');
  await page.getByRole('button', { name: 'Save freight rate' }).click();

  await expect(page.getByRole('heading', { name: /Rail rate · Synthetic Hauling/ })).toBeVisible();
  const route = page.getByRole('region', { name: 'Route' });
  await expect(route).toContainText('Synthetic Hand Grower');
  await expect(route).toContainText('Synthetic Mills');
  const current = page.getByRole('region', { name: 'Current terms' });
  await expect(current).toContainText('USD 4200.00/load');
  await expect(current).toContainText('90.5 MT a load');
  await expect(current).toContainText('Revision 1');
  await expect(current).toContainText('by Synthetic Trader');

  // New terms are a new revision; the first terms stay in the history.
  await page.getByRole('button', { name: 'Record new terms' }).click();
  await choose(page.getByLabel('Unit (required)', { exact: true }), 'per metric tonne (MT)');
  await page.getByLabel('Rate (required)').fill('46.50');
  await page.getByRole('button', { name: 'Save new terms' }).click();
  await expect(page.getByText('New terms saved.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Current terms' })).toContainText('USD 46.50/MT');
  const history = page.getByRole('table', { name: 'Revision history' });
  await expect(history.getByRole('row')).toHaveCount(3);
  await expect(history.getByRole('row').nth(2)).toContainText('USD 4200.00/load');
  await expect(history.getByRole('row').nth(2)).toContainText('Superseded');

  // The Freight page lists it until it is withdrawn; then only with the historical filter.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Freight' })
    .click();
  const list = page.getByRole('table', { name: 'Freight rates' });
  await expect(list).toContainText('USD 46.50/MT');
  await expect(list).toContainText('Synthetic Hauling');
  await list
    .getByRole('link', { name: /^Synthetic Hand Grower, Synthetic Town, SK to Synthetic Mills/ })
    .click();
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page
    .getByRole('group', { name: 'Withdraw this freight rate' })
    .getByRole('button', { name: 'Withdraw' })
    .click();
  await expect(page.getByText(/is never live again/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record new terms' })).toHaveCount(0);
  await page.getByRole('link', { name: 'All freight rates' }).click();
  await expect(page.getByText('No live freight rates here.')).toBeVisible();
  await page.getByLabel('Include withdrawn and expired').check();
  await expect(page.getByRole('table', { name: 'Freight rates' })).toContainText('Withdrawn');

  // Another organization's location cannot be on a route, and its freight stays hidden.
  const headers = { Authorization: `Bearer ${await accessToken(page)}` };
  const intrude = await request.post('/api/v1/freight-quotes', {
    headers,
    data: {
      organizationId: OTHER_ORG.id,
      carrierId: OTHER_ORG.counterpartyId,
      originFacilityId: OTHER_ORG.counterpartyId,
      destinationFacilityId: OTHER_ORG.id,
      mode: 'truck',
      values: {
        firmness: 'firm',
        rate: '1.00',
        currency: 'CAD',
        rateUnit: 'MT',
        validUntil: '2099-01-01T00:00:00Z',
        sourceType: 'phone',
      },
    },
  });
  expect(intrude.status()).toBe(403);
  const other = await request.get(
    `/api/v1/freight-quotes?organization_id=${OTHER_ORG.id}&status=all`,
    { headers },
  );
  expect(await other.json()).toEqual({ freight: [], truncated: false });

  expect(errors).toEqual([]);
});

// The CRM for counterparties: a contact logged with a follow-up, a correction kept as a new
// version, the menu's count, the Follow-ups page, and another organization's records out of
// reach. Last in this file, so the counterparty it adds is not in the lists the tests above
// count. Contacts logged and follow-ups are never deleted, so a second local run needs a
// fresh database (supabase.ts says so).

/**
 * 9 am yesterday in Alberta, as a datetime-local input takes it. Alberta's clocks stay at
 * UTC−6 (packages/domain/src/alberta.ts), whatever this computer's time zone rules say.
 */
function yesterdayInAlberta(): string {
  const day = new Date(Date.now() - 86_400_000 - 6 * 3_600_000).toISOString().slice(0, 10);
  return `${day}T09:00`;
}

test('logs a contact with a follow-up, corrects it, and marks the follow-up done', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const headers = { Authorization: `Bearer ${await accessToken(page)}` };
  const me = (await (await request.get('/api/v1/me', { headers })).json()) as {
    organizations: { id: string }[];
  };
  const organizationId = me.organizations[0]?.id ?? '';
  const created = await request.post('/api/v1/counterparties', {
    headers,
    data: {
      organizationId,
      values: {
        legalName: 'Synthetic CRM Buyer',
        country: 'CA',
        types: 'buyer',
        contactName: 'Synthetic Merchant',
      },
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/counterparties/${id}`);
  const history = page.getByRole('region', { name: 'Contact history (0)' });
  await history.getByRole('button', { name: 'Log contact' }).click();
  await history.getByLabel(/Who you spoke to/).fill('Synthetic Merchant');
  await history.getByLabel('Notes').fill('Asked about synthetic November delivery.');
  await history.getByLabel('Plan a follow-up').check();
  await history.getByLabel(/What to do/).fill('Send the synthetic bid sheet');
  // Due yesterday, so it is overdue at once.
  await history.getByLabel(/Due/).fill(yesterdayInAlberta());
  await history.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByText('Contact logged and follow-up planned.')).toBeVisible();

  const logged = page.getByRole('region', { name: 'Contact history (1)' });
  await expect(logged).toContainText('Call with Synthetic Merchant');
  await expect(logged).toContainText('Logged by Synthetic Trader');
  const followUps = page.getByRole('region', { name: 'Follow-ups (1 open)' });
  await expect(followUps).toContainText('OverdueSend the synthetic bid sheet');
  await expect(followUps).toContainText('9:00 am MT · Synthetic Trader');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Follow-ups, 1 overdue or due today' })).toBeVisible();

  // A correction is a new version; the first stays in the history.
  await logged.getByRole('button', { name: 'Correct: Call with Synthetic Merchant' }).click();
  await logged.getByLabel('Notes').fill('Asked about synthetic November and December delivery.');
  await logged.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText('Correction saved.')).toBeVisible();
  await expect(logged).toContainText('November and December');
  await logged.getByRole('button', { name: 'Show earlier versions (1)' }).click();
  await expect(logged.getByRole('list', { name: 'Earlier versions' })).toContainText(
    'Asked about synthetic November delivery.',
  );

  // The Follow-ups page: mine, overdue first; done takes it off the list and the menu.
  await nav.getByRole('link', { name: /^Follow-ups/ }).click();
  const overdue = page.getByRole('region', { name: 'Overdue (1)' });
  await expect(overdue.getByRole('link', { name: 'Synthetic CRM Buyer' })).toBeVisible();
  await overdue.getByRole('button', { name: 'Mark done: Send the synthetic bid sheet' }).click();
  await expect(page.getByText('You have no open follow-ups.')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Follow-ups', exact: true })).toBeVisible();
  await page.getByLabel('Include done').check();
  await expect(page.getByRole('region', { name: 'Done (1)' })).toContainText('by Synthetic Trader');

  // An admin removes it from the counterparty's page; it leaves every list (2026-10-30).
  await page.goto(`/counterparties/${id}`);
  const finished = page.getByRole('region', { name: 'Follow-ups (0 open)' });
  await finished.getByRole('button', { name: 'Show done (1)' }).click();
  await finished
    .getByRole('button', { name: 'Remove follow-up: Send the synthetic bid sheet' })
    .click();
  await finished
    .getByRole('group', { name: 'Remove follow-up: Send the synthetic bid sheet' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(page.getByText('Follow-up removed.')).toBeVisible();
  await expect(finished.getByRole('button', { name: /^Show done/ })).toHaveCount(0);
  await nav.getByRole('link', { name: /^Follow-ups/ }).click();
  await page.getByLabel('Include done').check();
  await expect(page.getByText('Send the synthetic bid sheet')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("another organization's contact log and follow-ups stay out of reach", async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${await accessToken(page)}` };
  const other = OTHER_ORG.counterpartyId;

  const log = await request.get(`/api/v1/contact-log?counterparty_id=${other}`, { headers });
  expect(await log.json()).toEqual({ entries: [], truncated: false });
  const followUps = await request.get(`/api/v1/follow-ups?organization_id=${OTHER_ORG.id}`, {
    headers,
  });
  expect(await followUps.json()).toEqual({ followUps: [], truncated: false });
  const team = await request.get(`/api/v1/follow-ups/team?organization_id=${OTHER_ORG.id}`, {
    headers,
  });
  expect(await team.json()).toEqual({ members: [] });

  const values = { channel: 'call', contactName: 'Intruder' };
  const logIt = await request.post('/api/v1/contact-log', {
    headers,
    data: { counterpartyId: other, values },
  });
  expect(logIt.status()).toBe(404);
  const plan = await request.post('/api/v1/follow-ups', {
    headers,
    data: {
      counterpartyId: other,
      values: {
        task: 'Intrude',
        dueAt: '2026-11-01T15:00:00.000Z',
        assignedTo: '00000000-0000-4000-8000-000000000001',
      },
    },
  });
  expect(plan.status()).toBe(404);
});
