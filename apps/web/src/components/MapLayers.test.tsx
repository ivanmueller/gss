import type { LayerInspection, MapLayerView } from '@grain/domain';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  colourExpression,
  readLayerFile,
  useLayerChoice,
  useLayerOverlays,
  OBJECT_ID,
} from '../lib/mapLayers';
import { clearApiCache } from '../lib/useApiResource';
import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
import { MapLayerSettings } from './MapLayerSettings';
import { MapLayersLegend, MapLayersMenu, PickedFeatureCard, useMapLayers } from './MapLayers';

// Map layers (F-107). Every layer, address and value is synthetic.
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
    expect(result.current.notes.get(RAIL)).toBe('Zoom in to see every line here.');
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
    });
    expect(calls.filter((c) => c.path.endsWith('/file'))).toHaveLength(1);
  });
});

function Map() {
  const state = useMapLayers(SESSION);
  return (
    <>
      <MapLayersMenu state={state} />
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
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Synthetic rail lines' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Synthetic elevators' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Layers (2)' })).toBeVisible();
    const legend = screen.getByRole('list', { name: 'Map layers shown' });
    expect(within(legend).getByText('R0')).toBeVisible();
    expect(within(legend).getByText('and 2 more, each its own colour')).toBeVisible();
    expect(within(legend).getAllByRole('link', { name: 'Synthetic publisher' })[0]).toHaveAttribute(
      'href',
      'https://example.com/terms',
    );

    await user.click(screen.getByRole('button', { name: 'Click a shape' }));
    const card = screen.getByRole('region', { name: 'Map layer details' });
    expect(within(card).getByText('Synthetic elevator')).toBeVisible();
    expect(within(card).queryByText('3')).toBeNull();
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
    values: null,
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
    await choose(within(dialog).getByLabelText('Colour by'), 'OWNER');
    expect(await within(dialog).findByText(/2 values, each its own colour/)).toBeVisible();
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
      colour: '#2f6baa',
      colourField: 'OWNER',
      colours: [
        ['AAA', '#e6194b'],
        ['BBB', '#3cb44b'],
      ],
      source: 'web',
      url: SERVICE,
      wmsLayers: null,
    });
    expect(await screen.findByText('Synthetic rail lines')).toBeVisible();
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
