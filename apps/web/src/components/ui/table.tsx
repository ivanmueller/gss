import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

// Plain semantic table parts with the system's styles. Put a Table inside a Card; it scrolls
// sideways on its own when it is wider than the card.

export function Table({
  className,
  containerClassName,
  ...props
}: ComponentProps<'table'> & { containerClassName?: string }) {
  return (
    <div data-slot="table-container" className={cn('w-full overflow-x-auto', containerClassName)}>
      <table data-slot="table" className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('text-left text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('tabular-nums', className)} {...props} />;
}

/** A row; mark the chosen one with `selected`. */
export function TableRow({
  className,
  selected = false,
  ...props
}: ComponentProps<'tr'> & { selected?: boolean }) {
  return (
    <tr
      data-slot="table-row"
      data-selected={selected || undefined}
      className={cn(
        'border-t transition-colors hover:bg-muted/50 data-selected:bg-accent',
        className,
      )}
      {...props}
    />
  );
}

/** A column heading. */
export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn('h-9 px-4 font-medium whitespace-nowrap', className)}
      {...props}
    />
  );
}

/** The cell that names its row (the counterparty, the facility). */
export function TableRowHeader({ className, scope = 'row', ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-row-header"
      scope={scope}
      className={cn('px-4 py-2.5 text-left font-medium', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-4 py-2.5', className)} {...props} />;
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('sr-only', className)} {...props} />;
}
