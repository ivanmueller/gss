import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartyDetail } from '../lib/api';
import { mockApi as mockBaseApi, ORG, PNG, SESSION } from '../test/api';
import { FREIGHT } from '../test/freight';
import { BID } from '../test/quotes';
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
  website: null,
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

/**
 * The page's API, with no bids, offers or freight for the counterparty unless a test says
 * otherwise.
 */
function mockApi(handlers: Parameters<typeof mockBaseApi>[0]) {
  return mockBaseApi({
    [`GET /quotes?counterparty_id=${ID}`]: () => Response.json({ quotes: [], truncated: false }),
    [`GET /freight-quotes?counterparty_id=${ID}`]: () =>
      Response.json({ freight: [], truncated: false }),
    [`GET /freight-quotes?carrier_id=${ID}`]: () =>
      Response.json({ freight: [], truncated: false }),
    ...handlers,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CounterpartyPage', () => {
  it('lists its bids and offers and offers a new bid or offer to traders', async () => {
    const calls = mockApi({
      [`GET /counterparties/${ID}`]: () => Response.json(DETAIL),
      [`GET /quotes?counterparty_id=${ID}`]: () =>
        Response.json({
          quotes: [{ ...BID, counterparty: { ...BID.counterparty, id: ID } }],
          truncated: false,
        }),
      [`GET /quotes?counterparty_id=${ID}&status=all`]: () =>
        Response.json({ quotes: [], truncated: false }),
    });
    render(
      <CounterpartyPage
        session={{ ...SESSION, organization: { ...ORG, role: 'trader' } }}
        id={ID}
      />,
    );
    const quotes = await screen.findByRole('region', { name: 'Bids and offers (1)' });
    const table = within(quotes).getByRole('table', {
      name: 'Bids and offers of this counterparty',
    });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(
      'BidFlaxseedNo. 1 CWUSD 730.50/MT',
    );
    // A buyer and seller can both bid and offer.
    expect(within(quotes).getByRole('link', { name: 'New bid' })).toHaveAttribute(
      'href',
      `/quotes/new?counterparty=${ID}&side=bid`,
    );
    expect(within(quotes).getByRole('link', { name: 'New offer' })).toHaveAttribute(
      'href',
      `/quotes/new?counterparty=${ID}&side=offer`,
    );
    await userEvent.click(within(quotes).getByLabelText('Include withdrawn and expired'));
    expect(await within(quotes).findByText('No bids or offers recorded.')).toBeInTheDocument();
    expect(calls.map((call) => call.path)).toContain(`/quotes?counterparty_id=${ID}&status=all`);
  });

  it('offers no new bids or offers to members who may not enter them', async () => {
    mockApi({ [`GET /counterparties/${ID}`]: () => Response.json(DETAIL) });
    render(
      <CounterpartyPage
        session={{ ...SESSION, organization: { ...ORG, role: 'operations' } }}
        id={ID}
      />,
    );
    const quotes = await screen.findByRole('region', { name: 'Bids and offers (0)' });
    expect(quotes).toHaveTextContent('No live bids or offers.');
    expect(within(quotes).queryByRole('link', { name: 'New bid' })).toBeNull();
    expect(within(quotes).queryByRole('link', { name: 'New offer' })).toBeNull();
  });

  it('lists a carrier’s freight rates and offers a new one to operations', async () => {
    const carrier = { ...DETAIL, types: ['carrier'], facilities: [] };
    mockApi({
      [`GET /counterparties/${ID}`]: () => Response.json(carrier),
      [`GET /freight-quotes?carrier_id=${ID}`]: () =>
        Response.json({
          freight: [{ ...FREIGHT, carrier: { ...FREIGHT.carrier, id: ID } }],
          truncated: false,
        }),
    });
    render(
      <CounterpartyPage
        session={{ ...SESSION, organization: { ...ORG, role: 'operations' } }}
        id={ID}
      />,
    );
    const freight = await screen.findByRole('region', { name: 'Freight rates (1)' });
    const table = within(freight).getByRole('table', { name: 'Freight rates of this carrier' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('CAD 105.00/MT');
    // The carrier is the page itself, so the table leaves it out.
    expect(within(table).queryByRole('columnheader', { name: 'Carrier' })).toBeNull();
    expect(within(freight).getByRole('link', { name: 'New freight rate' })).toHaveAttribute(
      'href',
      `/freight/new?carrier=${ID}`,
    );
  });

  it('lists freight to and from the locations of a counterparty that is not a carrier', async () => {
    const calls = mockApi({ [`GET /counterparties/${ID}`]: () => Response.json(DETAIL) });
    render(
      <CounterpartyPage
        session={{ ...SESSION, organization: { ...ORG, role: 'trader' } }}
        id={ID}
      />,
    );
    const freight = await screen.findByRole('region', {
      name: 'Freight to and from its locations (0)',
    });
    expect(freight).toHaveTextContent('No live freight rates.');
    expect(within(freight).queryByRole('link', { name: 'New freight rate' })).toBeNull();
    expect(calls.map((call) => call.path)).not.toContain(`/freight-quotes?carrier_id=${ID}`);
  });

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

  it('uploads a PNG logo, reloads the counterparty and still says the logo is saved', async () => {
    let logoSha256: string | null = null;
    const calls = mockApi({
      [`GET /counterparties/${ID}`]: () => Response.json({ ...DETAIL, logoSha256 }),
      [`PUT /counterparties/${ID}/logo`]: () => {
        logoSha256 = 'b'.repeat(64);
        return Response.json({ sha256: logoSha256, width: 1, height: 1, bytes: 70 });
      },
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);

    const input = await screen.findByLabelText('Upload logo');
    await userEvent.upload(input, new File([PNG], 'logo.png', { type: 'image/png' }));

    // Looked up afresh each time: once the reload has the logo, the note under the upload
    // button gives way to the same note beside the logo, so an element found first can be
    // gone a moment later although the words never leave the page (deploy run #45).
    await waitFor(() => {
      expect(screen.getByText('Logo saved.')).toBeInTheDocument();
    });
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.headers.get('Content-Type')).toBe('image/png');
    expect(put?.body).toEqual(PNG);
    await waitFor(() => {
      expect(
        calls.filter((call) => call.method === 'GET' && call.path === `/counterparties/${ID}`),
      ).toHaveLength(2);
    });
    // With the logo saved, the upload button gives way to the logo, and the note stays.
    await waitFor(() => {
      expect(screen.queryByLabelText('Upload logo')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Logo saved.')).toBeInTheDocument();
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
    await userEvent.type(within(form).getByLabelText('Website'), 'example.com/grain');
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
        website: 'example.com/grain',
        notes: 'Synthetic record.',
      },
    });
    expect(
      calls.filter((call) => call.method === 'GET' && call.path.startsWith('/counterparties')),
    ).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Details saved.');
  });

  it('refuses a website that is not a web address before sending it', async () => {
    const calls = mockApi({ [`GET ${PATH}`]: () => Response.json(DETAIL) });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    const form = screen.getByRole('form', { name: 'Edit details' });
    await userEvent.type(within(form).getByLabelText('Website'), 'javascript:alert(1)');
    await userEvent.click(within(form).getByRole('button', { name: 'Save details' }));
    expect(
      await within(form).findByText('Website must be a web address such as example.com.'),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText('Website')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
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
      expect(
        calls.filter((call) => call.method === 'GET' && call.path.startsWith('/counterparties')),
      ).toHaveLength(2);
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
    expect(within(form).getByLabelText('Province or territory')).toHaveTextContent('Saskatchewan');

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

describe('CounterpartyPage website', () => {
  it('links the website in a new tab, with no preview', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json({ ...DETAIL, website: 'https://www.example.com/grain' }),
    });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    const link = await screen.findByRole('link', {
      name: 'example.com/grain (opens in a new tab)',
    });
    expect(link).toHaveAttribute('href', 'https://www.example.com/grain');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    // Nothing asks the site anything: the page reads only the counterparty.
    expect(calls.map((call) => call.path)).not.toContain(`${PATH}/website-preview`);
  });

  it('shows no website when there is none', async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json(DETAIL) });
    render(<CounterpartyPage session={SESSION} id={ID} />);
    await screen.findByRole('heading', { name: 'Synthetic Prairie Mills' });
    expect(screen.queryByRole('link', { name: /opens in a new tab/ })).not.toBeInTheDocument();
  });
});
