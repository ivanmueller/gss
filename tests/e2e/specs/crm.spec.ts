import { expect, test, type Page } from '@playwright/test';

import { OTHER_ORG } from './supabase';

// The CRM for counterparties: a contact logged with a follow-up, a correction kept as a new
// version, the menu's count, the Follow-ups page, and another organization's records out of
// reach. Synthetic, fictional companies and people only. Contacts logged and follow-ups are
// never deleted, so a second local run needs a fresh database (supabase.ts says so).

/** The signed-in user's access token, from the Supabase session in local storage. */
async function accessToken(page: Page): Promise<string> {
  await page.goto('/');
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

/** A Central wall-clock time a day before now, as a datetime-local input takes it. */
function yesterdayInCentral(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Winnipeg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - 86_400_000));
  return `${parts}T09:00`;
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
  await history.getByLabel(/Due/).fill(yesterdayInCentral());
  await history.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByText('Contact logged and follow-up planned.')).toBeVisible();

  const logged = page.getByRole('region', { name: 'Contact history (1)' });
  await expect(logged).toContainText('Call with Synthetic Merchant');
  await expect(logged).toContainText('Logged by Synthetic Trader');
  const followUps = page.getByRole('region', { name: 'Follow-ups (1 open)' });
  await expect(followUps).toContainText('OverdueSend the synthetic bid sheet');
  await expect(followUps).toContainText('9:00 am CT · Synthetic Trader');
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
