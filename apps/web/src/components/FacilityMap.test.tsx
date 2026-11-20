import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MapOverlay } from '../lib/mapLayers';
import FacilityMap from './FacilityMap';

// Mapbox GL JS needs WebGL and Mapbox's servers. A stand-in keeps the sources and layers it is
// given and, like Mapbox, says its style is not loaded while any tile is still on its way.
// Everything else the component calls does nothing.
interface FakeMap {
  sources: Map<string, unknown>;
  layers: { id: string; source?: string }[];
  tilesPending: boolean;
  fire: (type: string) => void;
}
const maps = vi.hoisted(() => [] as FakeMap[]);

vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));
vi.mock('mapbox-gl', () => {
  class Fake {
    sources = new Map<string, unknown>();
    layers: { id: string; source?: string }[] = [];
    tilesPending = false;
    private readonly handlers = new Map<string, (() => void)[]>();

    constructor() {
      maps.push(this);
      // Whatever else the component calls on a map does nothing.
      return new Proxy(this, {
        get: (target, name, receiver) =>
          name in target ? (Reflect.get(target, name, receiver) as unknown) : () => undefined,
      });
    }
    on(type: string, handler: unknown) {
      // Clicks on one layer come as on(type, layer, handler): not fired here.
      if (typeof handler !== 'function') return;
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler as () => void]);
    }
    fire(type: string) {
      for (const handler of this.handlers.get(type) ?? []) handler();
    }
    isStyleLoaded() {
      return !this.tilesPending;
    }
    getStyle() {
      return { layers: this.layers, sources: Object.fromEntries(this.sources) };
    }
    addSource(id: string, source: unknown) {
      this.sources.set(id, source);
    }
    getSource(id: string) {
      return this.sources.has(id) ? { type: 'raster', setData: () => undefined } : undefined;
    }
    removeSource(id: string) {
      this.sources.delete(id);
    }
    addLayer(layer: { id: string; source?: string }) {
      this.layers.push(layer);
    }
    getLayer(id: string) {
      return this.layers.find((layer) => layer.id === id);
    }
    removeLayer(id: string) {
      this.layers = this.layers.filter((layer) => layer.id !== id);
    }
    hasImage() {
      return true;
    }
    getCanvas() {
      return { style: {} };
    }
    getContainer() {
      return { clientHeight: 400 };
    }
  }
  // The zoom buttons and the attribution: made, handed to the map, nothing more.
  const Control = vi.fn();
  return {
    default: {
      Map: Fake,
      NavigationControl: Control,
      AttributionControl: Control,
      ScaleControl: Control,
    },
  };
});

const LAYER = '00000000-0000-4000-8000-0000000a1a01';
/** A synthetic picture layer, as the Layers switch hands it to the map. */
const pictures: MapOverlay = {
  id: LAYER,
  kind: 'pictures',
  tiles: `${window.location.origin}/api/v1/petroleum/layers/${LAYER}/tiles/{z}/{x}/{y}.png`,
};

function drawn(map: FakeMap): string[] {
  return [...map.sources.keys()].filter((id) => id.includes(LAYER));
}

function mapWith(overlays: readonly MapOverlay[]) {
  return (
    <FacilityMap
      token="pk.synthetic"
      basemap="map"
      theme="light"
      pins={[]}
      selectedId={null}
      overlays={overlays}
      onSelect={() => undefined}
      onTokenRefused={() => undefined}
    />
  );
}

beforeEach(() => {
  maps.length = 0;
});

describe('FacilityMap and its map layers', () => {
  // F-247-2-R11-01: Mapbox says its style is not loaded while any picture is still on its way.
  // A layer switched off at such a moment was skipped, and stayed drawn while the map stood still.
  it('takes a picture layer off the map when it is switched off while pictures load', () => {
    const { rerender } = render(mapWith([pictures]));
    const map = maps[0];
    if (!map) throw new Error('No map was made.');
    // Nothing is drawn before the style has loaded; its loading draws the layers that are on.
    expect(drawn(map)).toEqual([]);
    act(() => {
      map.fire('style.load');
    });
    expect(drawn(map)).toHaveLength(1);

    map.tilesPending = true;
    rerender(mapWith([]));
    expect(drawn(map)).toEqual([]);
    expect(map.layers.filter((layer) => layer.source?.includes(LAYER))).toEqual([]);

    // And back on, pictures still loading.
    rerender(mapWith([pictures]));
    expect(drawn(map)).toHaveLength(1);
  });
});
