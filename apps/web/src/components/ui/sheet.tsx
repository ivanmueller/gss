import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';
import { Button } from './button';

// A panel that slides over the page from the left (the menu on phones). Radix Dialog keeps
// focus inside while it is open, closes on Escape or a tap outside, and returns focus after.

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  title,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  /** Read out by screen readers when the panel opens, e.g. "Menu". */
  title: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-(--z-overlay) bg-overlay" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        aria-describedby={undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-(--z-overlay) flex w-sidebar max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3">
            <X aria-hidden="true" />
            <span className="sr-only">Close {title.toLowerCase()}</span>
          </Button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
