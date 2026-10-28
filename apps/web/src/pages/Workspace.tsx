import { ChevronLeft, ChevronRight, MapPinned } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';

import { CommodityPicker } from '../components/CommodityPicker';
import { FacilityList } from '../components/FacilityList';
import { FacilityTable } from '../components/FacilityTable';
import { OrderBook } from '../components/OrderBook';
import { SelectedFacility } from '../components/SelectedFacility';
import { SegmentedControl } from '../components/ui/segmented-control';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { SYNTHETIC_COMMODITIES, SYNTHETIC_FACILITIES, SYNTHETIC_FX } from '../data/synthetic';
import type { Facility, FacilityRole } from '../data/types';
import { useDemoData } from '../lib/demo';
import { mapboxToken, type MapboxToken, type MapPin } from '../lib/mapbox';
import { buildOrderBooks } from '../lib/orderBook';
import { useTheme } from '../lib/theme';
import { useApiResource } from '../lib/useApiResource';
import { useMediaQuery } from '../lib/useMediaQuery';
import { cn } from '../lib/utils';
import { quotedCommodities, quotesToFacilities } from '../lib/workspaceQuotes';
import type { DirectorySession } from './CounterpartiesPage';
import type { QuoteListResponse } from './QuotesPage';

// Mapbox GL JS is large, so it is fetched only when a map is shown.
const FacilityMap = lazy(() => import('../components/FacilityMap'));

// Tailwind's `lg` breakpoint; from `xl` the order book sits over the map's right side.
const DESKTOP_QUERY = '(min-width: 1024px)';
const OVERLAY_QUERY = '(min-width: 1280px)';
// The order book's width over the map (27rem), in pixels.
const OVERLAY_WIDTH = 432;
const NO_FACILITIES: readonly Facility[] = [];

type RoleFilter = 'all' | FacilityRole;

const ROLES: readonly { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'seller', label: 'Sellers' },
  { value: 'buyer', label: 'Buyers' },
];

/**
 * Buyers in the bid colour, sellers in the ask colour; approximate locations hollow. A
 * location without coordinates gets no pin; it stays in the order book and the table.
 */
function pinsOf(facility: Facility): MapPin[] {
  if (facility.latitude === null || facility.longitude === null) return [];
  return [
    {
      id: facility.id,
      latitude: facility.latitude,
      longitude: facility.longitude,
      tone: facility.roles.includes('buyer') ? 'bid' : 'offer',
      hollow: facility.locationPrecision !== 'exact',
    },
  ];
}

function Legend() {
  const dot = 'size-3 rounded-full border-2';
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`${dot} border-offer bg-offer`} />
        Seller ask
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`${dot} border-bid bg-bid`} />
        Buyer bid
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`${dot} border-muted-foreground bg-background`} />
        Hollow: approximate location
      </span>
    </p>
  );
}

function MapUnavailable({ refused }: { refused: boolean }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center">
      <MapPinned aria-hidden="true" className="size-8 text-muted-foreground" />
      <p className="font-medium">Map not available</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {refused
          ? 'Mapbox refused the token. An administrator needs to check the token and the web addresses it allows (README, “Map”).'
          : 'The map needs a Mapbox public token, which an administrator adds in GitHub (README, “Map”). The order book and the facility list still work.'}
      </p>
    </div>
  );
}

/**
 * The trading workspace: the chosen commodities' sellers and buyers on the map, the order
 * book of their asks and bids in CAD, and the facility list. It shows GSS's live bids and
 * offers, fetched again every minute and when the page is shown again; with demo data on
 * (profile menu) it shows made-up data instead, with the golden fixture's CAD/USD rate.
 * Real USD quotes wait for a real rate (the Bank of Canada's, not built yet): they are left
 * out of the book with a note, never converted at a made-up rate.
 */
export function Workspace({
  mapbox = mapboxToken(),
  session = null,
}: {
  mapbox?: MapboxToken;
  /** The signed-in member, whose organization's bids and offers are shown. */
  session?: DirectorySession | null;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const overlay = useMediaQuery(OVERLAY_QUERY, true);
  const [theme] = useTheme();
  // Quotes are judged live or expired against this clock, checked every minute, so a quote
  // leaves the order book soon after its valid-until time even if the page stays open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  // The commodities chosen in the picker; null until the person chooses, meaning all.
  const [picked, setPicked] = useState<string[] | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  // Over the map, the order book can be tucked away to the right to see the whole map.
  const [bookOpen, setBookOpen] = useState(true);
  // Made-up prices only with demo data on (profile menu); otherwise GSS's own, never mixed.
  const [demo] = useDemoData();
  const real = !demo && session !== null;
  const token = session?.token ?? '';
  const [live, reloadLive] = useApiResource<QuoteListResponse>(
    real ? `/quotes?organization_id=${session.organization.id}` : null,
    token,
  );
  const [commodityList] = useApiResource<{ commodities: { code: string; name: string }[] }>(
    real ? '/commodities' : null,
    token,
  );
  // New, revised, withdrawn and expired quotes reach the book without a reload of the page.
  useEffect(() => {
    if (!real) return;
    const timer = window.setInterval(reloadLive, 60_000);
    const onShow = () => {
      if (document.visibilityState === 'visible') reloadLive();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [real, reloadLive]);
  const realFacilities = useMemo(
    () =>
      // An answer without a list (a proxy's error page, say) shows nothing rather than failing.
      live.status === 'ok' && Array.isArray(live.data.quotes)
        ? quotesToFacilities(live.data.quotes)
        : NO_FACILITIES,
    [live],
  );
  const facilities = demo ? SYNTHETIC_FACILITIES : realFacilities;
  // The demo's made-up rate converts only made-up prices; real USD prices have no rate yet.
  const fx = demo ? SYNTHETIC_FX : null;
  const available = useMemo(
    () =>
      demo
        ? [...SYNTHETIC_COMMODITIES]
        : quotedCommodities(
            realFacilities,
            commodityList.status === 'ok' && Array.isArray(commodityList.data.commodities)
              ? commodityList.data.commodities.map((c) => c.name)
              : [],
          ),
    [demo, realFacilities, commodityList],
  );
  const commodities = useMemo(
    () => (picked === null ? available : available.filter((name) => picked.includes(name))),
    [picked, available],
  );

  const visible = useMemo(
    () =>
      facilities.filter(
        (facility) =>
          facility.commodities.some((commodity) => commodities.includes(commodity)) &&
          (roleFilter === 'all' || facility.roles.includes(roleFilter)),
      ),
    [facilities, commodities, roleFilter],
  );
  const pins = useMemo(() => visible.flatMap(pinsOf), [visible]);
  const books = useMemo(
    () => buildOrderBooks(facilities, commodities, fx, now),
    [facilities, commodities, fx, now],
  );
  // A facility hidden by the filters is no longer selected.
  const selected = visible.find((facility) => facility.id === selectedId) ?? null;

  const selection = { selectedId: selected?.id ?? null, onSelect: setSelectedId, now };
  const selectedBlock = selected && (
    <SelectedFacility
      facility={selected}
      commodities={commodities}
      fx={fx}
      now={now}
      onClose={() => {
        setSelectedId(null);
      }}
    />
  );

  const floating = isDesktop && overlay;
  const map = (over?: ReactNode) => (
    <div className="relative size-full overflow-hidden rounded-card border bg-muted shadow-xs">
      {mapbox.status === 'ok' && !refused ? (
        <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading map…</p>}>
          <FacilityMap
            token={mapbox.token}
            basemap="map"
            theme={theme}
            pins={pins}
            selectedId={selected?.id ?? null}
            controls="top-left"
            coveredRight={floating && bookOpen ? OVERLAY_WIDTH : 0}
            onSelect={setSelectedId}
            onTokenRefused={() => {
              setRefused(true);
            }}
          />
        </Suspense>
      ) : (
        <MapUnavailable refused={refused} />
      )}
      {over}
    </div>
  );

  // What to say when there is nothing to show from real data: loading, a failure, or none yet.
  const realState =
    real && live.status === 'loading'
      ? { short: 'Loading bids and offers…', long: <>Loading bids and offers…</> }
      : real && live.status === 'error'
        ? {
            short: `Could not load bids and offers: ${live.error.message}`,
            long: <>Could not load bids and offers: {live.error.message}</>,
          }
        : {
            short: 'No facilities with asks or bids yet.',
            long: (
              <>
                <span className="block font-medium text-foreground">No asks or bids yet.</span>
                Enter them under Bids &amp; offers. Turn on Demo data in the profile menu to try the
                workspace with made-up prices.
              </>
            ),
          };
  const facilityProps = {
    facilities: visible,
    commodities,
    fx,
    ...(demo ? {} : { emptyText: realState.short }),
    ...selection,
  };
  const bookProps = {
    books,
    selected: selectedBlock,
    empty: demo || available.length > 0 ? undefined : realState.long,
    ...selection,
  };

  return (
    <section aria-labelledby="workspace-heading" className="flex flex-col gap-4">
      {/* The menu already says where the user is; the heading is kept for screen readers. */}
      <h1 id="workspace-heading" className="sr-only">
        Workspace
      </h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CommodityPicker commodities={available} chosen={commodities} onChange={setPicked} />
        <SegmentedControl
          label="Show facilities"
          options={ROLES}
          value={roleFilter}
          onChange={setRoleFilter}
        />
        <div className="lg:ml-auto">
          <Legend />
        </div>
      </div>

      {floating ? (
        <>
          <div className="h-[calc(100dvh-11rem)] min-h-[34rem]">
            {map(
              // Flush with the map's right edge, full height. The tab on its left edge points
              // right to tuck the book away and left to bring it back.
              <div
                className={cn(
                  'absolute inset-y-0 right-0 w-[27rem] transition-transform duration-200 motion-reduce:transition-none',
                  !bookOpen && 'translate-x-full',
                )}
              >
                <button
                  type="button"
                  aria-expanded={bookOpen}
                  aria-controls="order-book"
                  onClick={() => {
                    setBookOpen((open) => !open);
                  }}
                  className="absolute top-1/2 right-full flex h-14 w-6 -translate-y-1/2 items-center justify-center rounded-l-control border border-r-0 bg-card text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
                >
                  {bookOpen ? (
                    <ChevronRight aria-hidden="true" className="size-4" />
                  ) : (
                    <ChevronLeft aria-hidden="true" className="size-4" />
                  )}
                  <span className="sr-only">
                    {bookOpen ? 'Hide order book' : 'Show order book'}
                  </span>
                </button>
                <OrderBook
                  id="order-book"
                  inert={!bookOpen}
                  className="size-full rounded-none border-0 border-l shadow-none"
                  {...bookProps}
                />
              </div>,
            )}
          </div>
          <FacilityTable {...facilityProps} />
        </>
      ) : isDesktop ? (
        <>
          <div className="h-[32rem]">{map()}</div>
          <OrderBook className="max-h-[44rem]" {...bookProps} />
          <FacilityTable {...facilityProps} />
        </>
      ) : (
        <Tabs defaultValue="map">
          <TabsList aria-label="Workspace view">
            <TabsTrigger value="map">Map</TabsTrigger>
            <TabsTrigger value="book">Order book</TabsTrigger>
            <TabsTrigger value="list">Facilities</TabsTrigger>
          </TabsList>
          <TabsContent value="map" className="flex flex-col gap-4">
            <div className="h-[60vh] min-h-80">{map()}</div>
            {selectedBlock && (
              <div className="overflow-hidden rounded-card border bg-card">{selectedBlock}</div>
            )}
          </TabsContent>
          <TabsContent value="book">
            <OrderBook {...bookProps} />
          </TabsContent>
          <TabsContent value="list">
            <FacilityList {...facilityProps} />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
