import type { LayerInspection, MapLayerView } from '@grain/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearApiCache } from '../lib/useApiResource';
import { mockApi, ORG, SESSION } from '../test/api';
import type { FacilityMapProps } from './FacilityMap';
import { CANADA, FullPageMap } from './FullPageMap';

// Mapbox GL JS needs WebGL and Mapbox's servers; a stand-in reports what it was given.
vi.mock('./FacilityMap', () => ({
  default: (props: FacilityMapProps) => (
    <div>
      <p>{`Stand-in map: ${props.basemap}, ${String(props.pins.length)} pins`}</p>
      <p>{`Starts at ${props.start?.join(' ') ?? 'the default view'}`}</p>
      <p>{`Drawn: ${(props.overlays ?? []).map((o) => (o.kind === 'pictures' ? o.tiles : o.id)).join(' ') || 'nothing'}`}</p>
      <button type="button" onClick={props.onTokenRefused}>
        Refuse the token
      </button>
    </div>
  ),
}));

// A zoomed-out view is never prepared on the oil and gas side: the test fails if it is tried.
const prepare = vi.hoisted(() => vi.fn());
vi.mock('../lib/mapOverview', () => ({ prepareOverview: prepare }));

const MAPBOX = { status: 'ok', token: 'pk.synthetic' } as const;
const ORGANIZATION = `organization_id=${ORG.id}`;
const LIST = `GET /petroleum/layers?${ORGANIZATION}`;
const SERVICE = 'https://services.example.com/rest/services/Land/MapServer/8';
const PICTURES = '00000000-0000-4000-8000-0000000a1a01';
const LINES = '00000000-0000-4000-8000-0000000a1a02';

/** Every layer, address and value is synthetic. */
const pictures: MapLayerView = {
  id: PICTURES,
  name: 'Synthetic townships',
  kind: 'arcgis_image',
  url: 'https://services.example.com/rest/services/Grid/MapServer',
  wmsLayers: null,
  sourceName: 'Synthetic publisher',
  termsUrl: 'https://example.com/terms',
  termsNote: 'Open licence.',
  colour: '#2f6baa',
  colourField: null,
  colours: [],
  fileName: null,
  featureCount: null,
  createdByName: null,
  createdAt: '2026-11-19T18:00:00Z',
  version: 'v1',
  alsoFields: [],
  onlyField: null,
  onlyValues: [],
  overview: null,
  lineWidth: null,
  opacity: 1,
  minZoom: null,
  maxZoom: null,
  definitionExpression: null,
  othersShown: true,
  map: null,
  mapVisible: true,
  tileLevels: null,
};
const offAtFirst: MapLayerView = {
  ...pictures,
  id: LINES,
  name: 'Synthetic agreements',
  mapVisible: false,
};

function listOf(...layers: MapLayerView[]) {
  return () => Response.json({ layers });
}

const noLegend = {
  [`GET /petroleum/layers/${PICTURES}/legend?${ORGANIZATION}`]: () =>
    Response.json({ entries: [] }),
  [`GET /petroleum/layers/${LINES}/legend?${ORGANIZATION}`]: () => Response.json({ entries: [] }),
};

beforeEach(() => {
  clearApiCache();
  window.localStorage.clear();
  prepare.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FullPageMap', () => {
  it('shows a map of Canada with map styles, no companies and only oil and gas layers (F-239, F-247)', async () => {
    const calls = mockApi({ [LIST]: listOf(), ...noLegend });
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByText('Stand-in map: map, 0 pins')).toBeInTheDocument();
    expect(screen.getByText(`Starts at ${CANADA.join(' ')}`)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Map style' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Layers' })).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((call) => call.path.startsWith('/petroleum/layers'))).toBe(true);
    });
    // Neither companies' places nor grain's map layers are asked for.
    expect(calls.some((call) => call.path.startsWith('/facilities'))).toBe(false);
    expect(calls.some((call) => call.path.startsWith('/map-layers'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Layers' }));
    expect(screen.getByText('No map layers yet. Admins add them in Settings.')).toBeInTheDocument();
  });

  it('starts each visit from the admin’s choice, and remembers no switching (the owner, 2026-11-19)', async () => {
    const calls = mockApi({ [LIST]: listOf(pictures, offAtFirst), ...noLegend });
    const first = render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Layers (1)' }));
    const panel = screen.getByRole('region', { name: 'Map layers' });
    const on = within(panel).getByRole('switch', { name: /Synthetic townships/ });
    const off = within(panel).getByRole('switch', { name: /Synthetic agreements/ });
    expect(on).toBeChecked();
    expect(off).not.toBeChecked();
    // Its pictures are asked for under the oil and gas routes, naming the organization.
    expect(
      screen.getByText(
        `Drawn: ${window.location.origin}/api/v1/petroleum/layers/${PICTURES}/tiles/{z}/{x}/{y}.png?${ORGANIZATION}`,
      ),
    ).toBeInTheDocument();

    await userEvent.click(on);
    await userEvent.click(off);
    expect(on).not.toBeChecked();
    expect(off).toBeChecked();
    expect(screen.getByRole('button', { name: 'Layers (1)' })).toBeInTheDocument();
    expect(screen.getByText(/Drawn: .*a1a02\/tiles/)).toBeInTheDocument();

    // Opened again: the admin's choice, not the person's last switches. Nothing was stored.
    first.unmount();
    expect(window.localStorage.length).toBe(0);
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByText(/Drawn: .*a1a01\/tiles/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Layers (1)' })).toBeInTheDocument();
    // Every request names the organization (F-247-2-D1-04).
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.path).toContain(ORGANIZATION);
  });

  it('offers Settings to admins only', async () => {
    mockApi({ [LIST]: listOf(), ...noLegend });
    const { unmount } = render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument();
    unmount();
    for (const role of ['viewer', 'analyst', 'trader', 'operations']) {
      const view = render(
        <FullPageMap session={{ ...SESSION, organization: { ...ORG, role } }} mapbox={MAPBOX} />,
      );
      expect(await screen.findByRole('button', { name: 'Layers' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('adds a layer in Settings and removes it, the open map following (F-247-2-D1-02, D1-03)', async () => {
    let kept: MapLayerView[] = [];
    const inspection: LayerInspection = {
      kind: 'arcgis_features',
      url: SERVICE,
      wmsLayers: null,
      title: 'Synthetic agreements',
      copyright: 'Open licence.',
      fields: ['STATUS'],
      values: null,
      count: 12,
      drawing: null,
    };
    const added: MapLayerView = {
      ...pictures,
      id: LINES,
      name: 'Synthetic agreements',
      kind: 'arcgis_features',
      url: SERVICE,
    };
    const calls = mockApi({
      [LIST]: () => Response.json({ layers: kept }),
      [`POST /petroleum/layers/inspect?${ORGANIZATION}`]: () => Response.json(inspection),
      [`POST /petroleum/layers?${ORGANIZATION}`]: () => {
        kept = [added];
        return Response.json({ id: LINES }, { status: 201 });
      },
      [`POST /petroleum/layers/${LINES}/remove?${ORGANIZATION}`]: () => {
        kept = [];
        return Response.json({ id: LINES });
      },
    });
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Map settings' });
    expect(
      await within(settings).findByText(/No map layers yet. Add one from a web address;/),
    ).toBeInTheDocument();

    await userEvent.click(within(settings).getByRole('button', { name: 'Add map layer' }));
    const form = await screen.findByRole('dialog', { name: 'Add map layer' });
    // Only web addresses of live ArcGIS layers: no file, no whole ArcGIS map.
    expect(within(form).queryByRole('group', { name: 'Where the layer comes from' })).toBeNull();
    expect(within(form).getByText(/A live ArcGIS layer:/)).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Web address'), SERVICE);
    await userEvent.click(within(form).getByRole('button', { name: 'Check' }));
    await within(form).findByText(/Found:/);
    await userEvent.type(within(form).getByLabelText('Published by'), 'Synthetic publisher');
    await userEvent.type(
      within(form).getByLabelText('Link to its terms of use'),
      'https://example.com/terms',
    );
    const atOpen = within(form).getByRole('checkbox', { name: 'On when the map opens' });
    expect(atOpen).not.toBeChecked();
    await userEvent.click(atOpen);
    await userEvent.click(within(form).getByRole('button', { name: 'Add layer' }));

    // Saved with the admin's choice, without a zoomed-out view; the form closes normally.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add map layer' })).not.toBeInTheDocument();
    });
    const create = calls.find(
      (c) => c.method === 'POST' && c.path === `/petroleum/layers?${ORGANIZATION}`,
    );
    expect(create?.body).toMatchObject({ source: 'web', url: SERVICE, mapVisible: true });
    expect(prepare).not.toHaveBeenCalled();
    expect(calls.some((c) => /\/(count|pages|overview)/.test(c.path))).toBe(false);
    // The list in Settings and the map's own list were both read again.
    expect(await within(settings).findByText('Synthetic agreements')).toBeInTheDocument();
    expect(within(settings).getByText(/On when the map opens\./)).toBeInTheDocument();
    expect(within(settings).queryByText(/Added by/)).not.toBeInTheDocument();
    expect(within(settings).queryByRole('button', { name: /zoomed-out view/ })).toBeNull();
    expect(await screen.findByText(`Drawn: ${LINES}`)).toBeInTheDocument();

    await userEvent.click(within(settings).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(settings).getByRole('button', { name: 'Remove for everyone' }));
    expect(await screen.findByText('Drawn: nothing')).toBeInTheDocument();
    for (const call of calls) expect(call.path).toContain(ORGANIZATION);
    expect(calls.some((call) => call.path.startsWith('/map-layers'))).toBe(false);
  });

  it('changes a layer’s opening default in Settings, the open map following (F-247-2-D1-02)', async () => {
    const lines: MapLayerView = {
      ...pictures,
      id: LINES,
      name: 'Synthetic agreements',
      kind: 'arcgis_features',
      url: SERVICE,
      mapVisible: false,
    };
    let kept = [lines];
    const calls = mockApi({
      [LIST]: () => Response.json({ layers: kept }),
      [`PATCH /petroleum/layers/${LINES}?${ORGANIZATION}`]: () => {
        kept = [{ ...lines, mapVisible: true, version: 'v2' }];
        return Response.json({ id: LINES });
      },
    });
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByText('Drawn: nothing')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Map settings' });
    expect(await within(settings).findByText(/Off when the map opens\./)).toBeInTheDocument();
    await userEvent.click(within(settings).getByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('dialog', { name: 'Edit Synthetic agreements' });
    await userEvent.click(within(form).getByRole('checkbox', { name: 'On when the map opens' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    // Saved and closed normally, with no zoomed-out view prepared.
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Edit Synthetic agreements' }),
      ).not.toBeInTheDocument();
    });
    const change = calls.find((c) => c.method === 'PATCH');
    expect(change?.body).toMatchObject({ version: 'v1', mapVisible: true, wmsLayers: null });
    expect(prepare).not.toHaveBeenCalled();
    expect(await within(settings).findByText(/On when the map opens\./)).toBeInTheDocument();
    // Nobody switched it this visit, so the map follows the new default at once.
    expect(await screen.findByText(`Drawn: ${LINES}`)).toBeInTheDocument();
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
    mockApi({ [LIST]: listOf() });
    const { unmount } = render(<FullPageMap session={SESSION} mapbox={{ status: 'missing' }} />);
    expect(screen.getByText(/The map is not set up yet/)).toBeInTheDocument();
    unmount();

    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    (await screen.findByRole('button', { name: 'Refuse the token' })).click();
    expect(await screen.findByText(/Mapbox refused the token/)).toBeInTheDocument();
  });
});
