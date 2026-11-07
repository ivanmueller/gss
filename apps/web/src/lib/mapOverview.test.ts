import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, type Call } from '../test/api';
import { prepareOverview } from './mapOverview';

// Preparing a zoomed-out view (F-134, Codex's review of 8e0fd95). The service's pages are stood
// in for by the decoder's answers, keyed by the first byte the page route sends; synthetic.
const pages = vi.hoisted(() => new Map<number, unknown>());
vi.mock('arcgis-pbf-parser', () => ({
  default: (data: Uint8Array) => pages.get(data[0] ?? -1),
}));

const LAYER = '00000000-0000-4000-8000-0000000a1a01';

/** The longitude (three places) of the end of piece n - 1. */
const lon = (n: number) =>
  Math.round(((-11_000_000 + n * 5000) / 6378137) * (180 / Math.PI) * 1000) / 1000;

/** Pieces `from` to `to` (not included): two-point lines end to end, owner `owner`. */
function pieces(from: number, to: number, owner = 'AAA') {
  return {
    featureCollection: {
      type: 'FeatureCollection',
      features: Array.from({ length: to - from }, (_, k) => {
        const i = from + k;
        return {
          type: 'Feature',
          properties: { OWNER: owner },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-11_000_000 + i * 5000, 6_500_000],
              [-11_000_000 + (i + 1) * 5000, 6_500_000],
            ],
          },
        };
      }),
    },
  };
}

/** The service: `count` pieces, giving at most `size` from any offset (`short` gives fewer). */
function service(count: number, size: number, short: Record<number, number> = {}) {
  const handlers: Record<string, (call: Call) => Response> = {
    [`GET /map-layers/${LAYER}/count`]: () => Response.json({ count, pageSize: size }),
    [`PUT /map-layers/${LAYER}/overview/__/__`]: () => Response.json({}),
  };
  for (let offset = 0; offset < count; offset += 1) {
    const key = offset % 250;
    const n = Math.min(short[offset] ?? size, count - offset);
    pages.set(key, pieces(offset, offset + n));
    handlers[`GET /map-layers/${LAYER}/pages/${String(offset)}`] = () => {
      pages.set(key, pieces(offset, offset + n));
      return new Response(new Uint8Array([key]));
    };
  }
  return handlers;
}

/** Answers every part and the publishing. */
function saving(handlers: Record<string, (call: Call) => Response>) {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-00000000f001');
  const base = `/map-layers/${LAYER}/overview/00000000-0000-4000-8000-00000000f001`;
  for (let i = 0; i < 64; i += 1) handlers[`PUT ${base}/${String(i)}`] = () => Response.json({});
  handlers[`POST ${base}/publish`] = () => Response.json({ id: LAYER });
  return mockApi(handlers);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pages.clear();
});

describe('prepareOverview', () => {
  it('reads every page, joins the pieces, sends the parts and publishes the view', async () => {
    const calls = saving(service(7, 3));
    const progress = vi.fn();
    const done = await prepareOverview({ id: LAYER, colourField: 'OWNER' }, 'token', progress);
    expect(done).toEqual({ features: 1, pieces: 7 });
    expect(progress).toHaveBeenCalledWith({ stage: 'reading', done: 7, total: 7 });
    expect(progress).toHaveBeenCalledWith({ stage: 'joining' });
    const parts = calls.filter((c) => c.method === 'PUT');
    expect(parts).toHaveLength(1);
    const [feature] = (
      parts[0]?.body as {
        features: { properties: unknown; geometry: { coordinates: unknown[][] } }[];
      }
    ).features;
    expect(feature?.properties).toEqual({ OWNER: 'AAA' });
    // The seven pieces meet end to end: one line, from the first piece's start to the last's end.
    expect(feature?.geometry.coordinates).toHaveLength(1);
    expect(feature?.geometry.coordinates[0]?.at(-1)).toEqual([lon(7), expect.any(Number)]);
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      body: { colourField: 'OWNER', partCount: 1, sourceCount: 7 },
    });
  });

  it('fills in a page that came back short, so every piece is read once', async () => {
    // From offset 3 the service gives only 1 piece: 4 and 5 are read from where it stopped.
    const calls = saving(service(9, 3, { 3: 1, 4: 1 }));
    const done = await prepareOverview({ id: LAYER, colourField: 'OWNER' }, 'token', vi.fn());
    expect(done.pieces).toBe(9);
    const asked = calls
      .filter((c) => c.path.includes('/pages/'))
      .map((c) => c.path.split('/').pop());
    expect(asked).toEqual(expect.arrayContaining(['0', '3', '4', '5', '6']));
    const [feature] = (
      calls.find((c) => c.method === 'PUT')?.body as {
        features: { geometry: { coordinates: unknown[][] } }[];
      }
    ).features;
    expect(feature?.geometry.coordinates).toHaveLength(1);
    expect(feature?.geometry.coordinates[0]?.at(-1)).toEqual([lon(9), expect.any(Number)]);
  });

  it('refuses to publish when the service stops giving pieces', async () => {
    const handlers = service(7, 3, { 3: 0 });
    const calls = saving(handlers);
    await expect(
      prepareOverview({ id: LAYER, colourField: 'OWNER' }, 'token', vi.fn()),
    ).rejects.toThrow('The map service stopped giving pieces at 3 of 7. Try again.');
    expect(calls.some((c) => c.method === 'PUT' || c.method === 'POST')).toBe(false);
  });

  it('says when the service gives nothing, or no lines', async () => {
    saving(service(5, 0));
    await expect(
      prepareOverview({ id: LAYER, colourField: null }, 'token', vi.fn()),
    ).rejects.toThrow('The map service gave nothing to draw.');
    pages.set(0, {
      featureCollection: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      },
    });
    saving({
      [`GET /map-layers/${LAYER}/count`]: () => Response.json({ count: 1, pageSize: 8000 }),
      [`GET /map-layers/${LAYER}/pages/0`]: () => new Response(new Uint8Array([0])),
    });
    await expect(
      prepareOverview({ id: LAYER, colourField: null }, 'token', vi.fn()),
    ).rejects.toThrow(/no lines/);
  });
  it('reports nothing more once it has failed, though slower requests finish later (Codex’s review of d35ac90)', async () => {
    const handlers = service(12, 3);
    // From offset 3 the service fails at once; the page at 6 answers later.
    handlers[`GET /map-layers/${LAYER}/pages/3`] = () =>
      Response.json({ error: { code: 'LAYER_SERVICE_FAILED', message: 'Down.' } }, { status: 502 });
    const slow = handlers[`GET /map-layers/${LAYER}/pages/6`];
    let slowDone = false;
    handlers[`GET /map-layers/${LAYER}/pages/6`] = (call) =>
      new Promise<Response>((resolve) => {
        setTimeout(() => {
          slowDone = true;
          resolve(slow?.(call) ?? new Response(null, { status: 404 }));
        }, 30);
      }) as unknown as Response;
    saving(handlers);
    const progress = vi.fn();
    await expect(
      prepareOverview({ id: LAYER, colourField: 'OWNER' }, 'token', progress),
    ).rejects.toThrow('Down.');
    const reported = progress.mock.calls.length;
    await vi.waitFor(() => {
      expect(slowDone).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(progress.mock.calls).toHaveLength(reported);
  });
});
