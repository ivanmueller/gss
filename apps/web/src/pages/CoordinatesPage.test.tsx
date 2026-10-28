import { signedMatchOf, type GeocodeLookup, type GeocodeProposal } from '@grain/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { CoordinatesPage } from './CoordinatesPage';

// Every address and result here is synthetic.
const GEOCODE = 'POST /facilities/geocode';
const SAVE = 'POST /facilities/coordinates';

function proposal(
  n: number,
  match: Partial<NonNullable<GeocodeProposal['match']>> | null,
  overrides: Partial<GeocodeProposal> = {},
): GeocodeProposal {
  return {
    facilityId: `00000000-0000-4000-8000-00000000fac${String(n)}`,
    counterpartyId: `00000000-0000-4000-8000-00000000c00${String(n)}`,
    legalName: `Synthetic Buyer ${String(n)}`,
    facilityName: `Synthetic Elevator ${String(n)}`,
    address: {
      addressLine: `${String(n)} Synthetic Road`,
      city: 'Synthetic Town',
      region: 'SK',
      postalCode: null,
      country: 'CA',
    },
    match: match && {
      latitude: '52.133214',
      longitude: '-106.670046',
      precision: 'exact',
      accuracyType: 'rooftop',
      confidence: '0.97',
      formattedAddress: `${String(n)} Synthetic Rd, Synthetic Town, SK S4P`,
      regionMatches: true,
      facilityVersion: '2026-10-27T18:00:00.000000Z',
      expiresAt: '2026-10-27T19:00:00.000Z',
      signature: String(n).repeat(64),
      ...match,
    },
    miss: match ? null : 'NOT_FOUND',
    ...overrides,
  };
}

const LOOKUP: GeocodeLookup = {
  truncated: false,
  proposals: [
    proposal(1, {}),
    proposal(2, { precision: 'approximate', accuracyType: 'place', regionMatches: false }),
    proposal(3, { confidence: '0.55' }),
    proposal(4, null, {
      address: { addressLine: null, city: null, region: 'MB', postalCode: null, country: 'CA' },
      miss: 'NO_ADDRESS',
    }),
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CoordinatesPage', () => {
  it('looks addresses up, preselects the safe matches, and saves the chosen ones', async () => {
    const calls = mockApi({
      [GEOCODE]: () => Response.json(LOOKUP),
      [SAVE]: () => Response.json({ saved: 2, skipped: 0 }),
    });
    render(<CoordinatesPage session={SESSION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Look up addresses' }));

    expect(
      await screen.findByText('Found 3 locations of 4: 2 exact, 1 approximate. 1 was not found.'),
    ).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ organizationId: ORG.id });
    const found = screen.getByRole('list', { name: 'Locations found' });
    const boxes = within(found).getAllByRole('checkbox');
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([true, false, false]);
    expect(found).toHaveTextContent('another province or state');
    expect(found).toHaveTextContent('low confidence');
    expect(found).toHaveTextContent('Approximate (e.g. the town) · 97% confidence');
    expect(screen.getByRole('list', { name: 'Locations not found' })).toHaveTextContent(
      'MB, Canada · No street, town or postal code to look up',
    );

    const second = boxes[1];
    if (!second) throw new Error('no second checkbox');
    await userEvent.click(second);
    await userEvent.click(screen.getByRole('button', { name: 'Save 2 locations' }));

    expect(await screen.findByText('Saved coordinates for 2 locations.')).toBeInTheDocument();
    expect(calls[1]?.body).toEqual({
      organizationId: ORG.id,
      matches: [1, 2].map((n) => {
        const chosen = LOOKUP.proposals[n - 1];
        if (!chosen?.match) throw new Error('no match');
        return signedMatchOf(chosen.facilityId, chosen.match);
      }),
    });
    expect(screen.getByRole('link', { name: 'See them on the map' })).toHaveAttribute(
      'href',
      '/counterparties?view=map',
    );
  });

  it('says why a lookup failed', async () => {
    mockApi({
      [GEOCODE]: () =>
        Response.json(
          {
            error: {
              code: 'GEOCODING_NOT_CONFIGURED',
              message: 'Finding coordinates is not set up.',
            },
          },
          { status: 503 },
        ),
    });
    render(<CoordinatesPage session={SESSION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Look up addresses' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Finding coordinates is not set up.',
    );
  });

  it('keeps the review when saving fails', async () => {
    mockApi({
      [GEOCODE]: () => Response.json(LOOKUP),
      [SAVE]: () =>
        Response.json(
          { error: { code: 'MATCH_EXPIRED', message: 'These results are more than an hour old.' } },
          { status: 422 },
        ),
    });
    render(<CoordinatesPage session={SESSION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Look up addresses' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save 1 location' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('more than an hour old');
    expect(screen.getByRole('list', { name: 'Locations found' })).toBeInTheDocument();
  });

  it('offers the rest when more locations wait than one lookup covers', async () => {
    mockApi({
      [GEOCODE]: () => Response.json({ ...LOOKUP, truncated: true }),
      [SAVE]: () => Response.json({ saved: 0, skipped: 1 }),
    });
    render(<CoordinatesPage session={SESSION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Look up addresses' }));
    expect(await screen.findByText(/Only the first 1,000 locations were looked up/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 location' }));
    expect(
      await screen.findByText(
        'Saved coordinates for 0 locations. 1 was not saved because it has coordinates by now.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look up the rest' })).toBeInTheDocument();
  });

  it('says when every location already has coordinates', async () => {
    mockApi({ [GEOCODE]: () => Response.json({ proposals: [], truncated: false }) });
    render(<CoordinatesPage session={SESSION} />);
    await userEvent.click(screen.getByRole('button', { name: 'Look up addresses' }));
    expect(await screen.findByText('Every location already has coordinates.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
  });

  it('is only for operations and admin members', () => {
    render(<CoordinatesPage session={{ ...SESSION, organization: { ...ORG, role: 'trader' } }} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Only operations and admin members can find and save coordinates.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
