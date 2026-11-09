import { groupingOf, type MapLayerView } from '@grain/domain';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OBJECT_ID,
  squareCovered,
  squaresOverlap,
  useLayerOverlays,
  type MapView,
} from './mapLayers';

// No blank map between zooms (the owner's report of 2026-11-08, F-140): lines came and went while
// zooming in and out, unlike ArcGIS. Every layer, square and value is synthetic.

const LAYER = '00000000-0000-4000-8000-0000000a1a01';

const live: MapLayerView = {
  id: LAYER,
  name: 'Synthetic rail lines',
  kind: 'arcgis_features',
  url: 'https://services.example.com/rest/services/Rail/FeatureServer/0',
  wmsLayers: null,
  sourceName: 'Synthetic publisher',
  termsUrl: 'https://example.com/terms',
  termsNote: 'Public domain.',
  colour: '#2f6baa',
  colourField: 'OWNER',
  colours: [['R1', '#000001']],
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

const withOverview: MapLayerView = {
  ...live,
  overview: {
    colourField: 'OWNER',
    grouping: groupingOf(live),
    featureCount: 1,
    sourceCount: 100,
    preparedByName: 'Adam Admin',
    preparedAt: '2026-11-08T19:00:00Z',
    version: 'c'.repeat(64),
  },
};

/** The zoomed-out view: one line, without an object id. */
const OVERVIEW = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-105, 50],
          [-104, 50.2],
        ],
      },
      properties: { OWNER: 'R1' },
    },
  ],
};

/** A square with the given pieces, cut short or not. */
function square(ids: number[], exceeded = false) {
  return {
    type: 'FeatureCollection',
    features: ids.map((id) => ({
      type: 'Feature',
      id,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-104.9, 50.1],
          [-104.8, 50.1],
        ],
      },
      properties: { OBJECTID: id, OWNER: 'R1' },
    })),
    ...(exceeded && { properties: { exceededTransferLimit: true } }),
  };
}

/** Answers the API: squares by zoom (null: never answers), and the zoomed-out view. */
function api(squares: Record<number, unknown>, overview: unknown = OVERVIEW) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input.endsWith('/overview')) return Promise.resolve(Response.json(overview));
      const z = Number(/\/features\/(\d+)\//.exec(input)?.[1]);
      const body = squares[z];
      return body === null || body === undefined
        ? new Promise<Response>(() => undefined)
        : Promise.resolve(Response.json(body));
    }),
  );
}

const at = (zoom: number): MapView => ({
  bbox: { west: -105, south: 50, east: -104.7, north: 50.2 },
  zoom,
});

function drawn(result: { current: ReturnType<typeof useLayerOverlays> }) {
  const overlay = result.current.overlays[0];
  return overlay?.kind === 'features' ? overlay.data.features : [];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zooming without a blank map (F-140)', () => {
  it('keeps the lines already loaded while the next zoom’s squares load', async () => {
    api({ 8: square([1, 2]), 9: null });
    const { result, rerender } = renderHook(({ view }) => useLayerOverlays([live], view, 'token'), {
      initialProps: { view: at(8.5) },
    });
    await waitFor(() => {
      expect(drawn(result)).toHaveLength(2);
    });
    rerender({ view: at(9.5) });
    // The zoom 9 squares never answer: the zoom 8 lines stay.
    expect(drawn(result).map((f): unknown => f.properties?.[OBJECT_ID])).toEqual([1, 2]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drawn(result)).toHaveLength(2);
  });

  it('keeps the lines when zooming back out before the wider squares load', async () => {
    api({ 10: square([3]), 9: null });
    const { result, rerender } = renderHook(({ view }) => useLayerOverlays([live], view, 'token'), {
      initialProps: { view: at(10.2) },
    });
    await waitFor(() => {
      expect(drawn(result)).toHaveLength(1);
    });
    rerender({ view: at(9.2) });
    expect(drawn(result).map((f): unknown => f.properties?.[OBJECT_ID])).toEqual([3]);
  });

  it('draws the whole zoomed-out view where the service cut squares short', async () => {
    api({ 8: square([5, 6], true) });
    const { result } = renderHook(() => useLayerOverlays([withOverview], at(8.5), 'token'));
    await waitFor(() => {
      expect(drawn(result)).toHaveLength(1);
      expect(drawn(result)[0]?.properties?.[OBJECT_ID]).toBeUndefined();
    });
    expect(result.current.notes.size).toBe(0);
  });

  it('uses the squares from zoom 10, even when cut short, with the note to zoom in', async () => {
    api({ 10: square([7], true) });
    const { result } = renderHook(() => useLayerOverlays([withOverview], at(10.5), 'token'));
    await waitFor(() => {
      expect(drawn(result).map((f): unknown => f.properties?.[OBJECT_ID])).toEqual([7]);
    });
    expect(result.current.notes.get(LAYER)).toBe('Zoom in to see every line here.');
  });

  it('fills a place no square has reached yet with the zoomed-out view', async () => {
    api({ 12: null });
    const { result } = renderHook(() => useLayerOverlays([withOverview], at(12.5), 'token'));
    await waitFor(() => {
      expect(drawn(result)).toHaveLength(1);
    });
    expect(drawn(result)[0]?.properties).toEqual({ OWNER: 'R1' });
  });

  it('knows which squares overlap at any zooms', () => {
    expect(squaresOverlap({ z: 8, x: 50, y: 80 }, { z: 9, x: 101, y: 160 })).toBe(true);
    expect(squaresOverlap({ z: 9, x: 101, y: 160 }, { z: 8, x: 50, y: 80 })).toBe(true);
    expect(squaresOverlap({ z: 8, x: 50, y: 80 }, { z: 9, x: 102, y: 160 })).toBe(false);
    expect(squaresOverlap({ z: 8, x: 50, y: 80 }, { z: 8, x: 50, y: 80 })).toBe(true);
    expect(squaresOverlap({ z: 8, x: 50, y: 80 }, { z: 8, x: 51, y: 80 })).toBe(false);
  });
});

describe('Codex’s review of 4026e22', () => {
  it('draws the zoomed-out view when zooming out leaves part of the wider square empty', async () => {
    api({ 9: square([1]), 8: null });
    const { result, rerender } = renderHook(
      ({ view }) => useLayerOverlays([withOverview], view, 'token'),
      { initialProps: { view: at(9.5) } },
    );
    await waitFor(() => {
      expect(drawn(result).map((f): unknown => f.properties?.[OBJECT_ID])).toEqual([1]);
    });
    // The zoom 8 square is four zoom 9 squares; only one is loaded.
    rerender({ view: at(8.5) });
    expect(drawn(result)).toHaveLength(1);
    expect(drawn(result)[0]?.properties).toEqual({ OWNER: 'R1' });
  });

  it('keeps lines already loaded where a square failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.endsWith('/overview')) return Promise.resolve(Response.json(OVERVIEW));
        return input.includes('/features/8/')
          ? Promise.resolve(Response.json(square([2, 3])))
          : Promise.resolve(
              Response.json(
                { error: { code: 'LAYER_SERVICE_FAILED', message: 'No.' } },
                { status: 502 },
              ),
            );
      }),
    );
    const { result, rerender } = renderHook(({ view }) => useLayerOverlays([live], view, 'token'), {
      initialProps: { view: at(8.5) },
    });
    await waitFor(() => {
      expect(drawn(result)).toHaveLength(2);
    });
    rerender({ view: at(9.5) });
    await waitFor(() => {
      expect(result.current.notes.get(LAYER)).toMatch(/could not be loaded/);
    });
    expect(drawn(result).map((f): unknown => f.properties?.[OBJECT_ID])).toEqual([2, 3]);
  });

  it('knows when loaded squares cover all of a square', () => {
    const tile = { z: 8, x: 50, y: 80 };
    expect(squareCovered(tile, new Set(['7/25/40']))).toBe(true);
    expect(squareCovered(tile, new Set(['8/50/80']))).toBe(true);
    expect(squareCovered(tile, new Set(['9/100/160']))).toBe(false);
    expect(squareCovered(tile, new Set(['9/100/160', '9/101/160', '9/100/161', '9/101/161']))).toBe(
      true,
    );
    expect(
      squareCovered(
        tile,
        new Set(['9/100/160', '9/101/160', '9/100/161', '10/202/322', '10/203/322', '10/202/323']),
      ),
    ).toBe(false);
  });
});

describe('Codex’s re-review of b9746f9', () => {
  it('keeps the zoomed-out view when the only loaded squares were cut short', async () => {
    api({ 8: square([5, 6], true), 9: null });
    const { result, rerender } = renderHook(
      ({ view }) => useLayerOverlays([withOverview], view, 'token'),
      { initialProps: { view: at(8.5) } },
    );
    await waitFor(() => {
      expect(drawn(result)[0]?.properties).toEqual({ OWNER: 'R1' });
    });
    // Zoom 9 still loading: the cut-short zoom 8 squares do not replace the whole view.
    rerender({ view: at(9.5) });
    expect(drawn(result)).toHaveLength(1);
    expect(drawn(result)[0]?.properties).toEqual({ OWNER: 'R1' });
  });
});
