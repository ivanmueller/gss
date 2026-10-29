import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { CARRIER_ID, FREIGHT } from '../test/freight';
import { FreightPage } from './FreightPage';

const COUNTERPARTIES = {
  counterparties: [
    {
      id: CARRIER_ID,
      organizationId: ORG.id,
      legalName: 'Synthetic Carrier',
      tradingName: null,
      types: ['carrier'],
      primaryCountry: 'CA',
      verificationStatus: 'verified',
      source: 'manual',
      createdAt: '2026-10-29T14:05:00.000Z',
      contactCount: 0,
      facilityCount: 0,
      regions: [],
      logoSha256: null,
      archivedAt: null,
    },
  ],
  truncated: false,
};

beforeEach(() => {
  window.history.replaceState(null, '', '/freight');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FreightPage', () => {
  it('lists live freight rates with their route, carrier, mode and rate as quoted', async () => {
    mockApi({
      [`GET /freight-quotes?organization_id=${ORG.id}`]: () =>
        Response.json({ freight: [FREIGHT], truncated: false }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () => Response.json(COUNTERPARTIES),
    });
    render(<FreightPage session={SESSION} />);
    expect(await screen.findByText('1 live freight rates')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Freight rates' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent(
      'Synthetic SellerSynthetic Elevator, Synthetic City, SKSynthetic BuyerSynthetic Mill, Synthetic Town, MN',
    );
    expect(row).toHaveTextContent('Synthetic CarrierRailCAD 105.00/MT');
    expect(row).toHaveTextContent('Indicative');
    expect(
      within(table).getByRole('link', {
        name: 'Synthetic Seller, Synthetic Elevator, Synthetic City, SK to Synthetic Buyer, Synthetic Mill, Synthetic Town, MN',
      }),
    ).toHaveAttribute('href', `/freight/${FREIGHT.id}`);
    expect(screen.getByRole('link', { name: 'New freight rate' })).toHaveAttribute(
      'href',
      '/freight/new',
    );
  });

  it('filters by mode and asks for withdrawn and expired rates only when wanted', async () => {
    const calls = mockApi({
      [`GET /freight-quotes?organization_id=${ORG.id}`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /freight-quotes?organization_id=${ORG.id}&mode=truck`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /freight-quotes?organization_id=${ORG.id}&mode=truck&status=all`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () => Response.json(COUNTERPARTIES),
    });
    render(<FreightPage session={SESSION} />);
    expect(await screen.findByText('No live freight rates here.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Truck' }));
    await userEvent.click(screen.getByLabelText('Include withdrawn and expired'));
    await waitFor(() => {
      expect(calls.map((call) => call.path)).toContain(
        `/freight-quotes?organization_id=${ORG.id}&mode=truck&status=all`,
      );
    });
    expect(window.location.search).toBe('?mode=truck&status=all');
  });

  it('points to Counterparties when there are no carriers yet, and offers viewers no new rate', async () => {
    mockApi({
      [`GET /freight-quotes?organization_id=${ORG.id}`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () =>
        Response.json({ counterparties: [], truncated: false }),
    });
    const { unmount } = render(<FreightPage session={SESSION} />);
    expect(
      await screen.findByText(/First add your carriers under Counterparties/),
    ).toBeInTheDocument();
    unmount();
    render(<FreightPage session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }} />);
    expect(
      await screen.findByText('Traders, operations and admins enter them.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New freight rate' })).toBeNull();
  });
});
