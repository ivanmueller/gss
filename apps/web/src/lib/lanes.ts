import type { CarrierLane } from '@grain/domain';
import type { MultiPolygon } from 'geojson';

import type { MapBounds } from './mapbox';

// A carrier's lanes on a map (owner's request, 2026-11-01): the provinces and states it loads
// in and delivers to, shaded, with a line for each lane; the places its freight rates run
// between, dashed.

/** The outlines of the 64 places, from apps/web/src/data/lane-regions.json. */
export interface LaneRegionData {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { code: string; center: number[] };
    geometry: MultiPolygon;
  }[];
}

/**
 * How a place is drawn: where lanes start (`from`), where they end (`to`), or only where its
 * freight rates run (`quoted`). A place lanes both start and end in is `from`.
 */
export type LaneRole = 'from' | 'to' | 'quoted';

export interface LaneAreas {
  regions: {
    type: 'FeatureCollection';
    features: {
      type: 'Feature';
      properties: { code: string; role: LaneRole };
      geometry: MultiPolygon;
    }[];
  };
  lines: {
    type: 'FeatureCollection';
    features: {
      type: 'Feature';
      properties: { quoted: boolean };
      geometry: { type: 'LineString'; coordinates: number[][] };
    }[];
  };
}

const key = (lane: Pick<CarrierLane, 'origin' | 'destination'>) =>
  `${lane.origin}>${lane.destination}`;

/** The freight rates' lanes that are not also entered lanes. */
export function quotedOnly(
  lanes: readonly CarrierLane[],
  quotedLanes: readonly CarrierLane[],
): CarrierLane[] {
  const entered = new Set(lanes.map(key));
  return quotedLanes.filter((lane) => !entered.has(key(lane)));
}

/** The places and lines to draw for a carrier's lanes and its freight rates' lanes. */
export function laneAreas(
  data: LaneRegionData,
  lanes: readonly CarrierLane[],
  quotedLanes: readonly CarrierLane[],
): LaneAreas {
  const roles = new Map<string, LaneRole>();
  for (const lane of quotedOnly(lanes, quotedLanes)) {
    roles.set(lane.origin, 'quoted');
    roles.set(lane.destination, 'quoted');
  }
  for (const lane of lanes) roles.set(lane.destination, 'to');
  for (const lane of lanes) roles.set(lane.origin, 'from');

  const byCode = new Map(data.features.map((feature) => [feature.properties.code, feature]));
  const line = (lane: CarrierLane, quoted: boolean): LaneAreas['lines']['features'] => {
    const from = byCode.get(lane.origin)?.properties.center;
    const to = byCode.get(lane.destination)?.properties.center;
    if (!from || !to || lane.origin === lane.destination) return [];
    return [
      {
        type: 'Feature',
        properties: { quoted },
        geometry: { type: 'LineString', coordinates: [from, to] },
      },
    ];
  };

  return {
    regions: {
      type: 'FeatureCollection',
      features: [...roles].flatMap(([code, role]) => {
        const feature = byCode.get(code);
        return feature
          ? [{ type: 'Feature', properties: { code, role }, geometry: feature.geometry }]
          : [];
      }),
    },
    lines: {
      type: 'FeatureCollection',
      features: [
        ...lanes.flatMap((lane) => line(lane, false)),
        ...quotedOnly(lanes, quotedLanes).flatMap((lane) => line(lane, true)),
      ],
    },
  };
}

/**
 * The area holding every shaded place, for the map to start on; null when none. Points east
 * of 0° (Alaska's islands across the 180th meridian) are left out, so Alaska does not stretch
 * the view around the world.
 */
export function areaBounds(areas: LaneAreas): MapBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of areas.regions.features) {
    for (const polygon of feature.geometry.coordinates) {
      for (const [longitude = 0, latitude = 0] of polygon[0] ?? []) {
        if (longitude > 0) continue;
        west = Math.min(west, longitude);
        east = Math.max(east, longitude);
        south = Math.min(south, latitude);
        north = Math.max(north, latitude);
      }
    }
  }
  return west === Infinity ? null : [west, south, east, north];
}
