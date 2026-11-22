import { ChevronDown, ChevronRight, X } from 'lucide-react';

import { cn } from '../lib/utils';

/**
 * The pieces of the oil and gas map's side card (F-267; the owner, 2026-11-22, from three
 * pictures of another map: one card, its sections opening one at a time, each with the play it
 * is narrowed to, a small sample of its colours and a switch). Shared by Land sales, Land today
 * and Wells & licences, so the three read alike.
 */

/** A small capital heading over a field or a group of chips. */
export const SIDE_LABEL =
  'text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase';

/** The card's one accent: the open section's title and edge. */
export const SIDE_ACCENT = '#d9541e';

/** A field of the card: a text box, or a dark list for the play chosen. */
export const SIDE_INPUT = 'h-9 w-full rounded-md border bg-card px-2.5 text-sm';
export const SIDE_SELECT =
  'h-9 w-full rounded-md border border-foreground bg-foreground px-2.5 text-sm font-semibold text-background';

/** An on and off switch, drawn as a pill. */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => {
        onChange(!checked);
      }}
      className="relative h-5 w-9 shrink-0 rounded-full bg-muted-foreground/30 transition-colors aria-checked:bg-foreground"
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-xs transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

/**
 * One section of the card: its title opens and closes it, the chip names the play it is
 * narrowed to (its × lets the play go), the sample shows its colours and the switch takes it
 * off the map. Open, its title and left edge are in the accent.
 */
export function MapSection({
  title,
  open,
  onToggle,
  on,
  onSwitch,
  chip,
  onClearChip,
  sample,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  on: boolean;
  onSwitch: (on: boolean) => void;
  chip?: string | null;
  onClearChip?: () => void;
  sample?: React.ReactNode;
  children: React.ReactNode;
}) {
  const shown = open && on;
  const Arrow = shown ? ChevronDown : ChevronRight;
  return (
    <section
      aria-label={title}
      className={cn('border-t border-l-[3px] border-l-transparent pr-4 pl-[13px]')}
      style={
        shown ? { borderLeftColor: SIDE_ACCENT, backgroundColor: `${SIDE_ACCENT}0f` } : undefined
      }
    >
      <div className="flex items-center gap-2 py-3">
        <button
          type="button"
          aria-expanded={shown}
          onClick={onToggle}
          className="flex min-w-0 grow items-center gap-2 text-left text-[0.9375rem] font-semibold"
        >
          <Arrow aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate" style={shown ? { color: SIDE_ACCENT } : undefined}>
            {title}
          </span>
        </button>
        {chip && on && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground py-0.5 pr-1.5 pl-2.5 text-xs font-semibold text-background">
            {chip}
            {onClearChip && (
              <button
                type="button"
                aria-label={`${title}: every play`}
                onClick={onClearChip}
                className="rounded-full opacity-80 hover:opacity-100"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            )}
          </span>
        )}
        {sample}
        <Toggle label={title} checked={on} onChange={onSwitch} />
      </div>
      {shown && <div className="flex flex-col gap-3 pb-4">{children}</div>}
    </section>
  );
}

/** A chip that is on or off: a status shown, a period chosen. */
export function FilterChip({
  pressed,
  onClick,
  dot,
  plain = false,
  disabled,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  /** A dot in a status's colour, before the words. */
  dot?: string;
  /** No edge until it is chosen: the periods of a row of choices. */
  plain?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium hover:bg-muted disabled:opacity-40 aria-pressed:bg-foreground aria-pressed:font-semibold aria-pressed:text-background',
        !plain && 'border bg-card aria-pressed:border-foreground',
      )}
    >
      {dot && (
        <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: dot }} />
      )}
      {children}
    </button>
  );
}

/** A part of a section folded away until asked for: its name, and a few words beside it. */
export function Fold({
  label,
  note,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-t pt-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <span className={cn(SIDE_LABEL, 'text-foreground/80')}>{label}</span>
        {note && (
          <span className="ml-auto truncate font-mono text-[0.6875rem] text-muted-foreground">
            {note}
          </span>
        )}
      </summary>
      <div className="mt-2.5 flex flex-col gap-2">{children}</div>
    </details>
  );
}

/** A row with a switch of its own inside a section: a kind of land. */
export function SwitchRow({
  title,
  note,
  checked,
  onChange,
}: {
  title: string;
  note: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      <span className="grow font-medium">{title}</span>
      <span className={SIDE_LABEL}>{note}</span>
      <Toggle label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

/** A heading of the legend card. */
export function LegendTitle({ children }: { children: React.ReactNode }) {
  return <p className={SIDE_LABEL}>{children}</p>;
}
