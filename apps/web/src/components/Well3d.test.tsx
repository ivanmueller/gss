import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FormationAnswer } from '../lib/formationLayers';
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

// The Layers view (F-261 part 2): the ground under the well, 9 cells each way, the same stack
// everywhere: the surface, a thick sandstone, the Duvernay where the well's leg runs, and the
// Precambrian.
const LAYERS = (cells = 81): FormationAnswer => {
  const stack: [number, number, number][] = [
    [1, 898, 880],
    [8, 880, -1050],
    [68, -1050, -1150],
    [90, -1150, -6000],
  ];
  return {
    source: {
      name: 'Alberta Energy Regulator / Alberta Geological Survey, Geological Framework of Alberta, Version 4',
      rocks: 'Alberta Geological Survey (2019), Alberta Table of Formations',
      model: 'Geological Framework of Alberta, Version 4',
      loadedAt: '2026-11-22T22:00:00.000Z',
      sourceDate: '2026-11-02',
    },
    grid: { lonStep: 0.016, latStep: 0.009, x0: -7104, y0: 5918, columns: 9, rows: 9 },
    cells,
    zones:
      cells === 0
        ? []
        : stack.map(([zone, top, base]) => ({
            zone,
            tops: new Array<number>(81).fill(top),
            bases: new Array<number>(81).fill(base),
          })),
  };
};

/** Answers the well and, when asked, the ground's layers; keeps the addresses asked for. */
function serve(layers: FormationAnswer): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      asked.push(input);
      if (input.includes('/petroleum/formation-layers?')) {
        return Promise.resolve(Response.json(layers));
      }
      if (input.includes('/petroleum/st37/well-3d?')) {
        return Promise.resolve(Response.json(answer([leg(UWI), NEAR])));
      }
      return Promise.resolve(Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }));
    }),
  );
  return asked;
}

describe('Well3d, the Layers view', () => {
  it('switches to the ground cut open: every layer under the well, with its rock type', async () => {
    const asked = serve(LAYERS());
    render(view());
    const toggle = await screen.findByRole('button', { name: 'Layers' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Wells' })).toHaveAttribute('aria-pressed', 'true');
    // Nothing of the layers is asked for until the person switches.
    expect(asked.some((address) => address.includes('formation-layers'))).toBe(false);
    fireEvent.click(toggle);
    const list = await screen.findByRole('list', { name: 'Layers under this well' });
    // The box asked for holds the well and its neighbour.
    const layersAsked = asked.find((address) => address.includes('formation-layers')) ?? '';
    const query = new URLSearchParams(layersAsked.split('?')[1]);
    expect(query.get('organization_id')).toBe('org-a');
    expect(Number(query.get('west'))).toBeLessThan(-113.6);
    expect(Number(query.get('east'))).toBeGreaterThan(-113.6);
    expect(Number(query.get('south'))).toBeLessThan(53.3);
    expect(Number(query.get('north'))).toBeGreaterThan(53.31);

    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('p')?.textContent)).toEqual([
      'Sediment above bedrock (surficial deposits)',
      'Wapiti Formation / Brazeau Formation',
      'Duvernay Formation / Muskwa Formation· the play',
      'Precambrian',
    ]);
    // The rock type in the table's own words, the depth to the top and the thickness.
    const duvernay = rows[2];
    expect(duvernay).toHaveAttribute('aria-current', 'true');
    expect(duvernay).toHaveTextContent('Shale and mudstone with subordinate siltstone');
    expect(duvernay).toHaveTextContent('1,948 m');
    expect(duvernay).toHaveTextContent('100 m thick');
    expect(duvernay).toHaveAttribute(
      'title',
      'Rock type as the Table of Formations colours the Duvernay (West-Central Plains)',
    );
    // In words: how many layers, where the play lies, and where the well ends.
    expect(
      screen.getByText(
        /4 layers under this well, from the surface down to the Precambrian at 2,048 m\. The Duvernay Formation \/ Muskwa Formation lies 1,948 m to 2,048 m down here, 100 m thick/,
      ),
    ).toHaveTextContent(
      "The well's deepest point is in the Duvernay Formation / Muskwa Formation.",
    );
    // The Survey is named for the depths and for the rock types.
    expect(
      screen.getByText(/Geological Framework of Alberta, Version 4\. Rock types/),
    ).toHaveTextContent('Alberta Geological Survey (2019), Alberta Table of Formations');
    expect(
      screen.getByRole('img', { name: /with 1 wells nearby, through 4 layers of the ground$/ }),
    ).toBeInTheDocument();

    // Depths as they are, or drawn deeper so thin layers show; the numbers do not change.
    expect(screen.getByText(/True scale · grid/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Depth ×3' }));
    expect(screen.getByText(/Depths drawn ×3 · grid/)).toBeInTheDocument();
    expect(
      screen.getByText(/Deepest point 1,995 m below the surface · longest leg 3,106 m along/),
    ).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')[2]).toHaveTextContent('1,948 m');

    // And back to the wells alone.
    fireEvent.click(screen.getByRole('button', { name: 'Wells' }));
    expect(screen.queryByRole('list', { name: 'Layers under this well' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Depth ×3' })).not.toBeInTheDocument();
    expect(screen.getByText(/True scale · grid/)).toBeInTheDocument();
  });

  it('says so where the layers are not loaded, and keeps showing the wells', async () => {
    serve(LAYERS(0));
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Layers' }));
    expect(
      await screen.findByText(
        /layers are not loaded for this place yet: the wells are shown alone/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Layers under this well' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /under the ground, in 3D/ })).toBeInTheDocument();
  });
});
