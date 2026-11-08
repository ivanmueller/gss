import { groupingOf, type LayerInspection, type MapLayerView } from '@grain/domain';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  colourExpression,
  readLayerFile,
  useLayerChoice,
  USUAL_LOOK,
  useLayerOverlays,
  valueFilter,
  settingsTag,
  OBJECT_ID,
} from '../lib/mapLayers';
import { clearApiCache } from '../lib/useApiResource';
import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
import { MapLayerSettings } from './MapLayerSettings';
import {
  MapLayersButton,
  MapLayersLegend,
  MapLayersPanel,
  PickedFeatureCard,
  useMapLayers,
} from './MapLayers';

// Map layers (F-107, F-133 to F-135). Every layer, address and value is synthetic.
const prepare = vi.hoisted(() => vi.fn());
vi.mock('../lib/mapOverview', () => ({ prepareOverview: prepare }));
const RAIL = '00000000-0000-4000-8000-0000000a1a01';
const FILE = '00000000-0000-4000-8000-0000000a1a02';
const SERVICE = 'https://services.example.com/rest/services/Rail/FeatureServer/0';
const LIST = `GET /map-layers?organization_id=${ORG.id}`;

const rail: MapLayerView = {
  id: RAIL,
  name: 'Synthetic rail lines',
  kind: 'arcgis_features',
  url: SERVICE,
  wmsLayers: null,
  sourceName: 'Synthetic publisher',
  termsUrl: 'https://example.com/terms',
  termsNote: 'Public domain.',
  colour: '#2f6baa',
  colourField: 'OWNER',
  colours: Array.from({ length: 10 }, (_, i) => [`R${String(i)}`, `#00000${String(i)}`]),
  fileName: null,
  featureCount: null,
  createdByName: 'Adam Admin',
  createdAt: '2026-11-07T18:00:00Z',
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
const elevators: MapLayerView = {
  ...rail,
  id: FILE,
  name: 'Synthetic elevators',
  kind: 'file',
  url: null,
  colourField: null,
  colours: [],
  fileName: 'elevators.geojson',
  featureCount: 2,
};

beforeEach(() => {
  window.localStorage.clear();
  clearApiCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('colours', () => {
  it('colours by a field’s values, else the file’s own colours, else one colour', () => {
    expect(colourExpression(rail)).toEqual([
      'match',
      ['to-string', ['get', 'OWNER']],
      ...rail.colours.flat(),
      '#2f6baa',
    ]);
    expect(colourExpression(elevators)).toEqual(expect.arrayContaining(['case']));
    expect(colourExpression({ ...rail, colourField: null, colours: [] })).toBe('#2f6baa');
  });
});

describe('reading a file', () => {
  const file = (text: string, name: string) => new File([text], name);

  it('reads GeoJSON', async () => {
    const result = await readLayerFile(
      file(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-105, 50] },
              properties: { N: 'A' },
            },
          ],
        }),
        'points.geojson',
      ),
    );
    expect(result.ok && result.collection.features).toHaveLength(1);
  });

  it('reads KML with its colours', async () => {
    const kml = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Style id="red"><LineStyle><color>ff0000ff</color></LineStyle></Style>
<Placemark><name>Synthetic spur</name><styleUrl>#red</styleUrl>
<LineString><coordinates>-105,50 -104,50.5</coordinates></LineString></Placemark>
</Document></kml>`;
    const result = await readLayerFile(file(kml, 'spur.kml'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collection.features[0]?.properties).toMatchObject({
      name: 'Synthetic spur',
      stroke: '#ff0000',
    });
  });

  it('refuses other files and broken ones', async () => {
    expect((await readLayerFile(file('a,b', 'table.csv'))).ok).toBe(false);
    expect((await readLayerFile(file('{not json', 'broken.geojson'))).ok).toBe(false);
    expect((await readLayerFile(file('', 'map.kmz'))).ok).toBe(false);
  });
});

describe('which layers are on', () => {
  it('remembers each person’s choice in this browser', () => {
    const { result, rerender } = renderHook(({ token }) => useLayerChoice(token), {
      initialProps: { token: 'person-a' },
    });
    act(() => {
      result.current[1](RAIL);
    });
    expect(result.current[0].has(RAIL)).toBe(true);
    rerender({ token: 'person-b' });
    expect(result.current[0].has(RAIL)).toBe(false);
    rerender({ token: 'person-a' });
    expect(result.current[0].has(RAIL)).toBe(true);
    act(() => {
      result.current[1](RAIL);
    });
    expect(result.current[0].has(RAIL)).toBe(false);
  });
});

describe('fetching what is on', () => {
  it('fetches a live layer by map square, merging repeated features and saying when to zoom in', async () => {
    const square = (id: number) => ({
      type: 'FeatureCollection',
      properties: { exceededTransferLimit: true },
      features: [
        {
          type: 'Feature',
          id,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-105, 50],
              [-104, 50],
            ],
          },
          properties: { OWNER: 'R1' },
        },
        {
          type: 'Feature',
          id: 1,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-105, 50],
              [-104, 50],
            ],
          },
          properties: { OWNER: 'R1' },
        },
      ],
    });
    let n = 1;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        n += 1;
        return Promise.resolve(Response.json(square(n)));
      }),
    );
    const view = { bbox: { west: -106, south: 49.5, east: -103, north: 51 }, zoom: 7 };
    const { result } = renderHook(() => useLayerOverlays([rail], view, 'token'));
    await waitFor(() => {
      const overlay = result.current.overlays[0];
      expect(overlay?.kind === 'features' && overlay.data.features.length).toBe(n);
    });
    const overlay = result.current.overlays[0];
    if (overlay?.kind !== 'features') throw new Error('no features');
    expect(new Set(overlay.data.features.map((f): unknown => f.properties?.[OBJECT_ID])).size).toBe(
      overlay.data.features.length,
    );
    expect(result.current.notes.get(RAIL)).toBe(
      'Zoom in to see every line here. An admin can prepare its zoomed-out view on Team → Map layers.',
    );
  });

  it('fetches a file once and draws a picture layer from the API', async () => {
    const calls = mockApi({
      [`GET /map-layers/${FILE}/file`]: () =>
        Response.json({ type: 'FeatureCollection', features: [] }),
    });
    const pictures = {
      ...rail,
      id: RAIL,
      kind: 'wms' as const,
      wmsLayers: 'crops',
      colourField: null,
      colours: [],
    };
    const { result } = renderHook(() => useLayerOverlays([elevators, pictures], null, 'token'));
    await waitFor(() => {
      expect(result.current.overlays).toHaveLength(2);
    });
    expect(result.current.overlays[1]).toEqual({
      id: RAIL,
      kind: 'pictures',
      tiles: `${window.location.origin}/api/v1/map-layers/${RAIL}/tiles/{z}/{x}/{y}.png`,
      look: USUAL_LOOK,
      levels: null,
    });
    expect(calls.filter((c) => c.path.endsWith('/file'))).toHaveLength(1);
  });
});

describe('the zoomed-out view and each railroad on or off', () => {
  const withOverview: MapLayerView = {
    ...rail,
    overview: {
      colourField: 'OWNER',
      grouping: groupingOf({
        colourField: 'OWNER',
        alsoFields: [],
        onlyField: null,
        onlyValues: [],
      }),
      featureCount: 1,
      sourceCount: 100,
      preparedByName: 'Adam Admin',
      preparedAt: '2026-11-07T19:00:00Z',
      version: 'c'.repeat(64),
    },
  };
  const overview = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [-105, 50],
              [-104, 50],
            ],
          ],
        },
        properties: { OWNER: 'R1' },
      },
    ],
  };

  it('draws the zoomed-out view below zoom 7 and live squares from zoom 7', async () => {
    const calls = mockApi({
      [`GET /map-layers/${RAIL}/overview`]: () => Response.json(overview),
    });
    const wide = { bbox: { west: -130, south: 40, east: -60, north: 60 }, zoom: 4 };
    const { result, rerender } = renderHook(
      ({ view }) => useLayerOverlays([withOverview], view, 'token'),
      {
        initialProps: { view: wide },
      },
    );
    await waitFor(() => {
      const first = result.current.overlays[0];
      expect(first?.kind === 'features' && first.data.features).toHaveLength(1);
    });
    expect(calls.map((c) => c.path)).toEqual([`/map-layers/${RAIL}/overview`]);
    expect(result.current.notes.size).toBe(0);
    rerender({ view: { bbox: { west: -105, south: 50, east: -104, north: 50.5 }, zoom: 9 } });
    await waitFor(() => {
      expect(calls.some((c) => c.path.startsWith(`/map-layers/${RAIL}/features/`))).toBe(true);
    });
  });

  it('keeps to live squares when the view was grouped by another field', () => {
    const calls = mockApi({});
    const stale = { ...withOverview, colourField: 'TRACKS' };
    renderHook(() =>
      useLayerOverlays(
        [stale],
        { bbox: { west: -106, south: 49, east: -104, north: 51 }, zoom: 4 },
        'token',
      ),
    );
    expect(calls.some((c) => c.path.endsWith('/overview'))).toBe(false);
  });

  it('filters the map to the values a person shows', () => {
    expect(valueFilter(rail, undefined)).toBeNull();
    expect(valueFilter(rail, { shown: null, others: true })).toBeNull();
    const value = ['to-string', ['get', 'OWNER']];
    expect(valueFilter(rail, { shown: ['R3'], others: false })).toEqual([
      'in',
      value,
      ['literal', ['R3']],
    ]);
    expect(valueFilter(rail, { shown: [], others: true })).toEqual([
      '!',
      ['in', value, ['literal', rail.colours.map(([v]) => v)]],
    ]);
    expect(valueFilter(rail, { shown: [], others: false })).toEqual(['boolean', false]);
    expect(
      valueFilter({ ...rail, colourField: null, colours: [] }, { shown: [], others: false }),
    ).toBeNull();
  });
});

function Map() {
  const state = useMapLayers(SESSION);
  return (
    <>
      <MapLayersButton state={state} />
      <MapLayersPanel state={state} side="left" />
      <MapLayersLegend state={state} />
      <button
        type="button"
        onClick={() => {
          state.setPicked({
            layerId: FILE,
            properties: { NAME: 'Synthetic elevator', [OBJECT_ID]: 3 },
          });
        }}
      >
        Click a shape
      </button>
      <PickedFeatureCard state={state} token={SESSION.token} />
    </>
  );
}

describe('the Layers button', () => {
  it('switches layers on, several at once, with their colours and source under the map', async () => {
    mockApi({
      [LIST]: () => Response.json({ layers: [rail, elevators] }),
      [`GET /map-layers/${FILE}/file`]: () =>
        Response.json({ type: 'FeatureCollection', features: [] }),
    });
    const user = userEvent.setup();
    render(<Map />);
    await user.click(await screen.findByRole('button', { name: 'Layers' }));
    const panel = screen.getByRole('region', { name: 'Map layers' });
    await user.click(await within(panel).findByRole('switch', { name: 'Synthetic rail lines' }));
    await user.click(within(panel).getByRole('switch', { name: 'Synthetic elevators' }));
    expect(screen.getByRole('button', { name: 'Layers (2)' })).toBeVisible();
    const legend = screen.getByRole('list', { name: 'Map layers shown' });
    expect(within(legend).getByText('R0')).toBeVisible();
    expect(within(legend).getByText('and 2 more, each its own colour')).toBeVisible();
    // Colours only under the map: the source is on Team → Map layers (F-139).
    expect(within(legend).queryByText(/Source/)).toBeNull();
    expect(within(legend).queryByRole('link')).toBeNull();

    // One railroad alone (F-133).
    await user.click(
      within(panel).getByRole('button', { name: 'Choose OWNER of Synthetic rail lines' }),
    );
    await user.click(within(panel).getByRole('button', { name: 'Hide all' }));
    expect(within(panel).getByText('0 of 10 shown')).toBeVisible();
    await user.type(within(panel).getByLabelText('Search Synthetic rail lines'), 'r3');
    const values = within(panel).getByRole('list', { name: 'Synthetic rail lines: values' });
    expect(within(values).getAllByRole('checkbox')).toHaveLength(1);
    await user.click(within(values).getByRole('checkbox', { name: 'R3' }));
    expect(within(panel).getByText('1 of 10 shown')).toBeVisible();
    expect(within(legend).getByText('R3')).toBeVisible();
    expect(within(legend).queryByText('R0')).toBeNull();
    expect(within(legend).getByText('(9 hidden in Layers)')).toBeVisible();
    await user.click(within(panel).getByRole('button', { name: 'Show all' }));
    expect(within(legend).getByText('R0')).toBeVisible();
    await user.click(within(panel).getByRole('button', { name: 'Close layers' }));
    expect(screen.queryByRole('region', { name: 'Map layers' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Click a shape' }));
    const card = screen.getByRole('region', { name: 'Map layer details' });
    expect(within(card).getByText('Synthetic elevator')).toBeVisible();
    expect(within(card).queryByText('3')).toBeNull();
  });

  it('shows the railroad of a line clicked in the zoomed-out view (Codex’s review of 8e0fd95)', async () => {
    mockApi({ [LIST]: () => Response.json({ layers: [rail] }) });
    const user = userEvent.setup();
    function Overview() {
      const state = useMapLayers(SESSION);
      return (
        <>
          <MapLayersButton state={state} />
          <MapLayersPanel state={state} side="left" />
          <button
            type="button"
            onClick={() => {
              state.setPicked({ layerId: RAIL, properties: { OWNER: 'R3' } });
            }}
          >
            Click a line
          </button>
          <PickedFeatureCard state={state} token={SESSION.token} />
        </>
      );
    }
    const calls = mockApi({ [LIST]: () => Response.json({ layers: [rail] }) });
    render(<Overview />);
    await user.click(await screen.findByRole('button', { name: 'Layers' }));
    await user.click(await screen.findByRole('switch', { name: 'Synthetic rail lines' }));
    await user.click(screen.getByRole('button', { name: 'Click a line' }));
    const card = screen.getByRole('region', { name: 'Map layer details' });
    expect(within(card).getByText('OWNER')).toBeVisible();
    expect(within(card).getByText('R3')).toBeVisible();
    expect(within(card).queryByText('Loading…')).toBeNull();
    expect(calls.some((c) => c.path.includes('/details/'))).toBe(false);
  });

  it('says when there are no layers yet', async () => {
    mockApi({ [LIST]: () => Response.json({ layers: [] }) });
    const user = userEvent.setup();
    render(<Map />);
    await user.click(await screen.findByRole('button', { name: 'Layers' }));
    expect(await screen.findByText(/No map layers yet/)).toBeVisible();
  });
});

describe('Team → Map layers', () => {
  const inspection: LayerInspection = {
    kind: 'arcgis_features',
    url: SERVICE,
    wmsLayers: null,
    title: 'Synthetic Rail Lines',
    copyright: 'Public domain.',
    fields: ['OWNER', 'TRACKS'],
    drawing: null,
    values: null,
    count: 302774,
  };

  it('adds a web layer coloured by a field, each value its own colour', async () => {
    let layers: MapLayerView[] = [];
    const calls = mockApi({
      [LIST]: () => Response.json({ layers }),
      [`POST /map-layers/inspect?organization_id=${ORG.id}`]: ({ body }) =>
        Response.json(
          (body as { field: string | null }).field === null
            ? inspection
            : {
                ...inspection,
                values: [
                  { value: 'BBB', count: 2 },
                  { value: 'AAA', count: 9 },
                ],
              },
        ),
      [`POST /map-layers?organization_id=${ORG.id}`]: () => {
        layers = [rail];
        return Response.json({ id: RAIL }, { status: 201 });
      },
    });
    prepare.mockImplementation(
      (
        _layer: unknown,
        _token: string,
        progress: (p: { stage: 'reading'; done: number; total: number }) => void,
      ) => {
        progress({ stage: 'reading', done: 8000, total: 302774 });
        return Promise.resolve({ features: 2, pieces: 302774 });
      },
    );
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    expect(await screen.findByText(/No map layers yet/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add map layer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add map layer' });
    await user.type(within(dialog).getByLabelText('Web address'), SERVICE);
    await user.click(within(dialog).getByRole('button', { name: 'Check' }));
    expect(await within(dialog).findByText(/Found: ArcGIS layer/)).toBeVisible();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Synthetic Rail Lines');
    expect(within(dialog).getByLabelText('What the terms allow')).toHaveValue('Public domain.');
    expect(within(dialog).getByRole('button', { name: 'Add layer' })).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Published by'), 'Synthetic publisher');
    await user.type(
      within(dialog).getByLabelText('Link to its terms of use'),
      'https://example.com/terms',
    );
    expect(within(dialog).getByLabelText('Colour')).toBeVisible();
    await choose(within(dialog).getByLabelText('Colour by'), 'OWNER');
    expect(await within(dialog).findByText(/2 values, each its own colour/)).toBeVisible();
    // Coloured by a field, the rest are grey: no colour to choose (F-135).
    expect(within(dialog).queryByLabelText('Colour')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Add layer' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const saved = calls.find((c) => c.method === 'POST' && c.path.startsWith('/map-layers?'));
    expect(saved?.body).toEqual({
      name: 'Synthetic Rail Lines',
      sourceName: 'Synthetic publisher',
      termsUrl: 'https://example.com/terms',
      termsNote: 'Public domain.',
      colour: '#9ca3af',
      colourField: 'OWNER',
      colours: [
        ['AAA', '#e6194b'],
        ['BBB', '#3cb44b'],
      ],
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
      alsoFields: [],
      onlyField: null,
      onlyValues: [],
    });
    expect(await screen.findByText('Synthetic rail lines')).toBeVisible();
    // Its zoomed-out view is prepared straight away (F-134).
    expect(prepare).toHaveBeenCalledWith(
      { id: RAIL, colourField: 'OWNER', alsoFields: [], onlyField: null, onlyValues: [] },
      SESSION.token,
      expect.any(Function),
    );
  });

  it('says when the layer was added but its zoomed-out view could not be prepared', async () => {
    mockApi({
      [LIST]: () => Response.json({ layers: [] }),
      [`POST /map-layers/inspect?organization_id=${ORG.id}`]: () => Response.json(inspection),
      [`POST /map-layers?organization_id=${ORG.id}`]: () =>
        Response.json({ id: RAIL }, { status: 201 }),
    });
    prepare.mockRejectedValueOnce(new Error('The map service could not be reached.'));
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(await screen.findByRole('button', { name: 'Add map layer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add map layer' });
    await user.type(within(dialog).getByLabelText('Web address'), SERVICE);
    await user.click(within(dialog).getByRole('button', { name: 'Check' }));
    await user.type(await within(dialog).findByLabelText('Published by'), 'P');
    await user.type(
      within(dialog).getByLabelText('Link to its terms of use'),
      'https://example.com/t',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add layer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The layer was added. Its zoomed-out view could not be prepared: The map service could not be reached.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('changes what a layer is coloured by, and prepares its zoomed-out view again', async () => {
    const tracks: MapLayerView = {
      ...rail,
      colourField: 'TRACKS',
      colours: [['1', '#e6194b']],
      overview: {
        colourField: 'TRACKS',
        grouping: groupingOf({
          colourField: 'TRACKS',
          alsoFields: [],
          onlyField: null,
          onlyValues: [],
        }),
        featureCount: 3,
        sourceCount: 300,
        preparedByName: 'Adam Admin',
        preparedAt: '2026-11-07T19:00:00Z',
        version: 'a'.repeat(64),
      },
    };
    const calls = mockApi({
      [LIST]: () => Response.json({ layers: [tracks] }),
      [`POST /map-layers/inspect?organization_id=${ORG.id}`]: ({ body }) =>
        Response.json(
          (body as { field: string | null }).field === null
            ? inspection
            : { ...inspection, values: [{ value: 'CN', count: 9 }] },
        ),
      [`PATCH /map-layers/${RAIL}`]: () => Response.json({ id: RAIL }),
    });
    prepare.mockResolvedValue({ features: 1, pieces: 300 });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    expect(await screen.findByText(/Zoomed-out view: 3 lines from 300 pieces/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Synthetic rail lines' });
    await user.click(within(dialog).getByRole('button', { name: 'Change' }));
    await choose(await within(dialog).findByLabelText('Colour by'), 'OWNER');
    expect(await within(dialog).findByText(/1 values, each its own colour/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      version: 'v1',
      name: 'Synthetic rail lines',
      sourceName: 'Synthetic publisher',
      termsUrl: 'https://example.com/terms',
      termsNote: 'Public domain.',
      wmsLayers: null,
      colour: '#9ca3af',
      colourField: 'OWNER',
      colours: [['CN', '#e6194b']],
      alsoFields: [],
      onlyField: null,
      onlyValues: [],
    });
    expect(prepare).toHaveBeenCalledWith(
      { id: RAIL, colourField: 'OWNER', alsoFields: [], onlyField: null, onlyValues: [] },
      SESSION.token,
      expect.any(Function),
    );
  });

  it('prepares a zoomed-out view from the list', async () => {
    mockApi({ [LIST]: () => Response.json({ layers: [rail] }) });
    prepare.mockResolvedValue({ features: 1, pieces: 300 });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    expect(await screen.findByText(/No zoomed-out view yet/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Prepare zoomed-out view' }));
    await waitFor(() => {
      expect(prepare).toHaveBeenCalledWith(rail, SESSION.token, expect.any(Function));
    });
  });

  it('removes a layer for everyone after asking', async () => {
    let layers = [rail];
    const calls = mockApi({
      [LIST]: () => Response.json({ layers }),
      [`POST /map-layers/${RAIL}/remove`]: () => {
        layers = [];
        return Response.json({ id: RAIL });
      },
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    expect(await screen.findByText(/Added by Adam Admin/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove for everyone' }));
    expect(await screen.findByText(/No map layers yet/)).toBeVisible();
    expect(calls.find((c) => c.path === `/map-layers/${RAIL}/remove`)?.body).toEqual({
      version: 'v1',
    });
  });
});

// A railroad's lines as on ArcGIS (F-137).
describe('shared track and limits', () => {
  const railFields = ['RROWNER1', 'RROWNER2', 'RROWNER3', 'TRKRGHTS1', 'TRKRGHTS2', 'NET'];
  const shared: MapLayerView = {
    ...rail,
    colourField: 'RROWNER1',
    colours: [
      ['UP', '#4363d8'],
      ['CPKC', '#f58231'],
    ],
    alsoFields: ['RROWNER2', 'TRKRGHTS1'],
  };

  it('shows a line under every railroad of its fields, in the chosen railroad’s colour', () => {
    const choice = { shown: ['CPKC'], others: false };
    expect(valueFilter(shared, choice)).toEqual([
      'any',
      ['in', '|CPKC|', ['to-string', ['get', '__values']]],
    ]);
    expect(colourExpression(shared, choice)).toEqual([
      'case',
      ['in', '|CPKC|', ['to-string', ['get', '__values']]],
      '#f58231',
      ['match', ['to-string', ['get', 'RROWNER1']], 'UP', '#4363d8', 'CPKC', '#f58231', '#2f6baa'],
    ]);
    // With every railroad shown, each line in its first owner's colour.
    expect(colourExpression(shared, { shown: null, others: true })).toEqual([
      'match',
      ['to-string', ['get', 'RROWNER1']],
      'UP',
      '#4363d8',
      'CPKC',
      '#f58231',
      '#2f6baa',
    ]);
  });

  it('gives live pieces their railroads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Response.json({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 5,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-95.4, 29.8],
                  [-95.3, 29.9],
                ],
              },
              properties: { RROWNER1: 'UP', RROWNER2: null, TRKRGHTS1: 'CPKC' },
            },
          ],
        }),
      ),
    );
    const view = { bbox: { west: -95.45, south: 29.75, east: -95.25, north: 29.95 }, zoom: 7 };
    const { result } = renderHook(() => useLayerOverlays([shared], view, 'token'));
    await waitFor(() => {
      const first = result.current.overlays[0];
      expect(first?.kind === 'features' && first.data.features[0]?.properties?.__values).toBe(
        '|UP|CPKC|',
      );
    });
  });

  it('draws a zoomed-out view only while it was built under the layer’s settings, numbering its lines afresh', async () => {
    const grouping = groupingOf(shared);
    const built = {
      colourField: 'RROWNER1',
      grouping,
      featureCount: 2,
      sourceCount: 4,
      preparedByName: 'Adam Admin',
      preparedAt: '2026-11-08T03:00:00Z',
      version: 'd'.repeat(64),
    };
    const line = {
      type: 'Feature',
      id: 1,
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-95, 30],
            [-94, 30],
          ],
        ],
      },
      properties: { RROWNER1: 'UP', __values: '|UP|CPKC|' },
    };
    const calls = mockApi({
      [`GET /map-layers/${RAIL}/overview`]: () =>
        Response.json({ type: 'FeatureCollection', features: [line, line] }),
    });
    const wide = { bbox: { west: -130, south: 20, east: -60, north: 60 }, zoom: 3 };
    const { result } = renderHook(() =>
      useLayerOverlays([{ ...shared, overview: built }], wide, 'token'),
    );
    await waitFor(() => {
      const first = result.current.overlays[0];
      expect(first?.kind === 'features' && first.data.features.map((f) => f.id)).toEqual([1, 2]);
    });
    expect(calls.map((c) => c.path)).toEqual([`/map-layers/${RAIL}/overview`]);
    // Built without the shared fields: not drawn; live squares instead.
    const stale = mockApi({});
    renderHook(() =>
      useLayerOverlays(
        [
          {
            ...shared,
            overview: { ...built, grouping: groupingOf({ ...shared, alsoFields: [] }) },
          },
        ],
        wide,
        'token',
      ),
    );
    expect(stale.some((c) => c.path.endsWith('/overview'))).toBe(false);
  });

  it('applies the publisher’s railroad settings from Edit, counting values again and preparing the view', async () => {
    const tracks: MapLayerView = { ...rail, colourField: 'TRACKS', colours: [['1', '#e6194b']] };
    const calls = mockApi({
      [LIST]: () => Response.json({ layers: [tracks] }),
      [`POST /map-layers/inspect?organization_id=${ORG.id}`]: ({ body }) =>
        Response.json({
          kind: 'arcgis_features',
          url: SERVICE,
          wmsLayers: null,
          title: 'North American Rail Network Lines',
          copyright: null,
          fields: railFields,
          values:
            (body as { field: string | null }).field === null
              ? null
              : [{ value: 'CPKC', count: 9 }],
          count: 300000,
          drawing: null,
        } satisfies LayerInspection),
      [`PATCH /map-layers/${RAIL}`]: () => Response.json({ id: RAIL }),
    });
    prepare.mockResolvedValue({ features: 1, pieces: 300 });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    expect(await screen.findByText(SERVICE)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Synthetic rail lines' });
    await user.click(within(dialog).getByRole('button', { name: 'Change' }));
    await user.click(
      await within(dialog).findByRole('button', { name: 'Use ArcGIS’s railroad settings' }),
    );
    expect(
      await within(dialog).findByText(
        'Now: also counts RROWNER2, RROWNER3, TRKRGHTS1, TRKRGHTS2; only where NET is M or I.',
      ),
    ).toBeVisible();
    const counted = calls.filter((c) => c.path.startsWith('/map-layers/inspect')).at(-1);
    expect(counted?.body).toEqual({
      url: SERVICE,
      field: 'RROWNER1',
      alsoFields: ['RROWNER2', 'RROWNER3', 'TRKRGHTS1', 'TRKRGHTS2'],
      onlyField: 'NET',
      onlyValues: ['M', 'I'],
    });
    expect(await within(dialog).findByText(/1 values, each its own colour/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      colourField: 'RROWNER1',
      alsoFields: ['RROWNER2', 'RROWNER3', 'TRKRGHTS1', 'TRKRGHTS2'],
      onlyField: 'NET',
      onlyValues: ['M', 'I'],
    });
    expect(prepare).toHaveBeenCalledWith(
      {
        id: RAIL,
        colourField: 'RROWNER1',
        alsoFields: ['RROWNER2', 'RROWNER3', 'TRKRGHTS1', 'TRKRGHTS2'],
        onlyField: 'NET',
        onlyValues: ['M', 'I'],
      },
      SESSION.token,
      expect.any(Function),
    );
  });

  it('fetches squares afresh, at a new address, when the layer’s settings change (Codex’s review of bb488a9)', async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        asked.push(input);
        const owner = asked.length <= 2 && !input.includes(settingsTag(shared)) ? 'OLD' : 'NEW';
        return Promise.resolve(
          Response.json({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 5,
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [-95.4, 29.8],
                    [-95.3, 29.9],
                  ],
                },
                properties: { RROWNER1: owner, TRKRGHTS1: 'CPKC' },
              },
            ],
          }),
        );
      }),
    );
    const view = { bbox: { west: -95.45, south: 29.75, east: -95.25, north: 29.95 }, zoom: 7 };
    const before: MapLayerView = { ...shared, alsoFields: [] };
    const { result, rerender } = renderHook(
      ({ layer }) => useLayerOverlays([layer], view, 'token'),
      {
        initialProps: { layer: before },
      },
    );
    await waitFor(() => {
      const first = result.current.overlays[0];
      expect(first?.kind === 'features' && first.data.features.length).toBe(1);
    });
    const firstAsked = [...asked];
    expect(firstAsked.every((u) => u.includes(`?g=${settingsTag(before)}`))).toBe(true);
    rerender({ layer: shared });
    await waitFor(() => {
      const first = result.current.overlays[0];
      expect(first?.kind === 'features' && first.data.features[0]?.properties?.__values).toBe(
        '|NEW|CPKC|',
      );
    });
    expect(
      asked.slice(firstAsked.length).every((u) => u.includes(`?g=${settingsTag(shared)}`)),
    ).toBe(true);
    expect(settingsTag(before)).not.toBe(settingsTag(shared));
  });

  it('gives every distinct filter its own address (Codex’s review of da6c543)', () => {
    const base = { colourField: 'OWNER', alsoFields: ['RIGHTS'], onlyField: 'NET' };
    expect(settingsTag({ ...base, onlyValues: ['th9o7l'] })).not.toBe(
      settingsTag({ ...base, onlyValues: ['7tlz1e'] }),
    );
  });

  it('tidies live values as a checked view does, so they colour and filter alike at every zoom', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Response.json({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 5,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-95.4, 29.8],
                  [-95.3, 29.9],
                ],
              },
              properties: { RROWNER1: 'A\tB', TRKRGHTS1: 'CPKC' },
            },
            {
              type: 'Feature',
              id: 6,
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-95.4, 29.85],
                  [-95.3, 29.95],
                ],
              },
              // Codex's review of 2693859: a cut ending in a space.
              properties: { RROWNER1: `${'A'.repeat(499)} B`, TRKRGHTS1: 'CPKC' },
            },
          ],
        }),
      ),
    );
    const view = { bbox: { west: -95.45, south: 29.75, east: -95.25, north: 29.95 }, zoom: 7 };
    const { result } = renderHook(() => useLayerOverlays([shared], view, 'token'));
    await waitFor(() => {
      const first = result.current.overlays[0];
      expect(first?.kind === 'features' && first.data.features[0]?.properties).toMatchObject({
        RROWNER1: 'A B',
        __values: '|A B|CPKC|',
      });
      expect(first?.kind === 'features' && first.data.features[1]?.properties).toMatchObject({
        RROWNER1: 'A'.repeat(499),
        __values: `|${'A'.repeat(499)}|CPKC|`,
      });
    });
  });
});
