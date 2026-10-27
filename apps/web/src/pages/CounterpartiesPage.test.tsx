import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartySummary } from '../lib/api';
import { mockApi, ORG, SESSION } from '../test/api';
import { CounterpartiesPage } from './CounterpartiesPage';

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
});

describe('CounterpartiesPage', () => {
  it("lists the organization's counterparties with the user's token", async () => {
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
    expect(screen.getByRole('note')).toHaveTextContent(
      'Only members of Synthetic Org A can see them',
    );
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer synthetic-token');
  });

  it('searches by name and province or state', async () => {
    mockApi({ [LIST]: () => Response.json({ counterparties: items, truncated: false }) });
    render(<CounterpartiesPage session={SESSION} />);

    const search = await screen.findByRole('searchbox', { name: 'Search counterparties' });
    await userEvent.type(search, 'nd');
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Synthetic Prairie Mills' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Synthetic Buyer LLC' }).length).toBeGreaterThan(0);
  });

  it('shows the counterparties by logo', async () => {
    mockApi({ [LIST]: () => Response.json({ counterparties: items, truncated: false }) });
    render(<CounterpartiesPage session={SESSION} />);

    await userEvent.click(await screen.findByRole('tab', { name: 'Logos' }));
    const grid = screen.getByRole('list', { name: 'Counterparties by logo' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2);
    expect(within(grid).getByText('ND · United States')).toBeInTheDocument();
  });

  it('offers the import to editors only', async () => {
    mockApi({ [LIST]: () => Response.json({ counterparties: [], truncated: false }) });
    const { unmount } = render(<CounterpartiesPage session={SESSION} />);
    expect(await screen.findByText('Import your spreadsheet to add them.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import spreadsheet' })).toHaveAttribute(
      'href',
      '/counterparties/import',
    );
    unmount();

    render(
      <CounterpartiesPage session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }} />,
    );
    expect(
      await screen.findByText(
        'An operations or admin member of your organization can import them.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Import spreadsheet' })).not.toBeInTheDocument();
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
});
