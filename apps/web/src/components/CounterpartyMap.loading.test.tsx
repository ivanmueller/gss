import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { CounterpartyMap } from './CounterpartyMap';

// The map's code never finishes downloading: its loading message stays up.
vi.mock('./FacilityMap', () => new Promise(() => undefined));

const MAPBOX = { status: 'ok', token: 'pk.synthetic' } as const;
const WORLD = `GET /facilities?organization_id=${ORG.id}&bbox=-180.000000,-90.000000,180.000000,90.000000`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CounterpartyMap while the map is downloading', () => {
  it('keeps the full-page controls off the loading message (F-238-R2-01)', async () => {
    const calls = mockApi({
      [WORLD]: () => Response.json({ facilities: [], truncated: false, withoutCoordinates: 0 }),
    });
    render(<CounterpartyMap session={SESSION} fullPage mapbox={MAPBOX} />);
    // The places have arrived; the map's code has not.
    await vi.waitFor(() => {
      expect(calls.some((call) => call.path.startsWith('/facilities'))).toBe(true);
    });
    // Let the answer be read and shown (the map's own loading message then takes over).
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(screen.getByText('Loading map…')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Map style' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Map legend' })).not.toBeInTheDocument();
  });
});
