import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api';
import { prepareOverview } from './mapOverview';

// Preparing a zoomed-out view (F-134). The service's pages are stood in for by the decoder's
// answers; every value is synthetic.
const pages = vi.hoisted(() => new Map<number, unknown>());
vi.mock('arcgis-pbf-parser', () => ({
  default: (data: Uint8Array) => pages.get(data[0] ?? -1),
}));

const LAYER = '00000000-0000-4000-8000-0000000a1a01';

/** A page of `n` two-point lines in web Mercator metres, owner `owner`, starting at `x`. */
function page(n: number, owner: string, x: number) {
  return {
    featureCollection: {
      type: 'FeatureCollection',
      features: Array.from({ length: n }, (_, i) => ({
        type: 'Feature',
        properties: { OWNER: owner },
        geometry: {
          type: 'LineString',
          coordinates: [
            [x + i * 5000, 6_500_000],
            [x + (i + 1) * 5000, 6_500_000],
          ],
        },
      })),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  pages.clear();
});

describe('prepareOverview', () => {
  it('reads every page, joins each value’s pieces and saves the view', async () => {
    pages.set(0, page(3, 'AAA', -11_000_000));
    pages.set(1, page(3, 'AAA', -10_985_000));
    pages.set(2, page(1, 'BBB', -10_000_000));
    const calls = mockApi({
      [`GET /map-layers/${LAYER}/count`]: () => Response.json({ count: 7, pageSize: 3 }),
      [`GET /map-layers/${LAYER}/pages/0`]: () => new Response(new Uint8Array([0])),
      [`GET /map-layers/${LAYER}/pages/3`]: () => new Response(new Uint8Array([1])),
      [`GET /map-layers/${LAYER}/pages/6`]: () => new Response(new Uint8Array([2])),
      [`PUT /map-layers/${LAYER}/overview`]: () => Response.json({ id: LAYER }),
    });
    const progress = vi.fn();
    const done = await prepareOverview({ id: LAYER, colourField: 'OWNER' }, 'token', progress);
    expect(done).toEqual({ features: 2, pieces: 7 });
    expect(progress).toHaveBeenLastCalledWith({ read: 7, total: 7 });
    const saved = calls.find((c) => c.method === 'PUT')?.body as {
      colourField: string;
      sourceCount: number;
      geojson: { features: { properties: unknown; geometry: { coordinates: unknown[] } }[] };
    };
    expect(saved.colourField).toBe('OWNER');
    expect(saved.sourceCount).toBe(7);
    expect(saved.geojson.features.map((f) => f.properties)).toEqual([
      { OWNER: 'AAA' },
      { OWNER: 'BBB' },
    ]);
    // The six AAA pieces meet end to end: one line.
    expect(saved.geojson.features[0]?.geometry.coordinates).toHaveLength(1);
  });

  it('says when the service gives nothing, saving nothing', async () => {
    pages.set(0, { featureCollection: { type: 'FeatureCollection', features: [] } });
    const calls = mockApi({
      [`GET /map-layers/${LAYER}/count`]: () => Response.json({ count: 5, pageSize: 8000 }),
      [`GET /map-layers/${LAYER}/pages/0`]: () => new Response(new Uint8Array([0])),
    });
    await expect(
      prepareOverview({ id: LAYER, colourField: null }, 'token', vi.fn()),
    ).rejects.toThrow('The map service gave nothing to draw.');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('refuses a layer without lines', async () => {
    pages.set(0, {
      featureCollection: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      },
    });
    mockApi({
      [`GET /map-layers/${LAYER}/count`]: () => Response.json({ count: 1, pageSize: 8000 }),
      [`GET /map-layers/${LAYER}/pages/0`]: () => new Response(new Uint8Array([0])),
    });
    await expect(
      prepareOverview({ id: LAYER, colourField: null }, 'token', vi.fn()),
    ).rejects.toThrow(/no lines/);
  });
});
