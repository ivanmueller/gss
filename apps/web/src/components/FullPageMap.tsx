import { TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

import {
  BASEMAPS,
  mapboxToken,
  type Basemap,
  type MapBounds,
  type MapboxToken,
} from '../lib/mapbox';
import { useTheme } from '../lib/theme';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import {
  MapLayersButton,
  MapLayersLegend,
  MapLayersPanel,
  PickedFeatureCard,
  useMapLayers,
} from './MapLayers';
import { Callout } from './ui/callout';
import { SegmentedControl } from './ui/segmented-control';

// Mapbox GL JS is large, so it is fetched only when a map is shown.
const FacilityMap = lazy(() => import('./FacilityMap'));

/**
 * The starting view: Canada from the Pacific to the Atlantic, up to 70°N. The Arctic islands
 * (to 83°N) are left out on purpose: on a Mercator map they would take most of the window and
 * shrink the provinces where oil and gas is produced to half their height (F-239-R1-01).
 */
export const CANADA: MapBounds = [-141, 41.7, -52.6, 70];

const NO_PINS = [] as const;

/**
 * The map on its own page (F-238, map.torvenco.com), for the oil and gas side of the platform
 * (F-239): the map filling the window, with map styles and the team's map layers, and no
 * records of its own yet (owner's request, 2026-11-18: "no data on the map yet").
 */
export function FullPageMap({
  session,
  mapbox = mapboxToken(),
}: {
  session: DirectorySession;
  mapbox?: MapboxToken;
}) {
  const [refused, setRefused] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('map');
  const [theme] = useTheme();
  const layers = useMapLayers(mapbox.status === 'ok' && !refused ? session : null);

  if (mapbox.status !== 'ok' || refused) {
    const text = refused
      ? 'Mapbox refused the token. An administrator needs to check the token and the web addresses it allows (README, “Map”).'
      : 'The map is not set up yet: it needs a Mapbox public token (README, “Map”).';
    return (
      <div className="p-4">
        <Callout variant="warning" icon={TriangleAlert}>
          <p>{text}</p>
        </Callout>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-muted">
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
        <FacilityMap
          token={mapbox.token}
          basemap={basemap}
          theme={theme}
          pins={NO_PINS}
          selectedId={null}
          start={CANADA}
          onSelect={() => undefined}
          overlays={layers.overlays}
          authToken={session.token}
          onViewChange={layers.onViewChange}
          onOverlayClick={layers.setPicked}
          onTokenRefused={() => {
            setRefused(true);
          }}
        />
        {/* Shown with the map itself, so it never covers the loading message (F-238-R1-02). */}
        <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-2 rounded-card border bg-card/95 p-2 shadow-xs">
          <MapLayersButton state={layers} />
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
      </Suspense>
      {/* Below the zoom buttons, top right (F-139). */}
      <MapLayersPanel state={layers} side="right" />
      <PickedFeatureCard state={layers} token={session.token} className="left-3" />
      <div className="absolute bottom-8 left-3 z-10 max-w-[calc(100%-1.5rem)]">
        <MapLayersLegend state={layers} />
      </div>
    </div>
  );
}
