import type { ContactLogEntry, FollowUp } from '@grain/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartyDetail } from '../lib/api';
import { mockApi as mockBaseApi, ORG, SESSION } from '../test/api';
import { CounterpartyPage, tradingLayout } from './CounterpartyPage';

// A buyer's or seller's page (owner's approved layout, 2026-10-30). Synthetic values only;
// the clock is fixed at 10 am in Alberta (UTC−6), 30 October 2026.
const ID = '00000000-0000-4000-8000-00000000c001';
const PATH = `/counterparties/${ID}`;
const ME = '00000000-0000-4000-8000-0000000044aa';
const K1 = '00000000-0000-4000-8000-00000000a001';
const K2 = '00000000-0000-4000-8000-00000000a002';

const DETAIL: CounterpartyDetail = {
  id: ID,
  commodities: [],
  organizationId: ORG.id,
  legalName: 'Synthetic Prairie Mills',
  tradingName: null,
  types: ['buyer'],
  primaryCountry: 'CA',
  verificationStatus: 'verified',
  source: 'manual',
  createdAt: '2026-10-27T14:05:00.000Z',
  contactCount: 2,
  facilityCount: 2,
  regions: ['MB', 'SK'],
  logoSha256: null,
  website: null,
  phone: null,
  notes: null,
  archivedAt: null,
  buys: [],
  sells: [],
  markets: [],
  tier: null,
  version: '2026-10-27T14:05:00.000000Z',
  contacts: [
    {
      id: K1,
      name: 'Synthetic Merchandiser',
      role: 'Grain buyer',
      email: 'merch@example.test',
      phone: '+1 (306) 555-0100',
      isMain: false,
      version: '2026-10-27T14:05:00.000000Z',
    },
    {
      id: K2,
      name: 'Synthetic Accountant',
      role: null,
      email: null,
      phone: '306 555 0199',
      isMain: false,
      version: '2026-10-27T14:05:00.000000Z',
    },
  ],
  facilities: [
    {
      id: 'f1',
      name: 'Synthetic Elevator',
      facilityType: 'elevator',
      addressLine: null,
      city: 'Synthetic Town',
      region: 'SK',
      postalCode: null,
      country: 'CA',
      latitude: '52.133214',
      longitude: '-106.670046',
      locationPrecision: 'exact',
      geocodingSource: 'manual',
      transportAccess: null,
      version: '2026-10-27T14:05:00.000000Z',
    },
    {
      id: 'f2',
      name: 'Synthetic Plant',
      facilityType: null,
      addressLine: null,
      city: 'Synthetic City',
      region: 'MB',
      postalCode: null,
      country: 'CA',
      latitude: null,
      longitude: null,
      locationPrecision: null,
      geocodingSource: null,
      transportAccess: null,
      version: '2026-10-27T14:05:00.000000Z',
    },
  ],
};

const MAIN = { ...DETAIL, contacts: [{ ...DETAIL.contacts[0], isMain: true }, DETAIL.contacts[1]] };

const ENTRY: ContactLogEntry = {
  id: '00000000-0000-4000-8000-00000000e101',
  counterpartyId: ID,
  createdAt: '2026-10-29T15:00:00.000Z',
  current: {
    id: 'r1',
    revisionNumber: 1,
    occurredAt: '2026-10-29T14:30:00.000Z',
    channel: 'call',
    contactName: 'Synthetic Merchandiser',
    notes: null,
    recordedByName: 'Tess Trader',
    recordedAt: '2026-10-29T15:00:00.000Z',
  },
  revisions: [],
};
const OLDER: ContactLogEntry = {
  ...ENTRY,
  id: '00000000-0000-4000-8000-00000000e102',
  current: { ...ENTRY.current, occurredAt: '2026-10-20T14:30:00.000Z', channel: 'email' },
};

const FOLLOW_UP: FollowUp = {
  id: '00000000-0000-4000-8000-00000000f101',
  counterparty: { id: ID, legalName: DETAIL.legalName, tradingName: null, archived: false },
  contactLogEntryId: null,
  task: 'Send the bid sheet',
  // 9 am MT on 30 October: an hour ago.
  dueAt: '2026-10-30T15:00:00.000Z',
  assignedTo: { userId: ME, name: 'Tess Trader' },
  createdByName: 'Tess Trader',
  createdAt: '2026-10-29T15:00:00.000Z',
  doneAt: null,
  doneByName: null,
  version: '2026-10-29T15:00:00.000000Z',
};
const LATER: FollowUp = {
  ...FOLLOW_UP,
  id: '00000000-0000-4000-8000-00000000f102',
  task: 'Ask about December',
  dueAt: '2026-11-03T15:00:00.000Z',
};

function mockApi(handlers: Parameters<typeof mockBaseApi>[0] = {}) {
  return mockBaseApi({
    [`GET ${PATH}`]: () => Response.json(DETAIL),
    [`GET /quotes?counterparty_id=${ID}`]: () => Response.json({ quotes: [], truncated: false }),
    [`GET /freight-quotes?counterparty_id=${ID}`]: () =>
      Response.json({ freight: [], truncated: false }),
    [`GET /contact-log?counterparty_id=${ID}`]: () =>
      Response.json({ entries: [], truncated: false }),
    [`GET /follow-ups?counterparty_id=${ID}&status=all`]: () =>
      Response.json({ followUps: [], truncated: false }),
    [`GET /follow-ups/team?organization_id=${ORG.id}`]: () =>
      Response.json({ members: [{ userId: ME, name: 'Tess Trader' }] }),
    ...handlers,
  });
}

function show(role: string, id = ID) {
  render(
    <CounterpartyPage
      session={{ ...SESSION, organization: { ...ORG, role }, userId: ME }}
      id={id}
    />,
  );
}

/** The top card: the counterparty's name, tags, main contact and actions. */
function headerCard(): HTMLElement {
  const card = screen
    .getByRole('heading', { name: 'Synthetic Prairie Mills' })
    .closest('[data-slot="card"]');
  if (!(card instanceof HTMLElement)) throw new Error('no header card');
  return card;
}

/** The page's section headings, top to bottom. */
function headings(): string[] {
  return screen
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent.replace(/(Show|Hide)$/, '').replace(/ \(.*\)$/, ''));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T16:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('tradingLayout', () => {
  it('is for buyers, sellers and brokers; a carrier keeps the plain page', () => {
    expect(tradingLayout(['buyer'])).toBe(true);
    expect(tradingLayout(['seller', 'carrier'])).toBe(true);
    expect(tradingLayout(['broker'])).toBe(true);
    expect(tradingLayout(['carrier'])).toBe(false);
  });
});

describe('a buyer’s or seller’s page', () => {
  it('shows who they are and their main contact, whose phone and email are links', async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json(MAIN) });
    show('trader');
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    const header = headerCard();
    expect(within(header).getByText('Buyer')).toBeInTheDocument();
    expect(within(header).getByText('Verified')).toBeInTheDocument();
    expect(within(header).getByText('MB, SK · Canada')).toBeInTheDocument();
    const main = screen.getByRole('group', { name: 'Main contact' });
    expect(main).toHaveTextContent('Synthetic Merchandiser · Grain buyer');
    expect(within(main).getByRole('link', { name: '+1 (306) 555-0100' })).toHaveAttribute(
      'href',
      'tel:+13065550100',
    );
    expect(within(main).getByRole('link', { name: 'merch@example.test' })).toHaveAttribute(
      'href',
      'mailto:merch@example.test',
    );
    // The main contact is marked in the list too, and listed first by the API.
    const contacts = screen.getByRole('region', { name: 'Contacts (2)' });
    expect(within(contacts).getAllByRole('listitem')[0]).toHaveTextContent('Main contact');
  });

  it('puts Log contact first, then New bid and Plan follow-up, for a trader', async () => {
    mockApi();
    show('trader');
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    const header = headerCard();
    // Plan follow-up once the team who can be responsible has loaded.
    await within(header).findByRole('button', { name: 'Plan follow-up' });
    const actions = within(header)
      .getAllByRole('button')
      .concat(within(header).getAllByRole('link'))
      .map((element) => element.textContent);
    expect(actions).toEqual(['Log contact', 'Plan follow-up', 'New bid']);
    // A buyer bids; it does not offer.
    expect(within(header).getByRole('link', { name: 'New bid' })).toHaveAttribute(
      'href',
      `/quotes/new?counterparty=${ID}&side=bid`,
    );
    expect(within(header).queryByRole('link', { name: 'New offer' })).toBeNull();
    // Edit details and Archive are for operations and admins only.
    expect(within(header).queryByRole('button', { name: 'More actions' })).toBeNull();

    // Log contact opens the form in the contact history, with the main way of contact: a call.
    await userEvent.click(within(header).getByRole('button', { name: 'Log contact' }));
    const history = screen.getByRole('region', { name: 'Contact history (0)' });
    expect(within(history).getByRole('button', { name: 'Save contact' })).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'Log contact' })).toBeNull();

    await userEvent.click(within(header).getByRole('button', { name: 'Plan follow-up' }));
    const followUps = screen.getByRole('region', { name: 'Follow-ups (0 open)' });
    expect(within(followUps).getByRole('button', { name: 'Save follow-up' })).toBeInTheDocument();
  });

  it('logs a contact from the header and shows it as the last contact', async () => {
    let entries: ContactLogEntry[] = [];
    const calls = mockApi({
      [`GET /contact-log?counterparty_id=${ID}`]: () =>
        Response.json({ entries, truncated: false }),
      'POST /contact-log': () => {
        entries = [ENTRY];
        return Response.json(ENTRY, { status: 201 });
      },
    });
    show('trader');
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    const last = within(headerCard()).getByRole('group', { name: 'Last contact' });
    expect(await within(last).findByText('None logged.')).toBeInTheDocument();

    await userEvent.click(within(headerCard()).getByRole('button', { name: 'Log contact' }));
    const history = screen.getByRole('region', { name: 'Contact history (0)' });
    await userEvent.type(
      within(history).getByLabelText(/Who you spoke to/),
      'Synthetic Merchandiser',
    );
    await userEvent.click(within(history).getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByText('Contact logged.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      counterpartyId: ID,
      values: { channel: 'call', contactName: 'Synthetic Merchandiser' },
    });
    expect(await within(last).findByText('Call with Synthetic Merchandiser')).toBeInTheDocument();
  });

  it('shows the next follow-up and the last contact in the header, no boxes of facts', async () => {
    mockApi({
      [`GET /follow-ups?counterparty_id=${ID}&status=all`]: () =>
        Response.json({
          followUps: [
            LATER,
            FOLLOW_UP,
            { ...FOLLOW_UP, id: 'done', doneAt: '2026-10-29T17:00:00Z' },
          ],
          truncated: false,
        }),
      [`GET /contact-log?counterparty_id=${ID}`]: () =>
        Response.json({ entries: [OLDER, ENTRY], truncated: false }),
    });
    show('viewer');
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    const header = headerCard();
    // The soonest open one, overdue since 9 am MT.
    const next = within(header).getByRole('group', { name: 'Next follow-up' });
    await waitFor(() => {
      expect(next).toHaveTextContent(
        'Next follow-upOverdueFri 30 Oct 2026, 9:00 am MTSend the bid sheet · Tess Trader',
      );
    });
    const last = within(header).getByRole('group', { name: 'Last contact' });
    await waitFor(() => {
      expect(last).toHaveTextContent(
        'Last contactThu 29 Oct 2026, 8:30 am MTCall with Synthetic Merchandiser',
      );
    });
    expect(screen.queryByText('Live bids and offers')).toBeNull();
  });

  it('says when nothing is planned or logged yet', async () => {
    mockApi();
    show('viewer');
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    const header = headerCard();
    expect(await within(header).findByText('None planned.')).toBeInTheDocument();
    expect(await within(header).findByText('None logged.')).toBeInTheDocument();
  });

  it('makes a contact the main contact, and no longer main', async () => {
    let detail = DETAIL;
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(detail),
      [`PUT ${PATH}/main-contact`]: (call) => {
        const { contactId } = call.body as { contactId: string | null };
        detail = {
          ...DETAIL,
          contacts: DETAIL.contacts.map((contact) => ({
            ...contact,
            isMain: contact.id === contactId,
          })),
        };
        return Response.json(detail);
      },
    });
    show('operations');
    await screen.findByText(/None yet: choose one under Contacts/);
    await userEvent.click(
      screen.getByRole('button', { name: 'Make Synthetic Accountant the main contact' }),
    );
    const main = await screen.findByRole('group', { name: 'Main contact' });
    expect(main).toHaveTextContent('Synthetic Accountant');
    expect(within(main).getByRole('link', { name: '306 555 0199' })).toHaveAttribute(
      'href',
      'tel:3065550199',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Synthetic Accountant is no longer the main contact' }),
    );
    expect(await screen.findByText(/None yet: choose one under Contacts/)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      { contactId: K2 },
      { contactId: null },
    ]);
  });

  it('says why a main contact was not saved', async () => {
    mockApi({
      [`PUT ${PATH}/main-contact`]: () =>
        Response.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Only operations and admin members can change counterparties.',
            },
          },
          { status: 403 },
        ),
    });
    show('operations');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Make Synthetic Merchandiser the main contact' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only operations and admin members can change counterparties.',
    );
  });

  it('gives a viewer the facts and contacts but nothing to change', async () => {
    mockApi();
    show('viewer');
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    for (const name of [/^Make /, 'Log contact', 'Plan follow-up', 'More actions']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByText(/choose one under Contacts/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'New bid' })).toBeNull();
  });

  it('lays out two columns on a computer: trading on the left, who and where on the right', async () => {
    mockApi();
    show('trader');
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    expect(headings()).toEqual([
      'Bids and offers',
      'Follow-ups',
      'Contact history',
      'Contacts',
      'What they buy',
      'Locations',
      'Freight to and from its locations',
    ]);
  });

  it('puts follow-ups first and contacts before the history on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    mockApi();
    show('trader');
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    expect(headings()).toEqual([
      'Follow-ups',
      'Bids and offers',
      'Contacts',
      'Contact history',
      'What they buy',
      'Locations',
      'Freight to and from its locations',
    ]);
  });
});

describe('a carrier’s page', () => {
  it('keeps the plain layout, with Edit details and Archive at the top', async () => {
    mockApi({
      [`GET ${PATH}`]: () => Response.json({ ...DETAIL, types: ['carrier'] }),
      [`GET /freight-quotes?carrier_id=${ID}`]: () =>
        Response.json({ freight: [], truncated: false }),
    });
    show('operations');
    expect(await screen.findByRole('button', { name: 'Edit details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    // Its freight rates are open, not folded.
    expect(await screen.findByRole('region', { name: 'Freight rates (0)' })).toBeInTheDocument();
    expect(headings()).toEqual([
      'Contacts',
      'Follow-ups',
      'Contact history',
      'Locations',
      'Bids and offers',
      'Freight rates',
    ]);
  });
});
