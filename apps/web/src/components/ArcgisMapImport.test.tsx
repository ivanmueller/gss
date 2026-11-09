import type { MapLayerView } from '@grain/domain';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  choiceOf,
  lookOf,
  shownAtZoom,
  USUAL_LOOK,
  useLayerOverlays,
  useValueChoices,
} from '../lib/mapLayers';
import { clearApiCache } from '../lib/useApiResource';
import { mockApi, ORG, SESSION } from '../test/api';
import { MapLayerSettings } from './MapLayerSettings';
import { MapLayersLegend, MapLayersPanel, panelEntries, type MapLayersState } from './MapLayers';

// Layers from an ArcGIS map, as ArcGIS presents them (F-138). Every map, service and value is
// synthetic.
const prepare = vi.hoisted(() => vi.fn());
vi.mock('../lib/mapOverview', () => ({ prepareOverview: prepare }));

const MAP = '96ec03e4fc8546bd8a864e39a2c3fc41';
const OTHER_ITEM = 'a'.repeat(32);
const CPKC = 'https://services.example.com/x/ArcGIS/rest/services/Rail_CPKC/FeatureServer/0';
const OTHER = 'https://services.example.com/x/ArcGIS/rest/services/Rail_Other/FeatureServer/0';
const Q = `?organization_id=${ORG.id}`;

const WEB_MAP = {
  operationalLayers: [
    {
      layerType: 'ArcGISFeatureLayer',
      title: 'Synthetic passenger lines',
      featureCollection: {
        layers: [
          {
            layerDefinition: {
              geometryType: 'esriGeometryPolyline',
              extent: { spatialReference: { wkid: 102100 } },
              drawingInfo: {
                renderer: {
                  type: 'simple',
                  symbol: { type: 'esriSLS', color: [0, 197, 255, 255], width: 0.75 },
                },
              },
            },
            featureSet: {
              geometryType: 'esriGeometryPolyline',
              features: [
                {
                  attributes: { FID: 1 },
                  geometry: {
                    paths: [
                      [
                        [0, 0],
                        [111319.49, 0],
                      ],
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      layerType: 'ArcGISFeatureLayer',
      title: 'Synthetic other lines',
      url: OTHER,
      itemId: OTHER_ITEM,
    },
    {
      layerType: 'ArcGISFeatureLayer',
      title: 'Synthetic CPKC',
      url: CPKC,
      layerDefinition: {
        definitionExpression: "NET IN ('M','I')",
        drawingInfo: {
          renderer: {
            type: 'simple',
            symbol: { type: 'esriSLS', color: [255, 115, 223, 255], width: 0.998 },
          },
        },
      },
    },
    { layerType: 'VectorTileLayer', title: 'Synthetic labels' },
  ],
};

const OTHER_ITEM_DATA = {
  layers: [
    {
      id: 0,
      layerDefinition: {
        drawingInfo: {
          renderer: {
            type: 'simple',
            symbol: { type: 'esriSLS', color: [153, 153, 153, 255], width: 0.998 },
          },
        },
      },
    },
  ],
};

function inspection(url: string) {
  return {
    kind: 'arcgis_features',
    url,
    wmsLayers: null,
    title: 'Synthetic',
    copyright: null,
    fields: ['OWNER', 'NET'],
    values: null,
    count: url === OTHER ? 174875 : 13168,
    // The service's own purple, which the item's grey replaces.
    drawing: {
      renderer: { type: 'simple', symbol: { type: 'esriSLS', color: [128, 0, 128, 255] } },
      transparency: 0,
      minScale: null,
      maxScale: null,
    },
  };
}

beforeEach(() => {
  clearApiCache();
  prepare.mockReset();
  prepare.mockResolvedValue({ features: 1, pieces: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Team → Map layers → Add map layer → ArcGIS map', () => {
  it('adds a map’s layers bottom to top as ArcGIS draws them', async () => {
    let next = 0;
    const calls = mockApi({
      [`GET /map-layers${Q}`]: () => Response.json({ layers: [] }),
      [`POST /map-layers/arcgis-item${Q}`]: ({ body }) => {
        const { itemId, part } = body as { itemId: string; part: string };
        if (itemId === MAP && part === 'info') {
          return Response.json({
            id: MAP,
            title: 'Synthetic rail map',
            type: 'Web Map',
            accessInformation: 'Synthetic Board',
            licenseInfo: '<p>Public domain.</p>',
          });
        }
        if (itemId === MAP) return Response.json(WEB_MAP);
        return Response.json(OTHER_ITEM_DATA);
      },
      [`POST /map-layers/inspect${Q}`]: ({ body }) =>
        Response.json(inspection((body as { url: string }).url)),
      [`POST /map-layers${Q}`]: () => {
        next += 1;
        return Response.json({ id: `layer-${String(next)}` }, { status: 201 });
      },
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(await screen.findByRole('button', { name: 'Add map layer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add map layer' });
    await user.click(within(dialog).getByRole('button', { name: 'ArcGIS map' }));
    await user.type(
      within(dialog).getByLabelText('ArcGIS map link'),
      `https://www.arcgis.com/apps/mapviewer/index.html?webmap=${MAP}`,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Read map' }));

    const list = await within(dialog).findByRole('list', { name: 'The map’s layers' });
    // Top first, as ArcGIS lists them.
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringMatching(/^Synthetic labels.*vector tile layers yet/),
      expect.stringMatching(/^Synthetic CPKC.*13,168 pieces.*only where NET IN \('M','I'\)/),
      expect.stringMatching(/^Synthetic other lines.*174,875 pieces/),
      expect.stringMatching(/^Synthetic passenger lines.*1 shapes, kept in the map/),
    ]);
    expect(within(dialog).getByLabelText('Source')).toHaveValue('Synthetic Board');
    // The terms are not asked for: taken from the map's ArcGIS page (F-143).
    expect(within(dialog).queryByLabelText('Terms of use (link)')).toBeNull();
    expect(within(dialog).queryByLabelText('What the terms allow')).toBeNull();
    expect(within(dialog).getByRole('link', { name: 'the map’s ArcGIS page' })).toHaveAttribute(
      'href',
      `https://www.arcgis.com/home/item.html?id=${MAP}`,
    );
    // ArcGIS Online is read through the Worker only.
    expect(calls.every((c) => !c.path.startsWith('https://'))).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: 'Add 3 layers' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const added = calls
      .filter((c) => c.method === 'POST' && c.path === `/map-layers${Q}`)
      .map((c) => c.body as Record<string, unknown>);
    expect(added.map((b) => b.name)).toEqual([
      'Synthetic passenger lines',
      'Synthetic other lines',
      'Synthetic CPKC',
    ]);
    const map = { itemId: MAP, title: 'Synthetic rail map' };
    expect(added[0]).toMatchObject({
      source: 'file',
      colour: '#00c5ff',
      lineWidth: 0.75,
      map,
    });
    // Each layer still records the map's terms (F-143).
    expect(
      added.every((b) => b.termsUrl === `https://www.arcgis.com/home/item.html?id=${MAP}`),
    ).toBe(true);
    expect(added.every((b) => b.termsNote === 'Public domain.')).toBe(true);
    // The layer's own item gives its grey, not the service's purple.
    expect(added[1]).toMatchObject({ source: 'web', url: OTHER, colour: '#999999', map });
    expect(added[2]).toMatchObject({
      source: 'web',
      url: CPKC,
      colour: '#ff73df',
      lineWidth: 0.998,
      opacity: 1,
      definitionExpression: "NET IN ('M','I')",
      othersShown: true,
      map,
    });
    // Each live layer then gets its zoomed-out view.
    expect(prepare.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual([
      'layer-2',
      'layer-3',
    ]);
  });

  it('says why a link is not a map, and what an item is when it is not one', async () => {
    mockApi({
      [`GET /map-layers${Q}`]: () => Response.json({ layers: [] }),
      [`POST /map-layers/arcgis-item${Q}`]: ({ body }) =>
        (body as { part: string }).part === 'info'
          ? Response.json({ id: MAP, title: 'Synthetic', type: 'Feature Service' })
          : Response.json({}),
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(await screen.findByRole('button', { name: 'Add map layer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add map layer' });
    await user.click(within(dialog).getByRole('button', { name: 'ArcGIS map' }));
    const input = within(dialog).getByLabelText('ArcGIS map link');
    await user.type(input, 'https://example.com/map');
    await user.click(within(dialog).getByRole('button', { name: 'Read map' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/link of an ArcGIS map/);
    await user.clear(input);
    await user.type(input, MAP);
    await user.click(within(dialog).getByRole('button', { name: 'Read map' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This ArcGIS item is a Feature Service, not a map.',
    );
  });
});

const base: MapLayerView = {
  id: 'one',
  name: 'Synthetic layer',
  kind: 'arcgis_features',
  url: CPKC,
  wmsLayers: null,
  sourceName: 'Synthetic',
  termsUrl: 'https://example.com/terms',
  termsNote: 'Public domain.',
  colour: '#ff73df',
  colourField: null,
  colours: [],
  fileName: null,
  featureCount: null,
  createdByName: 'Adam Admin',
  createdAt: '2026-11-08T18:00:00Z',
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
const map = { itemId: MAP, title: 'Synthetic rail map' };

describe('how a map’s layers are shown', () => {
  it('lists a map’s layers together, top first, with one switch', async () => {
    const layers = [
      { ...base, id: 'a', name: 'Alone' },
      { ...base, id: 'bottom', name: 'Bottom', map },
      { ...base, id: 'top', name: 'Top', map },
    ];
    expect(
      panelEntries(layers).map((e) =>
        e.kind === 'layer' ? e.layer.id : e.layers.map((l) => l.id),
      ),
    ).toEqual(['a', ['top', 'bottom']]);
    const setMany = vi.fn();
    const state = {
      token: 'token',
      layers,
      chosen: new Set(['top']),
      toggle: vi.fn(),
      setMany,
      values: {},
      setValues: vi.fn(),
      panelOpen: true,
      setPanelOpen: vi.fn(),
      overlays: [],
      notes: new Map(),
      onViewChange: vi.fn(),
      picked: null,
      setPicked: vi.fn(),
      error: null,
    } satisfies MapLayersState;
    const user = userEvent.setup();
    render(<MapLayersPanel state={state} side="right" />);
    // Below the zoom buttons, on their side (F-139).
    expect(screen.getByRole('region', { name: 'Map layers' })).toHaveClass('top-20', 'right-3');
    // Folded until its drop-down is opened (F-142).
    expect(screen.queryByRole('list', { name: 'Synthetic rail map: layers' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show the layers of Synthetic rail map' }));
    const group = screen.getByRole('list', { name: 'Synthetic rail map: layers' });
    expect(
      within(group)
        .getAllByRole('switch')
        .map((s) => s.closest('label')?.textContent),
    ).toEqual(['Top', 'Bottom']);
    expect(screen.getByText('1 of 2')).toBeVisible();
    // One of them on: the map's switch turns them all off.
    await user.click(screen.getByRole('switch', { name: /Synthetic rail map/ }));
    expect(setMany).toHaveBeenCalledWith(['top', 'bottom'], false);
  });

  it('turns on the layers the ArcGIS map shows at first (F-141)', async () => {
    const layers = [
      { ...base, id: 'wheat', name: 'Wheat', map, mapVisible: false },
      { ...base, id: 'all', name: 'All crops', map, mapVisible: true },
    ];
    const setMany = vi.fn();
    const state = {
      token: 'token',
      layers,
      chosen: new Set<string>(),
      toggle: vi.fn(),
      setMany,
      values: {},
      setValues: vi.fn(),
      panelOpen: true,
      setPanelOpen: vi.fn(),
      overlays: [],
      notes: new Map(),
      onViewChange: vi.fn(),
      picked: null,
      setPicked: vi.fn(),
      error: null,
    } satisfies MapLayersState;
    const user = userEvent.setup();
    render(<MapLayersPanel state={state} side="left" />);
    await user.click(screen.getByRole('switch', { name: /Synthetic rail map/ }));
    expect(setMany).toHaveBeenCalledWith(['all'], true);
  });

  it('draws a layer with ArcGIS’s width, opacity and zooms', () => {
    expect(lookOf(base)).toBe(USUAL_LOOK);
    expect(
      lookOf({ ...base, map, lineWidth: 0.75, opacity: 0.5, minZoom: 4, maxZoom: 12 }),
    ).toEqual({
      lineWidth: 1,
      opacity: 0.5,
      minZoom: 4,
      maxZoom: 12,
    });
    expect(shownAtZoom({ minZoom: 4, maxZoom: 12 }, 3)).toBe(false);
    expect(shownAtZoom({ minZoom: 4, maxZoom: 12 }, 4)).toBe(true);
    expect(shownAtZoom({ minZoom: 4, maxZoom: 12 }, 12)).toBe(false);
    expect(shownAtZoom({ minZoom: 4, maxZoom: 12 }, null)).toBe(true);
  });

  it('hides values without a symbol when ArcGIS draws none, until the person chooses', () => {
    const layer = {
      ...base,
      kind: 'file' as const,
      colourField: 'OWNER',
      colours: [['CN', '#ff3300']] as [string, string][],
      othersShown: false,
    };
    mockApi({
      [`GET /map-layers/one/file`]: () =>
        Response.json({ type: 'FeatureCollection', features: [] }),
    });
    const { result } = renderHook(() => useLayerOverlays([layer], null, 'token'));
    return waitFor(() => {
      const [overlay] = result.current.overlays;
      expect(overlay?.kind === 'features' && overlay.filter).toEqual([
        'in',
        ['to-string', ['get', 'OWNER']],
        ['literal', ['CN']],
      ]);
    });
  });
});

describe('Codex’s review of 1f328f9', () => {
  it('does not add a layer whose own item has a filter GSS cannot send', async () => {
    mockApi({
      [`GET /map-layers${Q}`]: () => Response.json({ layers: [] }),
      [`POST /map-layers/arcgis-item${Q}`]: ({ body }) => {
        const { itemId, part } = body as { itemId: string; part: string };
        if (itemId === MAP && part === 'info') {
          return Response.json({ id: MAP, title: 'Synthetic rail map', type: 'Web Map' });
        }
        if (itemId === MAP) {
          return Response.json({
            operationalLayers: [
              {
                layerType: 'ArcGISFeatureLayer',
                title: 'Synthetic filtered lines',
                url: OTHER,
                itemId: OTHER_ITEM,
                layerDefinition: {
                  drawingInfo: { renderer: { type: 'simple', symbol: { type: 'esriSLS' } } },
                },
              },
            ],
          });
        }
        return Response.json({
          layers: [{ id: 0, layerDefinition: { definitionExpression: '1=1) OR (1=1' } }],
        });
      },
      [`POST /map-layers/inspect${Q}`]: ({ body }) =>
        Response.json(inspection((body as { url: string }).url)),
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(await screen.findByRole('button', { name: 'Add map layer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add map layer' });
    await user.click(within(dialog).getByRole('button', { name: 'ArcGIS map' }));
    await user.type(within(dialog).getByLabelText('ArcGIS map link'), MAP);
    await user.click(within(dialog).getByRole('button', { name: 'Read map' }));
    const list = await within(dialog).findByRole('list', { name: 'The map’s layers' });
    expect(list).toHaveTextContent('Its filter on ArcGIS is not one GSS can send.');
    expect(within(dialog).getByRole('button', { name: 'Add 0 layers' })).toBeDisabled();
  });

  it('keeps "Other values" on for a layer that hides them by default', () => {
    window.localStorage.clear();
    const layer = { ...base, othersShown: false };
    const { result } = renderHook(() => useValueChoices('token'));
    act(() => {
      result.current[1](layer.id, { shown: null, others: true }, choiceOf(layer, {}));
    });
    expect(choiceOf(layer, result.current[0])).toEqual({ shown: null, others: true });
    act(() => {
      result.current[1](layer.id, { shown: null, others: false }, choiceOf(layer, {}));
    });
    expect(result.current[0]).toEqual({});
  });
});

describe('a map of pre-drawn pictures, such as a heat map (F-141)', () => {
  const TILED = 'https://tiles.example.com/tiles/x/arcgis/rest/services/Crop_Density/MapServer';

  it('adds its layers as pre-drawn pictures, those ArcGIS shows at first marked so', async () => {
    let next = 0;
    const calls = mockApi({
      [`GET /map-layers${Q}`]: () => Response.json({ layers: [] }),
      [`POST /map-layers/arcgis-item${Q}`]: ({ body }) =>
        (body as { part: string }).part === 'info'
          ? Response.json({ id: MAP, title: 'Synthetic crop density', type: 'Web Map' })
          : Response.json({
              operationalLayers: [
                {
                  layerType: 'ArcGISTiledMapServiceLayer',
                  title: 'Synthetic wheat density',
                  url: TILED,
                  visibility: false,
                },
                {
                  layerType: 'ArcGISTiledMapServiceLayer',
                  title: 'Synthetic all crops density',
                  url: TILED,
                  visibility: true,
                },
              ],
            }),
      [`POST /map-layers/inspect${Q}`]: () =>
        Response.json({
          kind: 'arcgis_tiles',
          url: TILED,
          wmsLayers: null,
          title: 'Synthetic',
          copyright: null,
          fields: [],
          values: null,
          count: null,
          drawing: { renderer: null, transparency: 0, minScale: null, maxScale: null },
        }),
      [`POST /map-layers${Q}`]: () => {
        next += 1;
        return Response.json({ id: `tiles-${String(next)}` }, { status: 201 });
      },
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(await screen.findByRole('button', { name: 'Add map layer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add map layer' });
    await user.click(within(dialog).getByRole('button', { name: 'ArcGIS map' }));
    await user.type(within(dialog).getByLabelText('ArcGIS map link'), MAP);
    await user.click(within(dialog).getByRole('button', { name: 'Read map' }));
    const list = await within(dialog).findByRole('list', { name: 'The map’s layers' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringMatching(/^Synthetic all crops density.*pre-drawn pictures/),
      expect.stringMatching(/^Synthetic wheat density.*off at first, as on ArcGIS/),
    ]);
    // Pictures are ArcGIS's own drawing: not marked as shown roughly.
    expect(within(dialog).queryByText(/roughly/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 layers' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const added = calls
      .filter((c) => c.method === 'POST' && c.path === `/map-layers${Q}`)
      .map((c) => c.body as Record<string, unknown>);
    expect(added.map((b) => [b.name, b.mapVisible])).toEqual([
      ['Synthetic wheat density', false],
      ['Synthetic all crops density', true],
    ]);
    // No zoomed-out view to prepare for pictures.
    expect(prepare).not.toHaveBeenCalled();
  });

  it('shows a picture layer’s legend from ArcGIS under the map', async () => {
    const picture: MapLayerView = {
      ...base,
      id: 'tiles-1',
      name: 'Synthetic all crops density',
      kind: 'arcgis_tiles',
      url: TILED,
      tileLevels: { min: 3, max: 10 },
    };
    mockApi({
      'GET /map-layers/tiles-1/legend': () =>
        Response.json({
          entries: [
            { label: 'Most Dense - Least Dense', image: 'data:image/png;base64,iVBORw0KGgo=' },
          ],
        }),
    });
    const state = {
      token: 'token',
      layers: [picture],
      chosen: new Set(['tiles-1']),
      toggle: vi.fn(),
      setMany: vi.fn(),
      values: {},
      setValues: vi.fn(),
      panelOpen: false,
      setPanelOpen: vi.fn(),
      overlays: [],
      notes: new Map(),
      onViewChange: vi.fn(),
      picked: null,
      setPicked: vi.fn(),
      error: null,
    } satisfies MapLayersState;
    render(<MapLayersLegend state={state} />);
    expect(await screen.findByText('Most Dense - Least Dense')).toBeVisible();
    expect(
      screen.getByRole('list', { name: 'Map layers shown' }).querySelector('img'),
    ).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
  });

  it('draws a pre-drawn layer within its levels', () => {
    const picture: MapLayerView = {
      ...base,
      kind: 'arcgis_tiles',
      url: TILED,
      tileLevels: { min: 3, max: 10 },
    };
    const { result } = renderHook(() => useLayerOverlays([picture], null, 'token'));
    expect(result.current.overlays[0]).toMatchObject({
      kind: 'pictures',
      levels: { min: 3, max: 10 },
    });
  });
});

describe('a map’s layers kept together on Team (F-142)', () => {
  const rail = { itemId: MAP, title: 'Synthetic rail map' };
  const layers: MapLayerView[] = [
    { ...base, id: 'alone', name: 'Synthetic elevators', version: 'v-alone' },
    { ...base, id: 'bottom', name: 'Synthetic bottom', map: rail, version: 'v-bottom' },
    { ...base, id: 'middle', name: 'Synthetic middle', map: rail, version: 'v-middle' },
    { ...base, id: 'top', name: 'Synthetic top', map: rail, version: 'v-top' },
  ];

  it('lists a map as one entry, folded, with its source once', async () => {
    mockApi({ [`GET /map-layers${Q}`]: () => Response.json({ layers }) });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    expect(await screen.findByText('Synthetic elevators')).toBeVisible();
    expect(screen.getByText('· 3 layers')).toBeVisible();
    expect(screen.queryByText('Synthetic top')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show the layers of Synthetic rail map' }));
    const list = screen.getByRole('list', { name: 'Synthetic rail map: layers' });
    expect(
      within(list)
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('aria-label')),
    ).toEqual(['Select Synthetic top', 'Select Synthetic middle', 'Select Synthetic bottom']);
    // The map's source and terms once, not under each of its layers.
    expect(within(list).queryByText(/Source:/)).toBeNull();
  });

  it('removes only the layers selected, after asking', async () => {
    let shown = layers;
    const calls = mockApi({
      [`GET /map-layers${Q}`]: () => Response.json({ layers: shown }),
      'POST /map-layers/middle/remove': () => {
        shown = shown.filter((l) => l.id !== 'middle');
        return Response.json({ id: 'middle' });
      },
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(
      await screen.findByRole('button', { name: 'Show the layers of Synthetic rail map' }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select Synthetic middle' }));
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));
    await user.click(screen.getByRole('button', { name: 'Remove 1 layer for everyone' }));
    await waitFor(() => {
      expect(screen.queryByText('Synthetic middle')).toBeNull();
    });
    const removed = calls.filter((c) => c.method === 'POST');
    expect(removed.map((c) => [c.path, c.body])).toEqual([
      ['/map-layers/middle/remove', { version: 'v-middle' }],
    ]);
  });

  it('removes the whole map, after asking', async () => {
    let shown = layers;
    const calls = mockApi({
      [`GET /map-layers${Q}`]: () => Response.json({ layers: shown }),
      ...Object.fromEntries(
        ['bottom', 'middle', 'top'].map((id) => [
          `POST /map-layers/${id}/remove`,
          () => {
            shown = shown.filter((l) => l.id !== id);
            return Response.json({ id });
          },
        ]),
      ),
    });
    const user = userEvent.setup();
    render(<MapLayerSettings session={SESSION} />);
    await user.click(await screen.findByRole('button', { name: 'Remove map' }));
    await user.click(screen.getByRole('button', { name: 'Remove all 3 layers for everyone' }));
    await waitFor(() => {
      expect(screen.queryByText('Synthetic rail map')).toBeNull();
    });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/map-layers/top/remove',
      '/map-layers/middle/remove',
      '/map-layers/bottom/remove',
    ]);
    expect(screen.getByText('Synthetic elevators')).toBeVisible();
  });
});
