import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartySummary } from '../lib/api';
import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
import { CounterpartiesPage, tradesCommodity } from './CounterpartiesPage';

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
      [`GET /counterparties/${items[1]?.id ?? ''}/logo`]: () =>
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
    expect(
      within(views)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Logos', 'Table', 'Map']);
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
    expect(within(dialog).getByRole('link', { name: /^Add by hand/ })).toHaveAttribute(
      'href',
      '/counterparties/new',
    );
    expect(within(dialog).getByRole('link', { name: /^Import spreadsheet/ })).toHaveAttribute(
      'href',
      '/counterparties/import',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add counterparties' })).toHaveFocus();
    unmount();

    render(
      <CounterpartiesPage session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }} />,
    );
    expect(
      await screen.findByText('An operations or admin member can add them.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add counterparties' })).not.toBeInTheDocument();
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
    });
    const oatBroker = summary({
      id: '00000000-0000-4000-8000-00000000c004',
      legalName: 'Synthetic Oat Broker',
      types: ['broker'],
      buys: ['oats'],
      sells: ['canola'],
    });
    mockApi({
      [LIST]: () =>
        Response.json({ counterparties: [peaBuyer, peaGrower, oatBroker], truncated: false }),
    });
    window.history.replaceState(null, '', '/counterparties?view=table');
    render(<CounterpartiesPage session={SESSION} />);

    await choose(await screen.findByRole('combobox', { name: 'Commodity' }), 'Yellow peas');
    expect(window.location.search).toBe('?view=table&commodity=yellow_peas');
    expect(screen.getByText('2 of 3 shown')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Synthetic Oat Broker' })).toBeNull();

    // Among buyers, only those who buy it.
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Buyers' }),
    );
    expect(screen.getByText('1 of 3 shown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Synthetic Pea Buyer' })).toBeInTheDocument();

    // Canola: the buyer buys it; the broker sells it, so among buyers only the buyer.
    await choose(screen.getByRole('combobox', { name: 'Commodity' }), 'Canola');
    expect(screen.getByText('1 of 3 shown')).toBeInTheDocument();
    await choose(screen.getByRole('combobox', { name: 'Commodity' }), 'All commodities');
    expect(window.location.search).toBe('?view=table&type=buyer');
  });

  it('decides who trades a commodity by the buyers or sellers chosen', () => {
    const both = { buys: ['canola'], sells: ['oats'] };
    expect(tradesCommodity(both, null, 'all')).toBe(true);
    expect(tradesCommodity(both, 'canola', 'all')).toBe(true);
    expect(tradesCommodity(both, 'oats', 'all')).toBe(true);
    expect(tradesCommodity(both, 'oats', 'buyer')).toBe(false);
    expect(tradesCommodity(both, 'oats', 'seller')).toBe(true);
    expect(tradesCommodity(both, 'rye', 'all')).toBe(false);
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

  it('shows the locations on the map view, which the address can open directly', async () => {
    const world = `GET /facilities?organization_id=${ORG.id}&bbox=-180.000000,-90.000000,180.000000,90.000000`;
    const calls = mockApi({
      [LIST]: () => Response.json({ counterparties: items, truncated: false }),
      [`${world}&type=buyer`]: () =>
        Response.json({ facilities: [], truncated: false, withoutCoordinates: 2 }),
    });
    window.history.replaceState(null, '', '/counterparties?view=map&type=buyer');
    render(<CounterpartiesPage session={SESSION} />);

    expect(await screen.findByRole('tab', { name: 'Map', selected: true })).toBeInTheDocument();
    // Tests build without a Mapbox token, so the view lists the locations instead.
    expect(await screen.findByText(/2 locations have no coordinates yet/)).toBeInTheDocument();
    expect(calls.some((call) => call.path.endsWith('&type=buyer'))).toBe(true);

    await userEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(window.location.search).toBe('?view=table&type=buyer');
    expect(screen.getByRole('table', { name: 'Counterparties' })).toBeInTheDocument();
    // Logos is the default, so choosing it leaves the view out of the address.
    await userEvent.click(screen.getByRole('tab', { name: 'Logos' }));
    expect(window.location.search).toBe('?type=buyer');
  });
});
