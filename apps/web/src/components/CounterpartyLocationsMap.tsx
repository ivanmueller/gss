import { lazy, Suspense, useMemo, useState } from 'react';

import type { Facility } from '../lib/api';
import {
  BASEMAPS,
  counterpartyTone,
  mapboxToken,
  pinBounds,
  type Basemap,
  type MapboxToken,
  type MapPin,
} from '../lib/mapbox';
import { useTheme } from '../lib/theme';
import { SegmentedControl } from './ui/segmented-control';

// Mapbox GL JS is large, so it is fetched only when a map is shown.
const FacilityMap = lazy(() => import('./FacilityMap'));

/**
 * Starting zoom limits: an exact site close enough to see its bins and rail spur, an
 * approximate one (a town's centre) at street level (owner's request, 2026-10-30: closer).
 */
export const EXACT_MAX_ZOOM = 17;
export const APPROXIMATE_MAX_ZOOM = 14;

/** A location with coordinates as a map pin, in its counterparty's colour. */
export function locationPins(facilities: readonly Facility[], types: readonly string[]): MapPin[] {
  const tone = counterpartyTone(types);
  return facilities.flatMap((facility) =>
    facility.latitude !== null && facility.longitude !== null
      ? [
          {
            id: facility.id,
            latitude: Number(facility.latitude),
            longitude: Number(facility.longitude),
            tone,
            hollow: facility.locationPrecision !== 'exact',
          },
        ]
      : [],
  );
}

/**
 * A small map of one counterparty's locations on its page, in satellite view unless Map is
 * chosen (owner's request, 2026-10-30), kept simple: no road names, highway numbers or points
 * of interest. It starts on the locations that have coordinates;
 * without any, or without a Mapbox token, it is not shown (the list says which have none).
 */
export function CounterpartyLocationsMap({
  facilities,
  types,
  selectedId,
  onSelect,
  mapbox = mapboxToken(),
}: {
  facilities: readonly Facility[];
  types: readonly string[];
  selectedId: string | null;
  onSelect: (facilityId: string) => void;
  mapbox?: MapboxToken;
}) {
  const [basemap, setBasemap] = useState<Basemap>('satellite');
  const [refused, setRefused] = useState(false);
  const [theme] = useTheme();
  const pins = useMemo(() => locationPins(facilities, types), [facilities, types]);
  const bounds = pinBounds(pins);
  if (mapbox.status !== 'ok' || refused || bounds === null) return null;
  const maxZoom = pins.every((pin) => !pin.hollow) ? EXACT_MAX_ZOOM : APPROXIMATE_MAX_ZOOM;

  return (
    <div className="border-b">
      <div
        role="region"
        aria-label="Map of its locations"
        className="relative h-60 overflow-hidden bg-muted"
      >
        <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
          <FacilityMap
            // A new starting view when the locations move.
            key={bounds.join(',')}
            token={mapbox.token}
            basemap={basemap}
            theme={theme}
            pins={pins}
            selectedId={selectedId}
            start={bounds}
            startMaxZoom={maxZoom}
            cooperative
            simple
            onSelect={onSelect}
            onTokenRefused={() => {
              setRefused(true);
            }}
          />
        </Suspense>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <p className="text-xs text-muted-foreground">
          {pins.length === facilities.length
            ? `${pins.length === 1 ? 'Its location' : `All ${String(pins.length)} locations`} on the map.`
            : `${String(pins.length)} of ${String(facilities.length)} locations on the map; the others have no coordinates yet.`}
        </p>
        <SegmentedControl
          label="Map style"
          options={(Object.keys(BASEMAPS) as Basemap[]).map((key) => ({
            value: key,
            label: BASEMAPS[key].label,
          }))}
          value={basemap}
          onChange={setBasemap}
        />
      </div>
    </div>
  );
}
