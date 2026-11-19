import { tilesForView, type MapLayerView } from '@grain/domain';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { layersLeftOut, TOO_MANY_LAYERS_NOTE, useLayerOverlays } from './mapLayers';

// F-247-2-R3-01 and R20-01: with many live layers on, one view would need more map squares than
// are kept (600). The squares the map is showing are never dropped to make room (a dropped one
// left a hole nothing asked for again while the map stood still); instead the view loads only
// the layers it has room for, in the list's order, and the others say so. Synthetic layers only.

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
/** How many of them one view has room for. */
const FIT = Math.floor(600 / SQUARES_PER_LAYER);
/** Enough layers that the view would need well over the 600 squares kept. */
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
    expect(FIT).toBeGreaterThan(0);
    expect(FIT).toBeLessThan(LAYERS.length);
    const fitting = LAYERS.slice(0, FIT);
    const leftOut = LAYERS.slice(FIT);
    let n = 0;
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        n += 1;
        asked.push(url);
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
    const total = FIT * SQUARES_PER_LAYER;
    const drawn = () =>
      result.current.overlays.map((overlay) =>
        overlay.kind === 'features' ? [overlay.id, overlay.data.features.length] : [overlay.id, -1],
      );
    await waitFor(
      () => {
        expect(n).toBe(total);
        // One shape per square, for every layer the view has room for: none was dropped while
        // in view (F-247-2-R3-01).
        expect(drawn()).toEqual(fitting.map((layer) => [layer.id, SQUARES_PER_LAYER]));
      },
      { timeout: 15_000 },
    );
    // Nothing was asked for twice to get there, and nothing for the layers left out: what one
    // view loads and keeps stays within the 600 squares (F-247-2-R20-01). Each says why.
    expect(n).toBe(total);
    expect(total).toBeLessThanOrEqual(600);
    for (const layer of leftOut) {
      expect(asked.some((url) => url.includes(layer.id))).toBe(false);
      expect(result.current.notes.get(layer.id)).toBe(TOO_MANY_LAYERS_NOTE);
    }
    for (const layer of fitting) expect(result.current.notes.has(layer.id)).toBe(false);
    // F-247-2-R18-01: every square is asked for under an address the release before never
    // used, so nothing a browser kept under that release's "keep for an hour" is reused.
    expect(new Set(asked).size).toBe(total);
    for (const url of asked) expect(url).toMatch(/\/features\/\d+\/\d+\/\d+\?g=[^&]*&c=2$/);

    // With fewer layers on, one left out before has room and is loaded.
    const fewer = [...LAYERS.slice(1, FIT), ...leftOut.slice(0, 1)];
    rerender({ layers: fewer });
    await waitFor(
      () => {
        expect(drawn()).toEqual(fewer.map((layer) => [layer.id, SQUARES_PER_LAYER]));
      },
      { timeout: 15_000 },
    );
    expect(result.current.notes.size).toBe(0);
    expect(n).toBe(total + SQUARES_PER_LAYER);

    // F-247-2-R4-02 and R5-02: nothing is kept of a layer that is off. Every layer switched
    // off, then on again: every square is asked for again, none drawn from the page's memory.
    rerender({ layers: [] });
    expect(result.current.overlays).toEqual([]);
    const before = n;
    rerender({ layers: LAYERS });
    await waitFor(
      () => {
        expect(n).toBe(before + total);
        expect(drawn()).toEqual(fitting.map((layer) => [layer.id, SQUARES_PER_LAYER]));
      },
      { timeout: 15_000 },
    );
  }, 40_000);

  // F-247-2-R21-01: the map moved on before a view's squares were answered. Their requests are
  // called off, so they cannot hold up the view the person is looking at.
  it('calls off the squares of a view the map has left', async () => {
    const elsewhere = { bbox: { west: -80, south: 43, east: -77, north: 44.5 }, zoom: 7 };
    const first: AbortSignal[] = [];
    let moved = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (moved) return Promise.resolve(Response.json(ONE_SHAPE));
        // The first view's squares are never answered; they end only when called off.
        const signal = init?.signal;
        if (!signal) return new Promise<Response>(() => undefined);
        first.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }),
    );
    const one = LAYERS.slice(0, 1);
    const { result, rerender, unmount } = renderHook(
      ({ view }: { view: typeof VIEW }) => useLayerOverlays(one, view, 'token'),
      { initialProps: { view: VIEW } },
    );
    await waitFor(() => {
      expect(first).toHaveLength(SQUARES_PER_LAYER);
    });
    expect(first.every((signal) => !signal.aborted)).toBe(true);

    moved = true;
    rerender({ view: elsewhere });
    expect(first.every((signal) => signal.aborted)).toBe(true);
    await waitFor(() => {
      expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
    });
    // Called off is not failed: nothing is said about the layer.
    expect(result.current.notes.size).toBe(0);

    // Back to the first view: its squares are asked for again, and answered.
    rerender({ view: VIEW });
    await waitFor(() => {
      expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
    });
    expect(result.current.notes.size).toBe(0);
    unmount();
  });

  // In development React mounts everything twice: the squares called off at the first unmount
  // are asked for again at the second mount (F-247-2-R21-01).
  it('loads its squares when React mounts it twice, as in development', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        init?.signal?.aborted
          ? Promise.reject(new DOMException('Aborted', 'AbortError'))
          : Promise.resolve(Response.json(ONE_SHAPE)),
      ),
    );
    const one = LAYERS.slice(0, 1);
    const { result } = renderHook(() => useLayerOverlays(one, VIEW, 'token'), {
      wrapper: StrictMode,
    });
    await waitFor(() => {
      expect(shapesOf(result.current.overlays)).toBe(1);
    });
    expect(result.current.notes.size).toBe(0);
  });

  // F-247-2-R20-01: which layers a view has room for, by the list's order.
  it('leaves out the layers a view has no room for, never the first', () => {
    const ids = (set: ReadonlySet<string>) => LAYERS.filter((layer) => set.has(layer.id));
    expect(ids(layersLeftOut(LAYERS, SQUARES_PER_LAYER, VIEW.zoom))).toEqual(LAYERS.slice(FIT));
    expect(layersLeftOut(LAYERS.slice(0, FIT), SQUARES_PER_LAYER, VIEW.zoom).size).toBe(0);
    // One layer always loads, however many squares its view has.
    expect(layersLeftOut(LAYERS.slice(0, 1), 5000, VIEW.zoom).size).toBe(0);
    expect(layersLeftOut(LAYERS.slice(0, 2), 5000, VIEW.zoom)).toEqual(new Set([LAYERS[1]?.id]));
    // A layer out of its zoom range, or from a file (fetched whole, once), takes no room.
    const hidden = { ...base, id: 'hidden', minZoom: 12 };
    const file = { ...base, id: 'file', kind: 'file' as const, url: null };
    expect(ids(layersLeftOut([hidden, file, ...LAYERS], SQUARES_PER_LAYER, VIEW.zoom))).toEqual(
      LAYERS.slice(FIT),
    );
    // A picture layer takes its squares like any other (F-247-2-R22-01).
    const pictures = { ...base, id: 'pictures', kind: 'arcgis_image' as const };
    expect(ids(layersLeftOut([pictures, ...LAYERS], SQUARES_PER_LAYER, VIEW.zoom))).toEqual(
      LAYERS.slice(FIT - 1),
    );
  });

  // F-247-2-R22-01: picture layers count toward what one view loads, from the moment the map
  // opens: an admin can set a hundred on for everyone, and the map is handed only those there
  // is room for; the others say so.
  it('hands the map only the picture layers a view has room for', () => {
    const many: MapLayerView[] = Array.from({ length: 100 }, (_, i) => ({
      ...base,
      id: `00000000-0000-4000-8000-1${String(i).padStart(11, '0')}`,
      name: `Synthetic pictures ${String(i)}`,
      kind: 'arcgis_image',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Nothing is fetched for picture layers here.'))),
    );
    // Before the map has said what is in view: 12 squares counted for each, so 50 of them.
    const { result, rerender } = renderHook(
      ({ view }: { view: typeof VIEW | null }) => useLayerOverlays(many, view, 'token'),
      { initialProps: { view: null as typeof VIEW | null } },
    );
    expect(result.current.overlays.map((overlay) => overlay.id)).toEqual(
      many.slice(0, 50).map((layer) => layer.id),
    );
    expect([...result.current.notes.keys()]).toEqual(many.slice(50).map((layer) => layer.id));

    // With the view known: as many as its squares leave room for.
    rerender({ view: VIEW });
    expect(result.current.overlays.map((overlay) => overlay.id)).toEqual(
      many.slice(0, FIT).map((layer) => layer.id),
    );
    for (const layer of many.slice(FIT)) {
      expect(result.current.notes.get(layer.id)).toBe(TOO_MANY_LAYERS_NOTE);
    }
    expect(result.current.overlays.length * SQUARES_PER_LAYER).toBeLessThanOrEqual(600);
  });

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
    const onStale = vi.fn();
    const closer = { ...VIEW, zoom: 8 };
    const { result, rerender } = renderHook(
      ({ view, retry }: { view: typeof VIEW; retry: number }) =>
        useLayerOverlays(one, view, 'token', NO_CHOICES, onStale, retry),
      { initialProps: { view: VIEW, retry: 0 } },
    );
    await waitFor(() => {
      expect(shapes()).toBeGreaterThan(0);
    });
    expect(onStale).not.toHaveBeenCalled();
    removed = true;
    rerender({ view: closer, retry: 0 });
    await waitFor(() => {
      expect(result.current.notes.size).toBe(1);
    });
    expect(shapes()).toBe(0);
    // The list of layers is asked to be read again: it says what is still there.
    expect(onStale).toHaveBeenCalledWith('missing');

    // F-247-2-R9-01 and R12-02: the layer is there again (on grain's side a suspended member is
    // answered "not found", then restored) and the list, read well, still holds it: told to ask
    // again, the map draws it without being moved or the page reloaded.
    removed = false;
    rerender({ view: closer, retry: 1 });
    await waitFor(() => {
      expect(shapes()).toBeGreaterThan(0);
    });
    expect(result.current.notes.size).toBe(0);
  });

  // F-247-2-R8-01: a square asked for before the layer was removed, answered after the 404.
  it('keeps no answer for a layer after the server said it was removed', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let removed = false;
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          await held;
          return Response.json(ONE_SHAPE);
        }
        return removed
          ? Response.json(
              { error: { code: 'NOT_FOUND', message: 'No such map layer.' } },
              { status: 404 },
            )
          : Response.json(ONE_SHAPE);
      }),
    );
    const one = LAYERS.slice(0, 1);
    const { result, rerender } = renderHook(
      ({ view }: { view: typeof VIEW }) => useLayerOverlays(one, view, 'token'),
      { initialProps: { view: VIEW } },
    );
    await waitFor(() => {
      expect(calls).toBe(SQUARES_PER_LAYER);
    });
    removed = true;
    rerender({ view: { ...VIEW, zoom: 8 } });
    await waitFor(() => {
      expect(result.current.notes.size).toBe(1);
    });
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(shapesOf(result.current.overlays)).toBe(0);
  });

  // F-247-2-R8-02: a square still on its way when the sign-in is renewed, refused afterwards as
  // asked under the old one: asked again at once under the new one, with the map standing still.
  it('asks again under a renewed sign-in for a square refused under the old one', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const withNew: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (new Headers(init?.headers).get('Authorization') === 'Bearer old') {
          await held;
          return Response.json(
            { error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } },
            { status: 401 },
          );
        }
        withNew.push(url);
        return Response.json(ONE_SHAPE);
      }),
    );
    const one = LAYERS.slice(0, 1);
    const { result, rerender } = renderHook(
      ({ token }: { token: string }) => useLayerOverlays(one, VIEW, token),
      { initialProps: { token: 'old' } },
    );
    rerender({ token: 'new' });
    expect(withNew).toEqual([]);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => {
      expect(withNew).toHaveLength(SQUARES_PER_LAYER);
      expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
    });
  });

  // F-247-2-R5-02 (and R7-01): a layer switched off and on again draws nothing kept from before:
  // not while its squares are asked for again, and not from an answer to a request sent before
  // it was switched off.
  it('draws nothing of a layer switched back on until it is answered afresh', async () => {
    const waiting: (() => void)[] = [];
    let hold = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (hold) {
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
          });
        }
        return Response.json(ONE_SHAPE);
      }),
    );
    const one = LAYERS.slice(0, 1);
    const none: MapLayerView[] = [];
    const { result, rerender } = renderHook(
      ({ layers }: { layers: MapLayerView[] }) => useLayerOverlays(layers, VIEW, 'token'),
      { initialProps: { layers: one } },
    );
    await waitFor(() => {
      expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
    });

    // Off and on again, the fresh requests not yet answered: nothing kept is drawn.
    hold = true;
    rerender({ layers: none });
    rerender({ layers: one });
    await waitFor(() => {
      expect(waiting).toHaveLength(SQUARES_PER_LAYER);
    });
    expect(shapesOf(result.current.overlays)).toBe(0);

    // Off and on once more: the answers to the requests sent before are not kept.
    const before = waiting.splice(0);
    rerender({ layers: none });
    rerender({ layers: one });
    await waitFor(() => {
      expect(waiting).toHaveLength(SQUARES_PER_LAYER);
    });
    await act(async () => {
      for (const answer of before) answer();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(shapesOf(result.current.overlays)).toBe(0);

    // The fresh answers are drawn.
    await act(async () => {
      for (const answer of waiting) answer();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
  });

  // F-247-2-R5-02: access removed while the map is open. The squares of the new zoom are
  // refused; those kept from the zoom before are not drawn in their place, and an answer to a
  // request sent before the refusal is not kept (R6-01).
  it('draws nothing kept once a square is refused, nor an answer that arrives after', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refuse = false;
    let slow = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (slow) {
          // Passed the membership check before access was removed, and answers slowly.
          slow = false;
          await held;
          return Response.json(ONE_SHAPE);
        }
        return refuse
          ? Response.json(
              { error: { code: 'FORBIDDEN', message: 'You are not a member.' } },
              { status: 403 },
            )
          : Response.json(ONE_SHAPE);
      }),
    );
    const one = LAYERS.slice(0, 1);
    const onStale = vi.fn();
    const later = { ...VIEW, zoom: 8 };
    const { result, rerender } = renderHook(
      ({ view, retry }: { view: typeof VIEW; retry: number }) =>
        useLayerOverlays(one, view, 'token', NO_CHOICES, onStale, retry),
      { initialProps: { view: VIEW, retry: 0 } },
    );
    await waitFor(() => {
      expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
    });
    slow = true;
    refuse = true;
    rerender({ view: later, retry: 0 });
    await waitFor(() => {
      expect(result.current.notes.size).toBe(1);
    });
    expect(shapesOf(result.current.overlays)).toBe(0);
    // Once for the view's refusals, not once per square (the first lets everything go), and
    // as a refusal of the person, not a missing layer.
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith('refused');
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(shapesOf(result.current.overlays)).toBe(0);

    // F-247-2-R12-02: access is back and the list read well again, the very same layers: told
    // to ask again, the map draws its squares without being moved.
    refuse = false;
    rerender({ view: later, retry: 1 });
    await waitFor(() => {
      expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
    });
    expect(result.current.notes.size).toBe(0);
  });

  // F-247-2-R7-02: a refusal to a request sent under an expired sign-in says nothing about the
  // person now: what the renewed sign-in has loaded stays, and the square is asked for again.
  it('keeps what a renewed sign-in loaded when an old request is refused late', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let oldCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (new Headers(init?.headers).get('Authorization') === 'Bearer old') {
          oldCalls += 1;
          // The first is still on its way when the sign-in is renewed, then refused.
          if (oldCalls === 1) {
            await held;
            return Response.json(
              { error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } },
              { status: 401 },
            );
          }
        }
        return Response.json(ONE_SHAPE);
      }),
    );
    const one = LAYERS.slice(0, 1);
    const { result, rerender } = renderHook(
      ({ token }: { token: string }) => useLayerOverlays(one, VIEW, token),
      { initialProps: { token: 'old' } },
    );
    await waitFor(() => {
      expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
    });
    rerender({ token: 'new' });
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => {
      expect(result.current.notes.size).toBe(0);
    });
    expect(shapesOf(result.current.overlays)).toBeGreaterThan(0);
  });
});

const NO_CHOICES = {};

const ONE_SHAPE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 1,
      geometry: { type: 'Point', coordinates: [-105, 50] },
      properties: {},
    },
  ],
};

function shapesOf(overlays: ReturnType<typeof useLayerOverlays>['overlays']): number {
  return overlays.reduce(
    (sum, overlay) => sum + (overlay.kind === 'features' ? overlay.data.features.length : 0),
    0,
  );
}
