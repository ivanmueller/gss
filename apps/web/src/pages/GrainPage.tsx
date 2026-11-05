import { ChevronDown, ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { BackLink } from '../components/BackLink';
import { FAMILY_CLASSES, GrainSymbol } from '../components/GrainTile';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  GRAIN_SOURCES,
  familyLabel,
  grainById,
  type Grain,
  type GrainClass,
  type GrainTable,
} from '../data/grains';
import type { Citation } from '../data/grains/types';
import { classGroups, classLabel, classSlug, onSpec } from '../lib/grainClasses';
import { formatCheckedDate, sourcesOf } from '../lib/grains';
import { Link, setSearchParams, useSearch } from '../lib/router';
import { cn } from '../lib/utils';

/** "Canadian Grain Commission, Official Grain Grading Guide: Chapter 7, …" */
function Cited({ citation }: { citation: Citation }) {
  const source = GRAIN_SOURCES[citation.source];
  return (
    <p className="text-xs text-muted-foreground">
      Source:{' '}
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-4 hover:text-foreground"
      >
        {source.publisher}, {source.title}
      </a>
      {citation.where ? `: ${citation.where}` : ''}
    </p>
  );
}

function SourceTable({ table, heading = 'h3' }: { table: GrainTable; heading?: 'h2' | 'h3' }) {
  const Heading = heading;
  return (
    <div className="flex flex-col gap-2">
      <Heading className="text-sm font-semibold">{table.title}</Heading>
      <div className="rounded-control border">
        <Table>
          <TableHeader>
            <TableRow className="border-t-0 hover:bg-transparent">
              {table.columns.map((column) => (
                <TableHead key={column} className="px-3">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, index) => (
              <TableRow key={`${row[0] ?? ''}-${String(index)}`}>
                {row.map((cell, column) => (
                  <TableCell
                    key={`${table.columns[column] ?? ''}-${String(column)}`}
                    className={cn('px-3 py-2', column === 0 && 'font-medium')}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {table.note && <p className="text-xs text-muted-foreground">{table.note}</p>}
      <Cited citation={table} />
    </div>
  );
}

const VARIETIES_SHOWN = 40;

function Varieties({ grainClass }: { grainClass: GrainClass }) {
  const [all, setAll] = useState(false);
  const varieties = grainClass.varieties ?? [];
  if (varieties.length === 0) return null;
  const shown = all ? varieties : varieties.slice(0, VARIETIES_SHOWN);
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">
        Designated varieties{' '}
        <span className="font-normal text-muted-foreground">({varieties.length})</span>
      </h4>
      <ul className="flex flex-wrap gap-1.5" aria-label={`Varieties of ${grainClass.name}`}>
        {shown.map((variety) => (
          <li key={variety}>
            <Badge variant="outline">{variety}</Badge>
          </li>
        ))}
      </ul>
      {varieties.length > VARIETIES_SHOWN && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => {
            setAll((current) => !current);
          }}
        >
          {all ? 'Show fewer' : `Show all ${String(varieties.length)}`}
        </Button>
      )}
      {grainClass.varietiesCitation && <Cited citation={grainClass.varietiesCitation} />}
    </div>
  );
}

/** A button that shows or hides what follows it. */
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
      </Button>
      {open && <div className="flex flex-col gap-6">{children}</div>}
    </div>
  );
}

function Facts({ facts }: { facts: Grain['facts'] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className="text-sm font-medium">{fact.value}</dd>
          <dd>
            <Cited citation={fact} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The classes as short buttons, grouped Western, Eastern and Canada-wide. */
function ClassPicker({ grain, chosen }: { grain: Grain; chosen: GrainClass }) {
  return (
    <nav aria-label="Classes" className="flex flex-col gap-3">
      {classGroups(grain).map((group) => (
        <div key={group.title ?? 'all'} className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
          {group.title && (
            <h2 className="w-20 shrink-0 pt-1.5 text-xs font-medium text-muted-foreground">
              {group.title}
            </h2>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {group.classes.map((grainClass) => {
              const selected = grainClass === chosen;
              const label = classLabel(grainClass);
              const code =
                grainClass.abbreviation && !['CAN', 'CW', 'CE'].includes(grainClass.abbreviation)
                  ? grainClass.abbreviation
                  : null;
              return (
                <li key={grainClass.name}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    title={grainClass.name}
                    onClick={() => {
                      setSearchParams({ class: classSlug(grainClass) });
                    }}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-control border px-2.5 text-sm transition-colors',
                      selected
                        ? 'border-foreground bg-foreground text-background'
                        : 'bg-card hover:bg-muted',
                    )}
                  >
                    {code && <span className="font-mono text-xs font-semibold">{code}</span>}
                    <span>{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The chosen class: its on-spec limits by grade, the rest behind More details. */
function ClassDetail({ grain, grainClass }: { grain: Grain; grainClass: GrainClass }) {
  const spec = onSpec(grain, grainClass);
  const moisture = spec.moisture;
  const more =
    (grainClass.facts?.length ?? 0) > 0 ||
    (grainClass.tables?.length ?? 0) > 0 ||
    (grainClass.varieties?.length ?? 0) > 0;
  return (
    <Card asChild>
      <section aria-label={grainClass.name}>
        <CardHeader>
          <CardTitle asChild>
            <h2>{grainClass.name}</h2>
          </CardTitle>
          <span className="flex gap-1.5">
            {grainClass.abbreviation && (
              <Badge variant="outline" className="font-mono">
                {grainClass.abbreviation}
              </Badge>
            )}
            {grainClass.region && <Badge>{grainClass.region}</Badge>}
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">On spec</h3>
            {spec.rows.length > 0 && spec.columns.length > 1 ? (
              <div className="rounded-control border">
                <Table>
                  <TableHeader>
                    <TableRow className="border-t-0 hover:bg-transparent">
                      {spec.columns.map((heading) => (
                        <TableHead
                          key={heading}
                          className="h-auto px-2 py-2 align-bottom whitespace-normal sm:px-3"
                        >
                          {heading}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {spec.rows.map((row) => (
                      <TableRow key={row[0]}>
                        {row.map((value, index) => (
                          <TableCell
                            key={`${spec.columns[index] ?? ''}-${String(index)}`}
                            className={cn(
                              'px-2 py-2 sm:px-3',
                              index === 0 && 'font-medium whitespace-nowrap',
                            )}
                          >
                            {value}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm">
                <span className="text-muted-foreground">Grades: </span>
                {(grainClass.grades ?? []).join(', ')}
              </p>
            )}
            {moisture && (
              <p className="text-sm">
                <span className="font-medium">Moisture: {moisture.straight}%</span>
                {(moisture.tough ?? moisture.damp) && (
                  <span className="text-muted-foreground">
                    ; wetter is graded{' '}
                    {[
                      moisture.tough && moisture.tough !== 'No tough'
                        ? `Tough (${moisture.tough}%)`
                        : null,
                      moisture.damp ? `Damp (${moisture.damp}%)` : null,
                    ]
                      .filter(Boolean)
                      .join(', then ')}
                  </span>
                )}
              </p>
            )}
            {spec.tables.map((table) => (
              <Cited key={table.title} citation={table} />
            ))}
            {moisture && <Cited citation={moisture.table} />}
          </div>
          {more && (
            <Disclosure label="More details">
              <Facts facts={grainClass.facts ?? []} />
              {grainClass.tables?.map((table) => (
                <SourceTable key={table.title} table={table} />
              ))}
              <Varieties grainClass={grainClass} />
            </Disclosure>
          )}
        </CardContent>
      </section>
    </Card>
  );
}

function Sources({ grain }: { grain: Grain }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Sources</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {sourcesOf(grain).map((id) => {
          const source = GRAIN_SOURCES[id];
          return (
            <li key={id} className="flex flex-col">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 font-medium underline-offset-4 hover:underline"
              >
                {source.title}
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
              <span className="text-xs text-muted-foreground">
                {source.publisher}
                {'edition' in source ? `, ${source.edition}` : ''} · checked{' '}
                {formatCheckedDate(source.checked)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GrainDetail({ grain }: { grain: Grain }) {
  const colours = FAMILY_CLASSES[grain.family];
  const wanted = new URLSearchParams(useSearch()).get('class');
  const chosen =
    grain.classes.find((grainClass) => classSlug(grainClass) === wanted) ?? grain.classes[0];
  return (
    <section aria-labelledby="grain-heading" className="flex flex-col gap-6">
      <PageHeader
        id="grain-heading"
        back={<BackLink href="/grains">All grains</BackLink>}
        title={
          <span className="flex items-center gap-4">
            <GrainSymbol grain={grain} />
            <span className="flex flex-col gap-1">
              {grain.name}
              <span className={cn('text-sm font-medium', colours.text)}>
                {familyLabel(grain.family)}
                {grain.otherNames && grain.otherNames.length > 0
                  ? ` · also ${grain.otherNames.join(', ')}`
                  : ''}
              </span>
            </span>
          </span>
        }
      />

      {grain.classes.length > 1 && chosen && <ClassPicker grain={grain} chosen={chosen} />}
      {chosen && <ClassDetail key={classSlug(chosen)} grain={grain} grainClass={chosen} />}

      <Card asChild>
        <section aria-labelledby="grain-more">
          <CardHeader>
            <CardTitle id="grain-more">More about {grain.name.toLowerCase()}</CardTitle>
          </CardHeader>
          <CardContent>
            <Disclosure label="Show">
              <Facts facts={grain.facts} />
              {grain.tables.map((table) => (
                <SourceTable key={table.title} table={table} />
              ))}
              <Sources grain={grain} />
            </Disclosure>
          </CardContent>
        </section>
      </Card>
    </section>
  );
}

/** /grains/:id: one grain, one class at a time (?class=), the rest folded away. */
export function GrainPage({ id }: { id: string }) {
  const grain = grainById(id);
  if (!grain) {
    return (
      <p className="rounded-card border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-xs">
        There is no grain at this address.{' '}
        <Link href="/grains" className="font-medium text-foreground underline underline-offset-4">
          See all grains
        </Link>
        .
      </p>
    );
  }
  return <GrainDetail grain={grain} />;
}
