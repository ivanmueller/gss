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
  withPaper,
  type Basemap,
  type MapBounds,
  type MapColours,
  type MapPin,
  type PinFeatureCollection,
} from '../lib/mapbox';
import type { LaneAreas } from '../lib/lanes';
import { drawPin, PIN_KINDS, PIN_RATIO, PIN_TONES, pinImageId } from '../lib/mapPinImages';
import {
  LAND_PICKABLE,
  syncLand,
  syncLandHover,
  type LandShape,
  type LandView,
} from '../lib/landMap';
import { SALE_PICKABLE, syncLandSales, type LandSalesView } from '../lib/landSalesMap';
import {
  highlightSt37,
  ST37_HOVER_FROM,
  ST37_PICKABLE,
  syncSt37,
  type St37View,
} from '../lib/st37Map';
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

export interface St37Hover {
  uwis: string[];
  x: number;
  y: number;
}

/** Wells read light on a light map, and the other way round on a dark or satellite one. */
function st37Tone(basemap: Basemap, theme: Theme): 'light' | 'dark' {
  return theme === 'dark' || basemap === 'satellite' ? 'dark' : 'light';
}

export interface FacilityMapProps {
  token: string;
  basemap: Basemap;
  /** Light or night: picks Mapbox's light or dark style and the theme's map colours. */
  theme: Theme;
  pins: readonly MapPin[];
  selectedId: string | null;
  /** Where the zoom buttons go; the workspace keeps the right side for its order book. */
  controls?: 'top-left' | 'top-right';
  /** A distance bar (kilometres) in the bottom right corner, which follows the zoom. */
  scale?: boolean;
  /** The warm off-white base map in the light theme (the oil and gas map). */
  paper?: boolean;
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
  /** The AER's ST37 wells (F-243 part 4), drawn over the map layers and under the pins. */
  st37?: St37View | null;
  /**
   * The wells under the pointer (or a tap), with where it is in the map's box; null when it
   * leaves them. The first is drawn highlighted.
   */
  onSt37Hover?: (hover: St37Hover | null) => void;
  /** The wells clicked (or tapped), or null for a click on none (F-258). */
  onSt37Click?: (hover: St37Hover | null) => void;
  /**
   * The licence of the well whose card is kept open (F-258): it stays highlighted, and the
   * pointer shows no other well, until this is null again.
   */
  st37Locked?: string | null;
  /** Land held today (F-241), drawn under the wells. */
  land?: LandView | null;
  /** The parcels of Crown land sales (F-242), drawn over the land held and under the wells. */
  landSales?: LandSalesView | null;
  /**
   * The land clicked, by its keys, with where the click is in the map's box; null for a click
   * on none, or on a well (the well's card comes first).
   */
  onLandClick?: (pick: { keys: string[]; x: number; y: number } | null) => void;
  /**
   * The land under the pointer when no well is (F-265): the key of the topmost shape there, a
   * sale parcel before the land held; null when the pointer leaves it. Told only when it changes.
   */
  onLandHover?: (key: string | null) => void;
  /** The shape of the land under the pointer, outlined over everything else; null for none. */
  landHover?: LandShape | null;
  /**
   * What is shown at the pointer (F-265): the simple lines of the well or land under it. The
   * map moves the box with the pointer itself, so following it draws nothing of the page again.
   */
  hoverBox?: React.ReactNode;
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
function paintTheme(map: mapboxgl.Map, basemap: Basemap, theme: Theme, paper: boolean) {
  const colours = withPaper(readMapColours(), paper, theme);
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
  const { token, basemap, theme, pins, selectedId, paper } = props;
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
  /**
   * What is highlighted under the pointer, or kept open: `licence` for a whole well,
   * `licence|uwi` for one leg of it.
   */
  const st37Hovered = useRef<string | null>(null);
  // The wells the page was last told are under the pointer (their UWIs joined); '' for none.
  const st37Told = useRef('');
  // The land the page was last told is under the pointer (its key); null for none.
  const landTold = useRef<string | null>(null);
  // The box at the pointer, moved with it (F-265).
  const tip = useRef<HTMLDivElement>(null);
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
    if (latest.current.scale) {
      // Added after the attribution, so it sits above it in the same corner.
      instance.addControl(
        new mapboxgl.ScaleControl({ unit: 'metric', maxWidth: 120 }),
        'bottom-right',
      );
    }
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
      paintTheme(
        instance,
        latest.current.basemap,
        latest.current.theme,
        latest.current.paper ?? false,
      );
      addPinLayers(
        instance,
        latest.current.data,
        selectedData(latest.current.pins, latest.current.selectedId),
      );
      syncOverlays(instance, latest.current.overlays ?? []);
      syncSt37(
        instance,
        latest.current.st37 ?? null,
        st37Tone(latest.current.basemap, latest.current.theme),
        PINS,
      );
      syncLandSales(
        instance,
        latest.current.landSales ?? null,
        st37Tone(latest.current.basemap, latest.current.theme),
        PINS,
      );
      syncLand(
        instance,
        latest.current.land ?? null,
        st37Tone(latest.current.basemap, latest.current.theme),
        PINS,
      );
      syncLandHover(
        instance,
        latest.current.landHover ?? null,
        st37Tone(latest.current.basemap, latest.current.theme),
      );
      handlers.current.place();
    });
    // The wells under the pointer: their card and the first one highlighted (F-243 part 4).
    const wellsAt = (
      point: mapboxgl.Point,
    ): { uwis: string[]; licence: string | null; leg: string | null } => {
      const layers = ST37_PICKABLE.filter((id) => instance.getLayer(id));
      // Farther out the wells are faint and packed together: none answers the pointer there
      // (the owner, 2026-11-21).
      if (layers.length === 0 || instance.getZoom() < ST37_HOVER_FROM) {
        return { uwis: [], licence: null, leg: null };
      }
      // Three pixels about the pointer: near enough to catch a thin line, not its neighbours.
      const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [point.x - 3, point.y - 3],
        [point.x + 3, point.y + 3],
      ];
      const uwis = new Set<string>();
      let licence: string | null = null;
      let leg: string | null = null;
      for (const feature of instance.queryRenderedFeatures(box, { layers })) {
        const uwi: unknown = feature.properties?.uwi;
        if (typeof uwi !== 'string') continue;
        // The first found is the one highlighted: that leg alone (the owner, 2026-11-21), or
        // the whole well when it is pointed at by its surface dot, which stands for every leg.
        const of: unknown = feature.properties?.licence;
        if (uwis.size === 0 && typeof of === 'string') {
          licence = of;
          leg = feature.properties?.part === 'well' ? null : uwi;
        }
        uwis.add(uwi);
      }
      return { uwis: [...uwis], licence, leg };
    };
    // The land under the pointer, when no well is: the topmost shape, a sale parcel first.
    const landAt = (point: mapboxgl.Point): string | null => {
      const layers = [...SALE_PICKABLE, ...LAND_PICKABLE].filter((id) => instance.getLayer(id));
      if (layers.length === 0) return null;
      for (const feature of instance.queryRenderedFeatures(point, { layers })) {
        const key: unknown = feature.properties?.key;
        if (typeof key === 'string') return key;
      }
      return null;
    };
    // The box at the pointer follows it: to its right and below, or the other way near the
    // map's right and bottom edges.
    const placeTip = (point: mapboxgl.Point) => {
      const box = tip.current;
      if (!box) return;
      const within = instance.getContainer();
      const left = point.x > within.clientWidth - 300;
      const up = point.y > within.clientHeight - 190;
      box.style.left = `${String(point.x)}px`;
      box.style.top = `${String(point.y)}px`;
      box.style.transform = `translate(${left ? 'calc(-100% - 14px)' : '14px'}, ${up ? 'calc(-100% - 14px)' : '14px'})`;
    };
    // `clicked`: the click that keeps a well's panel open lights the leg clicked, also while
    // another well's panel is kept open (it used to leave the earlier one lit).
    const hover = (point: mapboxgl.Point, clicked = false) => {
      const onHover = latest.current.onSt37Hover;
      const onLand = latest.current.onLandHover;
      if (!onHover && !onLand) return null;
      const { uwis, licence, leg } = onHover
        ? wellsAt(point)
        : { uwis: [], licence: null, leg: null };
      const first = uwis[0] ?? null;
      const found = first ? { uwis, x: point.x, y: point.y } : null;
      // Land answers the pointer only where no well does.
      const land = onLand && !first ? landAt(point) : null;
      instance.getCanvas().style.cursor = first || land ? 'pointer' : '';
      placeTip(point);
      // The page is told only when what is under the pointer changes, not at every move of
      // it: each telling draws the whole page again (F-263). A click tells it of nothing: the
      // panel it opens takes the place of the box at the pointer (F-265).
      const told = clicked ? '' : uwis.join('|');
      if (told !== st37Told.current) {
        st37Told.current = told;
        onHover?.(clicked ? null : found);
      }
      const landNow = clicked ? null : land;
      if (landNow !== landTold.current) {
        landTold.current = landNow;
        onLand?.(landNow);
      }
      // While a well's panel is kept open, that well stays the one lit.
      if (latest.current.st37Locked && !(clicked && found)) return found;
      const lit = licence !== null && leg !== null ? `${licence}|${leg}` : licence;
      if (lit !== st37Hovered.current) {
        st37Hovered.current = lit;
        highlightSt37(instance, licence, leg);
      }
      return found;
    };
    // Where the pointer last was over the map; null once it has left.
    let pointer: mapboxgl.Point | null = null;
    // The pointer's moves are looked at once a frame: the mouse reports more often than the
    // map draws, and each look searches the wells drawn.
    let frame: number | null = null;
    instance.on('mousemove', (event) => {
      pointer = event.point;
      frame ??= requestAnimationFrame(() => {
        frame = null;
        if (pointer) hover(pointer);
      });
    });
    instance.on('remove', () => {
      if (frame !== null) cancelAnimationFrame(frame);
    });
    // The map can move or zoom under a still pointer (the wheel, the zoom buttons, an eased
    // move): the well under it is looked for again, so one it has left never stays lit.
    instance.on('moveend', () => {
      if (pointer) hover(pointer);
    });
    // A click keeps the well's card open (F-258); a tap shows it, on a phone where nothing
    // hovers; a click on no well lets it go.
    instance.on('click', (event) => {
      const found = hover(event.point, true);
      latest.current.onSt37Click?.(found);
      // Land under the click, when no well is: every shape there, agreements first (F-241).
      const onLand = latest.current.onLandClick;
      if (!onLand) return;
      // Sale parcels first: they are drawn over the land held.
      const layers = [...SALE_PICKABLE, ...LAND_PICKABLE].filter((id) => instance.getLayer(id));
      const keys = new Set<string>();
      if (!found && layers.length > 0) {
        for (const feature of instance.queryRenderedFeatures(event.point, { layers })) {
          const key: unknown = feature.properties?.key;
          if (typeof key === 'string') keys.add(key);
        }
      }
      onLand(keys.size > 0 ? { keys: [...keys], x: event.point.x, y: event.point.y } : null);
    });
    instance.on('mouseout', () => {
      pointer = null;
      if (landTold.current !== null) {
        landTold.current = null;
        latest.current.onLandHover?.(null);
      }
      if (st37Told.current !== '') {
        st37Told.current = '';
        latest.current.onSt37Hover?.(null);
      }
      if (latest.current.st37Locked) return;
      if (st37Hovered.current !== null) {
        st37Hovered.current = null;
        highlightSt37(instance, null);
      }
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
      paintTheme(instance, basemap, theme, paper ?? false);
    }
  }, [basemap, theme, paper]);

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

  // The well whose card is kept open stays highlighted, by the leg clicked; letting it go
  // clears the highlight until the pointer finds a well again.
  const locked = props.st37Locked ?? null;
  useEffect(() => {
    const instance = map.current;
    if (!instance || !styleReady.current) return;
    // The click that kept it open has already lit its leg (or the whole well): left as it is.
    const lit = st37Hovered.current;
    if (locked !== null && (lit === locked || lit?.startsWith(`${locked}|`))) return;
    st37Hovered.current = locked;
    highlightSt37(instance, locked);
  }, [locked]);

  const { st37 } = props;
  useEffect(() => {
    const instance = map.current;
    // Before the style is ready, its 'style.load' draws the wells as they are then.
    if (instance && styleReady.current) {
      syncSt37(instance, st37 ?? null, st37Tone(basemap, theme), PINS);
    }
  }, [st37, basemap, theme]);

  const { landSales } = props;
  useEffect(() => {
    const instance = map.current;
    // Before the style is ready, its 'style.load' draws the parcels as they are then.
    if (instance && styleReady.current) {
      syncLandSales(instance, landSales ?? null, st37Tone(basemap, theme), PINS);
    }
  }, [landSales, basemap, theme]);

  const { landHover } = props;
  useEffect(() => {
    const instance = map.current;
    if (instance && styleReady.current) {
      syncLandHover(instance, landHover ?? null, st37Tone(basemap, theme));
    }
  }, [landHover, basemap, theme]);

  const { land } = props;
  useEffect(() => {
    const instance = map.current;
    // Before the style is ready, its 'style.load' draws the land as it is then.
    if (instance && styleReady.current) {
      syncLand(instance, land ?? null, st37Tone(basemap, theme), PINS);
    }
  }, [land, basemap, theme]);

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
      {/* Moved with the pointer by the map itself; empty when nothing is under it. */}
      <div ref={tip} className="pointer-events-none absolute top-0 left-0 z-30">
        {props.hoverBox}
      </div>
      {details && selectedId !== closedId && (
        <PinDetailsBox details={details} anchor={anchor} onClose={closeBox} />
      )}
    </div>
  );
}
