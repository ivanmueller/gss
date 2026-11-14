import type { FreightEnd } from '@grain/domain';
import { lazy, Suspense, useMemo, useState } from 'react';

import { mapboxToken, pinBounds, type MapboxToken, type MapPin } from '../lib/mapbox';
import { useTheme } from '../lib/theme';
import { APPROXIMATE_MAX_ZOOM } from './CounterpartyLocationsMap';

// Mapbox GL JS is large, so it is fetched only when a map is shown.
const FacilityMap = lazy(() => import('./FacilityMap'));

/**
 * The towns of a freight route found on the map (F-235), as pins in the carriers' colour,
 * hollow when approximate. No line between them (the owner, 2026-11-02: no lines between
 * places). Saved locations are shown on their company's page.
 */
export function routePins(ends: readonly FreightEnd[]): MapPin[] {
  return ends.flatMap((end, index) =>
    end.kind === 'area' && end.point !== null
      ? [
          {
            id: `end-${String(index)}`,
            latitude: Number(end.point.latitude),
            longitude: Number(end.point.longitude),
            tone: 'mixed' as const,
            hollow: end.point.precision !== 'exact',
          },
        ]
      : [],
  );
}

/** A small map of the route's towns on a freight rate's page; nothing without one. */
export function FreightRouteMap({
  origin,
  destination,
  mapbox = mapboxToken(),
}: {
  origin: FreightEnd;
  destination: FreightEnd;
  mapbox?: MapboxToken;
}) {
  const [refused, setRefused] = useState(false);
  const [theme] = useTheme();
  const pins = useMemo(() => routePins([origin, destination]), [origin, destination]);
  const bounds = pinBounds(pins);
  if (mapbox.status !== 'ok' || refused || bounds === null) return null;
  return (
    <div
      role="region"
      aria-label="Map of the route’s towns"
      className="relative h-60 overflow-hidden border-t bg-muted"
    >
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
        <FacilityMap
          key={bounds.join(',')}
          token={mapbox.token}
          basemap="map"
          theme={theme}
          pins={pins}
          selectedId={null}
          start={bounds}
          startMaxZoom={APPROXIMATE_MAX_ZOOM - 4}
          cooperative
          simple
          onSelect={() => undefined}
          onTokenRefused={() => {
            setRefused(true);
          }}
        />
      </Suspense>
    </div>
  );
}
