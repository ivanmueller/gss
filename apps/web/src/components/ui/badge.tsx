import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

// Badges always carry a word (and usually an icon): colour is never the only signal.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-badge border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        outline: 'border-border text-foreground',
        info: 'border-info-border bg-info-subtle text-info',
        success: 'border-success-border bg-success-subtle text-success',
        caution: 'border-caution-border bg-caution-subtle text-caution',
        warning: 'border-warning-border bg-warning-subtle text-warning',
        danger: 'border-danger-border bg-danger-subtle text-danger',
        bid: 'border-bid-border bg-bid-subtle text-bid',
        offer: 'border-offer-border bg-offer-subtle text-offer',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
