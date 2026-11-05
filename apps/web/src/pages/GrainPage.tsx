import { ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { BackLink } from '../components/BackLink';
import { FAMILY_CLASSES, GrainSymbol } from '../components/GrainTile';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
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
import { formatCheckedDate, sourcesOf } from '../lib/grains';
import { Link } from '../lib/router';
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

function ClassCard({ grainClass }: { grainClass: GrainClass }) {
  return (
    <Card asChild>
      <section aria-label={grainClass.name}>
        <CardHeader>
          <CardTitle asChild>
            <h3>{grainClass.name}</h3>
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
        <CardContent className="flex flex-col gap-5">
          {grainClass.grades && grainClass.grades.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">Grades</h4>
              <ol className="flex flex-wrap gap-1.5" aria-label={`Grades of ${grainClass.name}`}>
                {grainClass.grades.map((grade) => (
                  <li key={grade}>
                    <Badge variant="outline">{grade}</Badge>
                  </li>
                ))}
              </ol>
              {grainClass.gradesCitation && <Cited citation={grainClass.gradesCitation} />}
            </div>
          )}
          {grainClass.facts && grainClass.facts.length > 0 && (
            <dl className="grid gap-3 sm:grid-cols-2">
              {grainClass.facts.map((fact) => (
                <div key={fact.label} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                  <dd className="text-sm font-medium">{fact.value}</dd>
                  <dd>
                    <Cited citation={fact} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {grainClass.tables?.map((table) => (
            <SourceTable key={table.title} table={table} heading="h3" />
          ))}
          <Varieties grainClass={grainClass} />
        </CardContent>
      </section>
    </Card>
  );
}

function GrainDetail({ grain }: { grain: Grain }) {
  const colours = FAMILY_CLASSES[grain.family];
  const sources = sourcesOf(grain);
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

      {grain.facts.length > 0 && (
        <Card asChild>
          <section aria-labelledby="grain-facts">
            <CardHeader>
              <CardTitle id="grain-facts">Key facts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {grain.facts.map((fact) => (
                  <div key={fact.label} className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                    <dd className="text-sm font-medium">{fact.value}</dd>
                    <dd>
                      <Cited citation={fact} />
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </section>
        </Card>
      )}

      {grain.classes.length > 0 && (
        <section aria-labelledby="grain-classes" className="flex flex-col gap-3">
          <h2 id="grain-classes" className="text-lg font-semibold">
            Classes and grades{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({grain.classes.length})
            </span>
          </h2>
          {grain.classes.length > 3 && (
            <nav aria-label="Classes" className="flex flex-wrap gap-1.5">
              {grain.classes.map((grainClass, index) => (
                <a
                  key={grainClass.name}
                  href={`#class-${String(index)}`}
                  className="rounded-badge border px-1.5 py-0.5 text-xs font-medium hover:bg-muted"
                >
                  {grainClass.abbreviation ?? grainClass.name}
                </a>
              ))}
            </nav>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            {grain.classes.map((grainClass, index) => (
              <div key={grainClass.name} id={`class-${String(index)}`} className="scroll-mt-20">
                <ClassCard grainClass={grainClass} />
              </div>
            ))}
          </div>
        </section>
      )}

      {grain.tables.length > 0 && (
        <Card asChild>
          <section aria-labelledby="grain-tables">
            <CardHeader>
              <CardTitle id="grain-tables">Moisture, quality and varieties</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {grain.tables.map((table) => (
                <SourceTable key={table.title} table={table} />
              ))}
            </CardContent>
          </section>
        </Card>
      )}

      <Card asChild>
        <section aria-labelledby="grain-sources">
          <CardHeader>
            <CardTitle id="grain-sources">Sources</CardTitle>
            <CardDescription>Public reference information, copied as published.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {sources.map((id) => {
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
          </CardContent>
        </section>
      </Card>
    </section>
  );
}

/** /grains/:id: one grain's facts, classes and grades, tables and sources. */
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
