import 'mapbox-gl/dist/mapbox-gl.css';

import { bboxFromBounds, type Bbox } from '@grain/domain';
import mapboxgl, { type FilterSpecification, type GeoJSONSource } from 'mapbox-gl';
import { useEffect, useRef } from 'react';

import {
  basemapStyle,
  isClutterLayer,
  mapPaint,
  pinFeatures,
  readMapColours,
  type Basemap,
  type MapBounds,
  type MapColours,
  type MapPin,
  type PinFeatureCollection,
} from '../lib/mapbox';
import type { LaneAreas } from '../lib/lanes';
import { isLayerPictureUrl, type MapOverlay, type PickedFeature } from '../lib/mapLayers';
import type { Theme } from '../lib/theme';

// The only module that calls Mapbox GL JS (docs/DECISIONS.md, map decision). It is loaded
// on demand by the pages with a map, so the rest of the app does not download it.

// Western Canada and the northern U.S. plains.
const START: [number, number, number, number] = [-120, 42, -88, 57];
const SOURCE = 'facilities';
const PINS = 'facilities';
const SELECTED = 'facilities-selected';
// A carrier's lanes (owner's request, 2026-11-01): the places it runs between, shaded.
const AREAS = 'lane-areas';
const AREA_FILL = 'lane-areas-fill';
const AREA_OUTLINE = 'lane-areas-outline';
const AREA_OUTLINE_QUOTED = 'lane-areas-outline-quoted';
// Map layers from outside sources (F-107), drawn under the lanes and the pins.
const OVERLAY = 'gss-layer-';
const EMPTY: LaneAreas = {
  regions: { type: 'FeatureCollection', features: [] },
};

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
  /** The starting view [west, south, east, north]; western Canada and the plains by default. */
  start?: MapBounds;
  /** The closest the starting view zooms in, so one location is not shown at street level. */
  startMaxZoom?: number;
  /** A small map on a longer page: the page scrolls past it; two fingers or Ctrl+scroll zoom. */
  cooperative?: boolean;
  /** Without road names, highway numbers and points of interest (isClutterLayer). */
  simple?: boolean;
  /**
   * Moves to hold these bounds whenever they change (the pins a filter leaves), without
   * reloading the map; null leaves the view as it is.
   */
  fitTo?: MapBounds | null;
  /**
   * A carrier's lanes: places shaded darker where lanes start, lighter where they end, and
   * outlined with dashes where only its freight rates run (no lines between them, 2026-11-02).
   */
  areas?: LaneAreas | null;
  /** The visible box and zoom after every move; null when none of it is on the map. */
  onViewChange?: (bbox: Bbox | null, zoom: number) => void;
  /** Map layers that are switched on, in order, drawn under the lanes and the pins. */
  overlays?: readonly MapOverlay[];
  /** The person's sign-in, sent with a layer's pictures (they come from the app's API). */
  authToken?: string;
  /** A feature of a map layer was clicked (not a pin). */
  onOverlayClick?: (picked: PickedFeature) => void;
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
    'mixed',
    colours.mixed,
    colours.bid,
  ];
  return {
    // Approximate locations are hollow, exact ones filled (specification section 6).
    'circle-color': ['case', ['get', 'hollow'], colours.hollow, tone],
    'circle-stroke-color': tone,
  };
}

/** Hides road names, highway numbers and points of interest on a simple map. */
function hideClutter(map: mapboxgl.Map) {
  for (const layer of map.getStyle().layers) {
    if (isClutterLayer(layer)) map.setLayoutProperty(layer.id, 'visibility', 'none');
  }
}

/** Lane areas take the colour of carriers' pins. */
function paintAreas(map: mapboxgl.Map, colours: MapColours) {
  if (!map.getLayer(AREA_FILL)) return;
  map.setPaintProperty(AREA_FILL, 'fill-color', colours.mixed);
  for (const layer of [AREA_OUTLINE, AREA_OUTLINE_QUOTED]) {
    map.setPaintProperty(layer, 'line-color', colours.mixed);
  }
}

function addAreaLayers(map: mapboxgl.Map, areas: LaneAreas) {
  if (map.getSource(AREAS)) return;
  const colours = readMapColours();
  const quoted: mapboxgl.FilterSpecification = ['==', ['get', 'role'], 'quoted'];
  const entered: mapboxgl.FilterSpecification = ['!=', ['get', 'role'], 'quoted'];
  map.addSource(AREAS, { type: 'geojson', data: areas.regions });
  // Under the pins, whenever they were added.
  const below = map.getLayer(SELECTED) ? SELECTED : undefined;
  const addLayer = (layer: mapboxgl.LayerSpecification) => {
    map.addLayer(layer, below);
  };
  addLayer({
    id: AREA_FILL,
    type: 'fill',
    source: AREAS,
    filter: entered,
    paint: {
      'fill-color': colours.mixed,
      'fill-opacity': ['match', ['get', 'role'], 'from', 0.5, 0.2],
    },
  });
  addLayer({
    id: AREA_OUTLINE,
    type: 'line',
    source: AREAS,
    filter: entered,
    paint: { 'line-color': colours.mixed, 'line-width': 1.5 },
  });
  addLayer({
    id: AREA_OUTLINE_QUOTED,
    type: 'line',
    source: AREAS,
    filter: quoted,
    paint: { 'line-color': colours.mixed, 'line-width': 1.5, 'line-dasharray': [2, 2] },
  });
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
  paintAreas(map, colours);
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

function overlayLayerIds(id: string): string[] {
  return [
    `${OVERLAY}${id}-fill`,
    `${OVERLAY}${id}-line`,
    `${OVERLAY}${id}-point`,
    `${OVERLAY}${id}-pictures`,
  ];
}

/** Every drawn layer of the map layers that are on, for clicks. */
function drawnOverlayLayers(map: mapboxgl.Map, overlays: readonly MapOverlay[]): string[] {
  return overlays.flatMap((o) => overlayLayerIds(o.id)).filter((id) => map.getLayer(id));
}

/**
 * Brings the map's layers in line with the overlays: adds the ones switched on, updates their
 * features and colours, and removes the ones switched off. Areas are filled lightly, lines
 * drawn on top, points as small dots; pictures slightly see-through.
 */
function syncOverlays(map: mapboxgl.Map, overlays: readonly MapOverlay[]) {
  const wanted = new Set(overlays.map((o) => `${OVERLAY}${o.id}`));
  for (const layer of map.getStyle().layers) {
    const source = 'source' in layer ? layer.source : undefined;
    if (typeof source === 'string' && source.startsWith(OVERLAY) && !wanted.has(source)) {
      map.removeLayer(layer.id);
    }
  }
  for (const id of Object.keys(map.getStyle().sources)) {
    if (id.startsWith(OVERLAY) && !wanted.has(id)) map.removeSource(id);
  }
  // Under the lanes and the pins, whichever is lowest.
  const below = [AREA_FILL, SELECTED, PINS].find((id) => map.getLayer(id));
  for (const overlay of overlays) {
    const source = `${OVERLAY}${overlay.id}`;
    const [fill, line, point, pictures] = overlayLayerIds(overlay.id) as [
      string,
      string,
      string,
      string,
    ];
    if (overlay.kind === 'pictures') {
      if (!map.getSource(source)) {
        map.addSource(source, { type: 'raster', tiles: [overlay.tiles], tileSize: 256 });
        map.addLayer(
          { id: pictures, type: 'raster', source, paint: { 'raster-opacity': 0.8 } },
          below,
        );
      }
      continue;
    }
    const existing = map.getSource<GeoJSONSource>(source);
    if (existing) existing.setData(overlay.data);
    else {
      map.addSource(source, { type: 'geojson', data: overlay.data });
      map.addLayer(
        {
          id: fill,
          type: 'fill',
          source,
          paint: { 'fill-opacity': 0.25 },
        },
        below,
      );
      map.addLayer(
        {
          id: line,
          type: 'line',
          source,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 2, 12, 3] },
        },
        below,
      );
      map.addLayer(
        {
          id: point,
          type: 'circle',
          source,
          paint: {
            'circle-radius': 4,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        },
        below,
      );
    }
    // Each kind of shape, and only the values the person shows (F-133).
    const only = (shape: FilterSpecification): FilterSpecification =>
      overlay.filter ? ['all', shape, overlay.filter] : shape;
    map.setFilter(fill, only(['==', ['geometry-type'], 'Polygon']));
    map.setFilter(line, only(['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]]));
    map.setFilter(point, only(['==', ['geometry-type'], 'Point']));
    map.setPaintProperty(fill, 'fill-color', overlay.colour);
    map.setPaintProperty(line, 'line-color', overlay.colour);
    map.setPaintProperty(point, 'circle-color', overlay.colour);
  }
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
    const { start, startMaxZoom, cooperative } = latest.current;
    const instance = new mapboxgl.Map({
      container: element,
      accessToken: token,
      style: shownStyle.current,
      bounds: start ?? START,
      fitBoundsOptions: {
        padding: { top: 24, bottom: 24, left: 24, right: 24 + (latest.current.coveredRight ?? 0) },
        ...(startMaxZoom !== undefined && { maxZoom: startMaxZoom }),
      },
      cooperativeGestures: cooperative ?? false,
      projection: 'mercator',
      // Added below on the same side as the zoom buttons, so a panel never hides it.
      attributionControl: false,
      // A map layer's pictures come from the app's API, which needs the person's sign-in.
      transformRequest: (url) => {
        const auth = latest.current.authToken;
        return auth && isLayerPictureUrl(url)
          ? { url, headers: { Authorization: `Bearer ${auth}` } }
          : { url };
      },
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
        instance.getZoom(),
      );
    };
    instance.on('load', report);
    instance.on('moveend', report);
    // Also after a basemap or theme change, which replaces the whole style.
    instance.on('style.load', () => {
      if (latest.current.simple) hideClutter(instance);
      if (latest.current.areas) addAreaLayers(instance, latest.current.areas);
      paintTheme(instance, latest.current.basemap);
      addPinLayers(instance, latest.current.data, latest.current.selectedId);
      syncOverlays(instance, latest.current.overlays ?? []);
    });
    // A click on a map layer's feature, unless it is on a pin (the pin wins).
    instance.on('click', (event) => {
      const onClick = latest.current.onOverlayClick;
      if (!onClick) return;
      const layers = drawnOverlayLayers(instance, latest.current.overlays ?? []);
      if (layers.length === 0) return;
      if (
        instance.getLayer(PINS) &&
        instance.queryRenderedFeatures(event.point, { layers: [PINS] }).length > 0
      ) {
        return;
      }
      const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [event.point.x - 4, event.point.y - 4],
        [event.point.x + 4, event.point.y + 4],
      ];
      const feature = instance.queryRenderedFeatures(box, { layers })[0];
      const source = feature?.source;
      if (!feature || typeof source !== 'string') return;
      onClick({
        layerId: source.slice(OVERLAY.length),
        properties: { ...(feature.properties ?? {}) },
      });
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
    const instance = map.current;
    if (!instance?.isStyleLoaded()) return;
    if (props.areas && !instance.getSource(AREAS)) {
      addAreaLayers(instance, props.areas);
      return;
    }
    const areas = props.areas ?? EMPTY;
    instance.getSource<GeoJSONSource>(AREAS)?.setData(areas.regions);
  }, [props.areas]);

  useEffect(() => {
    const instance = map.current;
    if (instance?.isStyleLoaded()) syncOverlays(instance, props.overlays ?? []);
  }, [props.overlays]);

  // Compared as text, so a new array with the same bounds does not move the map.
  const fitKey = props.fitTo ? props.fitTo.join(',') : null;
  useEffect(() => {
    const bounds = latest.current.fitTo;
    if (!map.current || !bounds) return;
    map.current.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 600 });
  }, [fitKey]);

  useEffect(() => {
    if (map.current?.getLayer(SELECTED)) {
      map.current.setFilter(SELECTED, selectedFilter(selectedId));
    }
  }, [selectedId]);

  return <div ref={container} className="size-full" />;
}
