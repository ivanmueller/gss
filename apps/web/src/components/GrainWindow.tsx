import type { Grain } from '../data/grains';
import { GRAIN_SOURCES, familyLabel } from '../data/grains';
import { classLabel, classSlug, onSpec } from '../lib/grainClasses';
import { grainVarieties, shownClasses } from '../lib/grainWindow';
import { setSearchParams } from '../lib/router';
import { cn } from '../lib/utils';
import { FAMILY_CLASSES } from './GrainTile';
import { Dialog, DialogContent } from './ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

/**
 * A grain in a window over the Grains table (owner's request, 2026-11-05): the classes most
 * grown on the Prairies as buttons, and for the chosen one only what is on spec: each grade's
 * minimum test weight and protein, the moisture, and its most grown varieties.
 */
export function GrainWindow({
  grain,
  classParam,
  onClose,
}: {
  grain: Grain;
  /** ?class= from the address: the class chosen, else the most grown. */
  classParam: string | null;
  onClose: () => void;
}) {
  const classes = shownClasses(grain);
  const chosen = classes.find((shown) => classSlug(shown.grainClass) === classParam) ?? classes[0];
  const spec = chosen ? onSpec(grain, chosen.grainClass) : undefined;
  const ownVarieties = chosen !== undefined && chosen.varieties.length > 0;
  const varieties = ownVarieties ? chosen.varieties : grainVarieties(grain);
  const colours = FAMILY_CLASSES[grain.family];
  const guide = GRAIN_SOURCES['cgc-oggg'];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={grain.name}
        description={
          <span className={cn('font-medium', colours.text)}>{familyLabel(grain.family)}</span>
        }
        className="max-w-xl animate-dialog-in"
      >
        {classes.length > 1 && (
          <div role="group" aria-label="Classes" className="flex flex-wrap gap-1.5">
            {classes.map(({ grainClass }) => {
              const selected = grainClass === chosen?.grainClass;
              const code =
                grainClass.abbreviation && !['CAN', 'CW', 'CE'].includes(grainClass.abbreviation)
                  ? grainClass.abbreviation
                  : null;
              return (
                <button
                  key={grainClass.name}
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
                  {code && (
                    <>
                      <span className="font-mono text-xs font-semibold">{code}</span>{' '}
                    </>
                  )}
                  <span>{classLabel(grainClass)}</span>
                </button>
              );
            })}
          </div>
        )}

        {chosen && spec && (
          <section
            aria-label={`On spec: ${chosen.grainClass.name}`}
            className="flex flex-col gap-3"
          >
            <h3 className="text-sm font-semibold">
              On spec
              <span className="font-normal text-muted-foreground"> · {chosen.grainClass.name}</span>
            </h3>
            {spec.columns.length > 1 ? (
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
                {(chosen.grainClass.grades ?? []).join(', ')}
              </p>
            )}
            {spec.moisture && (
              <p className="text-sm">
                <span className="text-muted-foreground">Moisture: </span>
                <span className="font-medium">{spec.moisture.straight}%</span>
              </p>
            )}
            {varieties.length > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">
                  Most grown{!ownVarieties && classes.length > 1 ? ' (all classes)' : ''}:{' '}
                </span>
                {varieties.join(', ')}
              </p>
            )}
          </section>
        )}

        <p className="text-xs text-muted-foreground">
          Grades:{' '}
          <a
            href={guide.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {guide.publisher}, {guide.title}
          </a>{' '}
          ({guide.edition}). Classes and varieties by acres insured in Alberta, Saskatchewan and
          Manitoba,{' '}
          <a
            href={GRAIN_SOURCES['cgc-acreage-2025-cereals'].url.replace(/[^/]+\/[^/]+$/, '')}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            2025
          </a>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
