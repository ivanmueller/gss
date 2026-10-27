import 'mapbox-gl/dist/mapbox-gl.css';

import { bboxFromBounds, type Bbox } from '@grain/domain';
import mapboxgl, { type GeoJSONSource } from 'mapbox-gl';
import { useEffect, useRef } from 'react';

import type { MapFacility } from '../lib/api';
import {
  BASEMAPS,
  facilityFeatures,
  type Basemap,
  type FacilityFeatureCollection,
} from '../lib/mapbox';

// The only module that calls Mapbox GL JS (docs/DECISIONS.md, map decision). It is loaded
// on demand by the map page, so the rest of the app does not download it.

// Western Canada and the northern U.S. plains.
const START: [number, number, number, number] = [-120, 42, -88, 57];
const SOURCE = 'facilities';
const PINS = 'facilities';
const SELECTED = 'facilities-selected';
// The app's buyer colour (--bid in index.css).
const PIN_COLOUR = '#3b3bb0';

export interface FacilityMapProps {
  token: string;
  basemap: Basemap;
  facilities: MapFacility[];
  selectedId: string | null;
  /** The visible box after every move; null when none of it is on the map. */
  onViewChange: (bbox: Bbox | null) => void;
  onSelect: (facilityId: string) => void;
  /** Mapbox refused the token (wrong token or not allowed on this address). */
  onTokenRefused: () => void;
}

function selectedFilter(selectedId: string | null): mapboxgl.FilterSpecification {
  return ['==', ['get', 'id'], selectedId ?? ''];
}

function addFacilityLayers(
  map: mapboxgl.Map,
  data: FacilityFeatureCollection,
  selectedId: string | null,
) {
  if (map.getSource(SOURCE)) return;
  map.addSource(SOURCE, { type: 'geojson', data });
  map.addLayer({
    id: SELECTED,
    type: 'circle',
    source: SOURCE,
    filter: selectedFilter(selectedId),
    paint: {
      'circle-radius': 11,
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-stroke-color': '#111111',
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: PINS,
    type: 'circle',
    source: SOURCE,
    paint: {
      'circle-radius': 6,
      // Exact locations are filled, approximate ones hollow (specification section 6).
      'circle-color': ['match', ['get', 'precision'], 'exact', PIN_COLOUR, '#ffffff'],
      'circle-stroke-color': PIN_COLOUR,
      'circle-stroke-width': 2,
    },
  });
}

/** A Mapbox map of the given facilities. */
export default function FacilityMap(props: FacilityMapProps) {
  const { token, basemap, facilities, selectedId } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const shownBasemap = useRef(basemap);
  // The latest props, read by map event handlers that are registered once.
  const latest = useRef({ ...props, data: facilityFeatures(facilities) });
  useEffect(() => {
    latest.current = { ...props, data: facilityFeatures(props.facilities) };
  });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = new mapboxgl.Map({
      container: element,
      accessToken: token,
      style: BASEMAPS[shownBasemap.current].style,
      bounds: START,
      projection: 'mercator',
    });
    instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }));
    const report = () => {
      const bounds = instance.getBounds();
      latest.current.onViewChange(
        bounds &&
          bboxFromBounds(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()),
      );
    };
    instance.on('load', report);
    instance.on('moveend', report);
    // Also after a basemap change, which replaces the whole style.
    instance.on('style.load', () => {
      addFacilityLayers(instance, latest.current.data, latest.current.selectedId);
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
    if (!map.current || shownBasemap.current === basemap) return;
    shownBasemap.current = basemap;
    // Without diffing, the whole style reloads, so 'style.load' adds the pins again. (Mapbox's
    // types also demand its font options, which setStyle otherwise keeps as they are.)
    const reload = { diff: false } as Parameters<mapboxgl.Map['setStyle']>[1];
    map.current.setStyle(BASEMAPS[basemap].style, reload);
  }, [basemap]);

  useEffect(() => {
    map.current?.getSource<GeoJSONSource>(SOURCE)?.setData(facilityFeatures(facilities));
  }, [facilities]);

  useEffect(() => {
    if (map.current?.getLayer(SELECTED)) {
      map.current.setFilter(SELECTED, selectedFilter(selectedId));
    }
  }, [selectedId]);

  return <div ref={container} className="size-full" />;
}
