import { formatBbox, type Bbox } from '@grain/domain';
import { TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';

import type { MapFacilities } from '../lib/api';
import {
  BASEMAPS,
  facilityPin,
  mapboxToken,
  pinBounds,
  type Basemap,
  type MapboxToken,
} from '../lib/mapbox';
import { useTheme } from '../lib/theme';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import {
  MapLayersButton,
  MapLayersLegend,
  MapLayersPanel,
  PickedFeatureCard,
  useMapLayers,
} from './MapLayers';
import { MapPinLegend } from './MapPinLegend';
import { Callout } from './ui/callout';
import { SegmentedControl } from './ui/segmented-control';

// Mapbox GL JS is large, so it is fetched only when a map is shown.
const FacilityMap = lazy(() => import('./FacilityMap'));

const WORLD: Bbox = { west: -180, south: -90, east: 180, north: 90 };

function SetupNote({ token }: { token: Exclude<MapboxToken['status'], 'ok'> | 'refused' }) {
  const text = {
    missing:
      'The map is not set up yet: it needs a Mapbox public token, which an administrator adds in GitHub (README, “Map”).',
    invalid:
      'The Mapbox token built into this app is not a public token (one starting with “pk.”). An administrator needs to replace it (README, “Map”).',
    refused:
      'Mapbox refused the token. An administrator needs to check the token and the web addresses it allows (README, “Map”).',
  }[token];
  return (
    <Callout variant="warning" icon={TriangleAlert}>
      <p>{text}</p>
    </Callout>
  );
}

/**
 * The Counterparties page's map view: every located place of the counterparties the page's
 * filters leave (`only`, counterparty ids), whatever part of the map is in view, and the
 * map fitted to them (owner's request, 2026-10-30: no count and no list under the map).
 * Archived counterparties are never shown.
 */
export function CounterpartyMap({
  session,
  only,
  mapbox = mapboxToken(),
}: {
  session: DirectorySession;
  only: ReadonlySet<string>;
  mapbox?: MapboxToken;
}) {
  const { token, organization } = session;
  const [refused, setRefused] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('map');
  const [theme] = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Asked for only when the map is shown.
  const layers = useMapLayers(mapbox.status === 'ok' && !refused ? session : null);

  // Every located place at once; the filters only choose which are shown.
  const [result] = useApiResource<MapFacilities>(
    mapbox.status === 'ok' && !refused
      ? `/facilities?organization_id=${organization.id}&bbox=${formatBbox(WORLD)}`
      : null,
    token,
  );
  const data = result.status === 'ok' ? result.data : null;
  const facilities = useMemo(
    () => (data?.facilities ?? []).filter((facility) => only.has(facility.counterpartyId)),
    [data, only],
  );
  const pins = useMemo(() => facilities.map(facilityPin), [facilities]);
  const bounds = pinBounds(pins);

  if (mapbox.status !== 'ok') return <SetupNote token={mapbox.status} />;
  if (refused) return <SetupNote token="refused" />;

  // The server sends at most 5,000 places (MAP_LIMIT): never leave some out without saying so.
  const truncatedNote = data?.truncated ? (
    <p role="status" className="text-xs text-warning">
      Not every place is shown: the map loads at most {data.facilities.length.toLocaleString()}.
    </p>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <MapPinLegend />
          <div className="flex flex-wrap items-center gap-2">
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
          {truncatedNote}
        </div>
        <div className="relative h-[60vh] min-h-80 overflow-hidden rounded-card border bg-muted shadow-xs lg:h-[65vh]">
          {result.status === 'error' ? (
            <p role="alert" className="p-4 text-sm text-danger">
              The locations could not be loaded: {result.error.message}
            </p>
          ) : data === null ? (
            <p className="p-4 text-sm text-muted-foreground">Loading map…</p>
          ) : (
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
              <FacilityMap
                token={mapbox.token}
                basemap={basemap}
                theme={theme}
                pins={pins}
                selectedId={selectedId}
                {...(bounds && { start: bounds, startMaxZoom: 12 })}
                fitTo={bounds}
                onSelect={setSelectedId}
                overlays={layers.overlays}
                authToken={token}
                onViewChange={layers.onViewChange}
                onOverlayClick={layers.setPicked}
                onTokenRefused={() => {
                  setRefused(true);
                }}
              />
            </Suspense>
          )}
          {/* Below the zoom buttons, top right (F-139). */}
          <MapLayersPanel state={layers} side="right" />
          <PickedFeatureCard state={layers} token={token} className="left-3" />
        </div>
        <MapLayersLegend state={layers} />
      </div>
    </div>
  );
}
