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
  markets: [],
  tier: null,
  grainTypes: [],
  sellerKind: null,
  annualTonnes: null,
  organicCertifier: null,
  organicCertifiedUntil: null,
  equipment: [],
  lanes: [],
  quotedLanes: [],
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

const MATCH = {
  latitude: '49.354000',
  longitude: '-97.365000',
  precision: 'approximate',
  expiresAt: '2099-01-01T00:00:00.000Z',
  signature: 'a'.repeat(64),
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
    phone: null,
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
        transportAccess: null,
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

/** The From end's Find on the map (the first on the page). */
function firstFindButton(): HTMLElement {
  const [button] = screen.getAllByRole('button', { name: 'Find on the map' });
  if (!button) throw new Error('no Find on the map button');
  return button;
}

function api() {
  return mockApi({
    [`GET /counterparties?organization_id=${ORG.id}`]: () =>
      Response.json({ counterparties: [CARRIER, OLD_CARRIER, SELLER, BUYER], truncated: false }),
    [`GET /counterparties/${SELLER.id}`]: () => Response.json(SELLER_DETAIL),
    [`GET /counterparties/${BUYER.id}`]: () => Response.json(BUYER_DETAIL),
    'POST /freight-quotes': () => Response.json(FREIGHT, { status: 201 }),
    'POST /freight-quotes/places': () =>
      Response.json({
        status: 'found',
        sure: true,
        formattedAddress: 'Synthetic Town A, MB, Canada',
        match: MATCH,
      }),
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
    const carrier = screen.getByLabelText(/^Company quoting the rate/);
    await waitFor(() => {
      expect(carrier).toHaveTextContent('Choose…');
    });
    // Any company that is not archived quotes freight (F-235).
    await userEvent.click(carrier);
    expect(await screen.findByRole('option', { name: 'Synthetic Carrier' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Synthetic Old Carrier' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Synthetic Seller' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('combobox', { name: 'Search the list' }), 'carr');
    await userEvent.click(screen.getByRole('option', { name: 'Synthetic Carrier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rail' }));

    // Saved locations: counterparties with locations; a carrier without one is not offered.
    for (const button of screen.getAllByRole('button', { name: 'Saved location' })) {
      await userEvent.click(button);
    }
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
      origin: { facilityId: SELLER_DETAIL.facilities[0]?.id },
      destination: { facilityId: BUYER_DETAIL.facilities[0]?.id },
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
    // Many steps: more time when the whole suite runs at once.
  }, 15_000);

  it('starts from the carrier in the address and goes back to its page', async () => {
    window.history.replaceState(null, '', `/freight/new?carrier=${CARRIER.id}`);
    api();
    render(<NewFreightPage session={SESSION} />);
    await waitFor(() => {
      expect(screen.getByLabelText(/^Company quoting the rate/)).toHaveTextContent(
        'Synthetic Carrier',
      );
    });
    expect(screen.getByRole('link', { name: 'Synthetic Carrier' })).toHaveAttribute(
      'href',
      `/counterparties/${CARRIER.id}`,
    );
  });

  it('asks for the company, the route and the required terms before sending', async () => {
    const calls = api();
    render(<NewFreightPage session={SESSION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save freight rate' }));
    expect(await screen.findByText('Choose the company that quoted the rate.')).toBeInTheDocument();
    expect(screen.getByText('Rate is required.')).toBeInTheDocument();
    // Optional since F-235.
    expect(screen.queryByText('Valid until is required.')).toBeNull();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('enters a buyer’s rate between two towns, one found on the map, with no end date', async () => {
    const calls = api();
    render(<NewFreightPage session={SESSION} />);
    await choose(screen.getByLabelText(/^Company quoting the rate/), 'Synthetic Buyer');

    // The province is read from the end of the text; Find on the map signs the town found.
    await userEvent.type(screen.getByLabelText(/^From: town or area/), 'Synthetic Town A, MB');
    expect(screen.getByLabelText(/^From: province or state/)).toHaveTextContent('Manitoba (MB)');
    await userEvent.click(firstFindButton());
    const found = await screen.findByRole('checkbox', { name: /That’s the place/ });
    expect(found).toBeChecked();

    // Not looked up: saved with its state only.
    await userEvent.type(screen.getByLabelText(/^To: town or area/), 'Synthetic Town B Indiana');
    await userEvent.type(screen.getByLabelText(/^Rate/), '335');
    await choose(screen.getByLabelText(/^Currency/), 'CAD');
    await choose(screen.getByLabelText(/^Source \(required\)/), 'Email');
    await userEvent.click(screen.getByRole('button', { name: 'Save freight rate' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/freight/${FREIGHT.id}`);
    });
    expect(calls.find((call) => call.path === '/freight-quotes/places')?.body).toEqual({
      organizationId: ORG.id,
      text: 'Synthetic Town A, MB',
      region: 'CA-MB',
    });
    const sent = calls.find(
      (call) => call.method === 'POST' && call.path === '/freight-quotes',
    )?.body;
    expect(sent).toMatchObject({
      carrierId: BUYER.id,
      origin: { area: { text: 'Synthetic Town A, MB', region: 'CA-MB', match: MATCH } },
      destination: { area: { text: 'Synthetic Town B Indiana', region: 'US-IN' } },
      values: { rate: '335', currency: 'CAD', rateUnit: 'MT', validUntil: '' },
    });
    expect(JSON.stringify(sent)).not.toContain('"match":null');
    // Many steps: more time when the whole suite runs at once.
  }, 15_000);

  // Codex F-235-1-R1-01: an answer that comes back after the town changed never replaces it.
  it('leaves out a map answer for a town changed while it was looked up', async () => {
    let answer: (response: Response) => void = () => undefined;
    const calls = mockApi({
      [`GET /counterparties?organization_id=${ORG.id}`]: () =>
        Response.json({ counterparties: [CARRIER, BUYER], truncated: false }),
      'POST /freight-quotes/places': () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
      'POST /freight-quotes': () => Response.json(FREIGHT, { status: 201 }),
    });
    render(<NewFreightPage session={SESSION} />);
    await choose(screen.getByLabelText(/^Company quoting the rate/), 'Synthetic Carrier');
    const town = screen.getByLabelText(/^From: town or area/);
    await userEvent.type(town, 'Synthetic Town A, MB');
    await userEvent.click(firstFindButton());
    await waitFor(() => {
      expect(calls.some((call) => call.path === '/freight-quotes/places')).toBe(true);
    });
    await userEvent.clear(town);
    await userEvent.type(town, 'Synthetic Town C, SK');
    answer(
      Response.json({
        status: 'found',
        sure: true,
        formattedAddress: 'Synthetic Town A, MB, Canada',
        match: MATCH,
      }),
    );
    await waitFor(() => {
      expect(firstFindButton()).toHaveTextContent('Find on the map');
    });
    expect(town).toHaveValue('Synthetic Town C, SK');
    expect(screen.getByLabelText(/^From: province or state/)).toHaveTextContent('Saskatchewan');
    expect(screen.queryByRole('checkbox', { name: /That’s the place/ })).toBeNull();
  });

  // Codex F-235-1-R4-01: a province picked by the person is never replaced by the text.
  it('keeps the province picked when the town’s name ends like another', async () => {
    const calls = api();
    render(<NewFreightPage session={SESSION} />);
    await choose(screen.getByLabelText(/^Company quoting the rate/), 'Synthetic Carrier');
    await choose(screen.getByLabelText(/^From: province or state/), 'Alberta (AB)');
    await userEvent.type(screen.getByLabelText(/^From: town or area/), 'Fort Saskatchewan');
    expect(screen.getByLabelText(/^From: province or state/)).toHaveTextContent('Alberta (AB)');
    await userEvent.type(screen.getByLabelText(/^To: town or area/), 'Synthetic Town B, WI');
    await userEvent.type(screen.getByLabelText(/^Rate/), '182');
    await choose(screen.getByLabelText(/^Currency/), 'CAD');
    await choose(screen.getByLabelText(/^Source \(required\)/), 'Email');
    await userEvent.click(screen.getByRole('button', { name: 'Save freight rate' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/freight/${FREIGHT.id}`);
    });
    expect(
      calls.find((call) => call.method === 'POST' && call.path === '/freight-quotes')?.body,
    ).toMatchObject({ origin: { area: { text: 'Fort Saskatchewan', region: 'CA-AB' } } });
  }, 15_000);

  it('saves a doubtful town only once the person ticks it', async () => {
    const calls = mockApi({
      [`GET /counterparties?organization_id=${ORG.id}`]: () =>
        Response.json({ counterparties: [CARRIER, BUYER], truncated: false }),
      'POST /freight-quotes/places': () =>
        Response.json({
          status: 'found',
          sure: false,
          formattedAddress: 'Elsewhere, MB',
          match: MATCH,
        }),
      'POST /freight-quotes': () => Response.json(FREIGHT, { status: 201 }),
    });
    render(<NewFreightPage session={SESSION} />);
    await choose(screen.getByLabelText(/^Company quoting the rate/), 'Synthetic Carrier');
    await userEvent.type(screen.getByLabelText(/^From: town or area/), 'Synthetic Town A, MB');
    await userEvent.click(firstFindButton());
    const found = await screen.findByRole('checkbox', { name: /That’s the place/ });
    expect(found).not.toBeChecked();
    expect(screen.getByText(/Not a sure match/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^To: town or area/), 'Synthetic Town B, WI');
    await userEvent.type(screen.getByLabelText(/^Rate/), '182');
    await choose(screen.getByLabelText(/^Currency/), 'CAD');
    await choose(screen.getByLabelText(/^Source \(required\)/), 'Email');
    await userEvent.click(screen.getByRole('button', { name: 'Save freight rate' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/freight/${FREIGHT.id}`);
    });
    const sent = calls.find((call) => call.method === 'POST' && call.path === '/freight-quotes')
      ?.body as { origin: { area: Record<string, unknown> } };
    expect(sent.origin.area).toEqual({ text: 'Synthetic Town A, MB', region: 'CA-MB' });
    // Many steps: more time when the whole suite runs at once.
  }, 15_000);

  it('is for traders, operations and admins only', () => {
    api();
    render(<NewFreightPage session={{ ...SESSION, organization: { ...ORG, role: 'analyst' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only traders, operations and admins of Synthetic Org A enter freight rates.',
    );
  });
});
