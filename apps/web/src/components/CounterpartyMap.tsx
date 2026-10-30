import { formatBbox, type Bbox } from '@grain/domain';
import { TriangleAlert } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';

import type { MapFacilities, MapFacility } from '../lib/api';
import { countryName, facilityTypeLabel, typeLabel } from '../lib/directory';
import {
  BASEMAPS,
  facilityPin,
  mapboxToken,
  pinBounds,
  type Basemap,
  type MapboxToken,
} from '../lib/mapbox';
import { Link } from '../lib/router';
import { useTheme } from '../lib/theme';
import { useApiResource } from '../lib/useApiResource';
import { cn } from '../lib/utils';
import type { DirectorySession } from '../pages/CounterpartiesPage';
import { Callout } from './ui/callout';
import { Card } from './ui/card';
import { SegmentedControl } from './ui/segmented-control';

// Mapbox GL JS is large, so it is fetched only when a map is shown.
const FacilityMap = lazy(() => import('./FacilityMap'));

const WORLD: Bbox = { west: -180, south: -90, east: 180, north: 90 };

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

/** Whose pins are which colour, and filled or hollow; matches the pins in FacilityMap. */
function Legend() {
  const tones = [
    ['Buyer', 'border-bid bg-bid'],
    ['Seller', 'border-offer bg-offer'],
    ['Buyer and seller, broker or carrier', 'border-info bg-info'],
  ] as const;
  return (
    <ul
      aria-label="Map legend"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {tones.map(([label, colour]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-3 rounded-full border-2', colour)} />
          {label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="size-3 rounded-full border-2 border-muted-foreground bg-background"
        />
        Hollow: approximate location (e.g. the town)
      </li>
    </ul>
  );
}

function whose(facility: MapFacility): string {
  return facility.counterpartyTypes.map(typeLabel).join(', ');
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
  const selected = facilities.find((facility) => facility.id === selectedId) ?? null;
  const pins = useMemo(() => facilities.map(facilityPin), [facilities]);
  const bounds = pinBounds(pins);

  if (mapbox.status !== 'ok') return <SetupNote token={mapbox.status} />;
  if (refused) return <SetupNote token="refused" />;

  return (
    <div className="flex flex-col gap-4">
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
                onTokenRefused={() => {
                  setRefused(true);
                }}
              />
            </Suspense>
          )}
        </div>
      </div>

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
              {whose(selected)} · {facilityLabel(selected)} · {place(selected)}
            </span>
            <span className="text-muted-foreground">
              <PrecisionNote precision={selected.locationPrecision} /> · {selected.latitude},{' '}
              {selected.longitude}
            </span>
          </section>
        </Card>
      )}
    </div>
  );
}
