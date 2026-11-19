import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, SESSION } from '../test/api';
import type { FacilityMapProps } from './FacilityMap';
import { CANADA, FullPageMap } from './FullPageMap';

// Mapbox GL JS needs WebGL and Mapbox's servers; a stand-in reports what it was given.
vi.mock('./FacilityMap', () => ({
  default: (props: FacilityMapProps) => (
    <div>
      <p>{`Stand-in map: ${props.basemap}, ${String(props.pins.length)} pins`}</p>
      <p>{`Starts at ${props.start?.join(' ') ?? 'the default view'}`}</p>
      <button type="button" onClick={props.onTokenRefused}>
        Refuse the token
      </button>
    </div>
  ),
}));

const MAPBOX = { status: 'ok', token: 'pk.synthetic' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FullPageMap', () => {
  it('shows an empty map of Canada with map styles, no companies and no grain layers (F-239, F-247)', async () => {
    const calls = mockApi({});
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByText('Stand-in map: map, 0 pins')).toBeInTheDocument();
    expect(screen.getByText(`Starts at ${CANADA.join(' ')}`)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Map style' })).toBeInTheDocument();
    // Neither companies' places nor grain's map layers are asked for or offered.
    expect(calls.some((call) => call.path.startsWith('/facilities'))).toBe(false);
    expect(calls.some((call) => call.path.startsWith('/map-layers'))).toBe(false);
    expect(screen.queryByRole('button', { name: /Layers/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Map legend' })).not.toBeInTheDocument();
  });

  it('starts on the provinces where oil and gas is produced, coast to coast', () => {
    const [west, south, east, north] = CANADA;
    const places = {
      'Fort McMurray': [-111.38, 56.73],
      'Fort St. John': [-120.85, 56.25],
      Estevan: [-102.99, 49.14],
      Vancouver: [-123.12, 49.28],
      "St. John's": [-52.71, 47.56],
      'Point Pelee': [-82.51, 41.91],
      Inuvik: [-133.72, 68.36],
    } as const;
    for (const [name, [lng, lat]] of Object.entries(places)) {
      expect({ name, inside: lng >= west && lng <= east && lat >= south && lat <= north }).toEqual({
        name,
        inside: true,
      });
    }
  });

  it('says what is wrong when there is no Mapbox token, or Mapbox refuses it', async () => {
    mockApi({});
    const { unmount } = render(<FullPageMap session={SESSION} mapbox={{ status: 'missing' }} />);
    expect(screen.getByText(/The map is not set up yet/)).toBeInTheDocument();
    unmount();

    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    (await screen.findByRole('button', { name: 'Refuse the token' })).click();
    expect(await screen.findByText(/Mapbox refused the token/)).toBeInTheDocument();
  });
});
