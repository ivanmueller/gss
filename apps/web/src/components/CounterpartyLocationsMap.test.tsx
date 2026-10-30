import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Facility } from '../lib/api';
import { CounterpartyLocationsMap, locationPins } from './CounterpartyLocationsMap';
import type { FacilityMapProps } from './FacilityMap';

// Mapbox GL JS needs WebGL and Mapbox's servers; a stand-in shows what the map was given.
vi.mock('./FacilityMap', () => ({
  default: (props: FacilityMapProps) => (
    <div>
      <p>{`Stand-in map: ${props.basemap}, ${String(props.pins.length)} pins`}</p>
      <p>{`Starts on ${props.start?.join(' ') ?? 'the default view'}, at most zoom ${String(props.startMaxZoom)}`}</p>
      <p>{props.cooperative ? 'Two fingers to move' : 'Moves with the page'}</p>
      <button
        type="button"
        onClick={() => {
          props.onSelect('f1');
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

function facility(id: string, changes: Partial<Facility> = {}): Facility {
  return {
    id,
    name: `Synthetic ${id}`,
    facilityType: 'elevator',
    addressLine: null,
    city: 'Synthetic Town',
    region: 'SK',
    postalCode: null,
    country: 'CA',
    latitude: '52.133214',
    longitude: '-106.670046',
    locationPrecision: 'exact',
    geocodingSource: 'manual',
    transportAccess: null,
    version: '2026-10-27T14:05:00.000000Z',
    ...changes,
  };
}

describe('locationPins', () => {
  it('pins located places in the counterparty’s colour, hollow unless exact', () => {
    expect(
      locationPins(
        [
          facility('f1'),
          facility('f2', {
            locationPrecision: 'approximate',
            latitude: '49.5',
            longitude: '-97.1',
          }),
          facility('f3', { latitude: null, longitude: null, locationPrecision: null }),
        ],
        ['seller'],
      ),
    ).toEqual([
      { id: 'f1', latitude: 52.133214, longitude: -106.670046, tone: 'offer', hollow: false },
      { id: 'f2', latitude: 49.5, longitude: -97.1, tone: 'offer', hollow: true },
    ]);
  });
});

describe('CounterpartyLocationsMap', () => {
  it('starts in satellite view on its locations, close in for exact ones', async () => {
    const onSelect = vi.fn();
    render(
      <CounterpartyLocationsMap
        facilities={[facility('f1')]}
        types={['buyer']}
        selectedId={null}
        onSelect={onSelect}
        mapbox={MAPBOX}
      />,
    );
    expect(await screen.findByText('Stand-in map: satellite, 1 pins')).toBeInTheDocument();
    expect(
      screen.getByText('Starts on -106.670046 52.133214 -106.670046 52.133214, at most zoom 15'),
    ).toBeInTheDocument();
    // A small map on a long page: the page scrolls past it.
    expect(screen.getByText('Two fingers to move')).toBeInTheDocument();
    expect(screen.getByText('Its location on the map.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Satellite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByText('Stand-in map: map, 1 pins')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Click a pin' }));
    expect(onSelect).toHaveBeenCalledWith('f1');
  });

  it('shows towns as towns, and says which locations have no coordinates', async () => {
    render(
      <CounterpartyLocationsMap
        facilities={[
          facility('f1'),
          facility('f2', {
            locationPrecision: 'approximate',
            latitude: '49.5',
            longitude: '-97.1',
          }),
          facility('f3', { latitude: null, longitude: null, locationPrecision: null }),
        ]}
        types={['buyer']}
        selectedId={null}
        onSelect={vi.fn()}
        mapbox={MAPBOX}
      />,
    );
    expect(
      await screen.findByText('Starts on -106.670046 49.5 -97.1 52.133214, at most zoom 11'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('2 of 3 locations on the map; the others have no coordinates yet.'),
    ).toBeInTheDocument();
  });

  it('is not shown without coordinates, without a token, or when Mapbox refuses it', async () => {
    const unlocated = [facility('f3', { latitude: null, longitude: null })];
    const { container, rerender } = render(
      <CounterpartyLocationsMap
        facilities={unlocated}
        types={['buyer']}
        selectedId={null}
        onSelect={vi.fn()}
        mapbox={MAPBOX}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <CounterpartyLocationsMap
        facilities={[facility('f1')]}
        types={['buyer']}
        selectedId={null}
        onSelect={vi.fn()}
        mapbox={{ status: 'missing' }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <CounterpartyLocationsMap
        facilities={[facility('f1')]}
        types={['buyer']}
        selectedId={null}
        onSelect={vi.fn()}
        mapbox={MAPBOX}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Refuse the token' }));
    expect(container).toBeEmptyDOMElement();
  });
});
