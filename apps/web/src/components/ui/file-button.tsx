import type { ChangeEvent, ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { buttonVariants, type ButtonVariants } from './button';

/**
 * A button that opens the file chooser. It is the file input's label, so the input is
 * named by the button's text ("Choose CSV file") for screen readers and tests alike.
 */
export function FileButton({
  accept,
  disabled = false,
  onChange,
  variant = 'outline',
  size,
  className,
  children,
}: {
  accept: string;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  children: ReactNode;
} & ButtonVariants) {
  return (
    <label
      className={cn(
        buttonVariants({ variant, size }),
        'w-fit cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {children}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled}
        onChange={onChange}
      />
    </label>
  );
}
