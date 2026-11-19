import type { LayerInspection, MapLayerView } from '@grain/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearApiCache } from '../lib/useApiResource';
import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
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
      <button
        type="button"
        onClick={() =>
          props.onOverlayClick?.({ layerId: LINES_ID, properties: { STATUS: 'Active' } })
        }
      >
        Click a shape
      </button>
      <p>{`Asked again: ${String(props.layersRetry ?? 0)}`}</p>
      <button type="button" onClick={() => props.onLayersStale?.('missing')}>
        A picture is refused
      </button>
      <button type="button" onClick={() => props.onLayersStale?.('refused')}>
        The person is refused
      </button>
      <button
        type="button"
        onClick={() => props.onViewChange?.({ west: -115, south: 50, east: -110, north: 54 }, 7)}
      >
        Move the map
      </button>
    </div>
  ),
}));

const LINES_ID = '00000000-0000-4000-8000-0000000a1a02';

// A zoomed-out view is never prepared on the oil and gas side: the test fails if it is tried.
const prepare = vi.hoisted(() => vi.fn());
vi.mock('../lib/mapOverview', () => ({ prepareOverview: prepare }));

// The Settings tests type whole addresses into forms: slow when the whole suite runs at once.
vi.setConfig({ testTimeout: 20_000 });

const MAPBOX = { status: 'ok', token: 'pk.synthetic' } as const;
const ORGANIZATION = `organization_id=${ORG.id}`;
const LIST = `GET /petroleum/layers?${ORGANIZATION}`;
const SERVICE = 'https://services.example.com/rest/services/Land/MapServer/8';
const PICTURES = '00000000-0000-4000-8000-0000000a1a01';
const LINES = LINES_ID;

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
  [`GET /petroleum/layers/${PICTURES}/legend?c=2&${ORGANIZATION}`]: () =>
    Response.json({ entries: [] }),
  [`GET /petroleum/layers/${LINES}/legend?c=2&${ORGANIZATION}`]: () =>
    Response.json({ entries: [] }),
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
        `Drawn: ${window.location.origin}/api/v1/petroleum/layers/${PICTURES}/tiles/{z}/{x}/{y}.png?c=2&${ORGANIZATION}`,
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

  // F-247-2-R15-01: a layer added in one colour with a limit ("Only where"): choosing the
  // limit counts again without starting the form over, and the limit is saved with the layer.
  it('adds a one-colour layer with its limit', async () => {
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
    const calls = mockApi({
      [LIST]: listOf(),
      [`POST /petroleum/layers/inspect?${ORGANIZATION}`]: () => Response.json(inspection),
      [`POST /petroleum/layers?${ORGANIZATION}`]: () =>
        Response.json({ id: LINES }, { status: 201 }),
    });
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Map settings' });
    await userEvent.click(await within(settings).findByRole('button', { name: 'Add map layer' }));
    const form = await screen.findByRole('dialog', { name: 'Add map layer' });
    await userEvent.type(within(form).getByLabelText('Web address'), SERVICE);
    await userEvent.click(within(form).getByRole('button', { name: 'Check' }));
    await within(form).findByText(/Found:/);
    await userEvent.type(within(form).getByLabelText('Published by'), 'Synthetic publisher');
    await userEvent.type(
      within(form).getByLabelText('Link to its terms of use'),
      'https://example.com/terms',
    );
    // Colour by stays "One colour"; the limit is chosen and typed.
    await userEvent.click(within(form).getByText('Shared track and limits (optional)'));
    await choose(within(form).getByLabelText('Only where'), 'STATUS');
    const values = await within(form).findByLabelText('is one of');
    await userEvent.type(values, 'Active');
    await userEvent.tab();
    // Counted again under the limit, and the limit is still in the form.
    await waitFor(() => {
      const counts = calls.filter((c) => c.path === `/petroleum/layers/inspect?${ORGANIZATION}`);
      expect(counts.at(-1)?.body).toMatchObject({
        field: null,
        onlyField: 'STATUS',
        onlyValues: ['Active'],
      });
    });
    expect(within(form).getByLabelText('is one of')).toHaveValue('Active');
    expect(within(form).getByLabelText('Published by')).toHaveValue('Synthetic publisher');

    await userEvent.click(within(form).getByRole('button', { name: 'Add layer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add map layer' })).not.toBeInTheDocument();
    });
    const create = calls.find(
      (c) => c.method === 'POST' && c.path === `/petroleum/layers?${ORGANIZATION}`,
    );
    expect(create?.body).toMatchObject({
      colourField: null,
      alsoFields: [],
      onlyField: 'STATUS',
      onlyValues: ['Active'],
    });
  });

  // F-247-2-R14-02: a layer in one colour with a limit ("Only where") keeps the limit when an
  // admin edits something else about it.
  it('keeps a one-colour layer’s limit when only its opening default is changed', async () => {
    const limited: MapLayerView = {
      ...pictures,
      id: LINES,
      name: 'Synthetic agreements',
      kind: 'arcgis_features',
      url: SERVICE,
      mapVisible: false,
      colourField: null,
      onlyField: 'NET',
      onlyValues: ['M'],
    };
    const calls = mockApi({
      [LIST]: listOf(limited),
      [`PATCH /petroleum/layers/${LINES}?${ORGANIZATION}`]: () => Response.json({ id: LINES }),
    });
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Map settings' });
    await userEvent.click(await within(settings).findByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('dialog', { name: 'Edit Synthetic agreements' });
    await userEvent.click(within(form).getByRole('checkbox', { name: 'On when the map opens' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      mapVisible: true,
      colourField: null,
      alsoFields: [],
      onlyField: 'NET',
      onlyValues: ['M'],
    });
  });

  // F-247-2-R3-02: both sit at the bottom left over the map; the legend makes way.
  it('hides the legend while a clicked shape’s details are open', async () => {
    const lines: MapLayerView = {
      ...pictures,
      id: LINES,
      name: 'Synthetic agreements',
      kind: 'arcgis_features',
      url: SERVICE,
      colourField: 'STATUS',
      colours: [['Active', '#e6194b']],
    };
    mockApi({ [LIST]: listOf(lines) });
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByRole('list', { name: 'Map layers shown' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Click a shape' }));
    const close = await screen.findByRole('button', { name: 'Close details' });
    expect(screen.queryByRole('list', { name: 'Map layers shown' })).not.toBeInTheDocument();
    await userEvent.click(close);
    expect(await screen.findByRole('list', { name: 'Map layers shown' })).toBeInTheDocument();
  });

  // F-247-2-R9-02: an admin removes a picture layer while a teammate has the map open. The
  // map reports its picture refused; the list is read again and the layer leaves the map.
  it('reads the list again when a picture is refused, and draws only what it holds', async () => {
    let listed = [pictures];
    const calls = mockApi({ [LIST]: () => Response.json({ layers: listed }), ...noLegend });
    const lists = () => calls.filter((call) => `${call.method} ${call.path}` === LIST).length;
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByText(/Drawn: .*a1a01.tiles/)).toBeInTheDocument();
    expect(lists()).toBe(1);

    listed = [];
    await userEvent.click(screen.getByRole('button', { name: 'A picture is refused' }));
    expect(await screen.findByText('Drawn: nothing')).toBeInTheDocument();
    expect(lists()).toBe(2);
    // Not once per refused picture: a view asks for many at once.
    await userEvent.click(screen.getByRole('button', { name: 'A picture is refused' }));
    await userEvent.click(screen.getByRole('button', { name: 'A picture is refused' }));
    expect(lists()).toBe(2);
  });

  // F-247-2-R10-01: a second layer removed just after the first. Its refusal comes during the
  // pause after the first re-read: the list is read once more when the pause ends.
  it('reads the list once more after the pause for a refusal that came during it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      const second: MapLayerView = { ...pictures, id: LINES, name: 'Synthetic agreements' };
      let listed = [pictures, second];
      const calls = mockApi({ [LIST]: () => Response.json({ layers: listed }), ...noLegend });
      const lists = () => calls.filter((call) => `${call.method} ${call.path}` === LIST).length;
      render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
      expect(await screen.findByText(/Drawn: .*a1a01.tiles.*a1a02.tiles/)).toBeInTheDocument();

      listed = [second];
      await user.click(screen.getByRole('button', { name: 'A picture is refused' }));
      await waitFor(() => {
        expect(screen.queryByText(/Drawn: .*a1a01.tiles/)).not.toBeInTheDocument();
      });
      expect(lists()).toBe(2);

      listed = [];
      await user.click(screen.getByRole('button', { name: 'A picture is refused' }));
      expect(lists()).toBe(2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await screen.findByText('Drawn: nothing')).toBeInTheDocument();
      expect(lists()).toBe(3);
      // The same list read again changes nothing, and nothing more is asked.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(lists()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  // F-247-2-R12-02: a square or picture refused ("not a member"), and access back before the
  // list is read again: the list comes back the same, so nothing else would ask again. The map
  // is told to, standing still. A layer merely missing is not asked for again by itself.
  it('asks the map again for what a refusal let go once the list is read well', async () => {
    const calls = mockApi({ [LIST]: listOf(pictures), ...noLegend });
    const lists = () => calls.filter((call) => `${call.method} ${call.path}` === LIST).length;
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByText(/Drawn: .*a1a01.tiles/)).toBeInTheDocument();
    expect(screen.getByText('Asked again: 0')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'The person is refused' }));
    expect(await screen.findByText('Asked again: 1')).toBeInTheDocument();
    expect(lists()).toBe(2);
    expect(screen.getByText(/Drawn: .*a1a01.tiles/)).toBeInTheDocument();
  });

  // F-247-2-R12-02 (round 13): grain's database answers "not found" to a suspended member, so
  // a "not found" followed by the same list read well also has the map ask again; but only once
  // a minute, so a layer that is listed yet keeps answering "not found" ends there.
  it('asks the map again after a "not found" too, and not in a circle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      const calls = mockApi({ [LIST]: listOf(pictures), ...noLegend });
      const lists = () => calls.filter((call) => `${call.method} ${call.path}` === LIST).length;
      render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
      expect(await screen.findByText(/Drawn: .*a1a01.tiles/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'A picture is refused' }));
      expect(await screen.findByText('Asked again: 1')).toBeInTheDocument();
      expect(lists()).toBe(2);

      // "Not found" again within the minute (a second suspension and return, or a layer that
      // keeps answering so): the list is read once more, and the map is told to ask again when
      // the minute ends, not at once and not never (F-247-2-R14-01).
      await user.click(screen.getByRole('button', { name: 'A picture is refused' }));
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => {
        expect(lists()).toBe(3);
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(lists()).toBe(3);
      expect(screen.getByText('Asked again: 1')).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(await screen.findByText('Asked again: 2')).toBeInTheDocument();
      // And nothing more by itself after that.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(lists()).toBe(3);
      expect(screen.getByText('Asked again: 2')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // F-247-2-R13-02: with many layers on, the legend keeps to the space under the buttons and
  // scrolls there; the buttons sit above it.
  it('keeps a long legend under the buttons, scrolling', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...pictures,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Synthetic layer ${String(i)}`,
    }));
    mockApi({ [LIST]: listOf(...many) });
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    const legend = await screen.findByRole('list', { name: 'Map layers shown' });
    expect(within(legend).getAllByRole('listitem')).toHaveLength(30);
    const box = legend.parentElement;
    expect(box?.className).toMatch(/\bmax-h-\[calc\(100%-9rem\)\]/);
    expect(box?.className).toMatch(/\boverflow-y-auto\b/);
    const buttons = screen.getByRole('button', { name: 'Layers (30)' }).parentElement;
    expect(buttons?.className).toMatch(/\bz-20\b/);
    expect(box?.className).toMatch(/\bz-10\b/);
  });

  // F-247-2-R9-01: a member suspended, then restored, with the map open. While the list is
  // refused there are no layers to ask about; moving the map asks for the list again.
  it('asks for the list again when the map moves after it was refused', async () => {
    let member = false;
    const calls = mockApi({
      [LIST]: () =>
        member
          ? Response.json({ layers: [pictures] })
          : Response.json(
              {
                error: { code: 'FORBIDDEN', message: 'You are not a member of this organization.' },
              },
              { status: 403 },
            ),
      ...noLegend,
    });
    const lists = () => calls.filter((call) => `${call.method} ${call.path}` === LIST).length;
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    await waitFor(() => {
      expect(lists()).toBe(1);
    });
    expect(screen.getByText('Drawn: nothing')).toBeInTheDocument();

    member = true;
    await userEvent.click(screen.getByRole('button', { name: 'Move the map' }));
    expect(await screen.findByText(/Drawn: .*a1a01.tiles/)).toBeInTheDocument();
    expect(lists()).toBe(2);
    // Read well: moving the map asks for nothing more.
    await userEvent.click(screen.getByRole('button', { name: 'Move the map' }));
    expect(lists()).toBe(2);
  });

  // F-247-2-R17-01: a picture layer's legend is not shown from the page's memory. Switched
  // off, access removed, switched back on: nothing of it shows, at once or after the refusal,
  // and the refusal has the list read again.
  it('shows no kept legend when a picture layer is switched back on and refused', async () => {
    let member = true;
    const calls = mockApi({
      [LIST]: listOf(pictures),
      [`GET /petroleum/layers/${PICTURES}/legend?c=2&${ORGANIZATION}`]: () =>
        member
          ? Response.json({ entries: [{ label: 'Synthetic township', image: null }] })
          : Response.json(
              {
                error: { code: 'FORBIDDEN', message: 'You are not a member of this organization.' },
              },
              { status: 403 },
            ),
    });
    const lists = () => calls.filter((call) => `${call.method} ${call.path}` === LIST).length;
    const legends = () => calls.filter((call) => call.path.includes('/legend')).length;
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    expect(await screen.findByText('Synthetic township')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Layers (1)' }));
    const panel = screen.getByRole('region', { name: 'Map layers' });
    const layer = within(panel).getByRole('switch', { name: /Synthetic townships/ });
    await userEvent.click(layer);
    expect(screen.queryByText('Synthetic township')).not.toBeInTheDocument();

    member = false;
    const before = legends();
    await userEvent.click(layer);
    // Not from memory while the Worker is asked...
    expect(screen.queryByText('Synthetic township')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(legends()).toBe(before + 1);
    });
    // ...nor after it refused; and the list is read again.
    await waitFor(() => {
      expect(lists()).toBe(2);
    });
    expect(screen.queryByText('Synthetic township')).not.toBeInTheDocument();
  });

  // F-247-2-R9-03: a clicked shape's details go with its layer, not kept for when it is back.
  it('forgets a clicked shape’s details when its layer is switched off', async () => {
    const lines: MapLayerView = {
      ...pictures,
      id: LINES,
      name: 'Synthetic agreements',
      kind: 'arcgis_features',
      url: SERVICE,
      colourField: 'STATUS',
      colours: [['Active', '#e6194b']],
    };
    mockApi({ [LIST]: listOf(lines) });
    render(<FullPageMap session={SESSION} mapbox={MAPBOX} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Layers (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Click a shape' }));
    expect(await screen.findByRole('region', { name: 'Map layer details' })).toBeInTheDocument();

    const panel = screen.getByRole('region', { name: 'Map layers' });
    const layer = within(panel).getByRole('switch', { name: /Synthetic agreements/ });
    await userEvent.click(layer);
    expect(screen.queryByRole('region', { name: 'Map layer details' })).not.toBeInTheDocument();
    await userEvent.click(layer);
    expect(layer).toBeChecked();
    expect(screen.queryByRole('region', { name: 'Map layer details' })).not.toBeInTheDocument();
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
