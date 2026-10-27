import { formatBbox, type Bbox } from '@grain/domain';
import { lazy, Suspense, useState } from 'react';

import { RealDataNote } from '../components/RealDataNote';
import type { MapFacilities, MapFacility } from '../lib/api';
import { canEditDirectory, countryName, facilityTypeLabel } from '../lib/directory';
import { BASEMAPS, mapboxToken, type Basemap, type MapboxToken } from '../lib/mapbox';
import { Link } from '../lib/router';
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

function Legend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full border-2 border-bid bg-bid" />
        Exact location
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full border-2 border-bid bg-card" />
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
    <p role="note" className="rounded-lg border bg-card px-3 py-2 text-sm">
      {text} The locations are listed below.
    </p>
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
  const [basemap, setBasemap] = useState<Basemap>('streets');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Without a map, list every location of the organization.
  const box = showMap ? view : WORLD;
  const [result] = useApiResource<MapFacilities>(
    box ? `/facilities?organization_id=${organization.id}&bbox=${formatBbox(box)}` : null,
    token,
    { keepPrevious: true },
  );
  const data = result.status === 'ok' ? result.data : null;
  const facilities = data?.facilities ?? [];
  const selected = facilities.find((facility) => facility.id === selectedId) ?? null;

  return (
    <section aria-labelledby="map-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="map-heading" className="text-lg font-semibold">
          Map
        </h2>
        <p className="text-sm text-muted-foreground">
          Locations of {organization.name}’s counterparties.
        </p>
      </div>
      <RealDataNote organization={organization.name} />

      {mapbox.status !== 'ok' && <SetupNote token={mapbox.status} />}
      {mapbox.status === 'ok' && refused && <SetupNote token="refused" />}

      {showMap && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend />
            <div role="group" aria-label="Map style" className="flex gap-1">
              {(Object.keys(BASEMAPS) as Basemap[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={basemap === key}
                  onClick={() => {
                    setBasemap(key);
                  }}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    basemap === key && 'bg-muted font-medium',
                  )}
                >
                  {BASEMAPS[key].label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[60vh] min-h-80 overflow-hidden rounded-xl border bg-muted lg:h-[65vh]">
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
              <FacilityMap
                token={mapbox.token}
                basemap={basemap}
                facilities={facilities}
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
        <section
          aria-label="Selected location"
          className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-sm"
        >
          <Link
            href={`/counterparties/${selected.counterpartyId}`}
            className="font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
        <Link
          href="/map/coordinates"
          className="w-fit rounded-md border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Find coordinates from addresses
        </Link>
      )}

      {facilities.length > 0 && (
        <ul
          aria-label={showMap ? 'Locations in view' : 'Locations'}
          className="divide-y rounded-xl border bg-card"
        >
          {facilities.slice(0, LIST_LIMIT).map((facility) => (
            <li
              key={facility.id}
              className={cn(
                'flex flex-col gap-0.5 px-4 py-2 text-sm',
                facility.id === selectedId && 'bg-accent',
              )}
            >
              <Link
                href={`/counterparties/${facility.counterpartyId}`}
                className="font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
      )}
    </section>
  );
}
