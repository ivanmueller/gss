import type { Grain, GrainFamily } from '../data/grains';
import { familyLabel } from '../data/grains';
import { Link } from '../lib/router';
import { cn } from '../lib/utils';

/** Each family's tile colours (themes.css, grain-*); written out so Tailwind finds them. */
export const FAMILY_CLASSES: Record<GrainFamily, { tile: string; text: string; dot: string }> = {
  wheat: {
    tile: 'border-grain-wheat-border bg-grain-wheat-subtle',
    text: 'text-grain-wheat',
    dot: 'bg-grain-wheat',
  },
  coarse: {
    tile: 'border-grain-coarse-border bg-grain-coarse-subtle',
    text: 'text-grain-coarse',
    dot: 'bg-grain-coarse',
  },
  oilseed: {
    tile: 'border-grain-oilseed-border bg-grain-oilseed-subtle',
    text: 'text-grain-oilseed',
    dot: 'bg-grain-oilseed',
  },
  pulse: {
    tile: 'border-grain-pulse-border bg-grain-pulse-subtle',
    text: 'text-grain-pulse',
    dot: 'bg-grain-pulse',
  },
  special: {
    tile: 'border-grain-special-border bg-grain-special-subtle',
    text: 'text-grain-special',
    dot: 'bg-grain-special',
  },
};

/** The tile's facts: those named in `tileFacts`, each its label above its value. */
function tileFacts(grain: Grain) {
  return (grain.tileFacts ?? [])
    .map((label) => grain.facts.find((fact) => fact.label === label))
    .filter((fact) => fact !== undefined);
}

/** The square symbol of a grain, as on its tile; also the top of its page. */
export function GrainSymbol({ grain, className }: { grain: Grain; className?: string }) {
  const colours = FAMILY_CLASSES[grain.family];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex size-16 shrink-0 items-center justify-center rounded-card border font-price text-2xl font-semibold',
        colours.tile,
        colours.text,
        className,
      )}
    >
      <span className="absolute top-1 left-1.5 text-2xs font-medium tabular-nums">
        {grain.number}
      </span>
      {grain.symbol}
    </span>
  );
}

/** One element of the table: number, symbol, name, a key fact and its family in words. */
export function GrainTile({ grain, dimmed = false }: { grain: Grain; dimmed?: boolean }) {
  const colours = FAMILY_CLASSES[grain.family];
  const facts = tileFacts(grain);
  return (
    <Link
      href={`/grains/${grain.id}`}
      className={cn(
        'group flex h-full min-h-36 flex-col gap-1 rounded-card border p-3 shadow-xs transition-[box-shadow,opacity] hover:shadow-sm',
        colours.tile,
        dimmed && 'opacity-40',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className={cn('text-xs font-medium tabular-nums', colours.text)}>{grain.number}</span>
        <span className={cn('text-2xs font-medium', colours.text)}>
          {familyLabel(grain.family)}
        </span>
      </span>
      <span className={cn('font-price text-3xl leading-none font-semibold', colours.text)}>
        {grain.symbol}
      </span>
      <span className="text-sm font-semibold text-foreground group-hover:underline group-hover:underline-offset-4">
        {grain.name}
      </span>
      {facts.map((fact) => (
        <span key={fact.label} className="flex flex-col text-xs text-muted-foreground">
          {fact.label}
          <span className="font-medium text-foreground tabular-nums">{fact.value}</span>
        </span>
      ))}
    </Link>
  );
}
