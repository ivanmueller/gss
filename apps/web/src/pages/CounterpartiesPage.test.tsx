import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMODITIES, MARKETS } from '@grain/domain';
import type { CounterpartySummary } from '../lib/api';
import { mockApi, ORG, SESSION } from '../test/api';
import { CounterpartiesPage, inTier, servesMarket, tradesCommodity } from './CounterpartiesPage';

function summary(overrides: Partial<CounterpartySummary>): CounterpartySummary {
  return {
    id: '00000000-0000-4000-8000-00000000c001',
    organizationId: ORG.id,
    legalName: 'Synthetic Prairie Mills',
    tradingName: 'Prairie Mills',
    types: ['buyer'],
    primaryCountry: 'CA',
    verificationStatus: 'verified',
    source: 'file_import',
    createdAt: '2026-10-27T00:00:00.000Z',
    contactCount: 2,
    facilityCount: 3,
    regions: ['MB', 'SK'],
    logoSha256: null,
    archivedAt: null,
    buys: [],
    sells: [],
    markets: [],
    tier: null,
    ...overrides,
  };
}

const LIST = `GET /counterparties?organization_id=${ORG.id}`;
const items = [
  summary({}),
  summary({
    id: '00000000-0000-4000-8000-00000000c002',
    legalName: 'Synthetic Buyer LLC',
    tradingName: null,
    types: ['buyer', 'broker'],
    primaryCountry: 'US',
    verificationStatus: 'unverified',
    regions: ['ND'],
    logoSha256: 'a'.repeat(64),
  }),
];

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:synthetic-logo' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('CounterpartiesPage', () => {
  it("lists the organization's counterparties with the user's token", async () => {
    window.history.replaceState(null, '', '/counterparties?view=table');
    const calls = mockApi({
      [LIST]: () => Response.json({ counterparties: items, truncated: false }),
      [`GET /counterparties/${items[1]?.id ?? ''}/logo?v=${'a'.repeat(64)}`]: () =>
        new Response(new Uint8Array([1, 2, 3])),
    });
    render(<CounterpartiesPage session={SESSION} />);

    const table = await screen.findByRole('table', { name: 'Counterparties' });
    const rows = within(table).getAllByRole('row');
    const row = (index: number) => {
      const found = rows[index];
      if (!found) throw new Error(`no row ${String(index)}`);
      return found;
    };
    expect(rows).toHaveLength(3);
    expect(within(row(1)).getByRole('link', { name: 'Synthetic Prairie Mills' })).toHaveAttribute(
      'href',
      `/counterparties/${items[0]?.id ?? ''}`,
    );
    expect(rows[1]).toHaveTextContent('MB, SK · Canada');
    expect(rows[1]).toHaveTextContent('Verified');
    expect(rows[2]).toHaveTextContent('Buyer, Broker');
    expect(rows[2]).toHaveTextContent('Unverified');
    expect(
      await within(row(2)).findByRole('img', { name: 'Synthetic Buyer LLC logo' }),
    ).toHaveAttribute('src', 'blob:synthetic-logo');
    // No "Your organization's records" note (owner's request, 2026-10-28).
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer synthetic-token');
  });

  it('searches by name and province or state', async () => {
    window.history.replaceState(null, '', '/counterparties?view=table');
    mockApi({ [LIST]: () => Response.json({ counterparties: items, truncated: false }) });
    render(<CounterpartiesPage session={SESSION} />);

    const search = await screen.findByRole('searchbox', { name: 'Search counterparties' });
    await userEvent.type(search, 'nd');
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Synthetic Prairie Mills' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Synthetic Buyer LLC' }).length).toBeGreaterThan(0);
  });

  it('opens on the logos, with the views in the order Logos, Table, Map', async () => {
    mockApi({ [LIST]: () => Response.json({ counterparties: items, truncated: false }) });
    render(<CounterpartiesPage session={SESSION} />);

    const views = await screen.findByRole('tablist', { name: 'Counterparty view' });
    const tabs = within(views).getAllByRole('tab');
    // Icons, named for screen readers and on hover (owner's request, 2026-10-30).
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['Logos', 'Table', 'Map']);
    expect(tabs.map((tab) => tab.getAttribute('title'))).toEqual(['Logos', 'Table', 'Map']);
    expect(tabs.map((tab) => tab.textContent)).toEqual(['', '', '']);
    // The commodity, market and tier come before All / Buyers / Sellers / Carriers.
    const commodity = screen.getByRole('button', { name: 'Commodities: All' });
    expect(screen.getByRole('button', { name: 'Market: All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tier: All' })).toBeInTheDocument();
    const show = screen.getByRole('group', { name: 'Show' });
    expect(commodity.compareDocumentPosition(show) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Logos', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Counterparties' })).not.toBeInTheDocument();
    const grid = screen.getByRole('list', { name: 'Counterparties by logo' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2);
    expect(within(grid).getByText('ND · United States')).toBeInTheDocument();
  });

  it('offers adding and importing to editors only', async () => {
    mockApi({ [LIST]: () => Response.json({ counterparties: [], truncated: false }) });
    const { unmount } = render(<CounterpartiesPage session={SESSION} />);
    expect(
      await screen.findByText('Add one by hand or import your spreadsheet.'),
    ).toBeInTheDocument();
    // One + button opens a window with the two ways to add (owner's request, 2026-10-30).
    expect(screen.queryByRole('link', { name: /Import spreadsheet/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparties' }));
    const dialog = screen.getByRole('dialog', { name: 'Add counterparties' });
    expect(dialog).toHaveAccessibleDescription(
      'Add one company yourself, or many at once from a spreadsheet.',
    );
    // First the choice; then the chosen window replaces it (owner's request, 2026-10-30).
    const ways = within(dialog).getByRole('navigation', { name: 'Ways to add' });
    await userEvent.click(within(ways).getByRole('button', { name: /^Add by hand/ }));
    const form = screen.getByRole('dialog', { name: 'Add a counterparty' });
    expect(form).toHaveClass('animate-dialog-in');
    expect(within(form).getByRole('form', { name: 'Add one counterparty' })).toBeInTheDocument();
    // Back to the choice, then the spreadsheet.
    await userEvent.click(within(form).getByRole('button', { name: 'Ways to add' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Add counterparties' })).getByRole('button', {
        name: /^Import spreadsheet/,
      }),
    );
    const importer = screen.getByRole('dialog', { name: 'Import counterparties' });
    expect(within(importer).getByLabelText('Choose CSV file')).toBeInTheDocument();
    await userEvent.click(within(importer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add counterparties' })).toHaveFocus();
    // Opened again, it starts on the choice.
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparties' }));
    expect(screen.getByRole('dialog', { name: 'Add counterparties' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    unmount();

    render(
      <CounterpartiesPage session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }} />,
    );
    expect(
      await screen.findByText('An operations or admin member can add them.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add counterparties' })).not.toBeInTheDocument();
  });

  it('opens the window on a tab from the address, as the old pages’ addresses do', async () => {
    mockApi({ [LIST]: () => Response.json({ counterparties: [], truncated: false }) });
    window.history.replaceState(null, '', '/counterparties?add=import');
    render(<CounterpartiesPage session={SESSION} />);
    const dialog = await screen.findByRole('dialog', { name: 'Import counterparties' });
    expect(within(dialog).getByLabelText('Choose CSV file')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('says when the list cannot be loaded', async () => {
    mockApi({
      [LIST]: () =>
        Response.json(
          { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' } },
          { status: 503 },
        ),
    });
    render(<CounterpartiesPage session={SESSION} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is unavailable.');
  });

  it('shows only buyers, sellers or carriers, and keeps the choice in the address', async () => {
    const seller = summary({
      id: '00000000-0000-4000-8000-00000000c003',
      legalName: 'Synthetic Grower',
      types: ['seller'],
    });
    const carrier = summary({
      id: '00000000-0000-4000-8000-00000000d001',
      legalName: 'Synthetic Hauling',
      types: ['carrier'],
    });
    mockApi({
      [LIST]: () =>
        Response.json({ counterparties: [...items, seller, carrier], truncated: false }),
    });
    window.history.replaceState(null, '', '/counterparties?view=table');
    render(<CounterpartiesPage session={SESSION} />);

    const show = await screen.findByRole('group', { name: 'Show' });
    await userEvent.click(within(show).getByRole('button', { name: 'Sellers' }));
    expect(window.location.search).toBe('?view=table&type=seller');
    expect(screen.getByText('1 of 4 shown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Synthetic Grower' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Synthetic Prairie Mills' })).not.toBeInTheDocument();

    await userEvent.click(within(show).getByRole('button', { name: 'Buyers' }));
    expect(screen.getByText('2 of 4 shown')).toBeInTheDocument();
    await userEvent.click(within(show).getByRole('button', { name: 'Carriers' }));
    expect(window.location.search).toBe('?view=table&type=carrier');
    expect(screen.getByText('1 of 4 shown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Synthetic Hauling' })).toBeInTheDocument();
    await userEvent.click(within(show).getByRole('button', { name: 'All' }));
    expect(window.location.search).toBe('?view=table');
    expect(screen.getByText('4 of 4 shown')).toBeInTheDocument();
  });

  it('finds who buys or sells a commodity, as buyers or sellers, and keeps it in the address', async () => {
    const peaBuyer = summary({ legalName: 'Synthetic Pea Buyer', buys: ['canola', 'yellow_peas'] });
    const peaGrower = summary({
      id: '00000000-0000-4000-8000-00000000c003',
      legalName: 'Synthetic Pea Grower',
      types: ['seller'],
      sells: ['yellow_peas'],
      markets: [],
      tier: null,
    });
    const oatBroker = summary({
      id: '00000000-0000-4000-8000-00000000c004',
      legalName: 'Synthetic Oat Broker',
      types: ['broker'],
      buys: ['oats'],
      sells: ['canola'],
      markets: [],
      tier: null,
    });
    mockApi({
      [LIST]: () =>
        Response.json({ counterparties: [peaBuyer, peaGrower, oatBroker], truncated: false }),
    });
    window.history.replaceState(null, '', '/counterparties?view=table');
    render(<CounterpartiesPage session={SESSION} />);

    // Like the workspace's picker: from All, one is chosen by choosing none, then it.
    await pick('Commodities: All', 'All commodities', 'Yellow peas');
    expect(window.location.search).toBe('?view=table&commodity=yellow_peas');
    expect(screen.getByText('2 of 3 shown')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Synthetic Oat Broker' })).toBeNull();

    // Among buyers, only those who buy it.
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Buyers' }),
    );
    expect(screen.getByText('1 of 3 shown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Synthetic Pea Buyer' })).toBeInTheDocument();

    // Several at once: yellow peas or oats, among all.
    await pick('Commodities: Yellow peas', 'Oats');
    expect(decodeURIComponent(window.location.search)).toBe(
      '?view=table&commodity=yellow_peas,oats&type=buyer',
    );
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'All' }),
    );
    expect(screen.getByText('3 of 3 shown')).toBeInTheDocument();
    await pick(/^Commodities:/, 'All commodities');
    expect(window.location.search).toBe('?view=table');
  });

  it('narrows by market and tier, several at once, kept in the address', async () => {
    const petA = summary({ legalName: 'Synthetic Pet Feeds', markets: ['pet', 'bird'], tier: 'A' });
    const equineB = summary({
      id: '00000000-0000-4000-8000-00000000c005',
      legalName: 'Synthetic Stables',
      markets: ['equine'],
      tier: 'B',
    });
    const none = summary({
      id: '00000000-0000-4000-8000-00000000c006',
      legalName: 'Synthetic Other',
    });
    mockApi({
      [LIST]: () => Response.json({ counterparties: [petA, equineB, none], truncated: false }),
    });
    window.history.replaceState(null, '', '/counterparties?view=table&market=bird,equine&tier=A');
    render(<CounterpartiesPage session={SESSION} />);
    expect(await screen.findByText('1 of 3 shown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Synthetic Pet Feeds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Market: Bird, Equine' })).toBeInTheDocument();
    await pick('Tier: Tier A', 'Tier B');
    expect(decodeURIComponent(window.location.search)).toBe(
      '?view=table&market=bird,equine&tier=A,B',
    );
    expect(screen.getByText('2 of 3 shown')).toBeInTheDocument();
    await pick(/^Market:/, 'All markets');
    await pick(/^Tier:/, 'All tiers');
    expect(window.location.search).toBe('?view=table');
    expect(screen.getByText('3 of 3 shown')).toBeInTheDocument();
  });

  it('decides who trades the chosen commodities by the buyers or sellers chosen', () => {
    const both = { buys: ['canola'], sells: ['oats'] };
    const every = COMMODITIES.map((item) => item.code);
    expect(tradesCommodity(both, every, 'all')).toBe(true);
    expect(tradesCommodity({ buys: [], sells: [] }, every, 'all')).toBe(true);
    expect(tradesCommodity(both, ['canola'], 'all')).toBe(true);
    expect(tradesCommodity(both, ['oats'], 'all')).toBe(true);
    expect(tradesCommodity(both, ['oats'], 'buyer')).toBe(false);
    expect(tradesCommodity(both, ['rye', 'oats'], 'seller')).toBe(true);
    expect(tradesCommodity(both, ['rye'], 'all')).toBe(false);
    expect(tradesCommodity(both, [], 'all')).toBe(false);
  });

  it('decides markets and tiers: all of them shows everyone, those unset too', () => {
    expect(servesMarket({ markets: [] }, [...MARKETS])).toBe(true);
    expect(servesMarket({ markets: [] }, ['pet'])).toBe(false);
    expect(servesMarket({ markets: ['bird', 'aqua'] }, ['aqua'])).toBe(true);
    expect(inTier({ tier: null }, ['A', 'B', 'C'])).toBe(true);
    expect(inTier({ tier: null }, ['A'])).toBe(false);
    expect(inTier({ tier: 'C' }, ['B', 'C'])).toBe(true);
  });

  it('leaves archived counterparties out unless asked', async () => {
    window.history.replaceState(null, '', '/counterparties?view=table');
    const archived = summary({
      id: '00000000-0000-4000-8000-00000000c004',
      legalName: 'Synthetic Closed Mill',
      archivedAt: '2026-10-28T10:00:00.000Z',
    });
    mockApi({
      [LIST]: () => Response.json({ counterparties: [...items, archived], truncated: false }),
    });
    render(<CounterpartiesPage session={SESSION} />);

    expect(await screen.findByText('2 of 3 shown')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Synthetic Closed Mill' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived (1)' }));
    const row = screen.getByRole('link', { name: 'Synthetic Closed Mill' }).closest('tr');
    expect(row).toHaveTextContent('Archived');
  });

  it('opens the map view from the address, and keeps the filters when changing view', async () => {
    mockApi({ [LIST]: () => Response.json({ counterparties: items, truncated: false }) });
    window.history.replaceState(null, '', '/counterparties?view=map&type=buyer');
    render(<CounterpartiesPage session={SESSION} />);

    expect(await screen.findByRole('tab', { name: 'Map', selected: true })).toBeInTheDocument();
    // Tests build without a Mapbox token: the view says so, with no count and no list.
    expect(screen.getByText(/The map is not set up yet/)).toBeInTheDocument();
    expect(screen.queryByText(/no coordinates yet/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(window.location.search).toBe('?view=table&type=buyer');
    expect(screen.getByRole('table', { name: 'Counterparties' })).toBeInTheDocument();
    // Logos is the default, so choosing it leaves the view out of the address.
    await userEvent.click(screen.getByRole('tab', { name: 'Logos' }));
    expect(window.location.search).toBe('?type=buyer');
  });
});

/**
 * Opens a picker, ticks its items, and closes it with Escape: as in the workspace, the menu
 * stays open while several are chosen.
 */
async function pick(button: string | RegExp, ...ticked: string[]) {
  await userEvent.click(await screen.findByRole('button', { name: button }));
  for (const item of ticked) {
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: item }));
  }
  await userEvent.keyboard('{Escape}');
}
