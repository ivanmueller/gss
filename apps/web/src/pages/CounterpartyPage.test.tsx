import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartyDetail } from '../lib/api';
import { mockApi, ORG, PNG, SESSION } from '../test/api';
import { CounterpartyPage } from './CounterpartyPage';

const ID = '00000000-0000-4000-8000-00000000c001';
const DETAIL: CounterpartyDetail = {
  id: ID,
  organizationId: ORG.id,
  legalName: 'Synthetic Prairie Mills',
  tradingName: 'Prairie Mills',
  types: ['buyer', 'seller'],
  primaryCountry: 'CA',
  verificationStatus: 'pending',
  source: 'file_import',
  createdAt: '2026-10-27T14:05:00.000Z',
  contactCount: 1,
  facilityCount: 1,
  regions: ['SK'],
  logoSha256: null,
  notes: 'Synthetic record.',
  contacts: [
    {
      id: 'k1',
      name: 'Synthetic Merchandiser',
      role: 'Grain buyer',
      email: 'merch@example.test',
      phone: '+1 (306) 555-0100',
    },
  ],
  facilities: [
    {
      id: 'f1',
      name: 'Synthetic Elevator',
      facilityType: 'elevator',
      addressLine: '1 Synthetic Road',
      city: 'Synthetic Town',
      region: 'SK',
      postalCode: 'S4P 3Y2',
      country: 'CA',
      latitude: '52.133214',
      longitude: '-106.670046',
      locationPrecision: 'approximate',
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CounterpartyPage', () => {
  it('shows the counterparty, its contacts and its locations', async () => {
    mockApi({ [`GET /counterparties/${ID}`]: () => Response.json(DETAIL) });
    render(<CounterpartyPage session={SESSION} id={ID} />);

    expect(
      await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Trading as Prairie Mills')).toBeInTheDocument();
    expect(screen.getByText('Verification pending')).toBeInTheDocument();
    expect(screen.getByText('Buyer, Seller')).toBeInTheDocument();
    expect(screen.getByText('Imported from a spreadsheet')).toBeInTheDocument();
    expect(screen.getByText('2026-10-27 14:05 UTC')).toBeInTheDocument();

    const contacts = screen.getByRole('region', { name: 'Contacts (1)' });
    expect(within(contacts).getByRole('link', { name: 'merch@example.test' })).toHaveAttribute(
      'href',
      'mailto:merch@example.test',
    );
    expect(within(contacts).getByRole('link', { name: '+1 (306) 555-0100' })).toHaveAttribute(
      'href',
      'tel:+13065550100',
    );

    const locations = screen.getByRole('region', { name: 'Locations (1)' });
    expect(locations).toHaveTextContent('Synthetic Elevator · Elevator');
    expect(locations).toHaveTextContent('1 Synthetic Road, Synthetic Town, SK S4P 3Y2, Canada');
    expect(locations).toHaveTextContent('52.133214, -106.670046 · approximate location');
  });

  it('explains a counterparty that is missing or belongs to another organization', async () => {
    mockApi({});
    render(<CounterpartyPage session={SESSION} id={ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This counterparty does not exist or is not in your organization.',
    );
  });

  it('uploads a PNG logo and reloads the counterparty', async () => {
    const calls = mockApi({
      [`GET /counterparties/${ID}`]: () => Response.json(DETAIL),
      [`PUT /counterparties/${ID}/logo`]: () =>
        Response.json({ sha256: 'b'.repeat(64), width: 1, height: 1, bytes: 70 }),
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);

    const input = await screen.findByLabelText('Upload PNG logo');
    await userEvent.upload(input, new File([PNG], 'logo.png', { type: 'image/png' }));

    expect(await screen.findByText('Logo saved.')).toBeInTheDocument();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.headers.get('Content-Type')).toBe('image/png');
    expect(put?.body).toEqual(PNG);
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    });
  });

  it('refuses a file that is not a PNG before uploading it', async () => {
    const calls = mockApi({ [`GET /counterparties/${ID}`]: () => Response.json(DETAIL) });
    render(<CounterpartyPage session={SESSION} id={ID} />);

    const input = await screen.findByLabelText('Upload PNG logo');
    await userEvent.upload(
      input,
      new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'logo.png', {
        type: 'image/png',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('The file is not a PNG image.');
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('does not offer the upload to a viewer', async () => {
    mockApi({ [`GET /counterparties/${ID}`]: () => Response.json(DETAIL) });
    render(
      <CounterpartyPage
        session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }}
        id={ID}
      />,
    );
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    expect(screen.queryByLabelText('Upload PNG logo')).not.toBeInTheDocument();
  });
});
