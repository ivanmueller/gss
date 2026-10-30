import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MapFacilities, MapFacility } from '../lib/api';
import { mockApi, ORG, SESSION } from '../test/api';
import { CounterpartyMap } from './CounterpartyMap';
import type { FacilityMapProps } from './FacilityMap';

// Mapbox GL JS needs WebGL and Mapbox's servers; a stand-in reports the same events.
vi.mock('./FacilityMap', () => ({
  default: (props: FacilityMapProps) => (
    <div>
      <p>{`Stand-in map: ${props.basemap}, ${props.theme}, ${String(props.pins.length)} pins`}</p>
      <p>{`Fitted to ${props.fitTo?.join(' ') ?? 'nothing'}`}</p>
      <button
        type="button"
        onClick={() => {
          props.onSelect(TERMINAL.id);
        }}
      >
        Click a pin
      </button>
      <button type="button" onClick={props.onTokenRefused}>
        Refuse the token
      </button>
    </div>
  ),
}));

const MAPBOX = { status: 'ok', token: 'pk.synthetic' } as const;
const ELEVATOR: MapFacility = {
  id: '00000000-0000-4000-8000-00000000fac1',
  counterpartyId: '00000000-0000-4000-8000-00000000c001',
  legalName: 'Synthetic Prairie Mills',
  tradingName: null,
  counterpartyTypes: ['buyer'],
  name: 'Synthetic Elevator',
  facilityType: 'elevator',
  city: 'Synthetic Town',
  region: 'SK',
  country: 'CA',
  latitude: '52.133214',
  longitude: '-106.670046',
  locationPrecision: 'exact',
};
const TERMINAL: MapFacility = {
  ...ELEVATOR,
  id: '00000000-0000-4000-8000-00000000fac2',
  counterpartyId: '00000000-0000-4000-8000-00000000c002',
  legalName: 'Synthetic Buyer LLC',
  counterpartyTypes: ['buyer', 'seller'],
  name: null,
  facilityType: 'terminal',
  city: null,
  region: 'MB',
  latitude: '49.000000',
  longitude: '-97.000000',
  locationPrecision: 'approximate',
};

const WORLD = `GET /facilities?organization_id=${ORG.id}&bbox=-180.000000,-90.000000,180.000000,90.000000`;
const BOTH = new Set([ELEVATOR.counterpartyId, TERMINAL.counterpartyId]);

function answer(body: Partial<MapFacilities> = {}) {
  return () =>
    Response.json({
      facilities: [ELEVATOR, TERMINAL],
      truncated: false,
      withoutCoordinates: 1,
      ...body,
    });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CounterpartyMap', () => {
  it('shows every located place of the counterparties shown, fitted to them, once', async () => {
    const calls = mockApi({ [WORLD]: answer() });
    render(<CounterpartyMap session={SESSION} only={BOTH} mapbox={MAPBOX} />);
    expect(await screen.findByText('Stand-in map: map, light, 2 pins')).toBeInTheDocument();
    expect(screen.getByText('Fitted to -106.670046 49 -97 52.133214')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer synthetic-token');
    // No count and no list under the map (owner's request, 2026-10-30).
    expect(screen.queryByText(/in view|no coordinates yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Locations/ })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Map legend' })).toHaveTextContent(
      'BuyerSellerBuyer and seller, broker or carrier',
    );
  });

  it('narrows to the counterparties the filters leave, and refits, without asking again', async () => {
    const calls = mockApi({ [WORLD]: answer() });
    const { rerender } = render(<CounterpartyMap session={SESSION} only={BOTH} mapbox={MAPBOX} />);
    await screen.findByText('Stand-in map: map, light, 2 pins');
    rerender(
      <CounterpartyMap
        session={SESSION}
        only={new Set([TERMINAL.counterpartyId])}
        mapbox={MAPBOX}
      />,
    );
    expect(screen.getByText('Stand-in map: map, light, 1 pins')).toBeInTheDocument();
    expect(screen.getByText('Fitted to -97 49 -97 49')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it('shows the selected pin’s location', async () => {
    mockApi({ [WORLD]: answer() });
    render(<CounterpartyMap session={SESSION} only={BOTH} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Click a pin' }));
    const selected = screen.getByRole('region', { name: 'Selected location' });
    expect(within(selected).getByRole('link', { name: 'Synthetic Buyer LLC' })).toHaveAttribute(
      'href',
      `/counterparties/${TERMINAL.counterpartyId}`,
    );
    expect(selected).toHaveTextContent('Buyer, Seller · Terminal · MB, Canada');
    expect(selected).toHaveTextContent(
      'Approximate location (e.g. the town) · 49.000000, -97.000000',
    );
  });

  it('switches between the street map and satellite', async () => {
    mockApi({ [WORLD]: answer() });
    render(<CounterpartyMap session={SESSION} only={BOTH} mapbox={MAPBOX} />);
    await screen.findByText('Stand-in map: map, light, 2 pins');
    await userEvent.click(screen.getByRole('button', { name: 'Satellite' }));
    expect(screen.getByText('Stand-in map: satellite, light, 2 pins')).toBeInTheDocument();
  });

  it('reports a failed request', async () => {
    mockApi({
      [WORLD]: () =>
        Response.json(
          { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' } },
          { status: 503 },
        ),
    });
    render(<CounterpartyMap session={SESSION} only={BOTH} mapbox={MAPBOX} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The locations could not be loaded: The database is unavailable.',
    );
  });

  it('says what is wrong when Mapbox refuses the token, or there is none', async () => {
    mockApi({ [WORLD]: answer() });
    const { unmount } = render(<CounterpartyMap session={SESSION} only={BOTH} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Refuse the token' }));
    expect(screen.getByText(/Mapbox refused the token/)).toBeInTheDocument();
    unmount();
    const calls = mockApi({});
    render(<CounterpartyMap session={SESSION} only={BOTH} mapbox={{ status: 'missing' }} />);
    expect(screen.getByText(/The map is not set up yet/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
