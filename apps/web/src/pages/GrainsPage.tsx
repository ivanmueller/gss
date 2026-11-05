import { Search } from 'lucide-react';

import { GrainTile, FAMILY_CLASSES } from '../components/GrainTile';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { GRAINS, GRAIN_FAMILIES, GRAIN_SOURCES } from '../data/grains';
import { formatCheckedDate, searchGrains } from '../lib/grains';
import { Link, setSearchParams, useSearch } from '../lib/router';
import { cn } from '../lib/utils';

const BUSHELS = GRAIN_SOURCES['cgc-test-weight'];

/**
 * /grains: the grains graded in Canada as a periodic table, coloured by family, with a search
 * over their names, classes and varieties (kept in the address as ?q=). Reference only: public
 * facts from the Canadian Grain Commission and the Alberta Seed Guide, each with its source.
 */
export function GrainsPage() {
  const query = new URLSearchParams(useSearch()).get('q') ?? '';
  const results = searchGrains(query);
  const searching = query.trim() !== '';
  const found = new Set(results.map((result) => result.grain.id));

  return (
    <section aria-labelledby="grains-heading" className="flex flex-col gap-6">
      <PageHeader
        id="grains-heading"
        title="Grains"
        description="Every grain graded in Canada: its official classes and grades, varieties, test weights, moisture limits and quality. Each fact names its source."
      />

      <div className="flex flex-col gap-3">
        <label className="relative block max-w-md">
          <span className="sr-only">Search grains, classes and varieties</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            placeholder="Search a grain, class or variety, e.g. CWRS or CS Camden"
            className="pl-9"
            onChange={(event) => {
              setSearchParams({ q: event.target.value === '' ? null : event.target.value });
            }}
          />
        </label>
        <ul aria-label="Families" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {GRAIN_FAMILIES.map(({ family, label }) => (
            <li key={family} className="flex items-center gap-1.5 text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn('size-2.5 rounded-full', FAMILY_CLASSES[family].dot)}
              />
              {label}
            </li>
          ))}
        </ul>
      </div>

      {searching && (
        <Card aria-live="polite">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <ul aria-label="Search results" className="divide-y">
              {results.map((result) => (
                <li key={`${result.grain.id}:${result.detail ?? ''}:${result.name}`}>
                  <Link
                    href={`/grains/${result.grain.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm hover:bg-muted/50"
                  >
                    <span className="font-medium">{result.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {result.detail ? `${result.detail} · ` : ''}
                      {result.grain.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ul
        aria-label="The grains"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7"
      >
        {GRAINS.map((grain) => (
          <li key={grain.id}>
            <GrainTile grain={grain} dimmed={searching && !found.has(grain.id)} />
          </li>
        ))}
      </ul>

      <p className="max-w-3xl text-xs text-muted-foreground">
        A bushel is not the same in both countries: Canada uses the British Imperial (Avery)
        bushel, 36.37 L, and the United States the Winchester bushel, 35.24 L. Canadian bushel
        weights are in lb/bu-A and account for compaction; U.S. contracts usually mean lb/bu-W.
        There is no single bushels-to-tonnes factor, even for one grain: the grain’s own test
        weight decides it. Source:{' '}
        <a
          href={BUSHELS.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          {BUSHELS.publisher}, {BUSHELS.title}
        </a>{' '}
        (checked {formatCheckedDate(BUSHELS.checked)}).
      </p>
    </section>
  );
}
