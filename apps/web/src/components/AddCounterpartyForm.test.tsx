import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { choose } from '../test/select';
import { mockApi, ORG, SESSION } from '../test/api';
import { AddCounterpartyForm, unaskedCleared } from './AddCounterpartyForm';

const CREATED = '00000000-0000-4000-8000-00000000c0de';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function section(name: string) {
  return screen.getByRole('region', { name });
}

const MATCH = {
  latitude: '52.133214',
  longitude: '-106.670046',
  precision: 'exact',
  accuracyType: 'rooftop',
  confidence: '0.97',
  formattedAddress: '1 Synthetic Rd, Synthetic Town, SK',
  regionMatches: true,
  facilityVersion: '2026-10-30T18:00:00.000000Z',
  expiresAt: '2026-10-30T19:00:00.000Z',
  signature: 'a'.repeat(64),
};

function form() {
  render(<AddCounterpartyForm session={SESSION} onCancel={vi.fn()} />);
}

describe('AddCounterpartyForm', () => {
  it('adds a seller with a location, finds its coordinates, then opens it', async () => {
    const calls = mockApi({
      'POST /counterparties': () => Response.json({ id: CREATED }, { status: 201 }),
      'POST /facilities/geocode': () =>
        Response.json({
          truncated: false,
          proposals: [
            {
              facilityId: '00000000-0000-4000-8000-00000000fac1',
              counterpartyId: CREATED,
              legalName: 'Synthetic Farms',
              facilityName: null,
              address: {
                addressLine: null,
                city: 'Synthetic Town',
                region: 'SK',
                postalCode: null,
                country: 'CA',
              },
              match: MATCH,
              miss: null,
            },
          ],
        }),
      'POST /facilities/coordinates': () => Response.json({ saved: 1, skipped: 0 }),
    });
    form();

    const company = section('Company');
    await userEvent.type(
      within(company).getByLabelText('Company name (required)'),
      'Synthetic Farms',
    );
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Seller' }));
    await choose(within(company).getByLabelText('Country (required)'), 'Canada');
    await userEvent.type(within(company).getByLabelText('Company phone'), '306 555 0100');
    // Formatted once the box is left (owner's choice, 2026-10-31).
    await userEvent.tab();
    expect(within(company).getByLabelText('Company phone')).toHaveValue('(306) 555-0100');
    // A seller has grain types, not a buyer's market (owner's request, 2026-11-03).
    expect(within(company).queryByRole('group', { name: /Market/ })).toBeNull();
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Feed' }));
    // The organic certificate is asked only with organic grain.
    expect(within(company).queryByLabelText('Organic certifier')).toBeNull();
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Organic' }));
    await choose(within(company).getByLabelText('Seller kind'), 'Farm');
    await userEvent.type(within(company).getByLabelText('Tonnes a year'), '4500');
    await userEvent.type(
      within(company).getByLabelText('Organic certifier'),
      'Synthetic Certifier',
    );
    await userEvent.type(within(company).getByLabelText('Organic certified until'), '2027-03-31');
    await choose(within(company).getByLabelText('Tier'), 'Tier A');
    // Contacts are added on the counterparty's page (owner's request, 2026-11-03).
    expect(screen.queryByRole('region', { name: 'Contact' })).toBeNull();
    const location = section('Location');
    // The location's country follows the company's.
    expect(within(location).getByLabelText('Country')).toHaveTextContent('Canada');
    await userEvent.type(within(location).getByLabelText('City or town'), 'Synthetic Town');
    await choose(within(location).getByLabelText('Province or territory'), 'Saskatchewan');
    await choose(within(location).getByLabelText('Served by'), 'Rail and truck');
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));

    expect(await screen.findByText('Synthetic Farms was added.')).toBeInTheDocument();
    expect(
      await screen.findByText('Coordinates found and saved for 1 location.'),
    ).toBeInTheDocument();
    expect(calls.map((call) => call.body)).toEqual([
      {
        organizationId: ORG.id,
        values: {
          legalName: 'Synthetic Farms',
          types: 'seller',
          country: 'CA',
          verificationStatus: 'unverified',
          companyPhone: '(306) 555-0100',
          grainTypes: 'feed,organic',
          sellerKind: 'farm',
          annualTonnes: '4500',
          organicCertifier: 'Synthetic Certifier',
          organicCertifiedUntil: '2027-03-31',
          tier: 'A',
          facilityCountry: 'CA',
          city: 'Synthetic Town',
          region: 'SK',
        },
        transportAccess: 'rail_and_truck',
      },
      // Only this counterparty's locations are looked up, and the sure match is saved.
      { organizationId: ORG.id, counterpartyId: CREATED },
      {
        organizationId: ORG.id,
        matches: [
          {
            facilityId: '00000000-0000-4000-8000-00000000fac1',
            latitude: MATCH.latitude,
            longitude: MATCH.longitude,
            precision: 'exact',
            accuracyType: 'rooftop',
            confidence: '0.97',
            facilityVersion: MATCH.facilityVersion,
            expiresAt: MATCH.expiresAt,
            signature: MATCH.signature,
          },
        ],
      },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Open Synthetic Farms' }));
    expect(window.location.pathname).toBe(`/counterparties/${CREATED}`);
    // Many steps through a form and three requests: more than the default 5 seconds in a full run.
  }, 15_000);

  it('opens the new counterparty straight away when it needs no coordinates', async () => {
    const calls = mockApi({
      'POST /counterparties': () => Response.json({ id: CREATED }, { status: 201 }),
    });
    form();
    const company = section('Company');
    await userEvent.type(within(company).getByLabelText('Company name (required)'), 'Synthetic Co');
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Carrier' }));
    await choose(within(company).getByLabelText('Country (required)'), 'Canada');
    // A carrier's location is its home yard, not asked whether rail or trucks serve it.
    expect(within(section('Home yard')).queryByLabelText('Served by')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/counterparties/${CREATED}`);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ transportAccess: null });
  });

  it('adds a carrier with its equipment and lanes, without market or tier', async () => {
    const calls = mockApi({
      'POST /counterparties': () => Response.json({ id: CREATED }, { status: 201 }),
    });
    form();
    const company = section('Company');
    expect(within(company).getByText('Tier')).toBeInTheDocument();
    await userEvent.type(
      within(company).getByLabelText('Company name (required)'),
      'Synthetic Hauling',
    );
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Carrier' }));
    await choose(within(company).getByLabelText('Country (required)'), 'Canada');
    // Market and tier are a buyer's or seller's.
    expect(within(company).queryByText('Tier')).toBeNull();
    expect(within(company).queryByRole('group', { name: /Market/ })).toBeNull();

    const carrier = section('Equipment and lanes');
    await userEvent.click(within(carrier).getByRole('checkbox', { name: 'Super B hopper' }));
    await userEvent.click(within(carrier).getByRole('checkbox', { name: 'Dry van' }));
    const first = within(carrier).getByRole('group', { name: 'Lanes 1' });
    await userEvent.click(within(first).getByRole('button', { name: 'From' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search the list' }), 'alberta');
    await userEvent.click(screen.getByRole('option', { name: 'Alberta' }));
    await userEvent.click(within(first).getByRole('button', { name: 'To: None' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Montana' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'North Dakota' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(first).getByRole('button', { name: 'Truck' }));

    // A second place, started but not finished, is pointed out before anything is sent.
    await userEvent.click(
      within(carrier).getByRole('button', { name: 'Lanes from another place' }),
    );
    const second = within(carrier).getByRole('group', { name: 'Lanes 2' });
    await userEvent.click(within(second).getByRole('button', { name: 'From' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search the list' }), 'sask');
    await userEvent.click(screen.getByRole('option', { name: 'Saskatchewan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));
    expect(screen.getByText('Lanes 2: Choose at least one place they go to.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    // Truck or rail left not stated.
    await userEvent.click(within(second).getByRole('button', { name: 'To: None' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'North Dakota' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const body = calls[0]?.body as { values: Record<string, string> };
    expect(body).toMatchObject({
      equipment: ['super_b', 'van'],
      lanes: [
        { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
        { origin: 'CA-AB', destination: 'US-ND', transport: 'truck' },
        { origin: 'CA-SK', destination: 'US-ND', transport: null },
      ],
    });
    expect(body.values).not.toHaveProperty('equipment');
  }, 15_000);

  it('sends no equipment or lanes for a buyer', async () => {
    const calls = mockApi({
      'POST /counterparties': () => Response.json({ id: CREATED }, { status: 201 }),
    });
    form();
    const company = section('Company');
    await userEvent.type(
      within(company).getByLabelText('Company name (required)'),
      'Synthetic Mill',
    );
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Buyer' }));
    await choose(within(company).getByLabelText('Country (required)'), 'Canada');
    expect(screen.queryByRole('region', { name: 'Equipment and lanes' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).not.toHaveProperty('equipment');
    expect(calls[0]?.body).not.toHaveProperty('lanes');
  });

  it('shows each problem by its field before sending anything', async () => {
    const calls = mockApi({});
    form();
    await userEvent.type(within(section('Company')).getByLabelText('Company phone'), 'reception');
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));

    const company = section('Company');
    expect(within(company).getByLabelText('Company name (required)')).toHaveAccessibleDescription(
      'Company name is required.',
    );
    expect(within(company).getByLabelText('Country (required)')).toHaveAccessibleDescription(
      'Country is required.',
    );
    expect(
      within(company).getByText('Choose at least one: buyer, seller, broker or carrier.'),
    ).toBeInTheDocument();
    expect(within(company).getByText('"reception" is not a phone number.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('says when the name is already in the list', async () => {
    mockApi({
      'POST /counterparties': () =>
        Response.json(
          {
            error: {
              code: 'DUPLICATE_NAME',
              message:
                'A counterparty with this legal name is already in the list for this country.',
            },
          },
          { status: 409 },
        ),
    });
    form();
    const company = section('Company');
    await userEvent.type(
      within(company).getByLabelText('Company name (required)'),
      'Synthetic Mills',
    );
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Buyer' }));
    await choose(within(company).getByLabelText('Country (required)'), 'United States');
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A counterparty with this legal name is already in the list for this country.',
    );
    expect(screen.getByRole('button', { name: 'Add counterparty' })).toBeEnabled();
  });
});

describe('unaskedCleared', () => {
  it('empties what the form did not ask for the types ticked, and nothing else', () => {
    // Seller ticked, filled in, then unticked: its details are not sent.
    expect(
      unaskedCleared({
        types: 'buyer',
        markets: 'pet',
        grainTypes: 'organic',
        sellerKind: 'farm',
        annualTonnes: '4500',
        organicCertifier: 'Synthetic Certifier',
        organicCertifiedUntil: '2027-03-31',
      }),
    ).toEqual({
      types: 'buyer',
      markets: 'pet',
      grainTypes: '',
      sellerKind: '',
      annualTonnes: '',
      organicCertifier: '',
      organicCertifiedUntil: '',
    });
    // A seller without organic grain sends no certificate, and no market.
    expect(
      unaskedCleared({
        types: 'seller',
        markets: 'pet',
        grainTypes: 'feed',
        organicCertifier: 'Synthetic Certifier',
      }),
    ).toEqual({ types: 'seller', markets: '', grainTypes: 'feed', organicCertifier: '' });
    expect(unaskedCleared({ types: 'carrier', tier: 'A' })).toEqual({ types: 'carrier', tier: '' });
  });
});
