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
  it('shows an empty map of Canada with map styles and layers, and no companies (F-239)', async () => {
    const calls = mockApi({});
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByText('Stand-in map: map, 0 pins')).toBeInTheDocument();
    expect(screen.getByText(`Starts at ${CANADA.join(' ')}`)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Map style' })).toBeInTheDocument();
    // No company's places are asked for or shown; only the team's map layers.
    expect(calls.some((call) => call.path.startsWith('/facilities'))).toBe(false);
    expect(calls.some((call) => call.path.startsWith('/map-layers'))).toBe(true);
    expect(screen.queryByRole('list', { name: 'Map legend' })).not.toBeInTheDocument();
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
