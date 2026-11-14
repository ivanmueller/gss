import type { FreightEnd } from '@grain/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FacilityMapProps } from './FacilityMap';
import { FreightRouteMap, routePins } from './FreightRouteMap';

// Mapbox GL JS needs WebGL and Mapbox's servers; a stand-in shows what the map was given.
vi.mock('./FacilityMap', () => ({
  default: (props: FacilityMapProps) => (
    <p>{`Stand-in map: ${props.pins.map((pin) => `${String(pin.latitude)},${String(pin.longitude)}${pin.hollow ? ' hollow' : ''}`).join(' | ')}`}</p>
  ),
}));

const MAPBOX = { status: 'ok', token: 'pk.synthetic' } as const;

// Synthetic places only.
const TOWN_A: FreightEnd = {
  kind: 'area',
  text: 'Synthetic Town A, MB',
  region: 'CA-MB',
  point: { latitude: '49.354000', longitude: '-97.365000', precision: 'approximate' },
};
const TOWN_B: FreightEnd = { kind: 'area', text: 'Synthetic Town B', region: 'US-IN', point: null };
const SAVED: FreightEnd = {
  kind: 'facility',
  id: '00000000-0000-4000-8000-000000000f01',
  name: 'Synthetic Mill',
  city: 'Synthetic Town',
  region: 'MN',
  country: 'US',
  counterparty: {
    id: '00000000-0000-4000-8000-00000000c001',
    legalName: 'Synthetic Buyer',
    archived: false,
  },
};

describe('FreightRouteMap (F-235)', () => {
  it('pins only the towns found on the map, hollow when approximate', () => {
    expect(routePins([TOWN_A, TOWN_B, SAVED])).toEqual([
      { id: 'end-0', latitude: 49.354, longitude: -97.365, tone: 'mixed', hollow: true },
    ]);
  });

  it('shows the towns found, and nothing when none is', async () => {
    const { rerender } = render(
      <FreightRouteMap origin={TOWN_A} destination={TOWN_B} mapbox={MAPBOX} />,
    );
    expect(await screen.findByText('Stand-in map: 49.354,-97.365 hollow')).toBeInTheDocument();
    rerender(<FreightRouteMap origin={SAVED} destination={TOWN_B} mapbox={MAPBOX} />);
    expect(screen.queryByRole('region', { name: 'Map of the route’s towns' })).toBeNull();
  });
});
