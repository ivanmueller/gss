import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Button } from './button';

// A pop-up window over the page, centred (the website preview). Radix Dialog keeps focus
// inside while it is open, closes on Escape or a click outside, and returns focus after.

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  title,
  actions,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  /** Shown at the top and read out by screen readers when the window opens. */
  title: string;
  /** Buttons or links beside the title, before the close button. */
  actions?: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-(--z-overlay) bg-overlay" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-describedby={undefined}
        className={cn(
          'fixed top-1/2 left-1/2 z-(--z-overlay) flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card border bg-card text-card-foreground shadow-lg outline-none',
          className,
        )}
        {...props}
      >
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </DialogPrimitive.Title>
          {actions}
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm">
              <X aria-hidden="true" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
