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
      <button
        type="button"
        onClick={() => {
          props.onViewChange?.({ west: -110, south: 49, east: -95, north: 60 });
        }}
      >
        Move to the prairies
      </button>
      <button
        type="button"
        onClick={() => {
          props.onViewChange?.({ west: -100, south: 49, east: -97, north: 50 });
        }}
      >
        Zoom in
      </button>
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

const path = (bbox: string) => `GET /facilities?organization_id=${ORG.id}&bbox=${bbox}`;
const PRAIRIES = path('-110.000000,49.000000,-95.000000,60.000000');
const ZOOMED = path('-100.000000,49.000000,-97.000000,50.000000');
const WORLD = path('-180.000000,-90.000000,180.000000,90.000000');

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

describe('CounterpartyMap with a Mapbox token', () => {
  it('asks for the locations in view once the map reports it, with the user’s token', async () => {
    const calls = mockApi({ [PRAIRIES]: answer() });
    render(<CounterpartyMap session={SESSION} type={null} only={null} mapbox={MAPBOX} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Move to the prairies' }));
    expect(
      await screen.findByText(
        '2 locations in view. 1 location has no coordinates yet, so it is not on the map.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Stand-in map: map, light, 2 pins')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer synthetic-token');

    const list = screen.getByRole('list', { name: 'Locations in view' });
    expect(within(list).getByRole('link', { name: 'Synthetic Prairie Mills' })).toHaveAttribute(
      'href',
      `/counterparties/${ELEVATOR.counterpartyId}`,
    );
    expect(list).toHaveTextContent(
      'Buyer · Synthetic Elevator · Synthetic Town, SK, Canada · Exact location',
    );
    expect(list).toHaveTextContent('Buyer, Seller · Terminal · MB, Canada · Approximate location');
    expect(screen.getByRole('list', { name: 'Map legend' })).toHaveTextContent(
      'BuyerSellerBuyer and seller, broker or carrier',
    );
  });

  it('shows the selected pin’s location', async () => {
    mockApi({ [PRAIRIES]: answer() });
    render(<CounterpartyMap session={SESSION} type={null} only={null} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move to the prairies' }));
    await screen.findByText(/2 locations in view/);

    await userEvent.click(screen.getByRole('button', { name: 'Click a pin' }));
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

  it('keeps the pins of the last view while the next one loads', async () => {
    mockApi({ [PRAIRIES]: answer(), [ZOOMED]: () => new Promise<Response>(() => undefined) });
    render(<CounterpartyMap session={SESSION} type={null} only={null} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move to the prairies' }));
    await screen.findByText(/2 locations in view/);

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('Stand-in map: map, light, 2 pins')).toBeInTheDocument();
  });

  it('switches between the street map and satellite', async () => {
    mockApi({});
    render(<CounterpartyMap session={SESSION} type={null} only={null} mapbox={MAPBOX} />);
    const satellite = screen.getByRole('button', { name: 'Satellite' });
    expect(satellite).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(satellite);
    expect(satellite).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Stand-in map: satellite, light, 0 pins')).toBeInTheDocument();
  });

  it('says when the locations were cut at the limit', async () => {
    mockApi({ [PRAIRIES]: answer({ truncated: true, withoutCoordinates: 0 }) });
    render(<CounterpartyMap session={SESSION} type={null} only={null} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move to the prairies' }));
    expect(
      await screen.findByText(
        '2 locations in view. Only the first 2 are shown; zoom in to see the rest.',
      ),
    ).toBeInTheDocument();
  });

  it('reports a failed request', async () => {
    mockApi({
      [PRAIRIES]: () =>
        Response.json(
          { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' } },
          { status: 503 },
        ),
    });
    render(<CounterpartyMap session={SESSION} type={null} only={null} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Move to the prairies' }));
    expect(
      await screen.findByText('The locations could not be loaded: The database is unavailable.'),
    ).toBeInTheDocument();
  });

  it('falls back to the list when Mapbox refuses the token', async () => {
    mockApi({ [WORLD]: answer() });
    render(<CounterpartyMap session={SESSION} type={null} only={null} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Refuse the token' }));

    expect(screen.getByText(/Mapbox refused the token/)).toBeInTheDocument();
    expect(screen.queryByText(/Stand-in map/)).not.toBeInTheDocument();
    expect(await screen.findByText(/2 locations have coordinates/)).toBeInTheDocument();
  });
});

describe('CounterpartyMap without a usable Mapbox token', () => {
  it('lists every location and says the map is not set up', async () => {
    mockApi({ [WORLD]: answer() });
    render(
      <CounterpartyMap session={SESSION} type={null} only={null} mapbox={{ status: 'missing' }} />,
    );

    expect(screen.getByText(/The map is not set up yet/)).toBeInTheDocument();
    expect(
      await screen.findByText(
        '2 locations have coordinates. 1 location has no coordinates yet, so it is not on the map.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Locations' })).toHaveTextContent(
      'Synthetic Buyer LLC',
    );
    expect(screen.queryByRole('group', { name: 'Map style' })).not.toBeInTheDocument();
  });

  it('says when the built-in token is not a public token', () => {
    mockApi({ [WORLD]: answer() });
    render(
      <CounterpartyMap session={SESSION} type={null} only={null} mapbox={{ status: 'invalid' }} />,
    );
    expect(screen.getByText(/is not a public token/)).toBeInTheDocument();
  });
});

describe('CounterpartyMap and locations without coordinates', () => {
  it('offers operations and admin members to find coordinates', async () => {
    mockApi({ [WORLD]: answer() });
    render(
      <CounterpartyMap session={SESSION} type={null} only={null} mapbox={{ status: 'missing' }} />,
    );
    expect(
      await screen.findByRole('link', { name: 'Find coordinates from addresses' }),
    ).toHaveAttribute('href', '/counterparties/coordinates');
  });

  it('does not offer it to other members, or when every location has coordinates', async () => {
    mockApi({ [WORLD]: answer() });
    const viewer = { ...SESSION, organization: { ...ORG, role: 'viewer' } };
    const { unmount } = render(
      <CounterpartyMap session={viewer} type={null} only={null} mapbox={{ status: 'missing' }} />,
    );
    await screen.findByText(/2 locations have coordinates/);
    expect(screen.queryByRole('link', { name: /Find coordinates/ })).not.toBeInTheDocument();
    unmount();

    mockApi({ [WORLD]: answer({ withoutCoordinates: 0 }) });
    render(
      <CounterpartyMap session={SESSION} type={null} only={null} mapbox={{ status: 'missing' }} />,
    );
    await screen.findByText('2 locations have coordinates.');
    expect(screen.queryByRole('link', { name: /Find coordinates/ })).not.toBeInTheDocument();
  });
});

describe('CounterpartyMap filters', () => {
  it('asks only for the chosen side’s locations', async () => {
    const calls = mockApi({ [`${WORLD}&type=seller`]: answer({ facilities: [TERMINAL] }) });
    render(
      <CounterpartyMap
        session={SESSION}
        type="seller"
        only={null}
        mapbox={{ status: 'missing' }}
      />,
    );
    expect(await screen.findByText(/1 location has coordinates/)).toBeInTheDocument();
    expect(calls[0]?.path).toBe(`${WORLD.replace('GET ', '')}&type=seller`);
  });

  it('narrows the pins and the list to the counterparties a search found', async () => {
    mockApi({ [PRAIRIES]: answer() });
    render(
      <CounterpartyMap
        session={SESSION}
        type={null}
        only={new Set([TERMINAL.counterpartyId])}
        mapbox={MAPBOX}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Move to the prairies' }));
    expect(await screen.findByText(/^1 location in view\./)).toBeInTheDocument();
    expect(screen.getByText('Stand-in map: map, light, 1 pins')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Locations in view' })).not.toHaveTextContent(
      'Synthetic Prairie Mills',
    );
  });
});
