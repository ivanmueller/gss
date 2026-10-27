import { formatBbox, type Bbox } from '@grain/domain';
import { TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';

import { PageHeader } from '../components/PageHeader';
import { RealDataNote } from '../components/RealDataNote';
import { Button } from '../components/ui/button';
import { Callout } from '../components/ui/callout';
import { Card } from '../components/ui/card';
import { SegmentedControl } from '../components/ui/segmented-control';
import type { MapFacilities, MapFacility } from '../lib/api';
import { canEditDirectory, countryName, facilityTypeLabel } from '../lib/directory';
import { BASEMAPS, facilityPin, mapboxToken, type Basemap, type MapboxToken } from '../lib/mapbox';
import { Link } from '../lib/router';
import { useTheme } from '../lib/theme';
import { useApiResource } from '../lib/useApiResource';
import { cn } from '../lib/utils';
import type { DirectorySession } from './CounterpartiesPage';

// Mapbox GL JS is large, so it is fetched only when a map is shown.
const FacilityMap = lazy(() => import('../components/FacilityMap'));

const WORLD: Bbox = { west: -180, south: -90, east: 180, north: 90 };
/** Locations listed under the map; the map itself shows them all. */
const LIST_LIMIT = 200;

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function place(facility: MapFacility): string {
  return [facility.city, facility.region, countryName(facility.country)]
    .filter((part) => part !== null)
    .join(', ');
}

function facilityLabel(facility: MapFacility): string {
  return facility.name ?? facilityTypeLabel(facility.facilityType) ?? 'Location';
}

function PrecisionNote({ precision }: { precision: MapFacility['locationPrecision'] }) {
  return precision === 'exact' ? (
    <span>Exact location</span>
  ) : (
    <span>Approximate location (e.g. the town)</span>
  );
}

/** Matches the pins in FacilityMap, which look the same in both themes. */
function Legend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-3 rounded-full border-2 border-bid-solid bg-bid-solid"
        />
        Exact location
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-3 rounded-full border-2 border-bid-solid bg-white"
        />
        Approximate location
      </span>
    </p>
  );
}

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
      <p>{text} The locations are listed below.</p>
    </Callout>
  );
}

/** /map: the organization's counterparty locations on a Mapbox map, with a list. */
export function MapPage({
  session,
  mapbox = mapboxToken(),
}: {
  session: DirectorySession;
  mapbox?: MapboxToken;
}) {
  const { token, organization } = session;
  const [refused, setRefused] = useState(false);
  const showMap = mapbox.status === 'ok' && !refused;
  const [view, setView] = useState<Bbox | null>(null);
  const [basemap, setBasemap] = useState<Basemap>('map');
  const [theme] = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Without a map, list every location of the organization.
  const box = showMap ? view : WORLD;
  const [result] = useApiResource<MapFacilities>(
    box ? `/facilities?organization_id=${organization.id}&bbox=${formatBbox(box)}` : null,
    token,
    { keepPrevious: true },
  );
  const data = result.status === 'ok' ? result.data : null;
  const facilities = useMemo(() => data?.facilities ?? [], [data]);
  const selected = facilities.find((facility) => facility.id === selectedId) ?? null;
  const pins = useMemo(() => facilities.map(facilityPin), [facilities]);

  return (
    <section aria-labelledby="map-heading" className="flex flex-col gap-4">
      <PageHeader
        id="map-heading"
        title="Map"
        description={`Locations of ${organization.name}’s counterparties.`}
      />
      <RealDataNote organization={organization.name} />

      {mapbox.status !== 'ok' && <SetupNote token={mapbox.status} />}
      {mapbox.status === 'ok' && refused && <SetupNote token="refused" />}

      {showMap && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend />
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
          <div className="h-[60vh] min-h-80 overflow-hidden rounded-card border bg-muted shadow-xs lg:h-[65vh]">
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
              <FacilityMap
                token={mapbox.token}
                basemap={basemap}
                theme={theme}
                pins={pins}
                selectedId={selectedId}
                onViewChange={(bbox) => {
                  if (bbox) setView(bbox);
                }}
                onSelect={setSelectedId}
                onTokenRefused={() => {
                  setRefused(true);
                }}
              />
            </Suspense>
          </div>
        </div>
      )}

      {selected && (
        <Card asChild>
          <section aria-label="Selected location" className="flex flex-col gap-1 px-4 py-3 text-sm">
            <Link
              href={`/counterparties/${selected.counterpartyId}`}
              className="w-fit rounded-xs font-medium underline-offset-4 hover:underline"
            >
              {selected.legalName}
            </Link>
            <span>
              {facilityLabel(selected)} · {place(selected)}
            </span>
            <span className="text-muted-foreground">
              <PrecisionNote precision={selected.locationPrecision} /> · {selected.latitude},{' '}
              {selected.longitude}
            </span>
          </section>
        </Card>
      )}

      <p role="status" className="text-sm">
        {result.status === 'error' && `The locations could not be loaded: ${result.error.message}`}
        {result.status === 'loading' && box && 'Loading locations…'}
        {data && (
          <>
            {showMap
              ? `${count(data.facilities.length, 'location', 'locations')} in view.`
              : `${count(data.facilities.length, 'location has', 'locations have')} coordinates.`}
            {data.truncated &&
              ` Only the first ${count(data.facilities.length, 'is', 'are')} shown; zoom in to see the rest.`}
            {data.withoutCoordinates > 0 &&
              ` ${count(data.withoutCoordinates, 'location has', 'locations have')} no coordinates yet, so ${data.withoutCoordinates === 1 ? 'it is' : 'they are'} not on the map.`}
          </>
        )}
      </p>
      {data && data.withoutCoordinates > 0 && canEditDirectory(organization.role) && (
        <Button asChild className="w-fit">
          <Link href="/map/coordinates">Find coordinates from addresses</Link>
        </Button>
      )}

      {facilities.length > 0 && (
        <Card asChild>
          <ul
            aria-label={showMap ? 'Locations in view' : 'Locations'}
            className="divide-y overflow-hidden"
          >
            {facilities.slice(0, LIST_LIMIT).map((facility) => (
              <li
                key={facility.id}
                className={cn(
                  'flex flex-col gap-0.5 px-4 py-2.5 text-sm',
                  facility.id === selectedId && 'bg-accent',
                )}
              >
                <Link
                  href={`/counterparties/${facility.counterpartyId}`}
                  className="w-fit rounded-xs font-medium underline-offset-4 hover:underline"
                >
                  {facility.legalName}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {facilityLabel(facility)} · {place(facility)} ·{' '}
                  <PrecisionNote precision={facility.locationPrecision} />
                </span>
              </li>
            ))}
            {facilities.length > LIST_LIMIT && (
              <li className="px-4 py-2 text-sm text-muted-foreground">
                And {count(facilities.length - LIST_LIMIT, 'more', 'more')}
                {showMap ? '; zoom in to narrow the list.' : '.'}
              </li>
            )}
          </ul>
        </Card>
      )}
    </section>
  );
}
