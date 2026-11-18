import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, SESSION } from '../test/api';
import { FullPageMap } from './FullPageMap';

// The map's code never finishes downloading: its loading message stays up.
vi.mock('./FacilityMap', () => new Promise(() => undefined));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FullPageMap while the map is downloading', () => {
  it('keeps its controls off the loading message (F-238-R1-02)', async () => {
    mockApi({});
    render(<FullPageMap session={SESSION} mapbox={{ status: 'ok', token: 'pk.synthetic' }} />);
    expect(await screen.findByText('Loading map…')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Map style' })).not.toBeInTheDocument();
  });
});
