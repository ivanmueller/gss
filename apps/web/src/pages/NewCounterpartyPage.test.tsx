import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { NewCounterpartyPage } from './NewCounterpartyPage';

const CREATED = '00000000-0000-4000-8000-00000000c0de';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function section(name: string) {
  return screen.getByRole('region', { name });
}

describe('NewCounterpartyPage', () => {
  it('adds a seller with a first contact and location, then opens it', async () => {
    const calls = mockApi({
      'POST /counterparties': () => Response.json({ id: CREATED }, { status: 201 }),
    });
    render(<NewCounterpartyPage session={SESSION} />);

    const company = section('Company');
    await userEvent.type(
      within(company).getByLabelText('Legal name (required)'),
      'Synthetic Farms',
    );
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Seller' }));
    await userEvent.selectOptions(within(company).getByLabelText('Country (required)'), 'CA');
    await userEvent.type(within(section('Contact')).getByLabelText('Name'), 'Synthetic Grower');
    const location = section('Location');
    // The location's country follows the company's.
    expect(within(location).getByLabelText('Country')).toHaveValue('CA');
    await userEvent.type(within(location).getByLabelText('City or town'), 'Synthetic Town');
    await userEvent.selectOptions(within(location).getByLabelText('Province or territory'), 'SK');
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe(`/counterparties/${CREATED}`);
    });
    expect(calls[0]?.body).toEqual({
      organizationId: ORG.id,
      values: {
        legalName: 'Synthetic Farms',
        types: 'seller',
        country: 'CA',
        verificationStatus: 'unverified',
        contactName: 'Synthetic Grower',
        facilityCountry: 'CA',
        city: 'Synthetic Town',
        region: 'SK',
      },
    });
  });

  it('shows each problem by its field before sending anything', async () => {
    const calls = mockApi({});
    render(<NewCounterpartyPage session={SESSION} />);
    await userEvent.type(within(section('Contact')).getByLabelText('Email'), 'not-an-email');
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
    render(<NewCounterpartyPage session={SESSION} />);
    const company = section('Company');
    await userEvent.type(
      within(company).getByLabelText('Legal name (required)'),
      'Synthetic Mills',
    );
    await userEvent.click(within(company).getByRole('checkbox', { name: 'Buyer' }));
    await userEvent.selectOptions(within(company).getByLabelText('Country (required)'), 'US');
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A counterparty with this legal name is already in the list for this country.',
    );
    expect(screen.getByRole('button', { name: 'Add counterparty' })).toBeEnabled();
  });

  it('is for operations and admin members only', () => {
    mockApi({});
    render(
      <NewCounterpartyPage session={{ ...SESSION, organization: { ...ORG, role: 'trader' } }} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only operations and admin members of Synthetic Org A can add counterparties.',
    );
    expect(screen.queryByRole('button', { name: 'Add counterparty' })).not.toBeInTheDocument();
  });
});
