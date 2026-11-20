import { ST37_STATUS_CLASSES, type St37StatusClass } from '@grain/domain';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapboxMap,
} from 'mapbox-gl';

/**
 * The AER's ST37 wells on the oil and gas map (F-243 part 4): how they are drawn at each zoom.
 * Zoomed out, a soft grey shading where wells are dense; from about 20 km across, each well's
 * drilled path as a line ending in a dot at its bottom hole, and a vertical well as a dot; past
 * about 10 km the shading is gone. A well with no drilled path yet (licensed, or being drilled)
 * is a dashed straight line from its surface hole to its planned bottom hole (F-243 part 4b).
 * Every well is coloured by its status. FacilityMap calls
 * `syncSt37` and `highlightSt37`; the Mapbox calls stay in these two map files.
 */

/** A well as the API sends it (GET /api/v1/petroleum/st37/wells). */
export interface St37MapWell {
  uwi: string;
  licenceNumber: string;
  wellName: string | null;
  licensee: string | null;
  statusClass: St37StatusClass;
  statusFluid: string | null;
  statusType: string | null;
  spudDate: string | null;
  totalDepthM: number | null;
  trueVerticalDepthM: number | null;
  surface: [number, number];
  bottom: [number, number];
  path: [number, number][] | null;
  licenceDate: string | null;
  plannedOperation: string | null;
  plannedFormation: string | null;
  plannedDepthM: number | null;
  /** The planned bottom hole of a well with no drilled path yet, or null. */
  plannedBottom: [number, number] | null;
}

/** What FacilityMap draws: the wells, the statuses switched on, and the formation's outline. */
export interface St37View {
  wells: GeoJSON.FeatureCollection;
  shown: readonly St37StatusClass[];
  /** The address of the outline (GeoJSON) of the formation loaded whole, or null. */
  outline: string | null;
  /** The zones where the formation's drilled wells cluster (F-255), or null. */
  zones: GeoJSON.FeatureCollection | null;
}

/** A zone as the API sends it: how many drilled wells it holds, and its closed ring. */
export interface St37MapZone {
  wells: number;
  ring: [number, number][];
}

export function st37ZoneFeatures(zones: readonly St37MapZone[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      properties: { wells: zone.wells },
      geometry: { type: 'Polygon', coordinates: [zone.ring] },
    })),
  };
}

/**
 * The outlines of the formations a load can hold whole, by the formation's key (F-252). Files in
 * the web app's public folder, made once from the Alberta Geological Survey's Digital Dataset
 * 2013-0024 (Rokosh et al., 2013: the areas its 2012 shale report evaluated), which the AER/AGS
 * licenses under the Open Government Licence – Alberta; the credit is shown with the wells.
 */
export const ST37_OUTLINES: Record<string, { url: string; credit: string }> = {
  duvernay: {
    url: '/outlines/duvernay.geojson',
    credit:
      'Outline: Alberta Energy Regulator / Alberta Geological Survey, Digital Dataset 2013-0024 (the area evaluated in its 2012 shale report). Contains information licensed under the Open Government Licence – Alberta.',
  },
};

/** The colour of each status, on a light map and on a dark or satellite one. */
export const ST37_COLOURS: Record<'light' | 'dark', Record<St37StatusClass, string>> = {
  light: {
    producing: '#1c1917',
    awaiting: '#57534e',
    drilling: '#2563eb',
    inactive: '#a16207',
    suspended: '#8a817c',
    abandoned: '#b8b2ad',
    licensed: '#60a5fa',
  },
  dark: {
    producing: '#fafaf9',
    awaiting: '#d6d3d1',
    drilling: '#60a5fa',
    inactive: '#f59e0b',
    suspended: '#a8a29e',
    abandoned: '#6f6a66',
    licensed: '#93c5fd',
  },
};

const SOURCE = 'st37-wells';
const OUTLINE_SOURCE = 'st37-outline';
const ZONES_SOURCE = 'st37-zones';
export const ST37_LAYERS = {
  outlineFill: 'st37-outline-fill',
  outlineLine: 'st37-outline-line',
  zones: 'st37-zones-fill',
  density: 'st37-density',
  paths: 'st37-paths',
  planned: 'st37-planned',
  dots: 'st37-dots',
  pending: 'st37-pending',
  hoverPath: 'st37-hover-path',
  hoverSurface: 'st37-hover-surface',
} as const;
/** The layers a pointer can find a well on. */
export const ST37_PICKABLE = [
  ST37_LAYERS.paths,
  ST37_LAYERS.planned,
  ST37_LAYERS.dots,
  ST37_LAYERS.pending,
];
const SQUARE = 'st37-square';

/** Wells that are only licensed or being drilled: shown as dots at every zoom, like new news. */
const PENDING: St37StatusClass[] = ['licensed', 'drilling'];

/**
 * The wells as map features: each well's path (when it runs sideways), its bottom-hole dot and
 * its surface hole, all carrying its UWI and status, so a pointer on any of them finds the well.
 * A well with a planned bottom hole gets a straight "planned" line to it, and its dot there.
 */
export function st37Features(wells: readonly St37MapWell[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const w of wells) {
    const properties = { uwi: w.uwi, status: w.statusClass };
    if (w.path) {
      features.push({
        type: 'Feature',
        properties: { ...properties, part: 'path' },
        geometry: { type: 'LineString', coordinates: w.path },
      });
    }
    if (w.plannedBottom) {
      features.push({
        type: 'Feature',
        properties: { ...properties, part: 'planned' },
        geometry: { type: 'LineString', coordinates: [w.surface, w.plannedBottom] },
      });
    }
    features.push({
      type: 'Feature',
      properties: { ...properties, part: 'bottom' },
      geometry: { type: 'Point', coordinates: w.plannedBottom ?? w.bottom },
    });
    features.push({
      type: 'Feature',
      properties: { ...properties, part: 'surface' },
      geometry: { type: 'Point', coordinates: w.surface },
    });
  }
  return { type: 'FeatureCollection', features };
}

function colourBy(tone: 'light' | 'dark'): ExpressionSpecification {
  const colours = ST37_COLOURS[tone];
  return [
    'match',
    ['get', 'status'],
    ...ST37_STATUS_CLASSES.flatMap((status) => [status, colours[status]]),
    colours.abandoned,
  ] as unknown as ExpressionSpecification;
}

function shownFilter(
  part: 'path' | 'planned' | 'bottom' | 'surface',
  shown: readonly St37StatusClass[],
  only?: St37StatusClass[],
): FilterSpecification {
  const statuses = only ? shown.filter((s) => only.includes(s)) : shown;
  return [
    'all',
    ['==', ['get', 'part'], part],
    ['in', ['get', 'status'], ['literal', statuses]],
  ] as FilterSpecification;
}

/** A small hollow square for the hovered well's surface hole, drawn without a canvas. */
function squareImage(colour: string) {
  const size = 11;
  const data = new Uint8Array(size * size * 4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const edge = x < 2 || y < 2 || x >= size - 2 || y >= size - 2;
      const i = (y * size + x) * 4;
      // The edge in the well colour, the inside white so the square reads on any map.
      data[i] = edge ? r : 255;
      data[i + 1] = edge ? g : 255;
      data[i + 2] = edge ? b : 255;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/**
 * Brings the map in line with the wells: adds their source and layers the first time (under
 * `beforeId`, the pins), updates the data, colours and the statuses shown after; removes them
 * all when `view` is null.
 */
export function syncSt37(
  map: MapboxMap,
  view: St37View | null,
  tone: 'light' | 'dark',
  beforeId?: string,
) {
  const layers = Object.values(ST37_LAYERS);
  if (view === null) {
    for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    if (map.getSource(OUTLINE_SOURCE)) map.removeSource(OUTLINE_SOURCE);
    if (map.getSource(ZONES_SOURCE)) map.removeSource(ZONES_SOURCE);
    return;
  }
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  syncOutline(map, view.outline, tone, before);
  syncZones(map, view.zones, tone, before);
  const existing = map.getSource<GeoJSONSource>(SOURCE);
  if (existing) existing.setData(view.wells);
  else map.addSource(SOURCE, { type: 'geojson', data: view.wells });

  const ink = tone === 'light' ? '#1c1917' : '#fafaf9';
  const square = squareImage(ink);
  if (map.hasImage(SQUARE)) map.updateImage(SQUARE, square);
  else map.addImage(SQUARE, square, { pixelRatio: 2 });

  if (!map.getLayer(ST37_LAYERS.density)) {
    map.addLayer(
      {
        id: ST37_LAYERS.density,
        type: 'heatmap',
        source: SOURCE,
        maxzoom: 11,
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.2],
          'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 5, 3, 8, 10, 10, 24],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.85, 10.6, 0],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.paths,
        type: 'line',
        source: SOURCE,
        minzoom: 8.5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 8.5, 0.5, 11, 1, 14, 1.8],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 0.35, 10, 0.9],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.planned,
        type: 'line',
        source: SOURCE,
        minzoom: 7,
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 11, 1.4, 14, 2],
          'line-dasharray': [2, 2],
        },
      },
      before,
    );
    // A well not yet drilled gets a larger dot: it has no path to be seen by.
    const pending = ['in', ['get', 'status'], ['literal', PENDING]];
    map.addLayer(
      {
        id: ST37_LAYERS.dots,
        type: 'circle',
        source: SOURCE,
        minzoom: 9.5,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9.5,
            ['case', pending, 3, 0.8],
            11,
            ['case', pending, 3.5, 1.4],
            14,
            ['case', pending, 4.5, 2.8],
          ],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9.5, 0.4, 10.5, 1],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.pending,
        type: 'circle',
        source: SOURCE,
        maxzoom: 9.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 9.5, 3],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.hoverPath,
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 3 },
        filter: ['==', ['get', 'uwi'], ''],
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.hoverSurface,
        type: 'symbol',
        source: SOURCE,
        layout: {
          'icon-image': SQUARE,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        filter: ['==', ['get', 'uwi'], ''],
      },
      before,
    );
  }

  const colour = colourBy(tone);
  // Wells are dense where they count: zoomed out, a grey shading of how many there are.
  const shade = tone === 'light' ? '60, 56, 54' : '230, 228, 226';
  map.setPaintProperty(ST37_LAYERS.density, 'heatmap-color', [
    'interpolate',
    ['linear'],
    ['heatmap-density'],
    0,
    `rgba(${shade}, 0)`,
    0.15,
    `rgba(${shade}, 0.12)`,
    0.5,
    `rgba(${shade}, 0.3)`,
    1,
    `rgba(${shade}, 0.5)`,
  ]);
  map.setFilter(ST37_LAYERS.density, shownFilter('surface', view.shown));
  map.setPaintProperty(ST37_LAYERS.paths, 'line-color', colour);
  map.setFilter(ST37_LAYERS.paths, shownFilter('path', view.shown));
  map.setPaintProperty(ST37_LAYERS.planned, 'line-color', colour);
  map.setFilter(ST37_LAYERS.planned, shownFilter('planned', view.shown));
  map.setPaintProperty(ST37_LAYERS.dots, 'circle-color', colour);
  map.setFilter(ST37_LAYERS.dots, shownFilter('bottom', view.shown));
  map.setPaintProperty(ST37_LAYERS.pending, 'circle-color', colour);
  map.setFilter(ST37_LAYERS.pending, shownFilter('bottom', view.shown, PENDING));
  map.setPaintProperty(ST37_LAYERS.hoverPath, 'line-color', ink);
}

/**
 * The formation's outline, under the wells: a faint fill and a line, as the Survey drew the
 * area (holes where the formation is absent). Removed when there is none.
 */
function syncOutline(
  map: MapboxMap,
  url: string | null,
  tone: 'light' | 'dark',
  before: string | undefined,
) {
  const ids = [ST37_LAYERS.outlineFill, ST37_LAYERS.outlineLine];
  if (url === null) {
    for (const id of ids) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(OUTLINE_SOURCE)) map.removeSource(OUTLINE_SOURCE);
    return;
  }
  const existing = map.getSource<GeoJSONSource>(OUTLINE_SOURCE);
  if (existing) existing.setData(url);
  else map.addSource(OUTLINE_SOURCE, { type: 'geojson', data: url });
  // Under the wells' own layers when they exist already, else under the pins.
  const under = map.getLayer(ST37_LAYERS.density) ? ST37_LAYERS.density : before;
  if (!map.getLayer(ST37_LAYERS.outlineFill)) {
    map.addLayer(
      {
        id: ST37_LAYERS.outlineFill,
        type: 'fill',
        source: OUTLINE_SOURCE,
        paint: {
          // Fades as the map closes in, where the wells themselves show the formation.
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.07, 10, 0.03],
        },
      },
      under,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.outlineLine,
        type: 'line',
        source: OUTLINE_SOURCE,
        layout: { 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 1.8],
          'line-opacity': 0.75,
        },
      },
      under,
    );
  }
  const ink = tone === 'light' ? '#44403c' : '#e7e5e4';
  map.setPaintProperty(ST37_LAYERS.outlineFill, 'fill-color', ink);
  map.setPaintProperty(ST37_LAYERS.outlineLine, 'line-color', ink);
}

/**
 * The zones where the formation's drilled wells cluster (F-255): a soft shading over the
 * outline and under the wells, with no edge line. Removed when there are none.
 */
function syncZones(
  map: MapboxMap,
  zones: GeoJSON.FeatureCollection | null,
  tone: 'light' | 'dark',
  before: string | undefined,
) {
  if (zones === null) {
    if (map.getLayer(ST37_LAYERS.zones)) map.removeLayer(ST37_LAYERS.zones);
    if (map.getSource(ZONES_SOURCE)) map.removeSource(ZONES_SOURCE);
    return;
  }
  const existing = map.getSource<GeoJSONSource>(ZONES_SOURCE);
  if (existing) existing.setData(zones);
  else map.addSource(ZONES_SOURCE, { type: 'geojson', data: zones });
  if (!map.getLayer(ST37_LAYERS.zones)) {
    map.addLayer(
      {
        id: ST37_LAYERS.zones,
        type: 'fill',
        source: ZONES_SOURCE,
        paint: {
          // Lighter close in, where each well shows for itself.
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.16, 9, 0.1, 12, 0.06],
        },
      },
      map.getLayer(ST37_LAYERS.density) ? ST37_LAYERS.density : before,
    );
  }
  map.setPaintProperty(ST37_LAYERS.zones, 'fill-color', tone === 'light' ? '#44403c' : '#e7e5e4');
}

/** Draws the hovered well's path thicker and a square on its surface hole; null clears it. */
export function highlightSt37(map: MapboxMap, uwi: string | null) {
  if (!map.getLayer(ST37_LAYERS.hoverPath)) return;
  const id = uwi ?? '';
  map.setFilter(ST37_LAYERS.hoverPath, [
    'all',
    ['==', ['get', 'uwi'], id],
    ['in', ['get', 'part'], ['literal', ['path', 'planned']]],
  ]);
  map.setFilter(ST37_LAYERS.hoverSurface, [
    'all',
    ['==', ['get', 'uwi'], id],
    ['==', ['get', 'part'], 'surface'],
  ]);
}
