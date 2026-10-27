import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps, JSX } from 'react';

import { cn } from '../../lib/utils';

type SlotProps<T extends keyof JSX.IntrinsicElements> = ComponentProps<T> & {
  /** Render the child element (a <section>, <ul>, <h3> ...) with these styles instead. */
  asChild?: boolean;
};

/** A raised panel: tables, lists and detail blocks sit in one. */
export function Card({ className, asChild = false, ...props }: SlotProps<'div'>) {
  const Component = asChild ? Slot : 'div';
  return (
    <Component
      data-slot="card"
      className={cn('rounded-card border bg-card text-card-foreground shadow-xs', className)}
      {...props}
    />
  );
}

/** The card's top row: a title, and optionally a note or actions on the right. */
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}

/** An <h2> by default; pass `asChild` with an <h3> for a deeper level. */
export function CardTitle({ className, asChild = false, ...props }: SlotProps<'h2'>) {
  const Component = asChild ? Slot : 'h2';
  return (
    <Component
      data-slot="card-title"
      className={cn('text-sm font-semibold', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-4', className)} {...props} />;
}
