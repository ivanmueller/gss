import { COMMODITIES } from '@grain/domain';
import {
  FileUp,
  LayoutGrid,
  List,
  Map as MapIcon,
  PencilLine,
  Plus,
  Search,
  Table2,
  Wheat,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { CounterpartyLogo } from '../components/CounterpartyLogo';
import { CounterpartyMap } from '../components/CounterpartyMap';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { SegmentedControl } from '../components/ui/segmented-control';
import { Select } from '../components/ui/select';
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
                    {counterparty.tradingName && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {counterparty.tradingName}
                      </span>
                    )}
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
 * One + button for operations and admins that opens a window to choose how to add
 * counterparties: one by hand, or many from a spreadsheet (owner's request, 2026-10-30).
 */
function AddCounterparties() {
  const choice =
    'flex items-start gap-3 rounded-card border bg-card p-4 text-left transition-colors hover:bg-accent';
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          size="icon"
          className="ml-auto"
          aria-label="Add counterparties"
          title="Add counterparties"
        >
          <Plus aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add counterparties"
        description="Add one company yourself, or many at once from a spreadsheet."
      >
        <nav aria-label="Ways to add" className="grid gap-3 sm:grid-cols-2">
          <Link href="/counterparties/new" className={choice}>
            <PencilLine
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Add by hand</span>
              <span className="text-sm text-muted-foreground">
                One company, with its first contact and location.
              </span>
            </span>
          </Link>
          <Link href="/counterparties/import" className={choice}>
            <FileUp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Import spreadsheet</span>
              <span className="text-sm text-muted-foreground">
                Many companies from a CSV file, checked before anything is saved.
              </span>
            </span>
          </Link>
        </nav>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Whether a counterparty trades the chosen commodity: buys it among buyers, sells it among
 * sellers, either otherwise. No commodity chosen: every counterparty.
 */
export function tradesCommodity(
  counterparty: Pick<CounterpartySummary, 'buys' | 'sells'>,
  commodity: string | null,
  side: string,
): boolean {
  if (commodity === null) return true;
  if (side === 'buyer') return counterparty.buys.includes(commodity);
  if (side === 'seller') return counterparty.sells.includes(commodity);
  return counterparty.buys.includes(commodity) || counterparty.sells.includes(commodity);
}

/** /counterparties: the organization's counterparties by logo (the default), as a table or on a map. */
export function CounterpartiesPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const [list] = useApiResource<CounterpartyList>(
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
  const commodityParam = params.get('commodity');
  const commodity = COMMODITIES.some((item) => item.code === commodityParam)
    ? commodityParam
    : null;

  const all = useMemo(() => (list.status === 'ok' ? list.data.counterparties : []), [list]);
  const archivedCount = all.filter((counterparty) => counterparty.archivedAt !== null).length;
  const shown = all.filter(
    (counterparty) =>
      (showArchived || counterparty.archivedAt === null) &&
      (side === 'all' || counterparty.types.includes(side)) &&
      tradesCommodity(counterparty, commodity, side) &&
      matches(counterparty, query),
  );
  // The map narrows to what the search and the commodity find; without them it shows every
  // location.
  const searched = useMemo(
    () =>
      query.trim() === '' && commodity === null
        ? null
        : new Set(
            all
              .filter(
                (counterparty) =>
                  matches(counterparty, query) && tradesCommodity(counterparty, commodity, side),
              )
              .map((item) => item.id),
          ),
    [all, query, commodity, side],
  );

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
              <Select
                aria-label="Commodity"
                className="w-52"
                icon={<Wheat aria-hidden="true" className="text-muted-foreground" />}
                value={commodity ?? ''}
                onValueChange={(next) => {
                  setSearchParams({ commodity: next || null });
                }}
                options={[
                  { value: '', label: 'All commodities' },
                  ...COMMODITIES.map(({ code, name }) => ({ value: code, label: name })),
                ]}
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
          {editor && <AddCounterparties />}
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
              <CounterpartyMap
                session={session}
                type={side === 'all' ? null : side}
                only={searched}
              />
            </TabsContent>
          </>
        )}
      </Tabs>
    </section>
  );
}
