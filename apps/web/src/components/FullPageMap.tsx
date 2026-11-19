import { Settings, TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';

import { LayerApiContext, petroleumLayers } from '../lib/layerApi';
import {
  BASEMAPS,
  mapboxToken,
  type Basemap,
  type MapBounds,
  type MapboxToken,
} from '../lib/mapbox';
import { useTheme } from '../lib/theme';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { AER_LICENCES, AER_RIGS, AerPickedCard, useAerLists } from './AerLists';
import {
  MapLayersButton,
  MapLayersLegend,
  MapLayersPanel,
  PickedFeatureCard,
  useMapLayers,
} from './MapLayers';
import { MapLayerSettings } from './MapLayerSettings';
import { Button } from './ui/button';
import { Callout } from './ui/callout';
import { Dialog, DialogContent, DialogTrigger } from './ui/dialog';
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
 * (F-239): the map filling the window, with map styles and the oil and gas map layers (F-247
 * part 2), which are its own, kept in the oil and gas database: grain's map layers are neither
 * asked for nor offered here. Everyone switches layers on and off under Layers; admins add and
 * manage them under Settings, and choose which are on when the map opens.
 */
export function FullPageMap({
  session,
  mapbox = mapboxToken(),
}: {
  session: DirectorySession;
  mapbox?: MapboxToken;
}) {
  const organizationId = session.organization.id;
  const api = useMemo(() => petroleumLayers(organizationId), [organizationId]);
  return (
    <LayerApiContext value={api}>
      <OilAndGasMap session={session} mapbox={mapbox} />
    </LayerApiContext>
  );
}

function OilAndGasMap({ session, mapbox }: { session: DirectorySession; mapbox: MapboxToken }) {
  const [refused, setRefused] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('map');
  const [theme] = useTheme();
  const layers = useMapLayers(mapbox.status === 'ok' && !refused ? session : null);
  const aer = useAerLists(session.organization.id, session.token);
  const admin = session.organization.role === 'org_admin';

  const allOverlays = useMemo(
    () => [...layers.overlays, ...aer.overlays],
    [layers.overlays, aer.overlays],
  );

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
          overlays={allOverlays}
          authToken={session.token}
          onViewChange={layers.onViewChange}
          onOverlayClick={(picked) => {
            // A dot of the AER's lists has its own card; any other shape, the layers' (F-243-2).
            const dot = picked.layerId === AER_LICENCES || picked.layerId === AER_RIGS;
            if (dot) aer.pick(picked);
            else aer.close();
            layers.setPicked(dot ? null : picked);
          }}
          onLayersStale={layers.onStale}
          layersRetry={layers.retry}
          onTokenRefused={() => {
            setRefused(true);
          }}
        />
        {/* Shown with the map itself, so it never covers the loading message (F-238-R1-02). */}
        <div className="absolute top-3 left-3 z-20 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-2 rounded-card border bg-card/95 p-2 shadow-xs">
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
          {/* Admins only; the API refuses everyone else whatever the page shows. */}
          {admin && (
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Settings aria-hidden="true" />
                  Settings
                </Button>
              </DialogTrigger>
              <DialogContent
                title="Map settings"
                description="The layers of the oil and gas map. Only admins see this."
                className="max-w-2xl"
              >
                {/* The map reads its list again after each change (F-247-2-D1-03). */}
                <MapLayerSettings session={session} onChanged={layers.reload} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </Suspense>
      {/* Below the zoom buttons, top right (F-139). */}
      <MapLayersPanel state={layers} side="right" />
      {/* The AER's new licences and rigs: under the controls, top left (F-243-2). */}
      <div className="absolute top-16 left-3 z-10 max-w-[calc(100%-1.5rem)]">{aer.panel}</div>
      <AerPickedCard state={aer} />
      <PickedFeatureCard state={layers} token={session.token} className="left-3" />
      {/* Both sit at the bottom left over the map: the legend makes way for a clicked shape's
          details, so it never covers their fields or their close button (F-247-2-R3-02). */}
      {/* With many layers on, the legend scrolls within the space under the buttons (which sit
          above it), so Layers, the map style and Settings stay in reach (F-247-2-R13-02). */}
      {layers.picked === null && (
        <div className="absolute bottom-8 left-3 z-10 max-h-[calc(100%-9rem)] max-w-[calc(100%-1.5rem)] overflow-y-auto">
          <MapLayersLegend state={layers} />
        </div>
      )}
    </div>
  );
}
