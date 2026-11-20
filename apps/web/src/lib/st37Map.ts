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
 * about 10 km the shading is gone. Every well is coloured by its status. FacilityMap calls
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
}

/** What FacilityMap draws: the wells, and the statuses switched on. */
export interface St37View {
  wells: GeoJSON.FeatureCollection;
  shown: readonly St37StatusClass[];
}

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
export const ST37_LAYERS = {
  density: 'st37-density',
  paths: 'st37-paths',
  dots: 'st37-dots',
  pending: 'st37-pending',
  hoverPath: 'st37-hover-path',
  hoverSurface: 'st37-hover-surface',
} as const;
/** The layers a pointer can find a well on. */
export const ST37_PICKABLE = [ST37_LAYERS.paths, ST37_LAYERS.dots, ST37_LAYERS.pending];
const SQUARE = 'st37-square';

/** Wells that are only licensed or being drilled: shown as dots at every zoom, like new news. */
const PENDING: St37StatusClass[] = ['licensed', 'drilling'];

/**
 * The wells as map features: each well's path (when it runs sideways), its bottom-hole dot and
 * its surface hole, all carrying its UWI and status, so a pointer on any of them finds the well.
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
    features.push({
      type: 'Feature',
      properties: { ...properties, part: 'bottom' },
      geometry: { type: 'Point', coordinates: w.bottom },
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
  part: 'path' | 'bottom' | 'surface',
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
    return;
  }
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
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
        id: ST37_LAYERS.dots,
        type: 'circle',
        source: SOURCE,
        minzoom: 9.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9.5, 0.8, 11, 1.4, 14, 2.8],
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
  map.setPaintProperty(ST37_LAYERS.dots, 'circle-color', colour);
  map.setFilter(ST37_LAYERS.dots, shownFilter('bottom', view.shown));
  map.setPaintProperty(ST37_LAYERS.pending, 'circle-color', colour);
  map.setFilter(ST37_LAYERS.pending, shownFilter('bottom', view.shown, PENDING));
  map.setPaintProperty(ST37_LAYERS.hoverPath, 'line-color', ink);
}

/** Draws the hovered well's path thicker and a square on its surface hole; null clears it. */
export function highlightSt37(map: MapboxMap, uwi: string | null) {
  if (!map.getLayer(ST37_LAYERS.hoverPath)) return;
  const id = uwi ?? '';
  map.setFilter(ST37_LAYERS.hoverPath, [
    'all',
    ['==', ['get', 'uwi'], id],
    ['==', ['get', 'part'], 'path'],
  ]);
  map.setFilter(ST37_LAYERS.hoverSurface, [
    'all',
    ['==', ['get', 'uwi'], id],
    ['==', ['get', 'part'], 'surface'],
  ]);
}
