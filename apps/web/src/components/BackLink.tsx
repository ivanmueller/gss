import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { goBackTo } from '../lib/router';

/**
 * "← All counterparties": back to the page above this one. When this page was opened from it,
 * it returns there as it was, filters and scroll position kept (owner's request, 2026-11-04).
 */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        goBackTo(href);
      }}
      className="inline-flex w-fit items-center gap-1 rounded-control text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {children}
    </a>
  );
}
