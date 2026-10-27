import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

const calloutVariants = cva(
  'flex items-start gap-2.5 rounded-card border px-3 py-2.5 text-sm [&_strong]:font-semibold',
  {
    variants: {
      variant: {
        neutral: 'bg-card text-muted-foreground [&_strong]:text-foreground',
        info: 'border-info-border bg-info-subtle text-foreground [&>svg]:text-info',
        success: 'border-success-border bg-success-subtle text-foreground [&>svg]:text-success',
        caution: 'border-caution-border bg-caution-subtle text-foreground [&>svg]:text-caution',
        warning: 'border-warning-border bg-warning-subtle text-foreground [&>svg]:text-warning',
        danger: 'border-danger-border bg-danger-subtle text-foreground [&>svg]:text-danger',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

/**
 * A boxed message: a note about the page (role "note", the default), or "alert" for an
 * error the user must see. The icon and the wording carry the meaning, not only the colour.
 */
export function Callout({
  className,
  variant,
  icon: Icon,
  children,
  role = 'note',
  ...props
}: ComponentProps<'div'> & VariantProps<typeof calloutVariants> & { icon?: LucideIcon }) {
  return (
    <div
      data-slot="callout"
      role={role}
      className={cn(calloutVariants({ variant }), className)}
      {...props}
    >
      {Icon && <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
