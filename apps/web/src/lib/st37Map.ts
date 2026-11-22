import { ST37_STATUS_CLASSES, type St37StatusClass } from '@grain/domain';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapboxMap,
} from 'mapbox-gl';
import { DETAIL_FULL, DETAIL_GONE, fadeIn } from './mapDetail';

/**
 * The AER's ST37 wells on the oil and gas map (F-243 part 4): how they are drawn at each zoom.
 * Zoomed out, a faint grey shading where wells are dense; from the second scroll after the
 * distance bar reads 30 km (DETAIL_GONE) each well's drilled path comes in as a line, a
 * vertical well as a dot, and by the second scroll after it reads 20 km (DETAIL_FULL) the
 * shading is gone and every well is drawn at full strength (F-260). A well with no drilled
 * path yet (licensed, or being drilled)
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
  /** The play the well was loaded for, and its field and pool (F-256). */
  formation?: string | null;
  fieldName?: string | null;
  poolCode?: number | null;
  poolName?: string | null;
}

/**
 * The parts of a well that can be switched on and off (F-257). A well is every leg drilled under
 * one licence: its main leg (the most active one), its other legs (an earlier hole, a sidetrack,
 * an extra leg), and, before it is drilled, its planned line. With the main legs off, a well is
 * one dot at its surface location.
 */
export interface St37Parts {
  legs: boolean;
  otherLegs: boolean;
  planned: boolean;
}

export const ST37_ALL_PARTS: St37Parts = { legs: true, otherLegs: true, planned: true };

/** What FacilityMap draws: the wells, the statuses switched on, and the formation's outline. */
export interface St37View {
  wells: GeoJSON.FeatureCollection;
  shown: readonly St37StatusClass[];
  /** The parts switched on; all of them when left out. */
  parts?: St37Parts;
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
    licensed: '#93c5fd',
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

/**
 * The zoom from which a well answers the pointer (the owner, 2026-11-21: "around 10 km and
 * closer", the distance bar's reading from about this zoom): farther out the wells are faint
 * and packed together, and a highlight there jumps from one to the next.
 */
export const ST37_HOVER_FROM = 8;

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
  wells: 'st37-wells-dots',
  hoverPath: 'st37-hover-path',
  hoverDots: 'st37-hover-dots',
  hoverSurface: 'st37-hover-surface',
} as const;
/** The layers a pointer can find a well on. */
export const ST37_PICKABLE = [
  ST37_LAYERS.paths,
  ST37_LAYERS.planned,
  ST37_LAYERS.dots,
  ST37_LAYERS.pending,
  ST37_LAYERS.wells,
];
const SQUARE = 'st37-square';

/** Wells that are only licensed or being drilled: shown as dots at every zoom, like new news. */
const PENDING: St37StatusClass[] = ['licensed', 'drilling'];

/** Which leg of a well is its main one: the most active, as the loader ranks statuses. */
const RANK: Record<St37StatusClass, number> = {
  producing: 0,
  drilling: 1,
  awaiting: 2,
  inactive: 3,
  suspended: 4,
  abandoned: 5,
  licensed: 6,
};

/**
 * The wells by licence (F-257): a well is every leg drilled under one licence, each leg a UWI of
 * its own. The main leg comes first: the most active; between equals, the one in a pool, then
 * the one with a drilled path, then the latest drilled (the UWI's last character).
 */
export function st37Legs(wells: readonly St37MapWell[]): Map<string, St37MapWell[]> {
  const out = new Map<string, St37MapWell[]>();
  for (const w of wells) {
    const legs = out.get(w.licenceNumber);
    if (legs) legs.push(w);
    else out.set(w.licenceNumber, [w]);
  }
  for (const legs of out.values()) {
    legs.sort(
      (a, b) =>
        RANK[a.statusClass] - RANK[b.statusClass] ||
        Number(b.poolCode != null) - Number(a.poolCode != null) ||
        Number(b.path !== null) - Number(a.path !== null) ||
        b.uwi.slice(-1).localeCompare(a.uwi.slice(-1)) ||
        a.uwi.localeCompare(b.uwi),
    );
  }
  return out;
}

/** Wells whose surface locations are within this of one another, in a chain, share a pad. */
const PAD_REACH_M = 100;
const M_PER_DEGREE = 111_320;
/** Alberta's middle latitude, near enough for telling 100 m apart anywhere in the province. */
const LONGITUDE_SHRINK = Math.cos((54 * Math.PI) / 180);

/**
 * The pad of each well, by licence (F-259): wells drilled from one surface spot. The AER's list
 * names no pad, so a pad is the wells whose surface locations lie within 100 m of one another,
 * in a chain; it is named by the lowest licence number on it. A well alone is its own pad.
 */
export function st37Pads(wells: readonly St37MapWell[]): Map<string, string> {
  const parent = new Map<string, string>();
  const root = (licence: string): string => {
    let at = licence;
    for (let up = parent.get(at); up !== undefined && up !== at; up = parent.get(at)) at = up;
    parent.set(licence, at);
    return at;
  };
  const cells = new Map<string, { licence: string; x: number; y: number }[]>();
  for (const [licence, [first]] of st37Legs(wells)) {
    if (!first) continue;
    parent.set(licence, licence);
    const x = first.surface[0] * M_PER_DEGREE * LONGITUDE_SHRINK;
    const y = first.surface[1] * M_PER_DEGREE;
    const cx = Math.floor(x / PAD_REACH_M);
    const cy = Math.floor(y / PAD_REACH_M);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of cells.get(`${String(cx + dx)},${String(cy + dy)}`) ?? []) {
          if (Math.hypot(other.x - x, other.y - y) <= PAD_REACH_M) {
            parent.set(root(other.licence), root(licence));
          }
        }
      }
    }
    const key = `${String(cx)},${String(cy)}`;
    const cell = cells.get(key);
    if (cell) cell.push({ licence, x, y });
    else cells.set(key, [{ licence, x, y }]);
  }
  const name = new Map<string, string>();
  for (const licence of parent.keys()) {
    const top = root(licence);
    const lowest = name.get(top);
    if (lowest === undefined || licence < lowest) name.set(top, licence);
  }
  const out = new Map<string, string>();
  for (const licence of parent.keys()) out.set(licence, name.get(root(licence)) ?? licence);
  return out;
}

/**
 * The wells as map features: each leg's path (when it runs sideways), its bottom-hole dot and
 * its surface hole, all carrying its UWI, licence, pad, status and whether it is the well's
 * main leg, so a pointer on any of them finds the well. A leg with a planned bottom hole gets a
 * straight "planned" line to it and, instead of a bottom-hole dot, one dot where it starts
 * (`at: 'start'`), drawn zoomed out, where the line is too short to see, or when planned lines
 * are off (F-259). Each well also gets one "well" dot at its surface location, in its main
 * leg's status, drawn when the main legs are off.
 */
export function st37Features(wells: readonly St37MapWell[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const main = new Set<string>();
  const pads = st37Pads(wells);
  for (const [licence, [first]] of st37Legs(wells)) {
    if (!first) continue;
    main.add(first.uwi);
    features.push({
      type: 'Feature',
      properties: {
        uwi: first.uwi,
        licence: first.licenceNumber,
        status: first.statusClass,
        pad: pads.get(licence) ?? licence,
        leg: 'main',
        part: 'well',
      },
      geometry: { type: 'Point', coordinates: first.surface },
    });
  }
  for (const w of wells) {
    const properties = {
      uwi: w.uwi,
      licence: w.licenceNumber,
      status: w.statusClass,
      pad: pads.get(w.licenceNumber) ?? w.licenceNumber,
      leg: main.has(w.uwi) ? 'main' : 'other',
    };
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
      properties: { ...properties, part: 'bottom', at: w.plannedBottom ? 'start' : 'hole' },
      geometry: { type: 'Point', coordinates: w.plannedBottom ? w.surface : w.bottom },
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
  part: 'path' | 'planned' | 'bottom' | 'surface' | 'well',
  shown: readonly St37StatusClass[],
  only?: St37StatusClass[],
  parts?: St37Parts,
  /** Whether a leg not drilled yet has its dot where it starts: not beside its planned line. */
  starts = true,
): FilterSpecification {
  const statuses = only ? shown.filter((s) => only.includes(s)) : shown;
  const filter: unknown[] = [
    'all',
    ['==', ['get', 'part'], part],
    ['in', ['get', 'status'], ['literal', statuses]],
  ];
  if (parts) {
    const legs = [...(parts.legs ? ['main'] : []), ...(parts.otherLegs ? ['other'] : [])];
    filter.push(['in', ['get', 'leg'], ['literal', legs]]);
    if (part === 'bottom') {
      filter.push(['in', ['get', 'at'], ['literal', starts ? ['hole', 'start'] : ['hole']]]);
    }
  }
  return filter as FilterSpecification;
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
        maxzoom: DETAIL_FULL,
        paint: {
          'heatmap-weight': 1,
          // A wide, weak spread per well, so a cluster reads as one soft shadow and a lone
          // well barely shows (F-260). Weak enough that only the densest ground reaches the
          // darkest tone: stronger, a whole zone filled up to one flat silver (the owner,
          // 2026-11-21). Set on the Duvernay's wells of a local load: about an eighth of the
          // shaded ground at the darkest tone, at every zoom the shading shows.
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.085, DETAIL_FULL, 0.14],
          'heatmap-radius': [
            'interpolate',
            ['exponential', 1.83],
            ['zoom'],
            5,
            5.5,
            DETAIL_FULL,
            30,
          ],
          // Gives way to the wells as they come in.
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], DETAIL_GONE, 1, DETAIL_FULL, 0],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.paths,
        type: 'line',
        source: SOURCE,
        minzoom: DETAIL_GONE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], DETAIL_GONE, 0.5, 11, 1, 14, 1.8],
          'line-opacity': fadeIn(0.9),
        },
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.planned,
        type: 'line',
        source: SOURCE,
        // Comes in as the far-out dot goes (F-259, F-260).
        minzoom: DETAIL_GONE,
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], DETAIL_GONE, 1, 11, 1.4, 14, 2],
          'line-dasharray': [2, 2],
          'line-opacity': fadeIn(1),
        },
      },
      before,
    );
    const fadeOut: ExpressionSpecification = [
      'interpolate',
      ['linear'],
      ['zoom'],
      DETAIL_GONE,
      1,
      DETAIL_FULL,
      0,
    ];
    // A well not yet drilled gets a larger dot: it has no path to be seen by.
    const pending = ['in', ['get', 'status'], ['literal', PENDING]];
    map.addLayer(
      {
        id: ST37_LAYERS.dots,
        type: 'circle',
        source: SOURCE,
        minzoom: DETAIL_GONE,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            DETAIL_GONE,
            ['case', pending, 3, 0.8],
            11,
            ['case', pending, 3.5, 1.4],
            14,
            ['case', pending, 4.5, 2.8],
          ],
          'circle-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            DETAIL_GONE,
            0,
            DETAIL_FULL,
            0.6,
            8.5,
            1,
          ],
        },
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.pending,
        type: 'circle',
        source: SOURCE,
        // The far-out dot of a well not drilled yet: gone as its planned line comes in.
        maxzoom: DETAIL_FULL,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, DETAIL_GONE, 3],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': fadeOut,
          'circle-stroke-opacity': fadeOut,
        },
      },
      before,
    );
    // One dot a well at its surface location, drawn when the main legs are off (F-257). A well
    // not yet drilled shows from far out, as its larger dot does with the legs on.
    map.addLayer(
      {
        id: ST37_LAYERS.wells,
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            ['case', pending, 2, 0],
            DETAIL_GONE,
            ['case', pending, 3, 0],
            DETAIL_FULL,
            ['case', pending, 3, 1.2],
            11,
            ['case', pending, 3.5, 2.2],
            14,
            ['case', pending, 4.5, 3.6],
          ],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], DETAIL_GONE, 0, 11, 0.75],
          'circle-stroke-color': '#ffffff',
        },
      },
      before,
    );
    // The leg under the pointer (F-259), whatever is switched off: a little bolder in the
    // map's ink, its bottom hole a dot. Only that leg: not the well's other legs, not the
    // others on its pad, and no colour of its own (the owner, 2026-11-21). A well pointed at
    // by its surface dot is shown whole (F-257).
    map.addLayer(
      {
        id: ST37_LAYERS.hoverPath,
        type: 'line',
        source: SOURCE,
        minzoom: ST37_HOVER_FROM,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 2.2 },
        filter: ['==', ['get', 'licence'], ''],
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.hoverDots,
        type: 'circle',
        source: SOURCE,
        minzoom: ST37_HOVER_FROM,
        paint: { 'circle-radius': 3.5, 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' },
        filter: ['==', ['get', 'licence'], ''],
      },
      before,
    );
    map.addLayer(
      {
        id: ST37_LAYERS.hoverSurface,
        type: 'symbol',
        source: SOURCE,
        minzoom: ST37_HOVER_FROM,
        layout: {
          'icon-image': SQUARE,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        filter: ['==', ['get', 'licence'], ''],
      },
      before,
    );
  }
  const parts = view.parts ?? ST37_ALL_PARTS;
  const none: readonly St37StatusClass[] = [];

  const colour = colourBy(tone);
  // Wells are dense where they count: zoomed out, a grey shading of how many there are. On the
  // light map, as on the picture the owner gave to match (2026-11-21): warm dark patches where
  // wells are dense, about #a7a39c at their darkest over a zone's fill, soft at the edges, the
  // ground between them left light.
  const shade = tone === 'light' ? '13, 6, 0' : '230, 228, 226';
  map.setPaintProperty(ST37_LAYERS.density, 'heatmap-color', [
    'interpolate',
    ['linear'],
    ['heatmap-density'],
    0,
    `rgba(${shade}, 0)`,
    0.15,
    `rgba(${shade}, 0.02)`,
    0.4,
    `rgba(${shade}, 0.1)`,
    0.7,
    `rgba(${shade}, 0.21)`,
    1,
    `rgba(${shade}, 0.27)`,
  ]);
  map.setFilter(ST37_LAYERS.density, shownFilter('surface', view.shown));
  map.setPaintProperty(ST37_LAYERS.paths, 'line-color', colour);
  map.setFilter(ST37_LAYERS.paths, shownFilter('path', view.shown, undefined, parts));
  map.setPaintProperty(ST37_LAYERS.planned, 'line-color', colour);
  map.setFilter(
    ST37_LAYERS.planned,
    shownFilter('planned', parts.planned ? view.shown : none, undefined, parts),
  );
  map.setPaintProperty(ST37_LAYERS.dots, 'circle-color', colour);
  // Close in, a leg not drilled yet is its planned line, with no dot; a dot where it starts
  // when planned lines are off, so it is still there to point at.
  map.setFilter(
    ST37_LAYERS.dots,
    shownFilter('bottom', view.shown, undefined, parts, !parts.planned),
  );
  map.setPaintProperty(ST37_LAYERS.pending, 'circle-color', colour);
  map.setFilter(ST37_LAYERS.pending, shownFilter('bottom', view.shown, PENDING, parts));
  map.setPaintProperty(ST37_LAYERS.wells, 'circle-color', colour);
  map.setFilter(ST37_LAYERS.wells, shownFilter('well', parts.legs ? none : view.shown));
  // The hovered well in ink.
  map.setPaintProperty(ST37_LAYERS.hoverPath, 'line-color', ink);
  map.setPaintProperty(ST37_LAYERS.hoverDots, 'circle-color', colour);
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
          // A light wash, so the shading's patches stand out on it (the owner, 2026-11-21);
          // lighter still close in, where each well shows for itself.
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.09, 9, 0.08, 12, 0.06],
        },
      },
      map.getLayer(ST37_LAYERS.density) ? ST37_LAYERS.density : before,
    );
  }
  map.setPaintProperty(ST37_LAYERS.zones, 'fill-color', tone === 'light' ? '#44403c' : '#e7e5e4');
}

/**
 * Draws the hovered leg (F-259; the owner, 2026-11-21: "only highlight the single leg under
 * the pointer"): the leg with this UWI a little bolder, a dot on its bottom hole and a square
 * on its well's surface location, whatever parts are switched off. Without a UWI the well is
 * drawn whole, every leg under its licence (F-257: a well pointed at by its surface dot); a
 * null licence clears it.
 */
export function highlightSt37(map: MapboxMap, licence: string | null, uwi: string | null = null) {
  if (!map.getLayer(ST37_LAYERS.hoverPath)) return;
  const id = licence ?? '';
  const legs: FilterSpecification =
    licence !== null && uwi !== null ? ['==', ['get', 'uwi'], uwi] : ['==', ['get', 'licence'], id];
  map.setFilter(ST37_LAYERS.hoverPath, [
    'all',
    legs,
    ['in', ['get', 'part'], ['literal', ['path', 'planned']]],
  ] as FilterSpecification);
  map.setFilter(ST37_LAYERS.hoverDots, [
    'all',
    legs,
    ['==', ['get', 'part'], 'bottom'],
    ['==', ['get', 'at'], 'hole'],
  ]);
  map.setFilter(ST37_LAYERS.hoverSurface, [
    'all',
    ['==', ['get', 'licence'], id],
    ['==', ['get', 'part'], 'well'],
  ]);
}
