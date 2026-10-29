import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartyDetail, CounterpartySummary } from '../lib/api';
import { choose } from '../test/select';
import { mockApi, ORG, SESSION } from '../test/api';
import { BID } from '../test/quotes';
import { NewQuotePage } from './NewQuotePage';

const BUYER: CounterpartySummary = {
  id: '00000000-0000-4000-8000-00000000c001',
  organizationId: ORG.id,
  legalName: 'Synthetic Buyer',
  tradingName: null,
  types: ['buyer'],
  primaryCountry: 'US',
  verificationStatus: 'verified',
  source: 'manual',
  createdAt: '2026-10-27T14:05:00.000Z',
  contactCount: 0,
  facilityCount: 1,
  regions: ['MN'],
  logoSha256: null,
  archivedAt: null,
};
const SELLER = {
  ...BUYER,
  id: '00000000-0000-4000-8000-00000000c002',
  legalName: 'Synthetic Seller',
  types: ['seller'],
};
const ARCHIVED = {
  ...BUYER,
  id: '00000000-0000-4000-8000-00000000c003',
  legalName: 'Synthetic Gone',
  archivedAt: '2026-10-27T00:00:00.000Z',
};
const DETAIL: CounterpartyDetail = {
  ...BUYER,
  notes: null,
  version: '2026-10-27T14:05:00.000000Z',
  contacts: [],
  facilities: [
    {
      id: '00000000-0000-4000-8000-000000000f01',
      name: 'Synthetic Mill',
      facilityType: 'processor',
      addressLine: null,
      city: 'Synthetic Town',
      region: 'MN',
      postalCode: null,
      country: 'US',
      latitude: null,
      longitude: null,
      locationPrecision: null,
      geocodingSource: null,
      version: '2026-10-27T14:05:00.000000Z',
    },
  ],
};

function api() {
  return mockApi({
    [`GET /counterparties?organization_id=${ORG.id}`]: () =>
      Response.json({ counterparties: [BUYER, SELLER, ARCHIVED], truncated: false }),
    [`GET /counterparties/${BUYER.id}`]: () => Response.json(DETAIL),
    'GET /commodities': () =>
      Response.json({ commodities: [{ code: 'flaxseed', name: 'Flaxseed' }] }),
    'POST /quotes': () => Response.json(BID, { status: 201 }),
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/quotes/new');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewQuotePage', () => {
  it('enters a bid from a buyer at one of its locations and opens it', async () => {
    const calls = api();
    render(<NewQuotePage session={SESSION} />);
    expect(screen.getByRole('heading', { name: 'New bid' })).toBeInTheDocument();
    const counterparty = screen.getByLabelText(/^Counterparty/);
    // Wait for the list, then look: only buyers that are not archived can bid.
    await waitFor(() => {
      expect(counterparty).toHaveTextContent('Choose…');
    });
    await userEvent.click(counterparty);
    expect(await screen.findByRole('option', { name: 'Synthetic Buyer' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Synthetic Seller' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Synthetic Gone' })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'Synthetic Buyer' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^Location/)).toBeEnabled();
    });
    await choose(screen.getByLabelText(/^Location/), 'Synthetic Mill, Synthetic Town, MN');
    await choose(screen.getByLabelText(/^Commodity/), 'Flaxseed');
    await userEvent.type(screen.getByLabelText(/^Price/), '725.00');
    await choose(screen.getByLabelText(/^Currency/), 'USD');
    await userEvent.type(screen.getByLabelText(/^Available quantity/), '84');
    await choose(screen.getByLabelText(/^Delivery basis/), 'Delivered');
    await userEvent.type(screen.getByLabelText(/^Valid until/), '2099-10-30T16:00');
    await choose(screen.getByLabelText(/^Source \(required\)/), 'Phone call');
    await userEvent.click(screen.getByRole('button', { name: 'Save bid' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/quotes/${BID.id}`);
    });
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({
      organizationId: ORG.id,
      counterpartyId: BUYER.id,
      facilityId: DETAIL.facilities[0]?.id,
      side: 'bid',
      commodity: 'flaxseed',
      values: {
        firmness: 'indicative',
        price: '725.00',
        currency: 'USD',
        priceUnit: 'MT',
        quantityMax: '84',
        deliveryBasis: 'delivered',
        validUntil: new Date('2099-10-30T16:00').toISOString(),
        sourceType: 'phone',
      },
    });
  });

  it('starts from the counterparty and side in the address, and lists sellers for an offer', async () => {
    window.history.replaceState(null, '', `/quotes/new?counterparty=${SELLER.id}&side=offer`);
    api();
    render(<NewQuotePage session={SESSION} />);
    expect(screen.getByRole('heading', { name: 'New offer' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(/^Counterparty/)).toHaveTextContent('Synthetic Seller');
    });
    await userEvent.click(screen.getByLabelText(/^Counterparty/));
    expect(await screen.findByRole('option', { name: 'Synthetic Seller' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Synthetic Buyer' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('link', { name: 'Synthetic Seller' })).toHaveAttribute(
      'href',
      `/counterparties/${SELLER.id}`,
    );
  });

  it('asks for the counterparty, the commodity and the required terms before sending', async () => {
    const calls = api();
    render(<NewQuotePage session={SESSION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save bid' }));
    expect(
      await screen.findByText('Choose the counterparty the bid comes from.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Price is required.')).toBeInTheDocument();
    expect(screen.getByText('Valid until is required.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('is for traders and admins only', () => {
    api();
    render(<NewQuotePage session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only traders and admins of Synthetic Org A enter bids and offers.',
    );
  });
});
