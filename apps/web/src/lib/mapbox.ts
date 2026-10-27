import type { MapFacility } from './api';

// Mapbox settings for the map page (docs/DECISIONS.md, 2026-10-27 map decision). Every
// Mapbox call lives in components/FacilityMap.tsx; this file holds what can be tested
// without a browser map.

export type MapboxToken =
  { status: 'ok'; token: string } | { status: 'missing' } | { status: 'invalid' };

/**
 * The Mapbox token built into the web app (VITE_MAPBOX_TOKEN). Only a public token (pk.)
 * is used; Mapbox restricts it to the app's addresses. The build refuses a secret token.
 */
export function mapboxToken(value = import.meta.env.VITE_MAPBOX_TOKEN): MapboxToken {
  const token = value?.trim() ?? '';
  if (token === '') return { status: 'missing' };
  return /^pk\.[A-Za-z0-9._-]+$/.test(token) ? { status: 'ok', token } : { status: 'invalid' };
}

export const BASEMAPS = {
  streets: { label: 'Map', style: 'mapbox://styles/mapbox/streets-v12' },
  satellite: { label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
} as const;

export type Basemap = keyof typeof BASEMAPS;

export interface FacilityFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { id: string; precision: MapFacility['locationPrecision'] };
  }[];
}

/** Map pins: one point per facility, carrying only its id and location precision. */
export function facilityFeatures(facilities: MapFacility[]): FacilityFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: facilities.map((facility) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Number(facility.longitude), Number(facility.latitude)],
      },
      properties: { id: facility.id, precision: facility.locationPrecision },
    })),
  };
}
