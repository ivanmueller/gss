import { FileUp, Search } from 'lucide-react';
import { useState } from 'react';

import { CounterpartyLogo } from '../components/CounterpartyLogo';
import { PageHeader } from '../components/PageHeader';
import { RealDataNote } from '../components/RealDataNote';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
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
import { Link } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import { useMediaQuery } from '../lib/useMediaQuery';
import type { MeOrganization } from '../lib/useMe';

// Tailwind's `md` breakpoint: below it the table becomes a stacked list.
const WIDE_QUERY = '(min-width: 768px)';

export interface DirectorySession {
  token: string;
  organization: MeOrganization;
}

function matches(counterparty: CounterpartySummary, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return true;
  return [counterparty.legalName, counterparty.tradingName ?? '', ...counterparty.regions].some(
    (text) => text.toLowerCase().includes(wanted),
  );
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
              <Link
                href={`/counterparties/${counterparty.id}`}
                className={`${nameLink} font-medium`}
              >
                {counterparty.legalName}
              </Link>
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

/** /counterparties: the organization's directory as a table or as logos. */
export function CounterpartiesPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const [list] = useApiResource<CounterpartyList>(
    `/counterparties?organization_id=${organization.id}`,
    token,
  );
  const [query, setQuery] = useState('');
  const editor = canEditDirectory(organization.role);
  const wide = useMediaQuery(WIDE_QUERY, true);

  const all = list.status === 'ok' ? list.data.counterparties : [];
  const shown = all.filter((counterparty) => matches(counterparty, query));

  return (
    <section aria-labelledby="counterparties-heading" className="flex flex-col gap-4">
      <PageHeader
        id="counterparties-heading"
        title="Counterparties"
        description={`Buyers, sellers, brokers and carriers of ${organization.name}.`}
        actions={
          editor && (
            <Button asChild>
              <Link href="/counterparties/import">
                <FileUp aria-hidden="true" />
                Import spreadsheet
              </Link>
            </Button>
          )
        }
      />
      <RealDataNote organization={organization.name} />

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
              ? 'Import your spreadsheet to add them.'
              : 'An operations or admin member of your organization can import them.'}
          </p>
        </Card>
      )}
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
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {shown.length} of {all.length} shown
            {list.data.truncated && ' · the list is cut at 5,000; search to narrow it'}
          </p>
          <Tabs defaultValue="table">
            <TabsList aria-label="Counterparty view">
              <TabsTrigger value="table">{wide ? 'Table' : 'List'}</TabsTrigger>
              <TabsTrigger value="logos">Logos</TabsTrigger>
            </TabsList>
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
          </Tabs>
        </>
      )}
    </section>
  );
}
