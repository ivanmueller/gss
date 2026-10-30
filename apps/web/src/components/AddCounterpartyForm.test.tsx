import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { choose } from '../test/select';
import { mockApi, ORG, SESSION } from '../test/api';
import { AddCounterpartyForm } from './AddCounterpartyForm';

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
  it('adds a seller with a first contact and a location, finds its coordinates, then opens it', async () => {
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
      within(company).getByLabelText('Legal name (required)'),
      'Synthetic Farms',
    );
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Seller' }));
    await choose(within(company).getByLabelText('Country (required)'), 'Canada');
    await userEvent.type(within(company).getByLabelText('Company phone'), '306 555 0100');
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Small Animal' }));
    await choose(within(company).getByLabelText('Tier'), 'Tier A');
    await userEvent.type(within(section('Contact')).getByLabelText('Name'), 'Synthetic Grower');
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
          companyPhone: '306 555 0100',
          markets: 'small_animal',
          tier: 'A',
          contactName: 'Synthetic Grower',
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
    await userEvent.type(within(company).getByLabelText('Legal name (required)'), 'Synthetic Co');
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Carrier' }));
    await choose(within(company).getByLabelText('Country (required)'), 'Canada');
    // A carrier's location is not asked whether rail or trucks serve it.
    expect(within(section('Location')).queryByLabelText('Served by')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/counterparties/${CREATED}`);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ transportAccess: null });
  });

  it('shows each problem by its field before sending anything', async () => {
    const calls = mockApi({});
    form();
    await userEvent.type(within(section('Contact')).getByLabelText('Email'), 'not-an-email');
    await userEvent.type(within(section('Company')).getByLabelText('Company phone'), 'reception');
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));

    const company = section('Company');
    expect(within(company).getByLabelText('Legal name (required)')).toHaveAccessibleDescription(
      'Legal name is required.',
    );
    expect(within(company).getByLabelText('Country (required)')).toHaveAccessibleDescription(
      'Country is required.',
    );
    expect(
      within(company).getByText('Choose at least one: buyer, seller, broker or carrier.'),
    ).toBeInTheDocument();
    expect(within(company).getByText('"reception" is not a phone number.')).toBeInTheDocument();
    expect(within(section('Contact')).getByLabelText('Email')).toHaveAccessibleDescription(
      '"not-an-email" is not an email address.',
    );
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
      within(company).getByLabelText('Legal name (required)'),
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
