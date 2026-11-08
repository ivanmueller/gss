import {
  COMMODITIES,
  COUNTRY_NAMES,
  GRAIN_TYPE_LABELS,
  GRAIN_TYPES,
  LANE_REGIONS,
  laneCountry,
  laneRegionName,
  MARKET_LABELS,
  MARKETS,
  runsLane,
  TIERS,
} from '@grain/domain';
import {
  Layers,
  LayoutGrid,
  Leaf,
  List,
  Map as MapIcon,
  MapPinned,
  PawPrint,
  Search,
  Table2,
  Truck,
  Wheat,
} from 'lucide-react';
import { useMemo } from 'react';

import { ADD_TABS, AddCounterpartiesDialog } from '../components/AddCounterpartiesDialog';
import { CounterpartyLogo } from '../components/CounterpartyLogo';
import { CounterpartyMap } from '../components/CounterpartyMap';
import { MultiPicker } from '../components/MultiPicker';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { SegmentedControl } from '../components/ui/segmented-control';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { VerificationBadge } from '../components/VerificationBadge';
import type { CounterpartyList, CounterpartySummary } from '../lib/api';
import { canEditDirectory, countryName, typeLabel } from '../lib/directory';
import { Link, setSearchParams, useRestoredScroll, useSearch } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import { useMediaQuery } from '../lib/useMediaQuery';
import type { MeOrganization } from '../lib/useMe';

// Tailwind's `md` breakpoint: below it the table becomes a stacked list.
const WIDE_QUERY = '(min-width: 768px)';

export interface DirectorySession {
  token: string;
  organization: MeOrganization;
  /** The signed-in person's user id, when known (the person responsible for a follow-up). */
  userId?: string;
}

// Logos first, and the view a page opens on (owner's request, 2026-10-29).
const VIEWS = ['logos', 'table', 'map'] as const;
type View = (typeof VIEWS)[number];
/** Buyers, sellers or carriers only; brokers show under All. */
type Side = 'all' | 'buyer' | 'seller' | 'carrier';
const SIDES: readonly Side[] = ['buyer', 'seller', 'carrier'];

function matches(counterparty: CounterpartySummary, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return true;
  return [counterparty.legalName, counterparty.tradingName ?? '', ...counterparty.regions].some(
    (text) => text.toLowerCase().includes(wanted),
  );
}

function ArchivedBadge({ counterparty }: { counterparty: CounterpartySummary }) {
  return counterparty.archivedAt ? <Badge className="ml-2">Archived</Badge> : null;
}

function place(counterparty: CounterpartySummary): string {
  const regions = counterparty.regions.join(', ');
  return regions
    ? `${regions} · ${countryName(counterparty.primaryCountry)}`
    : countryName(counterparty.primaryCountry);
}

const nameLink = 'rounded-xs underline-offset-4 hover:underline';

function CounterpartyTable({ items, token }: { items: CounterpartySummary[]; token: string }) {
  return (
    <Card className="overflow-hidden">
      <Table className="min-w-[44rem]">
        <TableCaption>Counterparties</TableCaption>
        <TableHeader>
          <tr>
            <TableHead>Counterparty</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Where</TableHead>
            <TableHead>Contacts</TableHead>
            <TableHead>Locations</TableHead>
            <TableHead>Verification</TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {items.map((counterparty) => (
            <TableRow key={counterparty.id}>
              <TableRowHeader>
                <span className="flex items-center gap-3">
                  <CounterpartyLogo
                    counterpartyId={counterparty.id}
                    name={counterparty.legalName}
                    sha256={counterparty.logoSha256}
                    token={token}
                  />
                  <span>
                    <Link href={`/counterparties/${counterparty.id}`} className={nameLink}>
                      {counterparty.legalName}
                    </Link>
                    <ArchivedBadge counterparty={counterparty} />
                  </span>
                </span>
              </TableRowHeader>
              <TableCell>{counterparty.types.map(typeLabel).join(', ')}</TableCell>
              <TableCell>{place(counterparty)}</TableCell>
              <TableCell>{counterparty.contactCount}</TableCell>
              <TableCell>{counterparty.facilityCount}</TableCell>
              <TableCell>
                <VerificationBadge status={counterparty.verificationStatus} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Narrow-screen alternative to the table: one stacked entry per counterparty. */
function CounterpartyStack({ items, token }: { items: CounterpartySummary[]; token: string }) {
  return (
    <Card asChild>
      <ul className="divide-y" aria-label="Counterparties">
        {items.map((counterparty) => (
          <li key={counterparty.id} className="flex items-start gap-3 px-4 py-3 text-sm">
            <CounterpartyLogo
              counterpartyId={counterparty.id}
              name={counterparty.legalName}
              sha256={counterparty.logoSha256}
              token={token}
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span>
                <Link
                  href={`/counterparties/${counterparty.id}`}
                  className={`${nameLink} font-medium`}
                >
                  {counterparty.legalName}
                </Link>
                <ArchivedBadge counterparty={counterparty} />
              </span>
              <span className="text-xs text-muted-foreground">
                {counterparty.types.map(typeLabel).join(', ')} · {place(counterparty)}
              </span>
              <span className="text-xs text-muted-foreground">
                {counterparty.contactCount} contacts · {counterparty.facilityCount} locations
              </span>
              <VerificationBadge status={counterparty.verificationStatus} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LogoGrid({ items, token }: { items: CounterpartySummary[]; token: string }) {
  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      aria-label="Counterparties by logo"
    >
      {items.map((counterparty) => (
        <li key={counterparty.id}>
          <Link
            href={`/counterparties/${counterparty.id}`}
            className="flex h-full flex-col items-center gap-2 rounded-card border bg-card p-3 text-center text-sm shadow-xs transition-shadow hover:shadow-sm"
          >
            <CounterpartyLogo
              counterpartyId={counterparty.id}
              name={counterparty.legalName}
              sha256={counterparty.logoSha256}
              token={token}
              size="md"
            />
            <span className="font-medium">{counterparty.legalName}</span>
            <span className="text-xs text-muted-foreground">{place(counterparty)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Whether a counterparty trades any of the chosen commodities: buys one among buyers, sells
 * one among sellers, either otherwise. All of them chosen: every counterparty, those with
 * none listed too.
 */
export function tradesCommodity(
  counterparty: Pick<CounterpartySummary, 'buys' | 'sells'>,
  commodities: readonly string[],
  side: string,
): boolean {
  if (commodities.length === COMMODITIES.length) return true;
  const listed =
    side === 'buyer'
      ? counterparty.buys
      : side === 'seller'
        ? counterparty.sells
        : [...counterparty.buys, ...counterparty.sells];
  return listed.some((code) => commodities.includes(code));
}

/** Whether it serves any of the chosen markets; all chosen: every counterparty. */
export function servesMarket(
  counterparty: Pick<CounterpartySummary, 'markets'>,
  markets: readonly string[],
): boolean {
  return (
    markets.length === MARKETS.length ||
    counterparty.markets.some((market) => markets.includes(market))
  );
}

/**
 * Whether it sells any of the chosen grain types (owner's request, 2026-11-03); all chosen:
 * every counterparty.
 */
export function sellsGrainType(
  counterparty: Pick<CounterpartySummary, 'grainTypes'>,
  grainTypes: readonly string[],
): boolean {
  return (
    grainTypes.length === GRAIN_TYPES.length ||
    counterparty.grainTypes.some((type) => grainTypes.includes(type))
  );
}

/** Whether its tier is one of those chosen; all chosen: every counterparty, untiered too. */
export function inTier(counterparty: Pick<CounterpartySummary, 'tier'>, tiers: readonly string[]) {
  return (
    tiers.length === TIERS.length ||
    (counterparty.tier !== null && tiers.includes(counterparty.tier))
  );
}

/**
 * Whether a carrier runs a lane from one of the places chosen to one of those chosen, by its
 * lanes or its freight rates (owner's request, 2026-11-01). All chosen at both ends: every
 * counterparty, those without lanes too; none chosen at one end: none.
 */
export function onLanes(
  counterparty: Pick<CounterpartySummary, 'lanes' | 'quotedLanes'>,
  from: readonly string[],
  to: readonly string[],
): boolean {
  const anyFrom = from.length === LANE_REGIONS.length;
  const anyTo = to.length === LANE_REGIONS.length;
  if (anyFrom && anyTo) return true;
  if (from.length === 0 || to.length === 0) return false;
  return runsLane(
    [...counterparty.lanes, ...counterparty.quotedLanes],
    anyFrom ? [] : from,
    anyTo ? [] : to,
  );
}

/**
 * The values chosen in a filter kept in the address: absent means all of them;
 * "?market=pet,bird" those; "?market=" none.
 */
function chosenFrom<T extends string>(param: string | null, all: readonly T[]): T[] {
  if (param === null) return [...all];
  const named = new Set(param.split(','));
  return all.filter((value) => named.has(value));
}

/** The address value for a filter's choice: null (left out) when all are chosen. */
function paramFor(chosen: readonly string[], all: readonly string[]): string | null {
  return chosen.length === all.length ? null : chosen.join(',');
}

const COMMODITY_CODES = COMMODITIES.map((item) => item.code);
const COMMODITY_OPTIONS = COMMODITIES.map(({ code, name }) => ({ value: code, label: name }));
const MARKET_OPTIONS = MARKETS.map((market) => ({ value: market, label: MARKET_LABELS[market] }));
const GRAIN_TYPE_OPTIONS = GRAIN_TYPES.map((type) => ({
  value: type,
  label: GRAIN_TYPE_LABELS[type],
}));
const TIER_OPTIONS = TIERS.map((tier) => ({ value: tier, label: `Tier ${tier}` }));
// Canada's provinces first, then the states, each by name.
const PLACE_OPTIONS = LANE_REGIONS.map((code) => ({
  value: code,
  label: laneRegionName(code),
  country: COUNTRY_NAMES[laneCountry(code)],
}))
  .sort((a, b) => a.country.localeCompare(b.country) || a.label.localeCompare(b.label))
  .map(({ value, label }) => ({ value, label }));
const PLACE_CODES = PLACE_OPTIONS.map((option) => option.value);

/** /counterparties: the organization's counterparties by logo (the default), as a table or on a map. */
export function CounterpartiesPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const [list, reloadList] = useApiResource<CounterpartyList>(
    `/counterparties?organization_id=${organization.id}`,
    token,
  );
  const editor = canEditDirectory(organization.role);
  const wide = useMediaQuery(WIDE_QUERY, true);

  // The view and the type filter live in the address (?view=map&type=seller), so a
  // reload or a shared link keeps them.
  const params = new URLSearchParams(useSearch());
  // The search and Show archived are kept in the address too (?q=…&archived=1), so Back from
  // a counterparty returns to the same list (owner's request, 2026-11-04).
  const query = params.get('q') ?? '';
  const showArchived = params.get('archived') === '1';
  const view: View = VIEWS.find((item) => item === params.get('view')) ?? 'logos';
  const typeParam = params.get('type');
  const side: Side = SIDES.find((item) => item === typeParam) ?? 'all';
  // Several of each may be chosen (owner's request, 2026-10-30), kept in the address too.
  const commodities = chosenFrom(params.get('commodity'), COMMODITY_CODES);
  const markets = chosenFrom(params.get('market'), MARKETS);
  const grainTypes = chosenFrom(params.get('grain'), GRAIN_TYPES);
  const tiers = chosenFrom(params.get('tier'), TIERS);
  // A buyer's Market is not a seller's, which has grain types instead (owner's request,
  // 2026-11-03): among sellers only Grain type is offered, among buyers only Market, and a
  // filter not offered does not apply.
  const offersMarket = side !== 'seller';
  const offersGrainType = side === 'all' || side === 'seller';
  // Among carriers, where they load and deliver (?from=CA-AB&to=US-MT,US-ND).
  const from = chosenFrom(params.get('from'), PLACE_CODES);
  const to = chosenFrom(params.get('to'), PLACE_CODES);
  // ?add=one or ?add=import opens the + window on that tab (the old adding pages' addresses).
  const addTab = ADD_TABS.find((tab) => tab === params.get('add')) ?? null;

  const all = useMemo(() => (list.status === 'ok' ? list.data.counterparties : []), [list]);
  // Back from a counterparty: where the list was scrolled, once it shows.
  useRestoredScroll(list.status === 'ok');
  const archivedCount = all.filter((counterparty) => counterparty.archivedAt !== null).length;
  const shown = all.filter(
    (counterparty) =>
      (showArchived || counterparty.archivedAt === null) &&
      (side === 'all' || counterparty.types.includes(side)) &&
      tradesCommodity(counterparty, commodities, side) &&
      (!offersMarket || servesMarket(counterparty, markets)) &&
      (!offersGrainType || sellsGrainType(counterparty, grainTypes)) &&
      inTier(counterparty, tiers) &&
      (side !== 'carrier' || onLanes(counterparty, from, to)) &&
      matches(counterparty, query),
  );
  // The map shows the places of exactly the counterparties listed (2026-10-30).
  const shownIds = new Set(shown.map((counterparty) => counterparty.id));

  return (
    <section aria-labelledby="counterparties-heading" className="flex flex-col gap-4">
      {/* No visible title (owner's request, 2026-10-28); the menu already says where you are. */}
      <h1 id="counterparties-heading" className="sr-only">
        Counterparties
      </h1>
      {/* The tabs hold the whole page so the view switch sits in the toolbar. */}
      <Tabs
        value={view}
        onValueChange={(next) => {
          setSearchParams({ view: next === 'logos' ? null : next });
        }}
        className="gap-4"
      >
        {/* One row: search, filters and the view on the left, adding on the right. */}
        <div className="flex flex-wrap items-center gap-3">
          {list.status === 'ok' && all.length > 0 && (
            <>
              <label className="relative block w-full max-w-sm">
                <span className="sr-only">Search counterparties</span>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setSearchParams({ q: event.target.value === '' ? null : event.target.value });
                  }}
                  placeholder="Search by name, province or state"
                  className="pl-9"
                />
              </label>
              <MultiPicker
                label="Commodities"
                icon={<Wheat aria-hidden="true" className="text-muted-foreground" />}
                options={COMMODITY_OPTIONS}
                chosen={commodities}
                allLabel="All commodities"
                onChange={(next) => {
                  setSearchParams({ commodity: paramFor(next, COMMODITY_CODES) });
                }}
              />
              {offersMarket && (
                <MultiPicker
                  label="Market"
                  icon={<PawPrint aria-hidden="true" className="text-muted-foreground" />}
                  options={MARKET_OPTIONS}
                  chosen={markets}
                  allLabel="All markets"
                  onChange={(next) => {
                    setSearchParams({ market: paramFor(next, MARKETS) });
                  }}
                />
              )}
              {offersGrainType && (
                <MultiPicker
                  label="Grain type"
                  icon={<Leaf aria-hidden="true" className="text-muted-foreground" />}
                  options={GRAIN_TYPE_OPTIONS}
                  chosen={grainTypes}
                  allLabel="All grain types"
                  onChange={(next) => {
                    setSearchParams({ grain: paramFor(next, GRAIN_TYPES) });
                  }}
                />
              )}
              <MultiPicker
                label="Tier"
                icon={<Layers aria-hidden="true" className="text-muted-foreground" />}
                options={TIER_OPTIONS}
                chosen={tiers}
                allLabel="All tiers"
                onChange={(next) => {
                  setSearchParams({ tier: paramFor(next, TIERS) });
                }}
              />
              <SegmentedControl
                label="Show"
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'buyer', label: 'Buyers' },
                  { value: 'seller', label: 'Sellers' },
                  { value: 'carrier', label: 'Carriers' },
                ]}
                value={side}
                onChange={(next) => {
                  // Lane places are for carriers only, so they go with any other choice.
                  setSearchParams({
                    type: next === 'all' ? null : next,
                    ...(next !== 'carrier' && { from: null, to: null }),
                  });
                }}
              />
              {side === 'carrier' && (
                <>
                  <MultiPicker
                    label="Loads in"
                    icon={<Truck aria-hidden="true" className="text-muted-foreground" />}
                    options={PLACE_OPTIONS}
                    chosen={from}
                    allLabel="Anywhere"
                    onChange={(next) => {
                      setSearchParams({ from: paramFor(next, PLACE_CODES) });
                    }}
                  />
                  <MultiPicker
                    label="Delivers to"
                    icon={<MapPinned aria-hidden="true" className="text-muted-foreground" />}
                    options={PLACE_OPTIONS}
                    chosen={to}
                    allLabel="Anywhere"
                    onChange={(next) => {
                      setSearchParams({ to: paramFor(next, PLACE_CODES) });
                    }}
                  />
                </>
              )}
              <TabsList aria-label="Counterparty view">
                {/* Icons only (owner's request, 2026-10-30); the name is read out and shown on hover. */}
                <TabsTrigger value="logos" aria-label="Logos" title="Logos" className="px-2.5">
                  <LayoutGrid aria-hidden="true" className="size-4" />
                </TabsTrigger>
                <TabsTrigger
                  value="table"
                  aria-label={wide ? 'Table' : 'List'}
                  title={wide ? 'Table' : 'List'}
                  className="px-2.5"
                >
                  {wide ? (
                    <Table2 aria-hidden="true" className="size-4" />
                  ) : (
                    <List aria-hidden="true" className="size-4" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="map" aria-label="Map" title="Map" className="px-2.5">
                  <MapIcon aria-hidden="true" className="size-4" />
                </TabsTrigger>
              </TabsList>
              {archivedCount > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={showArchived}
                    onChange={(event) => {
                      setSearchParams({ archived: event.target.checked ? '1' : null });
                    }}
                  />
                  Show archived ({archivedCount})
                </label>
              )}
            </>
          )}
          {editor && (
            <AddCounterpartiesDialog
              session={session}
              initialTab={addTab}
              onImported={reloadList}
            />
          )}
        </div>

        {list.status === 'loading' && (
          <p className="text-sm text-muted-foreground">Loading counterparties…</p>
        )}
        {list.status === 'error' && (
          <p role="alert" className="text-sm text-danger">
            Could not load counterparties: {list.error.message}
          </p>
        )}
        {list.status === 'ok' && all.length === 0 && (
          <Card className="px-4 py-10 text-center text-sm">
            <p className="font-medium">No counterparties yet.</p>
            <p className="text-muted-foreground">
              {editor
                ? 'Add one by hand or import your spreadsheet.'
                : 'An operations or admin member can add them.'}
            </p>
          </Card>
        )}
        {list.status === 'ok' && all.length > 0 && (
          <>
            {view !== 'map' && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {shown.length} of {all.length} shown
                {list.data.truncated && ' · the list is cut at 5,000; search to narrow it'}
              </p>
            )}
            <TabsContent value="table">
              {wide ? (
                <CounterpartyTable items={shown} token={token} />
              ) : (
                <CounterpartyStack items={shown} token={token} />
              )}
            </TabsContent>
            <TabsContent value="logos">
              <LogoGrid items={shown} token={token} />
            </TabsContent>
            <TabsContent value="map" className="flex flex-col gap-3">
              {/* No Find missing coordinates here (the owner's request of 2026-11-08, F-139):
                  locations are looked up after every import and on a company's page. */}
              <CounterpartyMap session={session} only={shownIds} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </section>
  );
}
