import { tilesForView, type MapLayerView } from '@grain/domain';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLayerOverlays } from './mapLayers';

// F-247-2-R3-01: with many live layers on, one view needs more map squares than are kept from
// earlier views (600). The squares the map is showing are never dropped to make room: a dropped
// one left a hole nothing asked for again while the map stood still. Synthetic layers only.

const base: MapLayerView = {
  id: '',
  name: 'Synthetic layer',
  kind: 'arcgis_features',
  url: 'https://services.example.com/rest/services/Land/MapServer/8',
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

const VIEW = { bbox: { west: -106, south: 49.5, east: -103, north: 51 }, zoom: 7 };
const SQUARES_PER_LAYER = tilesForView(VIEW.bbox, VIEW.zoom).length;
/** Enough layers that the view needs well over the 600 squares kept. */
const LAYERS: MapLayerView[] = Array.from(
  { length: Math.ceil(700 / SQUARES_PER_LAYER) },
  (_, i) => ({
    ...base,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Synthetic layer ${String(i)}`,
  }),
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useLayerOverlays with more squares in view than are kept', () => {
  it('keeps every square the map is showing', async () => {
    expect(LAYERS.length * SQUARES_PER_LAYER).toBeGreaterThan(600);
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        n += 1;
        return Promise.resolve(
          Response.json({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: n,
                geometry: { type: 'Point', coordinates: [-105, 50] },
                properties: {},
              },
            ],
          }),
        );
      }),
    );
    const { result, rerender } = renderHook(
      ({ layers }: { layers: MapLayerView[] }) => useLayerOverlays(layers, VIEW, 'token'),
      { initialProps: { layers: LAYERS } },
    );
    await waitFor(
      () => {
        expect(n).toBe(LAYERS.length * SQUARES_PER_LAYER);
        const drawn = result.current.overlays.map((overlay) =>
          overlay.kind === 'features' ? overlay.data.features.length : -1,
        );
        // One shape per square, for every layer: none was dropped while in view.
        expect(drawn).toEqual(LAYERS.map(() => SQUARES_PER_LAYER));
      },
      { timeout: 15_000 },
    );
    // Nothing was asked for twice to get there.
    const total = LAYERS.length * SQUARES_PER_LAYER;
    expect(n).toBe(total);

    // F-247-2-R4-02: every layer switched off, no square arriving after: those over the 600
    // kept are let go at once. Switched back on, exactly those are asked for again.
    rerender({ layers: [] });
    expect(result.current.overlays).toEqual([]);
    rerender({ layers: LAYERS });
    await waitFor(
      () => {
        expect(n).toBe(total + (total - 600));
        const drawn = result.current.overlays.map((overlay) =>
          overlay.kind === 'features' ? overlay.data.features.length : -1,
        );
        expect(drawn).toEqual(LAYERS.map(() => SQUARES_PER_LAYER));
      },
      { timeout: 15_000 },
    );
  }, 40_000);

  // F-247-2-R7-03: an admin removes a layer while a teammate has it open. Its squares at the new
  // zoom answer 404; those kept from the zoom before are not drawn in their place.
  it('draws nothing of a layer the server no longer has', async () => {
    let removed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          removed
            ? Response.json(
                { error: { code: 'NOT_FOUND', message: 'No such map layer.' } },
                { status: 404 },
              )
            : Response.json({
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    id: 1,
                    geometry: { type: 'Point', coordinates: [-105, 50] },
                    properties: {},
                  },
                ],
              }),
        ),
      ),
    );
    const one = LAYERS.slice(0, 1);
    const shapes = () =>
      result.current.overlays.reduce(
        (sum, overlay) => sum + (overlay.kind === 'features' ? overlay.data.features.length : 0),
        0,
      );
    const { result, rerender } = renderHook(
      ({ view }: { view: typeof VIEW }) => useLayerOverlays(one, view, 'token'),
      { initialProps: { view: VIEW } },
    );
    await waitFor(() => {
      expect(shapes()).toBeGreaterThan(0);
    });
    removed = true;
    rerender({ view: { ...VIEW, zoom: 8 } });
    await waitFor(() => {
      expect(result.current.notes.size).toBe(1);
    });
    expect(shapes()).toBe(0);
  });
});
