import 'mapbox-gl/dist/mapbox-gl.css';

import { bboxFromBounds, type Bbox } from '@grain/domain';
import mapboxgl, { type GeoJSONSource } from 'mapbox-gl';
import { useEffect, useRef } from 'react';

import {
  basemapStyle,
  mapPaint,
  pinFeatures,
  readMapColours,
  type Basemap,
  type MapColours,
  type MapPin,
  type PinFeatureCollection,
} from '../lib/mapbox';
import type { Theme } from '../lib/theme';

// The only module that calls Mapbox GL JS (docs/DECISIONS.md, map decision). It is loaded
// on demand by the pages with a map, so the rest of the app does not download it.

// Western Canada and the northern U.S. plains.
const START: [number, number, number, number] = [-120, 42, -88, 57];
const SOURCE = 'facilities';
const PINS = 'facilities';
const SELECTED = 'facilities-selected';

export interface FacilityMapProps {
  token: string;
  basemap: Basemap;
  /** Light or night: picks Mapbox's light or dark style and the theme's map colours. */
  theme: Theme;
  pins: readonly MapPin[];
  selectedId: string | null;
  /** Where the zoom buttons go; the workspace keeps the right side for its order book. */
  controls?: 'top-left' | 'top-right';
  /** Pixels on the right covered by a panel; the starting view keeps the pins clear of it. */
  coveredRight?: number;
  /** The visible box after every move; null when none of it is on the map. */
  onViewChange?: (bbox: Bbox | null) => void;
  onSelect: (pinId: string) => void;
  /** Mapbox refused the token (wrong token or not allowed on this address). */
  onTokenRefused: () => void;
}

function selectedFilter(selectedId: string | null): mapboxgl.FilterSpecification {
  return ['==', ['get', 'id'], selectedId ?? ''];
}

function pinPaint(colours: MapColours): {
  'circle-color': mapboxgl.ExpressionSpecification;
  'circle-stroke-color': mapboxgl.ExpressionSpecification;
} {
  const tone: mapboxgl.ExpressionSpecification = [
    'match',
    ['get', 'tone'],
    'offer',
    colours.offer,
    colours.bid,
  ];
  return {
    // Approximate locations are hollow, exact ones filled (specification section 6).
    'circle-color': ['case', ['get', 'hollow'], colours.hollow, tone],
    'circle-stroke-color': tone,
  };
}

/** Repaints the base map (for the "Map" style only) and the pins in the theme's colours. */
function paintTheme(map: mapboxgl.Map, basemap: Basemap) {
  const colours = readMapColours();
  if (basemap === 'map') {
    for (const layer of map.getStyle().layers) {
      for (const [name, value] of mapPaint(layer, colours)) {
        // Names come from mapPaint's fixed list, valid for each layer type.
        map.setPaintProperty(layer.id, name as 'fill-color', value);
      }
    }
  }
  if (map.getLayer(PINS)) {
    const paint = pinPaint(colours);
    map.setPaintProperty(PINS, 'circle-color', paint['circle-color']);
    map.setPaintProperty(PINS, 'circle-stroke-color', paint['circle-stroke-color']);
    map.setPaintProperty(SELECTED, 'circle-stroke-color', colours.selected);
  }
}

function addPinLayers(map: mapboxgl.Map, data: PinFeatureCollection, selectedId: string | null) {
  if (map.getSource(SOURCE)) return;
  const colours = readMapColours();
  map.addSource(SOURCE, { type: 'geojson', data });
  map.addLayer({
    id: SELECTED,
    type: 'circle',
    source: SOURCE,
    filter: selectedFilter(selectedId),
    paint: {
      'circle-radius': 11,
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-stroke-color': colours.selected,
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: PINS,
    type: 'circle',
    source: SOURCE,
    paint: { 'circle-radius': 6, 'circle-stroke-width': 2, ...pinPaint(colours) },
  });
}

/** A Mapbox map with the given pins. */
export default function FacilityMap(props: FacilityMapProps) {
  const { token, basemap, theme, pins, selectedId } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const shownStyle = useRef(basemapStyle(basemap, theme));
  // The latest props, read by map event handlers that are registered once.
  const latest = useRef({ ...props, data: pinFeatures(pins) });
  useEffect(() => {
    latest.current = { ...props, data: pinFeatures(props.pins) };
  });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = new mapboxgl.Map({
      container: element,
      accessToken: token,
      style: shownStyle.current,
      bounds: START,
      fitBoundsOptions: {
        padding: { top: 24, bottom: 24, left: 24, right: 24 + (latest.current.coveredRight ?? 0) },
      },
      projection: 'mercator',
      // Added below on the same side as the zoom buttons, so a panel never hides it.
      attributionControl: false,
    });
    const side = latest.current.controls ?? 'top-right';
    instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), side);
    // Mapbox's terms require its attribution to stay visible.
    instance.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      side === 'top-left' ? 'bottom-left' : 'bottom-right',
    );
    const report = () => {
      const bounds = instance.getBounds();
      latest.current.onViewChange?.(
        bounds &&
          bboxFromBounds(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()),
      );
    };
    instance.on('load', report);
    instance.on('moveend', report);
    // Also after a basemap or theme change, which replaces the whole style.
    instance.on('style.load', () => {
      paintTheme(instance, latest.current.basemap);
      addPinLayers(instance, latest.current.data, latest.current.selectedId);
    });
    instance.on('click', PINS, (event) => {
      const id: unknown = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') latest.current.onSelect(id);
    });
    instance.on('mouseenter', PINS, () => {
      instance.getCanvas().style.cursor = 'pointer';
    });
    instance.on('mouseleave', PINS, () => {
      instance.getCanvas().style.cursor = '';
    });
    instance.on('error', (event: { error?: unknown }) => {
      const status: unknown =
        typeof event.error === 'object' && event.error !== null && 'status' in event.error
          ? event.error.status
          : undefined;
      if (status === 401 || status === 403) latest.current.onTokenRefused();
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, [token]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const style = basemapStyle(basemap, theme);
    if (shownStyle.current !== style) {
      shownStyle.current = style;
      // Without diffing, the whole style reloads, so 'style.load' repaints and adds the pins.
      // (Mapbox's types also demand its font options, which setStyle otherwise keeps.)
      const reload = { diff: false } as Parameters<mapboxgl.Map['setStyle']>[1];
      instance.setStyle(style, reload);
    } else if (instance.isStyleLoaded()) {
      // Same imagery (satellite), new theme: only the pins change colour.
      paintTheme(instance, basemap);
    }
  }, [basemap, theme]);

  useEffect(() => {
    map.current?.getSource<GeoJSONSource>(SOURCE)?.setData(pinFeatures(pins));
  }, [pins]);

  useEffect(() => {
    if (map.current?.getLayer(SELECTED)) {
      map.current.setFilter(SELECTED, selectedFilter(selectedId));
    }
  }, [selectedId]);

  return <div ref={container} className="size-full" />;
}
