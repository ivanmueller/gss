import { signedMatchOf, type GeocodeLookup, type GeocodeProposal } from '@grain/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { FindCoordinates } from './FindCoordinates';

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

const COUNTERPARTY = '00000000-0000-4000-8000-00000000c001';

afterEach(() => {
  vi.unstubAllGlobals();
});

function find(lookup: GeocodeLookup = LOOKUP) {
  const calls = mockApi({
    [GEOCODE]: () => Response.json(lookup),
    [SAVE]: (call) =>
      Response.json({ saved: (call.body as { matches: unknown[] }).matches.length, skipped: 0 }),
  });
  const onDone = vi.fn();
  render(
    <FindCoordinates
      session={SESSION}
      scope={{ counterpartyId: COUNTERPARTY }}
      doneLabel="Open Synthetic Buyer 1"
      onDone={onDone}
    />,
  );
  return { calls, onDone };
}

const match = (n: number) => {
  const found = LOOKUP.proposals[n - 1];
  if (!found?.match) throw new Error('no match');
  return signedMatchOf(found.facilityId, found.match);
};

describe('FindCoordinates', () => {
  it('saves the sure results at once and asks only about the doubtful ones', async () => {
    const { calls, onDone } = find();
    const results = await screen.findByRole('list', { name: 'Results to check' });
    // Looked up once, for this counterparty only; the sure result saved without asking.
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([GEOCODE, SAVE]);
    expect(calls[0]?.body).toEqual({ organizationId: ORG.id, counterpartyId: COUNTERPARTY });
    expect(calls[1]?.body).toEqual({ organizationId: ORG.id, matches: [match(1)] });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Coordinates found and saved for 1 location. 2 results need a look before they are saved:',
    );

    // Another province, and low confidence: neither chosen until the user says so.
    const items = within(results).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('In another province or state than your address.');
    expect(items[1]).toHaveTextContent('Low confidence.');
    expect(within(results).queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save 0 chosen results' })).toBeDisabled();

    await userEvent.click(within(results).getAllByRole('checkbox')[0] ?? results);
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 chosen result' }));
    expect(calls[2]?.body).toEqual({ organizationId: ORG.id, matches: [match(2)] });
    expect(
      await screen.findByText(/Coordinates found and saved for 2 locations\./),
    ).toBeInTheDocument();

    // The one left out and the one with no address are listed, with what to do.
    const without = screen.getByRole('list', { name: 'Locations without coordinates' });
    expect(
      within(without)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Synthetic Buyer 4 · Synthetic Elevator 4MB, Canada · No street, town or postal code to look up',
      expect.stringContaining('Synthetic Buyer 3'),
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Open Synthetic Buyer 1' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('asks nothing when every result is sure', async () => {
    const { calls } = find({ truncated: false, proposals: [proposal(1, {})] });
    expect(
      await screen.findByText('Coordinates found and saved for 1 location.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Results to check' })).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('saves nothing and says so when nothing was found', async () => {
    const { calls } = find({ truncated: true, proposals: [proposal(3, null)] });
    expect(await screen.findByText(/No coordinates were saved\./)).toHaveTextContent(
      'Only the first 1,000 locations were looked up',
    );
    expect(calls.map((call) => call.path)).toEqual(['/facilities/geocode']);
  });

  it('lets the user carry on when coordinates cannot be found', async () => {
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
    const onDone = vi.fn();
    render(
      <FindCoordinates
        session={SESSION}
        scope={{ importBatchId: COUNTERPARTY }}
        doneLabel="Done"
        onDone={onDone}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Coordinates could not be found: Finding coordinates is not set up.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });
});
