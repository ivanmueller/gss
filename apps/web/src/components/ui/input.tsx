import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

// 16 px text below the `sm` breakpoint stops phones from zooming in when a field is focused.
const fieldClass =
  'h-9 w-full min-w-0 rounded-control border border-input bg-background px-3 text-base text-foreground shadow-xs transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger sm:text-sm';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(fieldClass, className)} {...props} />;
}

/** A native select, styled like Input; the browser draws its list. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select data-slot="select" className={cn(fieldClass, 'px-2', className)} {...props} />;
}

/** Several lines of text, styled like Input. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, 'h-auto min-h-20 py-2', className)}
      {...props}
    />
  );
}
