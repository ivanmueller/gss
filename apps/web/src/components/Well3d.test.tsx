import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Well3dAnswer, Well3dLeg } from '../lib/well3d';
import { mockApi } from '../test/api';
import { clearWell3dCache, Well3d } from './Well3d';

// A well under the ground, in 3D, on its panel (F-261). Made-up wells only. jsdom draws
// nothing: the picture itself is checked on staging; here, what is asked for and what is said.

const UWI = '00/09-07-030-26W4/0';
const PATH = `GET /petroleum/st37/well-3d?organization_id=org-a&uwi=${encodeURIComponent(UWI)}`;

const leg = (uwi: string, extra: Partial<Well3dLeg> = {}): Well3dLeg => ({
  uwi,
  licenceNumber: '0509395',
  licensee: 'Example Energy Ltd.',
  statusClass: 'producing',
  surveyed: true,
  own: true,
  points: [
    [-113.6, 53.3, 900],
    [-113.6, 53.3, -1100],
    [-113.6, 53.31, -1100],
  ],
  ...extra,
});

const answer = (legs: Well3dLeg[]): Well3dAnswer => ({
  source: { name: 'Alberta Energy Regulator, ST37 List of Wells in Alberta', loadedAt: null },
  well: {
    uwi: UWI,
    licenceNumber: '0509395',
    surface: [-113.6, 53.3],
    kbElevationM: 900,
    groundElevationM: 895,
  },
  nearbyKm: 3,
  truncated: false,
  legs,
});

const NEAR = leg('00/01-08-030-26W4/0', {
  own: false,
  licenceNumber: '0509400',
  statusClass: 'abandoned',
  surveyed: false,
});

const view = () => <Well3d uwi={UWI} organizationId="org-a" token="token" />;

beforeEach(() => {
  // jsdom has no canvas to draw on.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  clearWell3dCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Well3d', () => {
  it('shows the well with its depth, its length and the wells nearby', async () => {
    const calls = mockApi({ [PATH]: () => Response.json(answer([leg(UWI), NEAR])) });
    render(view());
    expect(screen.getByText('The well in 3D: loading…')).toBeInTheDocument();
    const picture = await screen.findByRole('img', {
      name: `Well ${UWI} under the ground, in 3D: 1 leg, down to 1,995 m below the surface, with 1 wells nearby`,
    });
    expect(picture.tagName).toBe('CANVAS');
    expect(calls.map((call) => call.headers.get('Authorization'))).toEqual(['Bearer token']);
    // 2,000 m down and about 1,106 m out; nothing is stretched.
    expect(
      screen.getByText(/Deepest point 1,995 m below the surface · longest leg 3,106 m along/),
    ).toBeInTheDocument();
    expect(screen.getByText(/True scale · grid/)).toBeInTheDocument();
    expect(screen.getByText('Wells within 3 km')).toBeInTheDocument();
    expect(screen.getByText('Paths as surveyed.', { exact: false })).toBeInTheDocument();
    // The statuses drawn, each with its colour.
    const statuses = screen.getByRole('list', { name: 'Statuses' });
    expect(statuses).toHaveTextContent('Producing or injecting');
    expect(statuses).toHaveTextContent('Abandoned');
    expect(screen.getByText(/Drag to turn/)).toBeInTheDocument();
  });

  it('hides the other wells when asked', async () => {
    mockApi({ [PATH]: () => Response.json(answer([leg(UWI), NEAR])) });
    render(view());
    fireEvent.click(await screen.findByRole('checkbox'));
    expect(
      screen.getByRole('img', {
        name: `Well ${UWI} under the ground, in 3D: 1 leg, down to 1,995 m below the surface`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Statuses' })).not.toHaveTextContent('Abandoned');
  });

  it('says when a leg is a path the AER worked out', async () => {
    mockApi({ [PATH]: () => Response.json(answer([leg(UWI, { surveyed: false })])) });
    render(view());
    expect(
      await screen.findByText(/A dashed leg is a path the AER worked out, not a survey\./),
    ).toBeInTheDocument();
    // No other well: no switch for them.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('opens large over the map and closes again, also with Escape', async () => {
    mockApi({ [PATH]: () => Response.json(answer([leg(UWI)])) });
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Expand' }));
    expect(screen.getByRole('dialog', { name: `Well ${UWI} in 3D` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says so when the well has no path with depths, or cannot be read', async () => {
    mockApi({ [PATH]: () => Response.json(answer([NEAR])) });
    const first = render(view());
    expect(
      await screen.findByText(/No drilled path with depths for this well yet/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    first.unmount();
    clearWell3dCache();
    mockApi({});
    render(view());
    expect(await screen.findByText('The well in 3D could not be loaded.')).toBeInTheDocument();
  });
});
