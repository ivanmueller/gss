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
  archivedAt: null,
  version: '2026-10-27T14:05:00.000000Z',
  contacts: [
    {
      id: 'k1',
      name: 'Synthetic Merchandiser',
      role: 'Grain buyer',
      email: 'merch@example.test',
      phone: '+1 (306) 555-0100',
      version: '2026-10-27T14:05:00.000000Z',
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
      geocodingSource: 'geocodio',
      version: '2026-10-27T14:05:00.000000Z',
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
    expect(await screen.findByRole('alert')).toHaveTextContent('This counterparty does not exist.');
  });

  it('uploads a PNG logo and reloads the counterparty', async () => {
    const calls = mockApi({
      [`GET /counterparties/${ID}`]: () => Response.json(DETAIL),
      [`PUT /counterparties/${ID}/logo`]: () =>
        Response.json({ sha256: 'b'.repeat(64), width: 1, height: 1, bytes: 70 }),
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);

    const input = await screen.findByLabelText('Upload logo');
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

    const input = await screen.findByLabelText('Upload logo');
    await userEvent.upload(
      input,
      new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'logo.png', {
        type: 'image/png',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file is not a PNG, JPG or WebP image.',
    );
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
    expect(screen.queryByLabelText('Upload logo')).not.toBeInTheDocument();
  });

  it('shows where a location’s coordinates came from', async () => {
    mockApi({ [`GET /counterparties/${ID}`]: () => Response.json(DETAIL) });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    const locations = await screen.findByRole('region', { name: 'Locations (1)' });
    expect(locations).toHaveTextContent('found from the address (Geocodio)');
  });
});

const PATH = `/counterparties/${ID}`;

describe('CounterpartyPage editing', () => {
  it('edits the details for the version on screen and reloads', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(DETAIL),
      [`PATCH ${PATH}`]: () => Response.json(DETAIL),
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit details' }));

    const form = screen.getByRole('form', { name: 'Edit details' });
    expect(within(form).getByLabelText('Legal name (required)')).toHaveValue(
      'Synthetic Prairie Mills',
    );
    expect(within(form).getByRole('checkbox', { name: 'Seller' })).toBeChecked();
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Seller' }));
    await userEvent.clear(within(form).getByLabelText('Trading name'));
    await userEvent.click(within(form).getByRole('button', { name: 'Save details' }));

    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Edit details' })).not.toBeInTheDocument();
    });
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      version: DETAIL.version,
      values: {
        legalName: 'Synthetic Prairie Mills',
        tradingName: '',
        types: 'buyer',
        country: 'CA',
        verificationStatus: 'pending',
        notes: 'Synthetic record.',
      },
    });
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Details saved.');
  });

  it('checks the form before sending it', async () => {
    const calls = mockApi({ [`GET ${PATH}`]: () => Response.json(DETAIL) });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const form = screen.getByRole('form', { name: 'Edit details' });
    await userEvent.clear(within(form).getByLabelText('Legal name (required)'));
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Buyer' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Seller' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save details' }));

    expect(within(form).getByLabelText('Legal name (required)')).toHaveAccessibleDescription(
      'Legal name is required.',
    );
    expect(
      within(form).getByText('Choose at least one: buyer, seller, broker or carrier.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('offers the latest version when someone else changed the record meanwhile', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(DETAIL),
      [`PATCH ${PATH}/contacts/k1`]: () =>
        Response.json(
          {
            error: {
              code: 'RECORD_CHANGED',
              message: 'Someone changed this contact after you opened it.',
            },
          },
          { status: 409 },
        ),
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit Synthetic Merchandiser' }),
    );
    const form = screen.getByRole('form', { name: 'Edit Synthetic Merchandiser' });
    await userEvent.type(within(form).getByLabelText('Job title'), ' lead');
    await userEvent.click(within(form).getByRole('button', { name: 'Save contact' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Someone changed this contact after you opened it.',
    );
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
      version: DETAIL.contacts[0]?.version,
      values: { contactName: 'Synthetic Merchandiser', contactRole: 'Grain buyer lead' },
    });
    await userEvent.click(within(form).getByRole('button', { name: 'Load the latest version' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('adds a contact and removes one after a confirmation', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(DETAIL),
      [`POST ${PATH}/contacts`]: () => Response.json(DETAIL, { status: 201 }),
      [`DELETE ${PATH}/contacts/k1`]: () => Response.json(DETAIL),
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add contact' }));
    const form = screen.getByRole('form', { name: 'New contact' });
    await userEvent.type(within(form).getByLabelText('Name (required)'), 'Synthetic Ana');
    await userEvent.type(within(form).getByLabelText('Email'), 'ana@example.test');
    await userEvent.click(within(form).getByRole('button', { name: 'Add contact' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        values: {
          contactName: 'Synthetic Ana',
          contactRole: '',
          contactEmail: 'ana@example.test',
          contactPhone: '',
        },
      });
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Synthetic Merchandiser' }),
    );
    const confirm = screen.getByRole('group', { name: 'Remove Synthetic Merchandiser' });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    });
  });

  it('corrects a location, keeping its version, and checks its postal code', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(DETAIL),
      [`PATCH ${PATH}/facilities/f1`]: () => Response.json(DETAIL),
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Synthetic Elevator' }));
    const form = screen.getByRole('form', { name: 'Edit Synthetic Elevator' });
    expect(within(form).getByLabelText('Province or territory')).toHaveValue('SK');

    const postal = within(form).getByLabelText('Postal code');
    await userEvent.clear(postal);
    await userEvent.type(postal, '12345');
    await userEvent.click(within(form).getByRole('button', { name: 'Save location' }));
    expect(postal).toHaveAccessibleDescription('"12345" is not a postal code like S4P 3Y2.');

    await userEvent.clear(postal);
    await userEvent.type(postal, 's4p3y2');
    await userEvent.clear(within(form).getByLabelText('Latitude'));
    await userEvent.clear(within(form).getByLabelText('Longitude'));
    await userEvent.click(within(form).getByRole('button', { name: 'Save location' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        version: DETAIL.facilities[0]?.version,
        values: {
          facilityName: 'Synthetic Elevator',
          facilityType: 'elevator',
          addressLine: '1 Synthetic Road',
          city: 'Synthetic Town',
          region: 'SK',
          postalCode: 's4p3y2',
          facilityCountry: 'CA',
          latitude: '',
          longitude: '',
          // Clearing the coordinates clears their precision too.
          locationPrecision: '',
        },
      });
    });
  });

  it('archives after a confirmation, then offers only Restore', async () => {
    let archived = false;
    const calls = mockApi({
      [`GET ${PATH}`]: () =>
        Response.json({ ...DETAIL, archivedAt: archived ? '2026-10-28T10:00:00.000Z' : null }),
      [`POST ${PATH}/archive`]: () => {
        archived = true;
        return Response.json(DETAIL);
      },
      [`POST ${PATH}/restore`]: () => {
        archived = false;
        return Response.json(DETAIL);
      },
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    const confirm = screen.getByRole('group', { name: 'Archive this counterparty' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Archive' }));

    expect(await screen.findByText(/on 2026-10-28 10:00 UTC/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Upload logo')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('button', { name: 'Edit details' })).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      `${PATH}/archive`,
      `${PATH}/restore`,
    ]);
  });

  it('offers no changes to a viewer', async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json(DETAIL) });
    render(
      <CounterpartyPage
        session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }}
        id={ID}
      />,
    );
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    for (const name of ['Edit details', 'Archive', 'Add contact', 'Add location']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /^(Edit|Remove) / })).not.toBeInTheDocument();
  });

  it('changes an existing logo under Edit details, not at the top', async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json({ ...DETAIL, logoSha256: 'b'.repeat(64) }) });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    expect(screen.queryByLabelText('Upload logo')).not.toBeInTheDocument();
    expect(screen.queryByText(/PNG only/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.getByLabelText('Change logo')).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp',
    );
  });
});
