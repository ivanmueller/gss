import { FileUp, Search } from 'lucide-react';
import { useState } from 'react';

import { CounterpartyLogo } from '../components/CounterpartyLogo';
import { RealDataNote } from '../components/RealDataNote';
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

function CounterpartyTable({ items, token }: { items: CounterpartySummary[]; token: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">Counterparties</caption>
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              Counterparty
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Type
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Where
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Contacts
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Locations
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Verification
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((counterparty) => (
            <tr key={counterparty.id} className="border-t align-middle">
              <th scope="row" className="px-4 py-2 text-left font-medium">
                <span className="flex items-center gap-3">
                  <CounterpartyLogo
                    counterpartyId={counterparty.id}
                    name={counterparty.legalName}
                    sha256={counterparty.logoSha256}
                    token={token}
                  />
                  <span>
                    <Link
                      href={`/counterparties/${counterparty.id}`}
                      className="rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {counterparty.legalName}
                    </Link>
                    {counterparty.tradingName && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {counterparty.tradingName}
                      </span>
                    )}
                  </span>
                </span>
              </th>
              <td className="px-4 py-2">{counterparty.types.map(typeLabel).join(', ')}</td>
              <td className="px-4 py-2">{place(counterparty)}</td>
              <td className="px-4 py-2 tabular-nums">{counterparty.contactCount}</td>
              <td className="px-4 py-2 tabular-nums">{counterparty.facilityCount}</td>
              <td className="px-4 py-2">
                <VerificationBadge status={counterparty.verificationStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Narrow-screen alternative to the table: one stacked entry per counterparty. */
function CounterpartyStack({ items, token }: { items: CounterpartySummary[]; token: string }) {
  return (
    <ul className="divide-y rounded-xl border bg-card" aria-label="Counterparties">
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
              className="font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
            className="flex h-full flex-col items-center gap-2 rounded-xl border bg-card p-3 text-center text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="counterparties-heading" className="text-lg font-semibold">
            Counterparties
          </h2>
          <p className="text-sm text-muted-foreground">
            Buyers, sellers, brokers and carriers of {organization.name}.
          </p>
        </div>
        {editor && (
          <Link
            href="/counterparties/import"
            className="inline-flex items-center gap-2 rounded-md border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <FileUp aria-hidden="true" className="size-4" />
            Import spreadsheet
          </Link>
        )}
      </div>
      <RealDataNote organization={organization.name} />

      {list.status === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading counterparties…</p>
      )}
      {list.status === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          Could not load counterparties: {list.error.message}
        </p>
      )}
      {list.status === 'ok' && all.length === 0 && (
        <div className="rounded-xl border bg-card px-4 py-8 text-center text-sm">
          <p className="font-medium">No counterparties yet.</p>
          <p className="text-muted-foreground">
            {editor
              ? 'Import your spreadsheet to add them.'
              : 'An operations or admin member of your organization can import them.'}
          </p>
        </div>
      )}
      {list.status === 'ok' && all.length > 0 && (
        <>
          <label className="flex max-w-sm items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="sr-only">Search counterparties</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search by name, province or state"
              className="w-full bg-transparent outline-none"
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
