import { COMMODITIES, MARKET_LABELS, MARKETS, TIERS } from '@grain/domain';
import {
  Layers,
  LayoutGrid,
  List,
  Map as MapIcon,
  PawPrint,
  Search,
  Table2,
  Wheat,
} from 'lucide-react';
import { useMemo, useState } from 'react';

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
import { Link, setSearchParams, useSearch } from '../lib/router';
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

/** Whether its tier is one of those chosen; all chosen: every counterparty, untiered too. */
export function inTier(counterparty: Pick<CounterpartySummary, 'tier'>, tiers: readonly string[]) {
  return (
    tiers.length === TIERS.length ||
    (counterparty.tier !== null && tiers.includes(counterparty.tier))
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
const TIER_OPTIONS = TIERS.map((tier) => ({ value: tier, label: `Tier ${tier}` }));

/** /counterparties: the organization's counterparties by logo (the default), as a table or on a map. */
export function CounterpartiesPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const [list, reloadList] = useApiResource<CounterpartyList>(
    `/counterparties?organization_id=${organization.id}`,
    token,
  );
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const editor = canEditDirectory(organization.role);
  const wide = useMediaQuery(WIDE_QUERY, true);

  // The view and the type filter live in the address (?view=map&type=seller), so a
  // reload or a shared link keeps them.
  const params = new URLSearchParams(useSearch());
  const view: View = VIEWS.find((item) => item === params.get('view')) ?? 'logos';
  const typeParam = params.get('type');
  const side: Side = SIDES.find((item) => item === typeParam) ?? 'all';
  // Several of each may be chosen (owner's request, 2026-10-30), kept in the address too.
  const commodities = chosenFrom(params.get('commodity'), COMMODITY_CODES);
  const markets = chosenFrom(params.get('market'), MARKETS);
  const tiers = chosenFrom(params.get('tier'), TIERS);
  // ?add=one or ?add=import opens the + window on that tab (the old adding pages' addresses).
  const addTab = ADD_TABS.find((tab) => tab === params.get('add')) ?? null;

  const all = useMemo(() => (list.status === 'ok' ? list.data.counterparties : []), [list]);
  const archivedCount = all.filter((counterparty) => counterparty.archivedAt !== null).length;
  const shown = all.filter(
    (counterparty) =>
      (showArchived || counterparty.archivedAt === null) &&
      (side === 'all' || counterparty.types.includes(side)) &&
      tradesCommodity(counterparty, commodities, side) &&
      servesMarket(counterparty, markets) &&
      inTier(counterparty, tiers) &&
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
                    setQuery(event.target.value);
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
                  setSearchParams({ type: next === 'all' ? null : next });
                }}
              />
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
                      setShowArchived(event.target.checked);
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
            <TabsContent value="map">
              <CounterpartyMap session={session} only={shownIds} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </section>
  );
}
