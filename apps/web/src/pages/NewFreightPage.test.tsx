import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartyDetail, CounterpartySummary } from '../lib/api';
import { mockApi, ORG, SESSION } from '../test/api';
import { FREIGHT } from '../test/freight';
import { choose } from '../test/select';
import { NewFreightPage } from './NewFreightPage';

const CARRIER: CounterpartySummary = {
  id: '00000000-0000-4000-8000-00000000d001',
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
  buys: [],
  sells: [],
};
const OLD_CARRIER = {
  ...CARRIER,
  id: '00000000-0000-4000-8000-00000000d002',
  legalName: 'Synthetic Old Carrier',
  archivedAt: '2026-10-27T00:00:00.000Z',
};
const SELLER = {
  ...CARRIER,
  id: '00000000-0000-4000-8000-00000000c002',
  legalName: 'Synthetic Seller',
  types: ['seller'],
  facilityCount: 1,
};
const BUYER = {
  ...CARRIER,
  id: '00000000-0000-4000-8000-00000000c001',
  legalName: 'Synthetic Buyer',
  types: ['buyer'],
  facilityCount: 1,
};

function location(
  owner: CounterpartySummary,
  id: string,
  name: string,
  city: string,
  region: string,
) {
  return {
    ...owner,
    commodities: [],
    website: null,
    notes: null,
    version: '2026-10-29T14:05:00.000000Z',
    contacts: [],
    facilities: [
      {
        id,
        name,
        facilityType: null,
        addressLine: '1 Synthetic Road',
        city,
        region,
        postalCode: null,
        country: owner.primaryCountry,
        latitude: null,
        longitude: null,
        locationPrecision: null,
        geocodingSource: null,
        version: '2026-10-29T14:05:00.000000Z',
      },
    ],
  } satisfies CounterpartyDetail;
}

const SELLER_DETAIL = location(
  SELLER,
  '00000000-0000-4000-8000-000000000f02',
  'Synthetic Elevator',
  'Synthetic City',
  'SK',
);
const BUYER_DETAIL = location(
  { ...BUYER, primaryCountry: 'US' },
  '00000000-0000-4000-8000-000000000f01',
  'Synthetic Mill',
  'Synthetic Town',
  'MN',
);

function api() {
  return mockApi({
    [`GET /counterparties?organization_id=${ORG.id}`]: () =>
      Response.json({ counterparties: [CARRIER, OLD_CARRIER, SELLER, BUYER], truncated: false }),
    [`GET /counterparties/${SELLER.id}`]: () => Response.json(SELLER_DETAIL),
    [`GET /counterparties/${BUYER.id}`]: () => Response.json(BUYER_DETAIL),
    'POST /freight-quotes': () => Response.json(FREIGHT, { status: 201 }),
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/freight/new');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewFreightPage', () => {
  it('enters a carrier’s rate per load from one location to another and opens it', async () => {
    const calls = api();
    render(<NewFreightPage session={SESSION} />);
    expect(screen.getByRole('heading', { name: 'New freight rate' })).toBeInTheDocument();
    const carrier = screen.getByLabelText(/^Carrier/);
    await waitFor(() => {
      expect(carrier).toHaveTextContent('Choose…');
    });
    // Only carriers that are not archived quote freight.
    await userEvent.click(carrier);
    expect(await screen.findByRole('option', { name: 'Synthetic Carrier' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Synthetic Old Carrier' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Synthetic Seller' })).toBeNull();
    await userEvent.type(screen.getByRole('combobox', { name: 'Search the list' }), 'carr');
    await userEvent.click(screen.getByRole('option', { name: 'Synthetic Carrier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rail' }));

    // The ends of the route are counterparties with locations; a carrier without one is not.
    await userEvent.click(screen.getByLabelText(/^From: company/));
    expect(await screen.findByRole('option', { name: 'Synthetic Seller' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Synthetic Carrier' })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'Synthetic Seller' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/^From: location/)).toBeEnabled();
    });
    await choose(
      screen.getByLabelText(/^From: location/),
      'Synthetic Elevator, Synthetic City, SK · 1 Synthetic Road',
    );
    await choose(screen.getByLabelText(/^To: company/), 'Synthetic Buyer');
    await waitFor(() => {
      expect(screen.getByLabelText(/^To: location/)).toBeEnabled();
    });
    await choose(
      screen.getByLabelText(/^To: location/),
      'Synthetic Mill, Synthetic Town, MN · 1 Synthetic Road',
    );

    await userEvent.type(screen.getByLabelText(/^Rate/), '4200.00');
    await choose(screen.getByLabelText(/^Currency/), 'USD');
    await choose(screen.getByLabelText(/^Unit/), 'per load (truckload or railcar)');
    await userEvent.type(screen.getByLabelText(/^Payload of one load/), '90.5');
    await choose(screen.getByLabelText(/^Payload unit/), 'metric tonnes');
    await userEvent.type(
      screen.getByLabelText(/^What the rate includes/),
      'Fuel surcharge included',
    );
    await userEvent.type(screen.getByLabelText(/^Valid until/), '2099-11-05T16:00');
    await choose(screen.getByLabelText(/^Source \(required\)/), 'Email');
    await userEvent.click(screen.getByRole('button', { name: 'Save freight rate' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/freight/${FREIGHT.id}`);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      organizationId: ORG.id,
      carrierId: CARRIER.id,
      originFacilityId: SELLER_DETAIL.facilities[0]?.id,
      destinationFacilityId: BUYER_DETAIL.facilities[0]?.id,
      mode: 'rail',
      values: {
        firmness: 'indicative',
        rate: '4200.00',
        currency: 'USD',
        rateUnit: 'LOAD',
        payload: '90.5',
        payloadUnit: 'MT',
        inclusions: 'Fuel surcharge included',
        // Typed in Alberta time (UTC−6).
        validUntil: '2099-11-05T22:00:00.000Z',
        sourceType: 'email',
      },
    });
  });

  it('starts from the carrier in the address and goes back to its page', async () => {
    window.history.replaceState(null, '', `/freight/new?carrier=${CARRIER.id}`);
    api();
    render(<NewFreightPage session={SESSION} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/^Carrier/)).toHaveTextContent('Synthetic Carrier');
    });
    expect(screen.getByRole('link', { name: 'Synthetic Carrier' })).toHaveAttribute(
      'href',
      `/counterparties/${CARRIER.id}`,
    );
  });

  it('asks for the carrier, the route and the required terms before sending', async () => {
    const calls = api();
    render(<NewFreightPage session={SESSION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save freight rate' }));
    expect(await screen.findByText('Choose the carrier that quoted the rate.')).toBeInTheDocument();
    expect(screen.getByText('Rate is required.')).toBeInTheDocument();
    expect(screen.getByText('Valid until is required.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('is for traders, operations and admins only', () => {
    api();
    render(<NewFreightPage session={{ ...SESSION, organization: { ...ORG, role: 'analyst' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only traders, operations and admins of Synthetic Org A enter freight rates.',
    );
  });
});
