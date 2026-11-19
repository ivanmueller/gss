import 'mapbox-gl/dist/mapbox-gl.css';

import { bboxFromBounds, type Bbox } from '@grain/domain';
import mapboxgl, { type FilterSpecification, type GeoJSONSource } from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState } from 'react';

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
import { drawPin, PIN_KINDS, PIN_RATIO, PIN_TONES, pinImageId } from '../lib/mapPinImages';
import {
  isLayerPictureUrl,
  layerPictureStale,
  mapRequestRefusal,
  PictureSignIns,
  USUAL_LOOK,
  type MapOverlay,
  type OverlayLook,
  type PickedFeature,
  type StaleReason,
} from '../lib/mapLayers';
import type { Theme } from '../lib/theme';
import { PinDetailsBox, type PinAnchor } from './PinDetailsBox';

// The only module that calls Mapbox GL JS (docs/DECISIONS.md, map decision). It is loaded
// on demand by the pages with a map, so the rest of the app does not download it.

// Western Canada and the northern U.S. plains.
const START: [number, number, number, number] = [-120, 42, -88, 57];
const SOURCE = 'facilities';
const PINS = 'facilities';
// Each place's name, from a close zoom.
const LABELS = 'facilities-labels';
// The chosen place, drawn larger on top of the others, from a source of its own. Every place
// keeps its own pin at every zoom, overlapping where crowded, never grouped (F-237).
const SELECTED_SOURCE = 'facilities-selected-source';
const SELECTED = 'facilities-selected';
const NAMES_FROM_ZOOM = 9;
const NOTHING = (): void => undefined;
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
  /**
   * A map layer's picture was refused or its layer is no longer there: the list of layers is
   * read again, and a layer it no longer holds leaves the map (F-247-2-R9-02).
   */
  onLayersStale?: ((reason: StaleReason) => void) | undefined;
  /**
   * Bumped when access is back after a refusal: the layers' pictures are asked for again, the
   * map standing still (F-247-2-R12-02).
   */
  layersRetry?: number | undefined;
}

function selectedData(pins: readonly MapPin[], selectedId: string | null): PinFeatureCollection {
  return pinFeatures(pins.filter((pin) => pin.id === selectedId));
}

/** The picture of each pin, by its kind, tone and fill; the layer picks one by its properties. */
const PIN_IMAGE: mapboxgl.ExpressionSpecification = [
  'concat',
  'pin-',
  ['get', 'kind'],
  '-',
  ['get', 'tone'],
  '-',
  ['case', ['get', 'hollow'], 'h', 'f'],
];

/** Draws the pin pictures in the theme's colours and gives them to the map. */
function addPinImages(map: mapboxgl.Map, colours: MapColours) {
  for (const kind of PIN_KINDS) {
    for (const tone of PIN_TONES) {
      for (const hollow of [false, true]) {
        // Approximate locations are hollow, exact ones filled (specification section 6).
        const image = drawPin(kind, tone, hollow, colours);
        if (!image) return;
        const id = pinImageId(kind, tone, hollow);
        if (map.hasImage(id)) map.updateImage(id, image);
        else map.addImage(id, image, { pixelRatio: PIN_RATIO });
      }
    }
  }
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
  const below = map.getLayer(PINS) ? PINS : undefined;
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
  addPinImages(map, colours);
  if (map.getLayer(LABELS)) {
    map.setPaintProperty(LABELS, 'text-color', colours.label);
    map.setPaintProperty(LABELS, 'text-halo-color', colours.labelHalo);
  }
  paintAreas(map, colours);
}

function addPinLayers(
  map: mapboxgl.Map,
  data: PinFeatureCollection,
  selected: PinFeatureCollection,
) {
  if (map.getSource(SOURCE)) return;
  const colours = readMapColours();
  addPinImages(map, colours);
  map.addSource(SOURCE, { type: 'geojson', data });
  map.addSource(SELECTED_SOURCE, { type: 'geojson', data: selected });
  map.addLayer({
    id: PINS,
    type: 'symbol',
    source: SOURCE,
    layout: {
      'icon-image': PIN_IMAGE,
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: LABELS,
    type: 'symbol',
    source: SOURCE,
    minzoom: NAMES_FROM_ZOOM,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.3],
      'text-max-width': 9,
    },
    paint: {
      'text-color': colours.label,
      'text-halo-color': colours.labelHalo,
      'text-halo-width': 1.5,
    },
  });
  map.addLayer({
    id: SELECTED,
    type: 'symbol',
    source: SELECTED_SOURCE,
    layout: {
      'icon-image': PIN_IMAGE,
      'icon-anchor': 'bottom',
      'icon-size': 1.3,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
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

/** GSS's usual line width, widening with the zoom. */
const USUAL_LINE_WIDTH: mapboxgl.ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3,
  1,
  8,
  2,
  12,
  3,
];

/** A layer's look as ArcGIS presents it (F-138): width, opacity and the zooms it shows between. */
function applyLook(map: mapboxgl.Map, ids: readonly string[], look: OverlayLook) {
  const [fill, line, point, pictures] = ids as [string, string, string, string];
  for (const id of ids) {
    if (map.getLayer(id)) map.setLayerZoomRange(id, look.minZoom ?? 0, look.maxZoom ?? 24);
  }
  if (map.getLayer(pictures)) {
    map.setPaintProperty(pictures, 'raster-opacity', look === USUAL_LOOK ? 0.8 : look.opacity);
    return;
  }
  map.setPaintProperty(line, 'line-width', look.lineWidth ?? USUAL_LINE_WIDTH);
  map.setPaintProperty(line, 'line-opacity', look.opacity);
  map.setPaintProperty(fill, 'fill-opacity', 0.25 * look.opacity);
  map.setPaintProperty(point, 'circle-opacity', look.opacity);
  map.setPaintProperty(point, 'circle-stroke-opacity', look.opacity);
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
  const below = [AREA_FILL, PINS].find((id) => map.getLayer(id));
  for (const overlay of overlays) {
    const source = `${OVERLAY}${overlay.id}`;
    const [fill, line, point, pictures] = overlayLayerIds(overlay.id) as [
      string,
      string,
      string,
      string,
    ];
    // In the list's order, each above the one before (a map's layers as ArcGIS stacks them,
    // F-138), all under the lanes and the pins.
    for (const id of [fill, line, point, pictures]) {
      if (map.getLayer(id)) map.moveLayer(id, below);
    }
    if (overlay.kind === 'pictures') {
      if (!map.getSource(source)) {
        map.addSource(source, {
          type: 'raster',
          tiles: [overlay.tiles],
          tileSize: 256,
          // A pre-drawn layer's own levels (F-141): its last level enlarged when zoomed further.
          ...(overlay.levels && { minzoom: overlay.levels.min, maxzoom: overlay.levels.max }),
        });
        map.addLayer(
          { id: pictures, type: 'raster', source, paint: { 'raster-opacity': 0.8 } },
          below,
        );
      }
      applyLook(map, [fill, line, point, pictures], overlay.look ?? USUAL_LOOK);
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
          paint: { 'line-width': USUAL_LINE_WIDTH },
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
    applyLook(map, [fill, line, point, pictures], overlay.look ?? USUAL_LOOK);
  }
}

/** A Mapbox map with the given pins. */
export default function FacilityMap(props: FacilityMapProps) {
  const { token, basemap, theme, pins, selectedId } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const shownStyle = useRef(basemapStyle(basemap, theme));
  /**
   * Whether the map's style can take sources and layers now: from its 'style.load' until another
   * style is set. Not Mapbox's isStyleLoaded(), which is also false while any picture or tile is
   * still loading: a layer switched off at such a moment was skipped and stayed drawn while the
   * map stood still (F-247-2-R11-01).
   */
  const styleReady = useRef(false);
  // The sign-in sent with each map layer picture, for pictures refused when it lapsed.
  const pictureSignIns = useRef(new PictureSignIns());
  // The latest props, read by map event handlers that are registered once.
  const latest = useRef({ ...props, data: pinFeatures(pins) });
  // The box on the map: where the chosen pin is on screen, and the pin whose box was closed.
  const [anchor, setAnchor] = useState<PinAnchor | null>(null);
  const [closedId, setClosedId] = useState<string | null>(null);
  // The latest handlers, read by map event handlers that are registered once.
  const handlers = useRef({ close: NOTHING, reopen: NOTHING, place: NOTHING });
  // A map layer's pictures asked for again with a renewed sign-in.
  const reloadPictures = (instance: mapboxgl.Map) => {
    for (const overlay of latest.current.overlays ?? []) {
      if (overlay.kind !== 'pictures') continue;
      const source = instance.getSource(`${OVERLAY}${overlay.id}`);
      if (source?.type === 'raster') source.reload();
    }
  };

  useEffect(() => {
    latest.current = { ...props, data: pinFeatures(props.pins) };
  });

  // Where the chosen pin is in the map's box, kept up to date while the map moves.
  const place = useCallback(() => {
    const instance = map.current;
    const { pins: current, selectedId: id } = latest.current;
    const pin = id === null ? undefined : current.find((candidate) => candidate.id === id);
    if (!instance || !pin) {
      setAnchor(null);
      return;
    }
    const point = instance.project([pin.longitude, pin.latitude]);
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    // The box opens downward from the pin, or upward when the pin is in the map's lower half,
    // so it stays inside the map whatever its height.
    const height = instance.getContainer().clientHeight;
    const up = point.y > height / 2;
    setAnchor((before) =>
      before?.x === x && before.y === y && before.height === height && before.up === up
        ? before
        : { x, y, height, up },
    );
  }, []);
  const closeBox = useCallback(() => {
    setClosedId(latest.current.selectedId);
  }, []);
  useEffect(() => {
    handlers.current = {
      close: closeBox,
      reopen: () => {
        setClosedId(null);
      },
      place,
    };
  }, [place, closeBox]);

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
        if (!auth || !isLayerPictureUrl(url)) return { url };
        pictureSignIns.current.sent(url, auth);
        return { url, headers: { Authorization: `Bearer ${auth}` } };
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
        bboxFromBounds(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()),
        instance.getZoom(),
      );
    };
    instance.on('load', report);
    instance.on('moveend', report);
    // Also after a basemap or theme change, which replaces the whole style.
    instance.on('style.load', () => {
      styleReady.current = true;
      if (latest.current.simple) hideClutter(instance);
      if (latest.current.areas) addAreaLayers(instance, latest.current.areas);
      paintTheme(instance, latest.current.basemap);
      addPinLayers(
        instance,
        latest.current.data,
        selectedData(latest.current.pins, latest.current.selectedId),
      );
      syncOverlays(instance, latest.current.overlays ?? []);
      handlers.current.place();
    });
    instance.on('move', () => {
      handlers.current.place();
    });
    // A click on the empty map closes the box on the map.
    instance.on('click', (event) => {
      const layers = [PINS, SELECTED].filter((id) => instance.getLayer(id));
      if (layers.length > 0 && instance.queryRenderedFeatures(event.point, { layers }).length > 0) {
        return;
      }
      handlers.current.close();
    });
    // A click on a map layer's feature, unless it is on a pin (the pin wins).
    instance.on('click', (event) => {
      const onClick = latest.current.onOverlayClick;
      if (!onClick) return;
      const layers = drawnOverlayLayers(instance, latest.current.overlays ?? []);
      if (layers.length === 0) return;
      if (
        instance.getLayer(PINS) &&
        instance.queryRenderedFeatures(event.point, { layers: [PINS, SELECTED] }).length > 0
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
    // The chosen pin's larger copy is clickable too: a click on it opens its box again.
    for (const layer of [PINS, SELECTED]) {
      instance.on('click', layer, (event) => {
        const id: unknown = event.features?.[0]?.properties?.id;
        if (typeof id !== 'string') return;
        handlers.current.reopen();
        latest.current.onSelect(id);
      });
      instance.on('mouseenter', layer, () => {
        instance.getCanvas().style.cursor = 'pointer';
      });
      instance.on('mouseleave', layer, () => {
        instance.getCanvas().style.cursor = '';
      });
    }
    instance.on('error', (event: { error?: unknown }) => {
      const refusal = mapRequestRefusal(event.error);
      if (refusal === 'mapbox-token') latest.current.onTokenRefused();
      const stale = layerPictureStale(event.error);
      if (stale) latest.current.onLayersStale?.(stale);
      // The person's sign-in lapsed: the pictures load again once it renews (below), or at
      // once if it renewed while this answer was on its way.
      const url = (event.error as { url?: unknown }).url;
      if (
        refusal === 'sign-in' &&
        typeof url === 'string' &&
        pictureSignIns.current.refused(url, latest.current.authToken)
      ) {
        reloadPictures(instance);
      }
    });
    map.current = instance;
    return () => {
      styleReady.current = false;
      instance.remove();
      map.current = null;
    };
  }, [token]);

  const { authToken } = props;
  useEffect(() => {
    const instance = map.current;
    if (instance && pictureSignIns.current.renewed(authToken)) reloadPictures(instance);
  }, [authToken]);

  const { layersRetry } = props;
  useEffect(() => {
    const instance = map.current;
    if (instance && styleReady.current && layersRetry) reloadPictures(instance);
  }, [layersRetry]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const style = basemapStyle(basemap, theme);
    if (shownStyle.current !== style) {
      shownStyle.current = style;
      // Without diffing, the whole style reloads, so 'style.load' repaints and adds the pins.
      // (Mapbox's types also demand its font options, which setStyle otherwise keeps.)
      const reload = { diff: false } as Parameters<mapboxgl.Map['setStyle']>[1];
      styleReady.current = false;
      instance.setStyle(style, reload);
    } else if (styleReady.current) {
      // Same imagery (satellite), new theme: only the pins change colour.
      paintTheme(instance, basemap);
    }
  }, [basemap, theme]);

  useEffect(() => {
    map.current?.getSource<GeoJSONSource>(SOURCE)?.setData(pinFeatures(pins));
    map.current?.getSource<GeoJSONSource>(SELECTED_SOURCE)?.setData(selectedData(pins, selectedId));
    place();
  }, [pins, selectedId, place]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady.current) return;
    if (props.areas && !instance.getSource(AREAS)) {
      addAreaLayers(instance, props.areas);
      return;
    }
    const areas = props.areas ?? EMPTY;
    instance.getSource<GeoJSONSource>(AREAS)?.setData(areas.regions);
  }, [props.areas]);

  useEffect(() => {
    const instance = map.current;
    // Before the style is ready, its 'style.load' draws the overlays as they are then.
    if (instance && styleReady.current) syncOverlays(instance, props.overlays ?? []);
  }, [props.overlays]);

  // Compared as text, so a new array with the same bounds does not move the map.
  const fitKey = props.fitTo ? props.fitTo.join(',') : null;
  useEffect(() => {
    const bounds = latest.current.fitTo;
    if (!map.current || !bounds) return;
    map.current.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 600 });
  }, [fitKey]);

  const details =
    selectedId === null ? undefined : pins.find((pin) => pin.id === selectedId)?.details;

  return (
    <div className="relative size-full">
      <div ref={container} className="size-full" />
      {details && selectedId !== closedId && (
        <PinDetailsBox details={details} anchor={anchor} onClose={closeBox} />
      )}
    </div>
  );
}
