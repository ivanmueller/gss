import { X } from 'lucide-react';

import { cn } from '../lib/utils';

/**
 * The oil and gas map's two ways of showing what is on it (F-265; the owner, 2026-11-22, from
 * pictures of another map): a small box at the pointer with a few simple lines, and a panel
 * that slides in from the right with everything about the parcel, land or well clicked.
 */

const LABEL = 'text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase';

/** The box at the pointer. The map places and moves it (FacilityMap's `hoverBox`). */
export function MapTip({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="w-64 rounded-card border bg-card px-3 py-2.5 text-sm shadow-md">
      {children}
    </div>
  );
}

/** A tip's first line: what it is, in bold, with a date or a note at the right. */
export function TipHead({ title, aside }: { title: string; aside?: string | null }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="font-mono font-semibold">{title}</span>
      {aside && <span className="shrink-0 font-mono text-xs text-muted-foreground">{aside}</span>}
    </p>
  );
}

/**
 * The panel on the right of the map: a heading (a small line above a large title), a close
 * button, and whatever sections its content brings. It scrolls within the map's height.
 */
export function MapPanel({
  label,
  eyebrow,
  title,
  aside,
  onClose,
  children,
}: {
  /** Read out for the panel, e.g. "Sale parcel B0102". */
  label: string;
  eyebrow: string;
  title: string;
  /** Beside the title, smaller: a date, a tract. */
  aside?: string | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      role="dialog"
      aria-label={label}
      className="absolute top-3 right-3 z-30 flex max-h-[calc(100%-3.5rem)] w-[26rem] max-w-[calc(100%-1.5rem)] animate-panel-in flex-col overflow-y-auto rounded-card border bg-card text-sm shadow-lg"
    >
      <header className="flex items-start gap-3 px-5 pt-4">
        <div className="min-w-0 grow">
          <p className={LABEL}>{eyebrow}</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
            <span className="font-mono text-2xl font-semibold break-all">{title}</span>
            {aside && <span className="font-mono text-sm text-muted-foreground">{aside}</span>}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="shrink-0 rounded-md border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>
      <div className="flex flex-col px-5 pb-4">{children}</div>
    </aside>
  );
}

/** A part of the panel under a small heading, a line above it. */
export function PanelSection({
  title,
  count,
  children,
  className,
}: {
  title: string;
  /** How many it lists, beside the heading. */
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mt-4 border-t pt-3', className)} aria-label={title}>
      <h3 className={LABEL}>
        {title}
        {count !== undefined && <span className="ml-1.5 font-normal">{count}</span>}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** The figures under the heading, side by side: a small label over each value. */
export function PanelTiles({ tiles }: { tiles: readonly { label: string; value: string }[] }) {
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-md border px-2.5 py-2">
          <dt className="truncate text-[0.625rem] font-medium tracking-wider text-muted-foreground uppercase">
            {tile.label}
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A status word in a small box, in the colour given (its text, edge and a faint fill). */
export function PanelBadge({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span
      className="mt-2.5 inline-flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tracking-wide uppercase"
      style={{ color: colour, borderColor: `${colour}66`, backgroundColor: `${colour}14` }}
    >
      {children}
    </span>
  );
}
